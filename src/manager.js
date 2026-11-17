/**
 * Composition manager: serialized graph mutations over the durable store.
 *
 * One write chain per root session prevents two UI clicks from interleaving a
 * read-modify-write. The manager owns the two policies the pure graph model
 * deliberately does not know: a composition must exist before a mutation, and
 * the root-session node can never be removed from its own composition.
 */

import { randomUUID } from 'node:crypto'

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
 * @param {object} summary - discovery summary.
 * @returns {object} graph node fields (without id/timestamps).
 */
function nodeFromSummary(summary) {
  return {
    sessionId: summary.sessionId,
    label: labelOf(summary.title) ?? summary.sessionId,
    kind: 'session',
    source: summary.source,
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
export function createManager({ store, discovery, agents = () => undefined, now = () => Date.now() }) {
  /** @type {Map<string, Promise<void>>} */
  const tails = new Map()
  let mergeTail = Promise.resolve()
  /** @type {Map<string, string>|null} session id -> owning root session id */
  let membership = null

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
    if (membership !== null) return membership
    const map = new Map()
    for (const [rootSessionId, record] of await store.list()) {
      for (const node of record?.composition?.nodes ?? []) {
        if (typeof node.sessionId === 'string' && node.sessionId.length > 0) {
          map.set(node.sessionId, rootSessionId)
        }
      }
    }
    membership = map
    return map
  }

  /**
   * @param {string} rootSessionId - owning composition.
   * @param {object} composition - saved graph.
   */
  function indexComposition(rootSessionId, composition) {
    if (membership === null) return
    for (const node of composition.nodes) {
      if (typeof node.sessionId === 'string' && node.sessionId.length > 0) {
        membership.set(node.sessionId, rootSessionId)
      }
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
  async function resolveSession(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null
    const map = await ensureMembership()
    let current = sessionId
    const seen = new Set()
    for (let depth = 0; depth < 32; depth += 1) {
      if (typeof current !== 'string' || current.length === 0 || seen.has(current)) return null
      seen.add(current)
      const rootSessionId = map.get(current)
      if (rootSessionId !== undefined) {
        const record = await store.get(rootSessionId)
        if (record === undefined) {
          map.delete(current)
          return null
        }
        return { rootSessionId, record }
      }
      // A native descendant that has not been mirrored yet still belongs to
      // the composition of its native ancestor: walk the durable parent chain.
      const summary = await discovery.describe(current)
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
    const result = previous.then(task, task)
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
   * @returns {Promise<Record<string, {allowMessage: boolean, allowInterrupt: boolean}>>}
   */
  async function getGrants(rootSessionId) {
    const record = await requireRecord(rootSessionId)
    const stored = (await store.getPolicy(rootSessionId))?.edges ?? {}
    /** @type {Record<string, {allowMessage: boolean, allowInterrupt: boolean}>} */
    const result = {}
    for (const edge of record.composition.edges) {
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
   * @returns {Promise<object[]>}
   */
  async function getTasks(rootSessionId) {
    await requireRecord(rootSessionId)
    const entries = await store.listTasks(rootSessionId)
    return entries.map(([, task]) => task).sort((left, right) => left.createdAt - right.createdAt)
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
      const ownerNodeId = typeof input.ownerNodeId === 'string' && input.ownerNodeId.length > 0
        ? input.ownerNodeId
        : null
      if (ownerNodeId !== null) {
        const owner = record.composition.nodes.find((node) => node.id === ownerNodeId)
        if (owner === undefined || owner.kind !== 'session') {
          throw new CompositionError('UNKNOWN_NODE', `owner node ${JSON.stringify(ownerNodeId)} is not a local session node`)
        }
      }
      const task = {
        id: randomUUID(),
        rootSessionId,
        subject,
        description: taskText(input.description, 8000),
        status: 'pending',
        ownerNodeId,
        blockedBy: Array.isArray(input.blockedBy) ? input.blockedBy.filter((id) => typeof id === 'string') : [],
        writeScopes: Array.isArray(input.writeScopes) ? input.writeScopes.filter((scope) => typeof scope === 'string') : [],
        revision: 1,
        createdAt: now(),
        updatedAt: now(),
        createdBy: 'user',
      }
      await store.putTask(task.id, task)
      await recordAudit(rootSessionId, { kind: 'task', toNodeId: ownerNodeId ?? '', outcome: 'created', detail: { taskId: task.id } })
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
    if (action !== 'start' && action !== 'complete' && action !== 'reopen' && action !== 'delete') {
      throw new CompositionError('INVALID_FIELD', 'action must be start, complete, reopen, or delete')
    }
    return withLock(rootSessionId, async () => {
      const task = await store.getTask(input.taskId)
      if (task === undefined || task.rootSessionId !== rootSessionId) {
        throw new CompositionError('TASK_NOT_FOUND', `task ${JSON.stringify(input.taskId)} does not exist`)
      }
      if (task.revision !== input.expectedRevision) {
        throw new CompositionError('TASK_CONFLICT', 'the task changed; refresh before retrying')
      }
      if (action === 'delete') {
        await store.deleteTask(task.id)
        await recordAudit(rootSessionId, { kind: 'task', outcome: 'deleted', detail: { taskId: task.id } })
        return getTasks(rootSessionId)
      }
      const status = action === 'start' ? 'in_progress' : action === 'complete' ? 'completed' : 'pending'
      const next = { ...task, status, revision: task.revision + 1, updatedAt: now() }
      await store.putTask(task.id, next)
      await recordAudit(rootSessionId, { kind: 'task', outcome: action, detail: { taskId: task.id } })
      return getTasks(rootSessionId)
    })
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
   * Move one subtree from another composition into the target composition.
   * A selected source root moves only that tree; if it was the composition root,
   * the remaining forest is re-keyed to another local root.
   * @param {string} targetRoot - target composition owner.
   * @param {object} input - add request.
   * @param {string} sourceRoot - current composition owner.
   * @returns {Promise<object>} saved target record.
   */
  async function moveAcross(targetRoot, input, sourceRoot) {
    const current = await resolveSession(input.sessionId)
    if (current === null || current.rootSessionId === targetRoot) {
      return addNode(targetRoot, input)
    }
    const sourceRecord = await requireRecord(current.rootSessionId)
    const targetRecord = await requireRecord(targetRoot)
    const parentId = typeof input.parentId === 'string' && input.parentId.length > 0 ? input.parentId : null
    assertIdle(targetRecord.composition, parentId === null ? [] : [parentId], 'move a node into')
    const sourceNode = sourceRecord.composition.nodes.find((node) => node.sessionId === input.sessionId)
    if (sourceNode === undefined) {
      return attachDiscovered(targetRecord, targetRoot, input, parentId)
    }
    if (isWorking(input.sessionId)) {
      throw new CompositionError('AGENT_BUSY', 'cannot move a node: that agent is running')
    }
    assertIdle(sourceRecord.composition, [sourceNode.id], 'move a node')
    const detached = detachSubtree(sourceRecord.composition, sourceNode.id)
    const remaining = detached.remaining
    let nextSourceRoot = current.rootSessionId
    if (remaining !== null && remaining.rootSessionId === null) {
      const nextRoot = rootsOf(remaining).find((node) => typeof node.sessionId === 'string')
      if (nextRoot === undefined) {
        throw new CompositionError('MOVE_WOULD_ORPHAN', 'the remaining composition has no local root session to own it')
      }
      nextSourceRoot = nextRoot.sessionId
      remaining.rootSessionId = nextSourceRoot
    }
    const targetComposition = attachSubtree(targetRecord.composition, detached.subtree, parentId)
    const saved = await save(targetRoot, targetComposition)
    indexComposition(targetRoot, targetComposition)
    if (parentId !== null) await grantManualConnection(targetRoot, targetComposition, sourceNode.id)
    if (remaining === null) {
      await store.delete(current.rootSessionId)
      unindexComposition(current.rootSessionId, sourceRecord.composition)
    } else if (nextSourceRoot !== current.rootSessionId) {
      await save(nextSourceRoot, remaining)
      await store.delete(current.rootSessionId)
      indexComposition(nextSourceRoot, remaining)
      unindexComposition(current.rootSessionId, sourceRecord.composition)
    } else {
      await save(current.rootSessionId, remaining)
      indexComposition(current.rootSessionId, remaining)
    }
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
      return withMergeLock(() => moveAcross(rootSessionId, input, owner.rootSessionId))
    }
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
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
    })
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
      return saved
    })
  }

  /**
   * Attach an external placeholder. It has no local Session and can never be
   * routed to; the node exists only in the overlay.
   * @param {string} rootSessionId - composition owner.
   * @param {{label: string, provider?: string, nativeParentSessionId?: string|null,
   *   parentId?: string|null}} input - external node fields.
   * @returns {Promise<{composition: object, updatedAt: number}>}
   */
  async function addExternal(rootSessionId, input = {}) {
    const label = labelOf(input.label)
    if (label === null) {
      throw new CompositionError('INVALID_FIELD', 'label must be a non-empty string')
    }
    return withLock(rootSessionId, async () => {
      const record = await requireRecord(rootSessionId)
      const parentId = typeof input.parentId === 'string' && input.parentId.length > 0 ? input.parentId : null
      assertIdle(record.composition, parentId === null ? [] : [parentId], 'add an external node')
      const node = {
        sessionId: null,
        label,
        kind: 'external',
        source: 'external',
        provider: textOf(input.provider, 80),
        nativeParentSessionId: textOf(input.nativeParentSessionId, 128),
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
    return withLock(owner.rootSessionId, async () => {
      const record = await requireRecord(owner.rootSessionId)
      const parent = record.composition.nodes.find((node) => node.sessionId === parentSessionId)
      if (parent === undefined) return null
      const existing = record.composition.nodes.find((node) => node.sessionId === info.childId)
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
        let summary = await discovery.describe(info.childId)
        if (summary === null) {
          // The subagent/start event can precede the child's durable title
          // projection; retry once after the session publishes.
          await new Promise((resolve) => setTimeout(resolve, 150))
          summary = await discovery.describe(info.childId)
        }
        if (summary !== null) {
          node = nodeFromSummary(summary)
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
          sessionId: null,
          label: textOf(info.provider, 120) ?? 'External subagent',
          kind: 'external',
          source: 'external',
          provider: textOf(info.provider, 80),
          nativeParentSessionId: textOf(parentSessionId, 128),
          cwd: null,
          permissionPreset: null,
        }
      }
      const composition = addGraphNode(record.composition, node, { parentId: parent.id })
      const saved = await save(owner.rootSessionId, composition)
      indexComposition(owner.rootSessionId, composition)
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
    return withLock(root, async () => {
      const record = await requireRecord(root)
      const tree = await discovery.listTree(root)
      if (!tree.available || tree.children.length === 0) return record
      let composition = record.composition
      let changed = false
      for (const entry of tree.children) {
        if (composition.nodes.some((node) => node.sessionId === entry.id)) continue
        const parentNode = composition.nodes.find((node) => node.sessionId === entry.parentId)
        if (parentNode === undefined) continue
        let nodeInput
        const summary = await discovery.describe(entry.id)
        if (summary !== null) {
          nodeInput = nodeFromSummary(summary)
        } else if (entry.mode === 'external' || entry.mode === 'one-shot') {
          nodeInput = {
            sessionId: null,
            label: textOf(entry.name ?? entry.label, 120) ?? entry.id,
            kind: 'external',
            source: 'external',
            provider: textOf(entry.mode, 80),
            nativeParentSessionId: textOf(entry.parentId, 128),
            cwd: null,
            permissionPreset: null,
          }
        } else {
          continue
        }
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
      unindexComposition(rootSessionId, record.composition)
      for (const [taskId, task] of await store.listTasks?.(rootSessionId) ?? []) {
        if (task.rootSessionId === rootSessionId) await store.deleteTask?.(taskId)
      }
      for (const [cloneId, clone] of await store.listClones?.() ?? []) {
        if (clone.newRootSessionId === rootSessionId) await store.deleteClone?.(cloneId)
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
    state,
    deleteComposition,
    /** @returns {'durable'|'memory'} storage mode of the backing store. */
    get storageMode() {
      return store.mode
    },
  }
}
