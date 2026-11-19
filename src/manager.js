/**
 * Composition manager: serialized graph mutations over the durable store.
 *
 * One write chain per root session prevents two UI clicks from interleaving a
 * read-modify-write. The manager owns the two policies the pure graph model
 * deliberately does not know: a composition must exist before a mutation, and
 * the root-session node can never be removed from its own composition.
 */

import { createHash, randomUUID } from 'node:crypto'

import {
  CompositionError,
  addNode as addGraphNode,
  assertComposition,
  ancestorsOf,
  attachSubtree,
  createComposition,
  descendantsOf,
  detachSubtree,
  isAncestor,
  removeNode as removeGraphNode,
  removeSubtree,
  renameNode as renameGraphNode,
  rootsOf,
  setParent as setGraphParent,
  setTitle as setGraphTitle,
} from './graph.js'

/** Default title for a new composition. */
export const DEFAULT_COMPOSITION_TITLE = 'Agent composition'

/** Same cap the graph model enforces for labels. */
const MAX_LABEL = 120

/**
 * @param {unknown} value - candidate text.
 * @param {number} max - graph cap.
 * @returns {string|null} trimmed text within the cap.
 */
function textOf(value, max) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed.slice(0, max)
}

/**
 * @param {string} value - candidate label.
 * @returns {string|null} trimmed label within the graph cap.
 */
function labelOf(value) {
  return textOf(value, MAX_LABEL)
}

/**
 * Stable node id for a native external placeholder. The native catalog has no
 * DSH session to key on, so a deterministic id is what makes sync-native and
 * auto-attach idempotent. A hash keeps the id within the graph cap and avoids
 * embedding an arbitrary native id.
 * @param {unknown} externalId - native catalog entry id.
 * @returns {string|null} stable node id.
 */
function externalNodeId(externalId) {
  if (typeof externalId !== 'string' || externalId.length === 0) return null
  return `external-${createHash('sha256').update(externalId).digest('hex').slice(0, 32)}`
}

/**
 * Find an external placeholder by its deterministic id, or by the legacy
 * (random-id) shape when a record predates deterministic ids.
 * @param {object} composition - current graph.
 * @param {string|null} externalId - deterministic id, when known.
 * @param {{label: string, nativeParentSessionId: string|null}} fields - placeholder identity.
 * @returns {object|undefined} matching node.
 */
function externalPlaceholder(composition, externalId, fields) {
  if (externalId !== null) {
    const byId = composition.nodes.find((node) => node.id === externalId)
    if (byId !== undefined) return byId
  }
  return composition.nodes.find((node) => node.kind === 'external'
    && node.sessionId === null
    // When the caller knows the native id, only a legacy random-id node may
    // match by label; two distinct deterministic placeholders stay distinct.
    && (externalId === null || !node.id.startsWith('external-'))
    && (node.nativeParentSessionId ?? null) === (fields.nativeParentSessionId ?? null)
    && node.label === fields.label)
}

/**
 * @param {object} summary - discovery summary.
 * @returns {object} graph node fields (without id/timestamps).
 */
function nodeFromSummary(summary) {
  return {
    sessionId: summary.sessionId,
    label: labelOf(summary.title) ?? summary.sessionId,
    kind: 'session',
    source: summary.source,
    mode: summary.mode ?? (summary.source === 'subagent' ? 'unknown' : 'continuable'),
    provider: null,
    nativeParentSessionId: summary.nativeParentSessionId,
    cwd: summary.cwd,
    permissionPreset: null,
  }
}

/**
 * Create the manager.
 * @param {{store: object, discovery: object, agents?: () => object|undefined,
 *   now?: () => number}} deps - store, discovery, an optional live-agent accessor,
 *   and an optional clock for tests.
 */
export function createManager({
  store,
  discovery,
  agents = () => undefined,
  now = () => Date.now(),
  logger = undefined,
}) {
  const warn = typeof logger?.warn === 'function' ? logger.warn.bind(logger) : () => {}
  /** @type {Map<string, Promise<void>>} */
  const tails = new Map()
  let mergeTail = Promise.resolve()
  /** @type {Map<string, string>|null} session id -> owning root session id */
  let membership = null
  let membershipGeneration = -1

  /**
   * @param {string} sessionId - live session id.
   * @returns {boolean} whether the session's agent is inside a running turn.
   */
  function isWorking(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return false
    try {
      return agents()?.get?.(sessionId)?.status === 'running'
    } catch {
      return false
    }
  }

  /**
   * Build the session -> composition index from durable records once, then
   * keep it updated in memory. Membership is one composition per session: this
   * is what makes the tab show the same configuration from every member.
   * @returns {Promise<Map<string, string>>}
   */
  async function ensureMembership() {
    await store.refresh?.()
    if (membership !== null && membershipGeneration === (store.generation ?? 0)) return membership
    membership = null
    const generationAtStart = store.generation ?? 0
    const map = new Map()
    for (const [rootSessionId, record] of await store.list()) {
      const nodes = record?.composition?.nodes
      if (!Array.isArray(nodes)) {
        warn('dsh-combinagents: skipping a composition with malformed nodes', { rootSessionId })
        continue
      }
      for (const node of nodes) {
        if (typeof node.sessionId !== 'string' || node.sessionId.length === 0) continue
        const existing = map.get(node.sessionId)
        if (existing !== undefined && existing !== rootSessionId) {
          warn('dsh-combinagents: a session belongs to two compositions', {
            sessionId: node.sessionId,
            kept: existing,
            ignored: rootSessionId,
          })
          continue
        }
        map.set(node.sessionId, rootSessionId)
      }
    }
    membership = map
    membershipGeneration = generationAtStart
    if ((store.generation ?? 0) !== generationAtStart) {
      membership = null
      return ensureMembership()
    }
    return map
  }

  /**
   * Direct composition membership without walking the native ancestor chain.
   * @param {string} sessionId - member session.
   * @returns {Promise<string|null>} owning root, or null.
   */
  async function directOwner(sessionId) {
    const map = await ensureMembership()
    return map.get(sessionId) ?? null
  }

  /**
   * @param {string} rootSessionId - owning composition.
   * @param {object} composition - saved graph.
   */
  function indexComposition(rootSessionId, composition) {
    if (membership === null) return
    for (const node of composition.nodes) {
      if (typeof node.sessionId !== 'string' || node.sessionId.length === 0) continue
      const existing = membership.get(node.sessionId)
      if (existing !== undefined && existing !== rootSessionId) {
        warn('dsh-combinagents: refused to overwrite composition membership', {
          sessionId: node.sessionId,
          kept: existing,
          ignored: rootSessionId,
        })
        continue
      }
      membership.set(node.sessionId, rootSessionId)
    }
  }

  /**
   * @param {string} rootSessionId - removed composition.
   * @param {object} composition - graph that is no longer stored.
   */
  function unindexComposition(rootSessionId, composition) {
    if (membership === null) return
    for (const node of composition.nodes) {
      if (node.sessionId === null) continue
      if (membership.get(node.sessionId) === rootSessionId) membership.delete(node.sessionId)
    }
  }

  /**
   * Remove one node's membership entry when it left the graph.
   * @param {string} rootSessionId - owning composition.
   * @param {string|null} sessionId - removed session.
   */
  function unindexSession(rootSessionId, sessionId) {
    if (membership === null || sessionId === null) return
    if (membership.get(sessionId) === rootSessionId) membership.delete(sessionId)
  }

  /**
   * Find the composition that contains one session. This is the shared
   * configuration that every member opens.
   * @param {string} sessionId - member session.
   * @returns {Promise<{rootSessionId: string, record: object}|null>}
   */
  async function resolveSession(sessionId, retry = 0) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null
    const generation = store.generation ?? 0
    const map = await ensureMembership()
    let current = sessionId
    const seen = new Set()
    for (let depth = 0; depth < 32; depth += 1) {
      if (typeof current !== 'string' || current.length === 0 || seen.has(current)) return null
      seen.add(current)
      const rootSessionId = map.get(current)
      if (rootSessionId !== undefined) {
        const record = await store.get(rootSessionId)
        if ((store.generation ?? 0) !== generation && retry < 2) {
          return resolveSession(sessionId, retry + 1)
        }
        if (record === undefined) {
          map.delete(current)
          return null
        }
        return { rootSessionId, record }
      }
      // A native descendant that has not been mirrored yet still belongs to
      // the composition of its native ancestor: walk the durable parent chain.
      // Ordinary forks also carry `header.parentSession`, but they lead a new
      // native tree (`origin` is absent), so they must not inherit membership.
      const summary = await (discovery.describeHeader?.(current) ?? discovery.describe(current))
      if (summary?.source !== 'subagent') return null
      const parent = summary?.nativeParentSessionId
      if (typeof parent !== 'string' || parent.length === 0) return null
      current = parent
    }
    return null
  }

  /**
   * Structural edits are blocked while an affected agent, one of its
   * composition ancestors, or one of its composition descendants is inside a
   * running turn. A sibling branch outside that line stays editable, so an
   * unrelated agent can still be reorganized.
   * @param {object} composition - current graph.
   * @param {readonly string[]} nodeIds - nodes the edit changes.
   * @param {string} action - human description for the error.
   */
  function assertIdle(composition, nodeIds, action) {
    const affected = new Set()
    for (const nodeId of nodeIds) {
      affected.add(nodeId)
      for (const ancestor of ancestorsOf(composition, nodeId)) affected.add(ancestor.id)
      for (const descendant of descendantsOf(composition, nodeId)) affected.add(descendant.id)
    }
    for (const nodeId of affected) {
      const node = composition.nodes.find((candidate) => candidate.id === nodeId)
      if (node?.sessionId !== null && node?.sessionId !== undefined && isWorking(node.sessionId)) {
        throw new CompositionError('AGENT_BUSY', `cannot ${action}: agent ${JSON.stringify(node.label)} is running`)
      }
    }
  }

  /**
   * Run one task after every earlier task for the same root session settles.
   * @param {string} key - root session id.
   * @param {() => Promise<unknown>} task - mutation.
   * @returns {Promise<unknown>}
   */
  function withLock(key, task) {
    const previous = tails.get(key) ?? Promise.resolve()
    const run = () => store.withMutationLock === undefined ? task() : store.withMutationLock(task)
    const result = previous.then(run, run)
    const tail = result.then(() => undefined, () => undefined)
    tails.set(key, tail)
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key)
    })
    return result
  }

  /**
   * Serialize cross-composition merges; they touch two durable records and
   * cannot use the single-root lock safely.
   * @param {() => Promise<unknown>} task - merge mutation.
   * @returns {Promise<unknown>}
   */
  function withMergeLock(task) {
    const previous = mergeTail
    const result = previous.then(task, task)
    mergeTail = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * Acquire per-root locks in lexical order. Cross-composition moves always run
   * under the merge lock, so they cannot deadlock each other; a normal mutation
   * holds only one root lock and can never wait for a second.
   * @param {readonly string[]} rootSessionIds - roots touched by the task.
   * @param {() => Promise<unknown>} task - work while all locks are held.
   * @returns {Promise<unknown>}
   */
  function withRootLocks(rootSessionIds, task) {
    const ordered = [...new Set(rootSessionIds)].sort()
    const run = (index) => index === ordered.length
      ? task()
      : withLock(ordered[index], () => run(index + 1))
    return run(0)
  }

  /**
   * @param {string} rootSessionId - composition owner.
   * @returns {Promise<{composition: object, updatedAt: number}>}
   */
  async function requireRecord(rootSessionId) {
    const record = await store.get(rootSessionId)
    if (record === undefined) {
      throw new CompositionError('COMPOSITION_NOT_FOUND', `no composition for root session ${JSON.stringify(rootSessionId)}`)
    }
    return record
  }

  /**
   * @param {string} rootSessionId - owner.
   * @param {object} composition - next graph.
   * @returns {Promise<{composition: object, updatedAt: number}>} saved record.
   */
  async function save(rootSessionId, composition) {
    const record = { composition, updatedAt: now() }
    await store.put(rootSessionId, record)
    return record
  }

  /**
   * Default a user-created connection to bidirectional messaging. The grant is
   * stored per edge because the composition path is undirected: one true
   * `allowMessage` lets either endpoint reach the other. Interrupt stays denied
   * until explicitly granted.
   * @param {string} rootSessionId - composition owner.
   * @param {object} composition - composition after the manual attach.
   * @param {string} childNodeId - node whose incoming edge is new.
   * @returns {Promise<void>}
   */
  async function grantManualConnection(rootSessionId, composition, childNodeId) {
    const edge = composition.edges.find((candidate) => candidate.childId === childNodeId)
    if (edge === undefined) return
    const policy = await store.getPolicy(rootSessionId)
    if (policy?.edges?.[edge.id] !== undefined) return
    await store.putPolicy(rootSessionId, {
      version: 1,
      rootSessionId,
      edges: {
        ...(policy?.edges ?? {}),
        [edge.id]: { allowMessage: true, allowInterrupt: false },
      },
      updatedAt: now(),
    })
    await recordAudit(rootSessionId, {
      kind: 'grant',
      edgeId: edge.id,
      outcome: 'defaulted',
      detail: { reason: 'manual-connection' },
    })
  }

  /**
   * Carry a child's edge grants to its new incoming edge after a reparent.
   * A manually created replacement edge with no previous grant defaults to
   * bidirectional messaging. Detaching removes the stored grant.
   * @param {string} rootSessionId - composition owner.
   * @param {object} previous - composition before the change.
   * @param {object} next - composition after the change.
   * @param {string} childNodeId - node whose incoming edge changed.
   */
  async function migrateParentGrants(rootSessionId, previous, next, childNodeId) {
    const previousEdge = previous.edges.find((edge) => edge.childId === childNodeId) ?? null
    const nextEdge = next.edges.find((edge) => edge.childId === childNodeId) ?? null
    if (previousEdge !== null && nextEdge?.id === previousEdge.id) return
    const policy = await store.getPolicy(rootSessionId)
    const grant = previousEdge === null ? undefined : policy?.edges?.[previousEdge.id]
    const edges = { ...(policy?.edges ?? {}) }
    if (previousEdge !== null) delete edges[previousEdge.id]
    if (nextEdge !== null) {
      edges[nextEdge.id] = grant === undefined
        ? { allowMessage: true, allowInterrupt: false }
        : {
            allowMessage: grant.allowMessage === true,
            allowInterrupt: grant.allowInterrupt === true,
          }
    }
    await store.putPolicy(rootSessionId, {
      version: 1,
      rootSessionId,
      edges,
      updatedAt: now(),
    })
    if (nextEdge !== null) {
      await recordAudit(rootSessionId, {
        kind: 'grant',
        edgeId: nextEdge.id,
        outcome: grant === undefined ? 'defaulted' : 'migrated',
        ...(previousEdge === null ? {} : { detail: { fromEdgeId: previousEdge.id } }),
      })
    }
  }

  /**
   * The unique edge path between two nodes in one forest.
   * @param {object} composition - graph.
   * @param {string} fromId - start node.
   * @param {string} toId - end node.
   * @returns {object[]|null} edges on the path, or null when disconnected.
   */
  function pathEdges(composition, fromId, toId) {
    if (fromId === toId) return []
    const parentEdge = new Map(composition.edges.map((edge) => [edge.childId, edge]))
    const ancestors = (nodeId) => {
      const chain = []
      const seen = new Set()
      let current = nodeId
      while (!seen.has(current)) {
        seen.add(current)
        const edge = parentEdge.get(current)
        if (edge === undefined) break
        chain.push(edge)
        current = edge.parentId
      }
      return chain
    }
    const fromChain = ancestors(fromId)
    const toChain = ancestors(toId)
    const fromNodes = new Set([fromId, ...fromChain.map((edge) => edge.parentId)])
    const lca = [toId, ...toChain.map((edge) => edge.parentId)].find((nodeId) => fromNodes.has(nodeId))
    if (lca === undefined) return null
    const fromEdges = []
    let current = fromId
    while (current !== lca) {
      const edge = parentEdge.get(current)
      if (edge === undefined) return null
      fromEdges.push(edge)
      current = edge.parentId
    }
    const toEdges = []
    current = toId
    while (current !== lca) {
      const edge = parentEdge.get(current)
      if (edge === undefined) return null
      toEdges.push(edge)
      current = edge.parentId
    }
    return [...fromEdges, ...toEdges]
  }

  /**
   * @param {string} rootSessionId - composition owner.
   * @param {object} [record] - already-read record for this root.
   * @returns {Promise<Record<string, {allowMessage: boolean, allowInterrupt: boolean}>>}
   */
  async function getGrants(rootSessionId, record = undefined) {
    const current = record ?? await requireRecord(rootSessionId)
    const stored = (await store.getPolicy(rootSessionId))?.edges ?? {}
    /** @type {Record<string, {allowMessage: boolean, allowInterrupt: boolean}>} */
    const result = {}
    for (const edge of current.composition.edges) {
      result[edge.id] = {
        allowMessage: stored[edge.id]?.allowMessage === true,
        allowInterrupt: stored[edge.id]?.allowInterrupt === true,
      }
    }
    return result
  }

  /**
   * @param {string} rootSessionId - composition owner.
   * @param {object} entry - audit fields.
   */
  async function recordAudit(rootSessionId, entry) {
    try {
      await store.appendAudit({
        id: randomUUID(),
        rootSessionId,
        at: now(),
        ...entry,
      })
    } catch {
      // Audit failure must not hide the operation result.
    }
  }

  /**
   * Update one edge's grants. Only existing edges are addressable.
   * @param {string} rootSessionId - composition owner.
   * @param {string} edgeId - edge to update.
   * @param {{allowMessage?: boolean, allowInterrupt?: boolean}} patch - toggles.
   * @returns {Promise<Record<string, object>>} normalized grants.
   */
  async function setEdgeGrant(rootSessionId, edgeId, patch = {}) {
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      if (!record.composition.edges.some((edge) => edge.id === edgeId)) {
        throw new CompositionError('UNKNOWN_EDGE', `edge ${JSON.stringify(edgeId)} does not exist`)
      }
      const current = await store.getPolicy(rootSessionId)
      const edges = { ...(current?.edges ?? {}) }
      const next = {
        allowMessage: patch.allowMessage === true,
        allowInterrupt: patch.allowInterrupt === true,
      }
      if (patch.allowMessage === undefined) next.allowMessage = edges[edgeId]?.allowMessage === true
      if (patch.allowInterrupt === undefined) next.allowInterrupt = edges[edgeId]?.allowInterrupt === true
      edges[edgeId] = next
      await store.putPolicy(rootSessionId, {
        version: 1,
        rootSessionId,
        edges,
        updatedAt: now(),
      })
      await recordAudit(rootSessionId, {
        kind: 'grant',
        edgeId,
        outcome: 'updated',
        detail: next,
      })
      return getGrants(rootSessionId)
    })
  }

  /**
   * @param {string} rootSessionId - composition owner.
   * @param {string} fromNodeId - sender node.
   * @param {string} toNodeId - target node.
   * @returns {Promise<{allowed: boolean, edgeIds: string[], deniedEdgeIds: string[]}>}
   */
  async function authorizeMessage(rootSessionId, fromNodeId, toNodeId) {
    const record = await requireRecord(rootSessionId)
    const path = pathEdges(record.composition, fromNodeId, toNodeId)
    if (path === null || path.length === 0) {
      return { allowed: false, edgeIds: [], deniedEdgeIds: [] }
    }
    const grants = await getGrants(rootSessionId)
    const denied = path.filter((edge) => grants[edge.id]?.allowMessage !== true)
    return {
      allowed: denied.length === 0,
      edgeIds: path.map((edge) => edge.id),
      deniedEdgeIds: denied.map((edge) => edge.id),
    }
  }

  /**
   * Interrupt authority follows a downward composition path.
   * @param {string} rootSessionId - composition owner.
   * @param {string} fromNodeId - caller (ancestor).
   * @param {string} toNodeId - target (descendant).
   * @returns {Promise<{allowed: boolean, edgeIds: string[], deniedEdgeIds: string[]}>}
   */
  async function authorizeInterrupt(rootSessionId, fromNodeId, toNodeId) {
    const record = await requireRecord(rootSessionId)
    if (!isAncestor(record.composition, toNodeId, fromNodeId)) {
      return { allowed: false, edgeIds: [], deniedEdgeIds: [] }
    }
    const path = pathEdges(record.composition, fromNodeId, toNodeId)
    if (path === null || path.length === 0) {
      return { allowed: false, edgeIds: [], deniedEdgeIds: [] }
    }
    const grants = await getGrants(rootSessionId)
    const denied = path.filter((edge) => grants[edge.id]?.allowInterrupt !== true)
    return {
      allowed: denied.length === 0,
      edgeIds: path.map((edge) => edge.id),
      deniedEdgeIds: denied.map((edge) => edge.id),
    }
  }

  /**
   * A delegation-created edge starts with the capabilities the child needs to
   * report back and the parent needs to steer it. The user can revoke either
   * capability from the edge UI afterward.
   * @param {string} rootSessionId - composition owner.
   * @param {string} parentSessionId - creator session.
   * @param {string} childSessionId - started child.
   * @returns {Promise<object|null>} normalized grants when the edge exists.
   */
  async function grantDelegatedEdge(rootSessionId, parentSessionId, childSessionId) {
    const record = await requireRecord(rootSessionId)
    const parent = record.composition.nodes.find((node) => node.sessionId === parentSessionId)
    const child = record.composition.nodes.find((node) => node.sessionId === childSessionId)
    if (parent === undefined || child === undefined) return null
    const edge = record.composition.edges.find((candidate) => candidate.parentId === parent.id && candidate.childId === child.id)
    if (edge === undefined) return null
    return setEdgeGrant(rootSessionId, edge.id, { allowMessage: true, allowInterrupt: true })
  }

  /**
   * List plugin-owned tasks for one composition.
   * @param {string} rootSessionId - composition owner.
   * @param {object} [record] - already-read record for this root.
   * @returns {Promise<object[]>}
   */
  async function getTasks(rootSessionId, record = undefined, teamId = undefined) {
    if (record === undefined) await requireRecord(rootSessionId)
    const entries = await store.listTasks(rootSessionId)
    return entries
      .map(([, task]) => task)
      .filter((task) => teamId === undefined
        || (teamId === null ? task.teamId === null || task.teamId === undefined : task.teamId === teamId))
      .sort((left, right) => left.createdAt - right.createdAt)
  }

  /**
   * @param {unknown} value - candidate text.
   * @param {number} max - cap.
   * @returns {string} trimmed text.
   */
  function taskText(value, max) {
    if (typeof value !== 'string') return ''
    return value.trim().slice(0, max)
  }

  /**
   * Resolve one Team's current members from the composition tree. A Team is a
   * connected subtree rooted at `rootNodeId`; graph edits therefore change
   * membership without rewriting the Team record.
   * @param {object} composition - current graph.
   * @param {object} team - team record.
   * @returns {object[]} member nodes.
   */
  function teamNodes(composition, team) {
    if (Array.isArray(team?.nodeIds) && team.nodeIds.length > 0) {
      return team.nodeIds
        .map((id) => composition.nodes.find((node) => node.id === id))
        .filter((node) => node !== undefined)
    }
    const root = composition.nodes.find((node) => node.id === team?.rootNodeId)
    if (root === undefined) return []
    try {
      return [root, ...descendantsOf(composition, root.id)]
    } catch {
      return []
    }
  }

  /**
   * @param {object} composition - current graph.
   * @param {readonly object[]} teams - current teams.
   * @param {string} nodeId - composition node.
   * @returns {object|null} owning team.
   */
  function teamContainingNode(composition, teams, nodeId) {
    return teams.find((team) => teamNodes(composition, team).some((node) => node.id === nodeId)) ?? null
  }

  /**
   * A task may be changed by the user, its owner, or one of the owner's  /**
   * A task may be changed by the user, its owner, or one of the owner's
   * composition ancestors. Unowned tasks are user-only. Agents outside the
   * owner line must not complete or delete another member's work.
   * @param {object} composition - current graph.
   * @param {object} task - stored task.
   * @param {string} actor - `user` or a session id.
   * @returns {boolean}
   */
  function taskActorAllowed(composition, task, actor, team = null) {
    if (actor === 'user') return true
    if (typeof actor !== 'string' || actor.length === 0) return false
    const node = composition.nodes.find((candidate) => candidate.sessionId === actor)
    if (node === undefined) return false
    if (team !== null) {
      const members = teamNodes(composition, team)
      if (!members.some((candidate) => candidate.id === node.id)) return false
      if (node.id === team.rootNodeId) return true
      if (node.id === task.ownerNodeId) return true
      return false
    }
    const root = composition.nodes.find((candidate) => candidate.sessionId === composition.rootSessionId)
    if (node.id === root?.id) return true
    if (task.ownerNodeId === null || task.ownerNodeId === undefined) return false
    if (node.id === task.ownerNodeId) return true
    return isAncestor(composition, task.ownerNodeId, node.id)
  }

  /**
   * A pending task is ready when every blocker is completed. Non-pending tasks
   * are never ready to claim; the native list filter mirrors that rule.
   * @param {object} task - task record.
   * @param {readonly object[]} tasks - board snapshot.
   * @returns {boolean}
   */
  function taskReady(task, tasks) {
    if (task.status !== 'pending') return false
    const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]))
    return (Array.isArray(task.blockedBy) ? task.blockedBy : [])
      .every((id) => byId.get(id)?.status === 'completed')
  }

  /**
   * @param {readonly object[]} tasks - board snapshot.
   * @param {string} taskId - task being edited.
   * @param {readonly string[]} blockedBy - proposed blockers.
   * @returns {boolean} whether the proposed edge creates a cycle.
   */
  function dependencyCycle(tasks, taskId, blockedBy) {
    const byId = new Map(tasks.map((task) => [task.id, task]))
    const visit = (id, seen) => {
      if (id === taskId) return true
      if (seen.has(id)) return false
      seen.add(id)
      for (const next of byId.get(id)?.blockedBy ?? []) {
        if (visit(next, seen)) return true
      }
      return false
    }
    return blockedBy.some((id) => visit(id, new Set()))
  }

  /**
   * Create one plugin-owned task. This never writes a DSH Team task.
   * @param {string} rootSessionId - composition owner.
   * @param {{subject: string, description?: string, ownerNodeId?: string|null,
   *   blockedBy?: string[], writeScopes?: string[]}} input - task fields.
   * @returns {Promise<object[]>}
   */
  async function createTask(rootSessionId, input = {}) {
    const subject = taskText(input.subject, 200)
    if (subject.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'subject must be a non-empty string')
    }
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      const teamId = typeof input.teamId === 'string' && input.teamId.length > 0 ? input.teamId : null
      const team = teamId === null ? null : await store.getTeam?.(teamId)
      if (teamId !== null && (team === undefined || team === null || team.rootSessionId !== rootSessionId)) {
        throw new CompositionError('TEAM_NOT_FOUND', `team ${JSON.stringify(teamId)} does not exist in this composition`)
      }
      const members = team === null ? null : teamNodes(record.composition, team)
      const ownerNodeId = typeof input.ownerNodeId === 'string' && input.ownerNodeId.length > 0
        ? input.ownerNodeId
        : null
      if (ownerNodeId !== null) {
        const owner = record.composition.nodes.find((node) => node.id === ownerNodeId)
        if (owner === undefined || owner.kind !== 'session') {
          throw new CompositionError('UNKNOWN_NODE', `owner node ${JSON.stringify(ownerNodeId)} is not a local session node`)
        }
        if (members !== null && !members.some((node) => node.id === ownerNodeId)) {
          throw new CompositionError('TEAM_MEMBER_REQUIRED', 'task owner must belong to the selected team')
        }
      }
      const createdBy = textOf(input.createdBy, 128) ?? 'user'
      const actor = textOf(input.actor, 128) ?? 'user'
      const existing = await getTasks(rootSessionId, undefined, teamId)
      const blockedBy = [...new Set(Array.isArray(input.blockedBy)
        ? input.blockedBy.filter((id) => typeof id === 'string' && id.length > 0)
        : [])]
      const known = new Set(existing.map((candidate) => candidate.id))
      for (const id of blockedBy) {
        if (!known.has(id)) throw new CompositionError('TASK_NOT_FOUND', `blocked task ${JSON.stringify(id)} does not exist`)
      }
      const writeScopes = [...new Set(Array.isArray(input.writeScopes)
        ? input.writeScopes.map((scope) => textOf(scope, 500)).filter((scope) => scope.length > 0)
        : [])]
      const task = {
        id: randomUUID(),
        rootSessionId,
        teamId,
        subject,
        description: taskText(input.description, 8000),
        status: 'pending',
        ownerNodeId,
        blockedBy,
        writeScopes,
        revision: 1,
        createdAt: now(),
        updatedAt: now(),
        createdBy,
      }
      await store.putTask(task.id, task)
      await recordAudit(rootSessionId, {
        kind: 'task',
        toNodeId: ownerNodeId ?? '',
        outcome: 'created',
        detail: { taskId: task.id, actor, ...(teamId === null ? {} : { teamId }) },
      })
      return getTasks(rootSessionId)
    })
  }

  /**
   * Apply one task transition with a revision precondition.
   * @param {string} rootSessionId - composition owner.
   * @param {{taskId: string, expectedRevision: number, action: string}} input - transition.
   * @returns {Promise<object[]>}
   */
  async function updateTask(rootSessionId, input = {}) {
    if (typeof input.taskId !== 'string' || input.taskId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'taskId must be a non-empty string')
    }
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) {
      throw new CompositionError('INVALID_FIELD', 'expectedRevision must be a positive integer')
    }
    const action = input.action
    const actions = new Set([
      'start', 'complete', 'reopen', 'delete',
      'claim', 'release', 'edit', 'set_dependencies', 'reassign',
    ])
    if (!actions.has(action)) {
      throw new CompositionError('INVALID_FIELD', 'unsupported task action')
    }
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      const allTasks = await getTasks(rootSessionId)
      const task = allTasks.find((candidate) => candidate.id === input.taskId)
      if (task === undefined) {
        throw new CompositionError('TASK_NOT_FOUND', `task ${JSON.stringify(input.taskId)} does not exist`)
      }
      if (input.teamId !== undefined && (input.teamId ?? null) !== (task.teamId ?? null)) {
        throw new CompositionError('TASK_NOT_FOUND', 'task is not in the selected team')
      }
      const team = task.teamId === null || task.teamId === undefined ? null : await store.getTeam?.(task.teamId)
      if (task.teamId !== null && task.teamId !== undefined && (team === undefined || team === null || team.rootSessionId !== rootSessionId)) {
        throw new CompositionError('TEAM_NOT_FOUND', 'the task team no longer exists')
      }
      const tasks = allTasks.filter((candidate) => team === null
        ? candidate.teamId === null || candidate.teamId === undefined
        : candidate.teamId === team.id)
      if (task.revision !== input.expectedRevision) {
        throw new CompositionError('TASK_CONFLICT', 'the task changed; refresh before retrying')
      }
      const actor = textOf(input.actor, 128) ?? 'user'
      const actorNode = actor === 'user'
        ? undefined
        : record.composition.nodes.find((node) => node.sessionId === actor)
      const ownerAllowed = taskActorAllowed(record.composition, task, actor, team)
      const requireOwner = () => {
        if (!ownerAllowed) throw new CompositionError('TASK_FORBIDDEN', 'only the owner or an ancestor may change this task')
      }
      let next
      switch (action) {
        case 'claim': {
          if (actorNode === undefined) throw new CompositionError('TASK_FORBIDDEN', 'claim requires a composition agent')
          if (team !== null && !teamNodes(record.composition, team).some((node) => node.id === actorNode.id)) {
            throw new CompositionError('TASK_FORBIDDEN', 'only a member of this team may claim its tasks')
          }
          if (task.ownerNodeId !== null && task.ownerNodeId !== undefined && task.ownerNodeId !== actorNode.id) {
            throw new CompositionError('TASK_ALREADY_CLAIMED', 'another member already owns this task')
          }
          if (task.status !== 'pending' || !taskReady(task, tasks)) {
            throw new CompositionError('TASK_BLOCKED', 'this task is not ready to claim')
          }
          next = {
            ...task,
            ownerNodeId: actorNode.id,
            status: 'in_progress',
            revision: task.revision + 1,
            updatedAt: now(),
          }
          break
        }
        case 'release': {
          requireOwner()
          if (task.status !== 'in_progress') throw new CompositionError('TASK_INVALID_TRANSITION', 'only an in-progress task can be released')
          next = { ...task, ownerNodeId: null, status: 'pending', revision: task.revision + 1, updatedAt: now() }
          break
        }
        case 'edit': {
          requireOwner()
          if (input.subject === undefined && input.description === undefined && input.writeScopes === undefined) {
            throw new CompositionError('INVALID_FIELD', 'edit requires subject, description, or writeScopes')
          }
          const subject = input.subject === undefined ? task.subject : taskText(input.subject, 200)
          if (subject.length === 0) throw new CompositionError('INVALID_FIELD', 'subject must be a non-empty string')
          next = {
            ...task,
            subject,
            ...input.description === undefined ? {} : { description: taskText(input.description, 8000) },
            ...input.writeScopes === undefined ? {} : {
              writeScopes: [...new Set(input.writeScopes.map((scope) => textOf(scope, 500)).filter((scope) => scope.length > 0))],
            },
            revision: task.revision + 1,
            updatedAt: now(),
          }
          break
        }
        case 'set_dependencies': {
          requireOwner()
          if (!Array.isArray(input.blockedBy)) throw new CompositionError('INVALID_FIELD', 'set_dependencies requires blockedBy')
          const blockedBy = [...new Set(input.blockedBy.filter((id) => typeof id === 'string' && id.length > 0))]
          const known = new Set(tasks.map((candidate) => candidate.id))
          for (const id of blockedBy) {
            if (!known.has(id)) throw new CompositionError('TASK_NOT_FOUND', `blocked task ${JSON.stringify(id)} does not exist`)
          }
          if (dependencyCycle(tasks, task.id, blockedBy)) {
            throw new CompositionError('TASK_DEPENDENCY_CYCLE', 'task dependencies must be acyclic')
          }
          next = { ...task, blockedBy, revision: task.revision + 1, updatedAt: now() }
          break
        }
        case 'complete': {
          requireOwner()
          if (task.status !== 'in_progress') throw new CompositionError('TASK_INVALID_TRANSITION', 'only an in-progress task can complete')
          next = { ...task, status: 'completed', revision: task.revision + 1, updatedAt: now() }
          break
        }
        case 'reopen': {
          requireOwner()
          if (task.status !== 'completed') throw new CompositionError('TASK_INVALID_TRANSITION', 'only a completed task can reopen')
          next = { ...task, status: 'pending', ownerNodeId: null, revision: task.revision + 1, updatedAt: now() }
          break
        }
        case 'reassign': {
          const leadNodeId = team === null ? record.composition.rootSessionId : team.rootNodeId
          const leadNode = record.composition.nodes.find((node) => node.id === leadNodeId
            || node.sessionId === leadNodeId)
          if (actorNode === undefined || actorNode.id !== leadNode?.id) {
            throw new CompositionError('TASK_FORBIDDEN', 'only the Team Lead may reassign tasks')
          }
          if (task.status !== 'pending' && task.status !== 'in_progress') {
            throw new CompositionError('TASK_INVALID_TRANSITION', 'only a pending or in-progress task can be reassigned')
          }
          const ownerNodeId = typeof input.ownerNodeId === 'string' && input.ownerNodeId.length > 0
            ? input.ownerNodeId
            : null
          if (ownerNodeId !== null) {
            const owner = record.composition.nodes.find((node) => node.id === ownerNodeId && node.kind === 'session')
            if (owner === undefined) throw new CompositionError('UNKNOWN_NODE', 'reassign target is not a local composition node')
            if (team !== null && !teamNodes(record.composition, team).some((node) => node.id === ownerNodeId)) {
              throw new CompositionError('TEAM_MEMBER_REQUIRED', 'reassign target must belong to this team')
            }
            if (!taskReady(task, tasks)) throw new CompositionError('TASK_BLOCKED', 'this task is blocked')
          }
          next = {
            ...task,
            ownerNodeId,
            status: ownerNodeId === null ? 'pending' : 'in_progress',
            revision: task.revision + 1,
            updatedAt: now(),
          }
          break
        }
        case 'delete': {
          requireOwner()
          const dependent = tasks.find((candidate) => candidate.id !== task.id && (candidate.blockedBy ?? []).includes(task.id))
          if (dependent !== undefined) {
            throw new CompositionError('TASK_HAS_DEPENDENTS', `task still blocks ${dependent.id}`)
          }
          next = null
          break
        }
        case 'start': {
          requireOwner()
          if (task.status === 'completed') throw new CompositionError('TASK_INVALID_TRANSITION', 'a completed task must be reopened')
          next = {
            ...task,
            status: 'in_progress',
            ...task.ownerNodeId === null && actorNode !== undefined ? { ownerNodeId: actorNode.id } : {},
            revision: task.revision + 1,
            updatedAt: now(),
          }
          break
        }
        default:
          throw new CompositionError('INVALID_FIELD', 'unsupported task action')
      }
      if (next === null) {
        await store.deleteTask(task.id)
        await recordAudit(rootSessionId, { kind: 'task', outcome: 'deleted', detail: { taskId: task.id, actor } })
        return getTasks(rootSessionId)
      }
      await store.putTask(task.id, next)
      await recordAudit(rootSessionId, {
        kind: 'task',
        outcome: action,
        detail: { taskId: task.id, actor, ...(team === null ? {} : { teamId: team.id }) },
      })
      return getTasks(rootSessionId)
    })
  }

  /**
   * List Teams owned by one composition.
   * @param {string} rootSessionId - composition owner.
   * @returns {Promise<object[]>}
   */
  async function listTeams(rootSessionId, record = undefined) {
    if (record === undefined) await requireRecord(rootSessionId)
    return await store.listTeams?.(rootSessionId) ?? []
  }

  /**
   * Create a Team from a connected composition subtree. The selected node is
   * the Team Lead; current descendants are members. Teams may not overlap.
   * @param {string} rootSessionId - composition owner.
   * @param {{rootNodeId: string, label?: string, createdBy?: string}} input - team fields.
   * @returns {Promise<object[]>}
   */
  async function createTeam(rootSessionId, input = {}) {
    if (typeof input.rootNodeId !== 'string' || input.rootNodeId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'rootNodeId must be a non-empty string')
    }
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      const rootNode = record.composition.nodes.find((node) => node.id === input.rootNodeId)
      if (rootNode === undefined) {
        throw new CompositionError('UNKNOWN_NODE', `node ${JSON.stringify(input.rootNodeId)} does not exist`)
      }
      if (rootNode.kind !== 'session') {
        throw new CompositionError('INVALID_FIELD', 'a Team root must be a local session node')
      }
      const requested = Array.isArray(input.nodeIds)
        ? [...new Set(input.nodeIds.filter((id) => typeof id === 'string' && id.length > 0))]
        : null
      const selected = requested === null
        ? teamNodes(record.composition, { rootNodeId: rootNode.id })
        : requested.map((id) => record.composition.nodes.find((node) => node.id === id))
      if (selected.some((node) => node === undefined)) {
        throw new CompositionError('UNKNOWN_NODE', 'every Team node must exist')
      }
      if (selected.length === 0 || !selected.some((node) => node.id === rootNode.id)) {
        throw new CompositionError('INVALID_FIELD', 'the Team lead must be one of its nodes')
      }
      if (selected.some((node) => node.kind !== 'session')) {
        throw new CompositionError('INVALID_FIELD', 'a Team may contain only local session nodes')
      }
      const selectedIds = new Set(selected.map((node) => node.id))
      const adjacency = new Map()
      for (const edge of record.composition.edges ?? []) {
        if (!selectedIds.has(edge.parentId) || !selectedIds.has(edge.childId)) continue
        const left = adjacency.get(edge.parentId) ?? []
        left.push(edge.childId)
        adjacency.set(edge.parentId, left)
        const right = adjacency.get(edge.childId) ?? []
        right.push(edge.parentId)
        adjacency.set(edge.childId, right)
      }
      const reached = new Set()
      const queue = [rootNode.id]
      while (queue.length > 0) {
        const id = queue.shift()
        if (reached.has(id)) continue
        reached.add(id)
        for (const next of adjacency.get(id) ?? []) queue.push(next)
      }
      if (reached.size !== selectedIds.size) {
        throw new CompositionError('TEAM_NOT_CONNECTED', 'selected Team nodes must be connected')
      }
      const memberIds = selectedIds
      const teams = await store.listTeams?.(rootSessionId) ?? []
      for (const team of teams) {
        if (teamNodes(record.composition, team).some((node) => memberIds.has(node.id))) {
          throw new CompositionError('TEAM_OVERLAP', 'selected nodes overlap an existing Team')
        }
      }
      const team = {
        id: randomUUID(),
        rootSessionId,
        rootNodeId: rootNode.id,
        nodeIds: requested === null ? undefined : [...selectedIds],
        label: textOf(input.label, 120) ?? `Team ${teams.length + 1}`,
        createdBy: textOf(input.createdBy, 128) ?? 'user',
        createdAt: now(),
        updatedAt: now(),
      }
      await store.putTeam(team.id, team)
      await recordAudit(rootSessionId, { kind: 'team', outcome: 'created', detail: { teamId: team.id } })
      return teams.concat(team)
    })
  }

  /**
   * Delete one Team and its scoped tasks. The composition graph is untouched.
   * @param {string} rootSessionId - composition owner.
   * @param {string} teamId - team id.
   * @returns {Promise<object[]>}
   */
  async function deleteTeam(rootSessionId, teamId) {
    if (typeof teamId !== 'string' || teamId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'teamId must be a non-empty string')
    }
    return withLock(rootSessionId, async () => {
      await requireRecord(rootSessionId)
      const team = await store.getTeam?.(teamId)
      if (team === undefined || team === null || team.rootSessionId !== rootSessionId) {
        throw new CompositionError('TEAM_NOT_FOUND', 'Team not found')
      }
      for (const [, task] of await store.listTasks?.(rootSessionId) ?? []) {
        if (task.teamId === teamId) await store.deleteTask?.(task.id)
      }
      await store.deleteTeam?.(teamId)
      await recordAudit(rootSessionId, { kind: 'team', outcome: 'deleted', detail: { teamId } })
      return await store.listTeams?.(rootSessionId) ?? []
    })
  }

  /**
   * Resolve the Team containing one composition node.
   * @param {string} rootSessionId - composition owner.
   * @param {string} nodeId - composition node.
   * @returns {Promise<object|null>}
   */
  async function teamForNode(rootSessionId, nodeId) {
    const record = await requireRecord(rootSessionId)
    const teams = await store.listTeams?.(rootSessionId) ?? []
    return teamContainingNode(record.composition, teams, nodeId)
  }

  /**
   * Remove Teams whose root node no longer exists.
   * @param {string} rootSessionId - composition owner.
   * @param {object} composition - saved graph.
   * @returns {Promise<void>}
   */
  async function pruneTeams(rootSessionId, composition) {
    for (const team of await store.listTeams?.(rootSessionId) ?? []) {
      const members = teamNodes(composition, team)
      if (members.some((node) => node.id === team.rootNodeId)) continue
      for (const [, task] of await store.listTasks?.(rootSessionId) ?? []) {
        if (task.teamId === team.id) await store.deleteTask?.(task.id)
      }
      await store.deleteTeam?.(team.id)
    }
  }

  /**
   * Create a composition with the root session as its first node. Idempotent:
   * an existing record is returned unchanged.
   * @param {string} rootSessionId - root session.
   * @param {{title?: string}} [input] - optional title.
   * @returns {Promise<{composition: object, updatedAt: number}>}
   */
  async function create(rootSessionId, input = {}) {
    if (typeof rootSessionId !== 'string' || rootSessionId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'rootSessionId must be a non-empty string')
    }
    const owner = await resolveSession(rootSessionId)
    if (owner !== null) return await syncNativeTree(owner.rootSessionId) ?? owner.record
    const record = await withLock(rootSessionId, async () => {
      // Re-check membership under the lock: another profile may have attached
      // this session between the resolution above and lock acquisition.
      const ownerNow = await resolveSession(rootSessionId)
      if (ownerNow !== null && ownerNow.rootSessionId !== rootSessionId) {
        if (ownerNow.record !== undefined) return ownerNow.record
      }
      const existing = await store.get(rootSessionId)
      if (existing !== undefined) return existing
      const summary = await discovery.describe(rootSessionId)
      if (summary === null) {
        throw new CompositionError('SESSION_NOT_DISCOVERED', `session ${JSON.stringify(rootSessionId)} was not discovered`)
      }
      const composition = createComposition({
        title: input.title,
        rootSessionId,
        nodes: [nodeFromSummary(summary)],
      })
      const saved = await save(rootSessionId, composition)
      indexComposition(rootSessionId, composition)
      return saved
    })
    return await syncNativeTree(rootSessionId) ?? record
  }

  /**
   * Add one discovered session under a target node. The caller owns the target
   * lock and has already validated the parent.
   * @param {object} record - target composition record.
   * @param {string} rootSessionId - target owner.
   * @param {object} input - add request.
   * @param {string|null} parentId - target parent.
   * @returns {Promise<object>} saved record.
   */
  async function attachDiscovered(record, rootSessionId, input, parentId) {
    if (isWorking(input.sessionId)) {
      throw new CompositionError('AGENT_BUSY', 'cannot add a node: that agent is running')
    }
    const summary = await discovery.describe(input.sessionId)
    if (summary === null) {
      throw new CompositionError('SESSION_NOT_DISCOVERED', `session ${JSON.stringify(input.sessionId)} was not discovered`)
    }
    const node = nodeFromSummary(summary)
    const label = labelOf(input.label)
    if (label !== null) node.label = label
    const composition = addGraphNode(record.composition, node, { parentId })
    const saved = await save(rootSessionId, composition)
    indexComposition(rootSessionId, composition)
    const added = composition.nodes.find((candidate) => candidate.sessionId === input.sessionId)
    if (added !== undefined) await grantManualConnection(rootSessionId, composition, added.id)
    return saved
  }

  /**
   * Carry task rows and policy ownership when a subtree moves. Tasks owned by
   * moved nodes follow the subtree; tasks left behind follow the remaining
   * root; an emptied source composition drops its policy.
   * @param {string} sourceRoot - original composition key.
   * @param {string} targetRoot - destination composition key.
   * @param {string|null} remainingRoot - re-keyed source root, or null.
   * @param {readonly object[]} movedNodes - nodes moved to the target.
   * @returns {Promise<void>}
   */
  async function migrateMovedSideTables(sourceRoot, targetRoot, remainingRoot, movedNodes) {
    const movedNodeIds = new Set(movedNodes.map((node) => node.id))
    for (const [taskId, task] of await store.listTasks?.(sourceRoot) ?? []) {
      if (task.rootSessionId !== sourceRoot) continue
      if (movedNodeIds.has(task.ownerNodeId)) {
        await store.putTask(taskId, { ...task, rootSessionId: targetRoot, updatedAt: now() })
      } else if (remainingRoot === null) {
        await store.deleteTask?.(taskId)
      } else if (remainingRoot !== sourceRoot) {
        await store.putTask(taskId, { ...task, rootSessionId: remainingRoot, updatedAt: now() })
      }
    }
    if (remainingRoot === null) {
      await store.deletePolicy?.(sourceRoot)
    } else if (remainingRoot !== sourceRoot) {
      const policy = await store.getPolicy(sourceRoot)
      if (policy !== undefined) {
        await store.putPolicy(remainingRoot, { ...policy, rootSessionId: remainingRoot, updatedAt: now() })
        await store.deletePolicy?.(sourceRoot)
      }
    }
  }

  /**
   * Add one node while the caller already holds the target root lock.
   * @param {string} rootSessionId - composition owner.
   * @param {{sessionId: string, parentId?: string|null, label?: string}} input - node.
   * @returns {Promise<object>} saved record.
   */
  async function addNodeExclusive(rootSessionId, input) {
    const record = await requireRecord(rootSessionId)
    // The pre-lock owner lookup can race another profile. Re-check under the
    // lock so this path can never create a second membership.
    const ownerNow = await resolveSession(input.sessionId)
    if (ownerNow !== null && ownerNow.rootSessionId !== rootSessionId) {
      throw new CompositionError(
        'SESSION_ALREADY_COMPOSED',
        `session ${JSON.stringify(input.sessionId)} already belongs to composition ${JSON.stringify(ownerNow.rootSessionId)}`,
      )
    }
    const parentId = typeof input.parentId === 'string' && input.parentId.length > 0 ? input.parentId : null
    const existing = record.composition.nodes.find((node) => node.sessionId === input.sessionId)
    if (existing !== undefined) {
      assertIdle(record.composition, [existing.id], 'move a node')
      if (parentId !== null) assertIdle(record.composition, [parentId], 'move a node under a parent')
      const previous = record.composition
      const composition = setGraphParent(previous, existing.id, parentId)
      const saved = await save(rootSessionId, composition)
      indexComposition(rootSessionId, composition)
      await migrateParentGrants(rootSessionId, previous, composition, existing.id)
      return saved
    }
    assertIdle(record.composition, parentId === null ? [] : [parentId], 'add a node')
    return attachDiscovered(record, rootSessionId, input, parentId)
  }

  /**
   * Move one subtree while the merge lock and both root locks are held.
   * Target is saved first; a source failure restores the target, and membership
   * is updated only after both records settle.
   * @param {string} targetRoot - target composition owner.
   * @param {{sessionId: string, parentId?: string|null, label?: string}} input - node.
   * @param {string} sourceRoot - current composition owner.
   * @returns {Promise<object>} saved target record.
   */
  async function moveAcrossExclusive(targetRoot, input, sourceRoot) {
    const current = await resolveSession(input.sessionId)
    if (current === null || current.rootSessionId === targetRoot) {
      return addNodeExclusive(targetRoot, input)
    }
    if (current.rootSessionId !== sourceRoot) {
      throw new CompositionError('AGENT_BUSY', 'the composition changed while moving the node; retry')
    }
    const sourceRecord = await requireRecord(sourceRoot)
    const targetRecord = await requireRecord(targetRoot)
    const parentId = typeof input.parentId === 'string' && input.parentId.length > 0 ? input.parentId : null
    assertIdle(targetRecord.composition, parentId === null ? [] : [parentId], 'move a node into')
    const sourceNode = sourceRecord.composition.nodes.find((node) => node.sessionId === input.sessionId)
    if (sourceNode === undefined) {
      // The session is a native descendant of the source composition but was
      // never mirrored into its graph. Moving it must also move membership;
      // otherwise the target graph would contain a node that still resolves to
      // the source composition.
      unindexSession(sourceRoot, input.sessionId)
      try {
        return await attachDiscovered(targetRecord, targetRoot, input, parentId)
      } catch (error) {
        membership?.set(input.sessionId, sourceRoot)
        throw error
      }
    }
    if (isWorking(input.sessionId)) {
      throw new CompositionError('AGENT_BUSY', 'cannot move a node: that agent is running')
    }
    assertIdle(sourceRecord.composition, [sourceNode.id], 'move a node')
    const sourcePolicy = await store.getPolicy?.(sourceRoot)
    const targetPolicy = await store.getPolicy?.(targetRoot)
    const previousEdge = sourceRecord.composition.edges.find((edge) => edge.childId === sourceNode.id) ?? null
    const detached = detachSubtree(sourceRecord.composition, sourceNode.id)
    const remaining = detached.remaining
    let nextSourceRoot = sourceRoot
    if (remaining !== null && remaining.rootSessionId === null) {
      const nextRoot = rootsOf(remaining).find((node) => typeof node.sessionId === 'string')
      if (nextRoot === undefined) {
        throw new CompositionError('MOVE_WOULD_ORPHAN', 'the remaining composition has no local root session to own it')
      }
      nextSourceRoot = nextRoot.sessionId
      remaining.rootSessionId = nextSourceRoot
    }
    const targetComposition = attachSubtree(targetRecord.composition, detached.subtree, parentId)
    // Carry the grants stored with the moved subtree. Internal edge ids are
    // preserved by attachSubtree; the new boundary edge must inherit the old
    // incoming grant (including an explicit deny) instead of defaulting to
    // bidirectional messaging. A root moved under a parent with no previous
    // edge is a new manual connection and keeps the manual default.
    /** @type {Record<string, {allowMessage: boolean, allowInterrupt: boolean}>} */
    const movedGrants = {}
    for (const edge of detached.subtree.edges) {
      const grant = sourcePolicy?.edges?.[edge.id]
      if (grant === undefined) continue
      movedGrants[edge.id] = {
        allowMessage: grant.allowMessage === true,
        allowInterrupt: grant.allowInterrupt === true,
      }
    }
    const boundaryEdge = parentId === null
      ? null
      : targetComposition.edges.find((edge) => edge.childId === sourceNode.id) ?? null
    if (boundaryEdge !== null) {
      if (previousEdge === null) {
        movedGrants[boundaryEdge.id] = { allowMessage: true, allowInterrupt: false }
      } else {
        const grant = sourcePolicy?.edges?.[previousEdge.id]
        movedGrants[boundaryEdge.id] = grant === undefined
          ? { allowMessage: false, allowInterrupt: false }
          : {
              allowMessage: grant.allowMessage === true,
              allowInterrupt: grant.allowInterrupt === true,
            }
      }
    }
    const saved = await save(targetRoot, targetComposition)
    try {
      if (remaining === null) {
        await store.delete(sourceRoot)
      } else if (nextSourceRoot !== sourceRoot) {
        if (nextSourceRoot === targetRoot) {
          await save(nextSourceRoot, remaining)
        } else {
          await withLock(nextSourceRoot, () => save(nextSourceRoot, remaining))
        }
        await store.delete(sourceRoot)
      } else {
        await save(sourceRoot, remaining)
      }
    } catch (error) {
      try {
        await store.put(targetRoot, targetRecord)
      } catch (rollbackError) {
        warn('dsh-combinagents: move target rollback failed', rollbackError)
      }
      throw error
    }
    if (Object.keys(movedGrants).length > 0 && typeof store.putPolicy === 'function') {
      try {
        await store.putPolicy(targetRoot, {
          version: 1,
          rootSessionId: targetRoot,
          edges: { ...(targetPolicy?.edges ?? {}), ...movedGrants },
          updatedAt: now(),
        })
        if (boundaryEdge !== null) {
          await recordAudit(targetRoot, {
            kind: 'grant',
            edgeId: boundaryEdge.id,
            outcome: previousEdge === null ? 'defaulted' : 'migrated',
            ...(previousEdge === null ? {} : { detail: { fromEdgeId: previousEdge.id } }),
          })
        }
      } catch (error) {
        // The graph move is already committed; a failed grant write must fail
        // closed (the new edge reads as deny) rather than default to allow.
        warn('dsh-combinagents: grant migration failed after move', error)
      }
    }
    await migrateMovedSideTables(
      sourceRoot,
      targetRoot,
      remaining === null ? null : nextSourceRoot,
      detached.subtree.nodes,
    )
    unindexComposition(sourceRoot, sourceRecord.composition)
    if (remaining !== null) indexComposition(nextSourceRoot, remaining)
    indexComposition(targetRoot, targetComposition)
    return saved
  }

  /**
   * Attach one discovered session, optionally under an existing node. Sessions
   * already in this composition move their subtree; sessions in another
   * composition are moved (root selection moves the whole source forest).
   * @param {string} rootSessionId - composition owner.
   * @param {{sessionId: string, parentId?: string|null, label?: string}} input - node.
   * @returns {Promise<{composition: object, updatedAt: number}>}
   */
  async function addNode(rootSessionId, input = {}) {
    if (typeof input.sessionId !== 'string' || input.sessionId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'sessionId must be a non-empty string')
    }
    const owner = await resolveSession(input.sessionId)
    if (owner !== null && owner.rootSessionId !== rootSessionId) {
      return withMergeLock(() => withRootLocks(
        [rootSessionId, owner.rootSessionId],
        () => moveAcrossExclusive(rootSessionId, input, owner.rootSessionId),
      ))
    }
    return withLock(rootSessionId, () => addNodeExclusive(rootSessionId, input))
  }

  /**
   * Remove one node. `promote` lifts its reports to roots; `cascade` removes the
   * subtree. Both remove composition nodes only. The root-session node is
   * rejected because the per-root record key must stay resolvable.
   * @param {string} rootSessionId - composition owner.
   * @param {{nodeId: string, mode?: 'promote'|'cascade'}} input - target and mode.
   * @returns {Promise<{composition: object, updatedAt: number}>}
   */
  async function removeNode(rootSessionId, input = {}) {
    const mode = input.mode ?? 'promote'
    if (mode !== 'promote' && mode !== 'cascade') {
      throw new CompositionError('INVALID_FIELD', "mode must be 'promote' or 'cascade'")
    }
    if (typeof input.nodeId !== 'string' || input.nodeId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'nodeId must be a non-empty string')
    }
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      const target = record.composition.nodes.find((node) => node.id === input.nodeId)
      if (target === undefined) {
        throw new CompositionError('UNKNOWN_NODE', `node ${JSON.stringify(input.nodeId)} does not exist`)
      }
      if (target.sessionId !== null && target.sessionId === record.composition.rootSessionId) {
        throw new CompositionError('ROOT_PROTECTED', 'the root-session node cannot be removed; delete the composition instead')
      }
      const affected = mode === 'cascade'
        ? [input.nodeId, ...descendantsOf(record.composition, input.nodeId).map((node) => node.id)]
        : [input.nodeId]
      assertIdle(record.composition, affected, 'remove a node')
      const composition = mode === 'cascade'
        ? removeSubtree(record.composition, input.nodeId)
        : removeGraphNode(record.composition, input.nodeId)
      const saved = await save(rootSessionId, composition)
      const remaining = new Set(composition.nodes.map((node) => node.id))
      for (const node of record.composition.nodes) {
        if (!remaining.has(node.id)) unindexSession(rootSessionId, node.sessionId)
      }
      await pruneTeams(rootSessionId, composition)
      return saved
    })
  }

  /**
   * Attach an external placeholder. It has no local Session and can never be
   * routed to; the node exists only in the overlay.
   * @param {string} rootSessionId - composition owner.
   * @param {{label: string, provider?: string, nativeParentSessionId?: string|null,
   *   externalId?: string, parentId?: string|null}} input - external node fields.
   * @returns {Promise<{composition: object, updatedAt: number}>}
   */
  async function addExternal(rootSessionId, input = {}) {
    const label = labelOf(input.label)
    if (label === null) {
      throw new CompositionError('INVALID_FIELD', 'label must be a non-empty string')
    }
    const externalId = externalNodeId(textOf(input.externalId, 256))
    const nativeParentSessionId = textOf(input.nativeParentSessionId, 128)
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      const parentId = typeof input.parentId === 'string' && input.parentId.length > 0 ? input.parentId : null
      assertIdle(record.composition, parentId === null ? [] : [parentId], 'add an external node')
      // Adding the same native placeholder twice is a no-op, not a duplicate
      // node and not a node-cap failure.
      if (externalPlaceholder(record.composition, externalId, {
        label,
        nativeParentSessionId,
      }) !== undefined) return record
      const node = {
        ...(externalId === null ? {} : { id: externalId }),
        sessionId: null,
        label,
        kind: 'external',
        source: 'external',
        mode: 'external',
        provider: textOf(input.provider, 80),
        nativeParentSessionId,
        cwd: null,
        permissionPreset: null,
      }
      const composition = addGraphNode(record.composition, node, { parentId })
      const saved = await save(rootSessionId, composition)
      indexComposition(rootSessionId, composition)
      return saved
    })
  }

  /**
   * Change one node's reporting parent. `null` detaches it to a root.
   * @param {string} rootSessionId - composition owner.
   * @param {{nodeId: string, parentId: string|null}} input - target and parent.
   * @returns {Promise<{composition: object, updatedAt: number}>}
   */
  async function setParent(rootSessionId, input = {}) {
    if (typeof input.nodeId !== 'string' || input.nodeId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'nodeId must be a non-empty string')
    }
    const parentId = typeof input.parentId === 'string' && input.parentId.length > 0 ? input.parentId : null
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      assertIdle(record.composition, [input.nodeId], 'reparent a node')
      if (parentId !== null) assertIdle(record.composition, [parentId], 'reparent under a node')
      const previous = record.composition
      const composition = setGraphParent(previous, input.nodeId, parentId)
      const saved = await save(rootSessionId, composition)
      indexComposition(rootSessionId, composition)
      await migrateParentGrants(rootSessionId, previous, composition, input.nodeId)
      return saved
    })
  }

  /**
   * Rename one node without changing its session or parent.
   * @param {string} rootSessionId - composition owner.
   * @param {{nodeId: string, label: string}} input - target and label.
   * @returns {Promise<{composition: object, updatedAt: number}>}
   */
  async function renameNode(rootSessionId, input = {}) {
    if (typeof input.nodeId !== 'string' || input.nodeId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'nodeId must be a non-empty string')
    }
    const label = labelOf(input.label)
    if (label === null) {
      throw new CompositionError('INVALID_FIELD', 'label must be a non-empty string')
    }
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      const composition = renameGraphNode(record.composition, input.nodeId, label)
      return save(rootSessionId, composition)
    })
  }

  /**
   * Change one composition's title without touching its nodes or edges.
   * @param {string} rootSessionId - composition owner.
   * @param {{title: string}} input - new title.
   * @returns {Promise<{composition: object, updatedAt: number}>}
   */
  async function setTitle(rootSessionId, input = {}) {
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      const composition = setGraphTitle(record.composition, input.title)
      return save(rootSessionId, composition)
    })
  }

  /**
   * Mirror one newly started native child into the composition that owns its
   * parent. This observes the native subagent channel; it does not route or
   * reparent anything and it bypasses the busy guard because it is a system
   * observation, not a user edit.
   * @param {string} parentSessionId - durable direct creator.
   * @param {{childId: string, provider: string, local: boolean}} info - start info.
   * @returns {Promise<object|null>} the saved record, or null when nothing changed.
   */
  async function autoAttach(parentSessionId, info) {
    if (typeof parentSessionId !== 'string' || typeof info?.childId !== 'string') return null
    const owner = await resolveSession(parentSessionId)
    if (owner === null) return null
    // The start event can precede the child's durable title projection. Read
    // (and retry) outside the composition lock so a burst of starts does not
    // serialize 150 ms waits behind one root.
    let preparedSummary = null
    if (info.local === true) {
      preparedSummary = await discovery.describe(info.childId)
      if (preparedSummary === null) {
        await new Promise((resolve) => setTimeout(resolve, 150))
        preparedSummary = await discovery.describe(info.childId)
      }
    }
    const externalId = info.local === true ? null : externalNodeId(info.childId)
    const externalLabel = textOf(info.provider, 120) ?? 'External subagent'
    const externalParent = textOf(parentSessionId, 128)
    return withLock(owner.rootSessionId, async () => {
      const record = await requireRecord(owner.rootSessionId)
      const parent = record.composition.nodes.find((node) => node.sessionId === parentSessionId)
      if (parent === undefined) return null
      const childOwner = await directOwner(info.childId)
      if (childOwner !== null && childOwner !== owner.rootSessionId) {
        warn('dsh-combinagents: refusing to mirror a child owned by another composition', {
          childId: info.childId,
          owner: childOwner,
          requestedBy: owner.rootSessionId,
        })
        return null
      }
      const existing = record.composition.nodes.find((node) => node.sessionId === info.childId)
        ?? (externalId === null
          ? undefined
          : externalPlaceholder(record.composition, externalId, {
              label: externalLabel,
              nativeParentSessionId: externalParent,
            }))
      if (existing !== undefined) {
        if (typeof info.label === 'string' && info.label.length > 0 && existing.label !== info.label) {
          const composition = renameGraphNode(record.composition, existing.id, info.label)
          const saved = await save(owner.rootSessionId, composition)
          indexComposition(owner.rootSessionId, composition)
          return saved
        }
        return null
      }
      let node
      if (info.local === true) {
        const summary = preparedSummary
        if (summary !== null) {
          node = { ...nodeFromSummary(summary), mode: 'continuable' }
          if (typeof info.label === 'string' && info.label.length > 0) {
            node = { ...node, label: info.label }
          }
        } else if (typeof info.label === 'string' && info.label.length > 0) {
          // Headless and other projections may not expose a title yet; the
          // composed delegation path knows the child it just started.
          node = {
            sessionId: info.childId,
            label: info.label,
            kind: 'session',
            source: 'subagent',
            mode: 'continuable',
            provider: textOf(info.provider, 80),
            nativeParentSessionId: textOf(parentSessionId, 128),
            cwd: textOf(info.cwd, 1024),
            permissionPreset: null,
          }
        } else {
          return null
        }
      } else {
        node = {
          ...(externalId === null ? {} : { id: externalId }),
          sessionId: null,
          label: externalLabel,
          kind: 'external',
          source: 'external',
          mode: 'external',
          provider: textOf(info.provider, 80),
          nativeParentSessionId: externalParent,
          cwd: null,
          permissionPreset: null,
        }
      }
      const composition = addGraphNode(record.composition, node, { parentId: parent.id })
      const saved = await save(owner.rootSessionId, composition)
      indexComposition(owner.rootSessionId, composition)
      discovery.invalidateNative?.(owner.rootSessionId)
      return saved
    })
  }

  /**
   * Import every native descendant that is not already a composition node.
   * Existing overlay edges are never rewritten; only missing children are
   * attached under their native parent node. System action: it bypasses the
   * user busy guard.
   * @param {string} rootSessionId - composition root or any member.
   * @returns {Promise<object|null>} the saved record, or null without a composition.
   */
  async function syncNativeTree(rootSessionId) {
    const owner = await resolveSession(rootSessionId)
    const root = owner?.rootSessionId ?? rootSessionId
    if (typeof root !== 'string' || root.length === 0) return null
    const direct = owner?.record ?? await store.get(root)
    if (direct === undefined) return null
    const tree = await discovery.listTree(root)
    if (!tree.available || tree.children.length === 0) return direct
    // Collect the expensive I/O outside the per-root lock. The lock only
    // re-reads the graph, checks membership, and merges the prepared nodes.
    const prepared = []
    const knownSessions = new Set(direct.composition.nodes
      .map((node) => node.sessionId)
      .filter((sessionId) => typeof sessionId === 'string'))
    const knownExternal = new Set(direct.composition.nodes
      .filter((node) => node.kind === 'external')
      .map((node) => node.id))
    for (const entry of tree.children) {
      let nodeInput = null
      const placeholderId = externalNodeId(entry.id)
      // Already-present nodes only need their lifecycle mode reconciled. Do
      // not fold a title or read a log for a tree that is already mirrored.
      if (knownSessions.has(entry.id) || (placeholderId !== null && knownExternal.has(placeholderId))) {
        prepared.push({
          entry,
          nodeInput: null,
          externalId: knownSessions.has(entry.id) ? null : placeholderId,
        })
        continue
      }
      const placeholder = {
        sessionId: null,
        label: textOf(entry.name ?? entry.label, 120) ?? entry.id,
        kind: 'external',
        source: 'external',
        mode: entry.mode,
        provider: textOf(entry.mode, 80),
        nativeParentSessionId: textOf(entry.parentId, 128),
        cwd: null,
        permissionPreset: null,
      }
      if (entry.mode === 'external') {
        nodeInput = { ...(placeholderId === null ? {} : { id: placeholderId }), ...placeholder }
      } else {
        const summary = await discovery.describe(entry.id)
        if (summary !== null) {
          nodeInput = { ...nodeFromSummary(summary), mode: entry.mode }
        } else if (entry.mode === 'one-shot') {
          nodeInput = { ...(placeholderId === null ? {} : { id: placeholderId }), ...placeholder }
        }
      }
      if (nodeInput !== null) {
        prepared.push({
          entry,
          nodeInput,
          externalId: nodeInput.kind === 'external' ? placeholderId : null,
        })
      }
    }
    return withLock(root, async () => {
      const record = await requireRecord(root)
      let composition = record.composition
      let changed = false
      for (const { entry, nodeInput, externalId } of prepared) {
        const existing = composition.nodes.find((node) => node.sessionId === entry.id)
          ?? (externalId === null
            ? undefined
            : nodeInput === null
              ? composition.nodes.find((node) => node.id === externalId)
              : externalPlaceholder(composition, externalId, nodeInput))
        if (existing !== undefined) {
          if (existing.mode !== entry.mode) {
            composition = {
              ...composition,
              nodes: composition.nodes.map((node) => node.id === existing.id ? { ...node, mode: entry.mode } : node),
            }
            changed = true
          }
          continue
        }
        // The pre-lock snapshot said this node existed; if it disappeared
        // meanwhile there is no prepared input to add, so skip it.
        if (nodeInput === null) continue
        const childOwner = await directOwner(entry.id)
        if (childOwner !== null) {
          if (childOwner !== root) {
            warn('dsh-combinagents: sync-native skipped a session owned by another composition', {
              childId: entry.id,
              owner: childOwner,
              requestedBy: root,
            })
          }
          continue
        }
        const parentNode = composition.nodes.find((node) => node.sessionId === entry.parentId)
        if (parentNode === undefined) continue
        try {
          composition = addGraphNode(composition, nodeInput, { parentId: parentNode.id })
          changed = true
        } catch (error) {
          if (error?.code === 'TOO_MANY_NODES' || error?.code === 'DUPLICATE_SESSION_ID') break
          throw error
        }
      }
      if (!changed) return record
      const saved = await save(root, composition)
      indexComposition(root, composition)
      discovery.invalidateNative?.(root)
      return saved
    })
  }

  /**
   * Install a fully built composition (used by the clone/bud adapter).
   * @param {string} rootSessionId - new composition owner.
   * @param {object} composition - validated composition graph.
   * @returns {Promise<{composition: object, updatedAt: number}>}
   */
  async function installComposition(rootSessionId, composition) {
    if (typeof rootSessionId !== 'string' || rootSessionId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'rootSessionId must be a non-empty string')
    }
    assertComposition(composition)
    return withLock(rootSessionId, async () => {
      for (const node of composition.nodes) {
        if (typeof node.sessionId !== 'string' || node.sessionId.length === 0) continue
        const owner = await directOwner(node.sessionId)
        if (owner !== null && owner !== rootSessionId) {
          throw new CompositionError(
            'SESSION_ALREADY_COMPOSED',
            `session ${JSON.stringify(node.sessionId)} already belongs to composition ${JSON.stringify(owner)}`,
          )
        }
      }
      const record = await save(rootSessionId, composition)
      indexComposition(rootSessionId, composition)
      return record
    })
  }

  /**
   * Read one composition record.
   * @param {string} rootSessionId - composition owner.
   * @returns {Promise<{composition: object, updatedAt: number}|null>}
   */
  async function state(rootSessionId) {
    if (typeof rootSessionId !== 'string' || rootSessionId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'rootSessionId must be a non-empty string')
    }
    const record = await store.get(rootSessionId)
    return record ?? null
  }

  /**
   * Delete one composition record. Sessions are untouched.
   * @param {string} rootSessionId - composition owner.
   * @returns {Promise<void>}
   */
  async function deleteComposition(rootSessionId) {
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      assertIdle(record.composition, record.composition.nodes.map((node) => node.id), 'delete the composition')
      await store.delete(rootSessionId)
      await store.deletePolicy?.(rootSessionId)
      unindexComposition(rootSessionId, record.composition)
      for (const [taskId, task] of await store.listTasks?.(rootSessionId) ?? []) {
        if (task.rootSessionId === rootSessionId) await store.deleteTask?.(taskId)
      }
      for (const team of await store.listTeams?.(rootSessionId) ?? []) {
        await store.deleteTeam?.(team.id)
      }
      for (const [cloneId, clone] of await store.listClones?.(rootSessionId) ?? []) {
        if (clone.newRootSessionId === rootSessionId && typeof store.putClone === 'function') {
          // Keep the clone mapping so the session cleanup tool can find the
          // persisted clone sessions after the overlay is gone. The record is
          // removed only after those sessions are explicitly deleted. A
          // metadata write failure must not resurrect or block the deletion.
          try {
            await store.putClone(cloneId, { ...clone, status: 'orphaned', orphanedAt: now() })
          } catch (error) {
            warn('dsh-combinagents: could not mark the clone record orphaned', error)
          }
        }
      }
    })
  }

  return {
    create,
    addNode,
    addExternal,
    removeNode,
    setParent,
    renameNode,
    setTitle,
    installComposition,
    resolveSession,
    autoAttach,
    syncNativeTree,
    getGrants,
    setEdgeGrant,
    grantDelegatedEdge,
    authorizeMessage,
    authorizeInterrupt,
    recordAudit,
    getTasks,
    createTask,
    updateTask,
    listTeams,
    createTeam,
    deleteTeam,
    teamForNode,
    state,
    deleteComposition,
    /** @returns {'durable'|'memory'} storage mode of the backing store. */
    get storageMode() {
      return store.mode
    },
  }
}
