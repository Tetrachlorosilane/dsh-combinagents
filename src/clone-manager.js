/**
 * Whole-tree clone and bud adapter.
 *
 * A clone is a new DSH session tree: a seeded root created through
 * `ctx.agents.create`, and seeded native children created through
 * `ctx.subagents.startActivation` with a plugin-owned provider. Children are
 * kept live while their own descendants are built, then disposed in post-order
 * so they remain persisted, cataloged, and cold-resumable without running.
 */

import { randomUUID } from 'node:crypto'

import { CompositionError, createComposition } from './graph.js'
import { planClone } from './clone.js'

/** Provider name owned by this adapter. */
export const CLONE_PROVIDER = 'combinagents-clone'

/** Idle clone roots retained live in one Host process before the oldest is released. */
export const MAX_LIVE_CLONE_ROOTS = 8

/** Hard upper bound for one whole-tree clone/bud operation. */
export const CLONE_TOTAL_TIMEOUT_MS = 120000

const CLONE_NOTICE = (sourceId) => [
  'This session is a clone created by dsh-combinagents.',
  `Source session: ${sourceId}.`,
  'The original session remains active and is not replaced.',
  'Continue from the inherited history; do not assume the source\'s in-flight work is still running.',
].join('\n')

/**
 * @param {object} sourceNode - source plan node that failed.
 * @param {unknown} error - underlying failure.
 * @returns {CompositionError}
 */
function cloneFailure(sourceNode, error) {
  const detail = error instanceof Error ? error.message : String(error)
  return new CompositionError(
    'CLONE_FAILED',
    `could not clone ${JSON.stringify(sourceNode.label)} (${String(sourceNode.sourceSessionId)}): ${detail}`,
  )
}

/**
 * @param {readonly object[]} events - source session events.
 * @returns {object[]} raw completed-turn prefix, without marker/closers.
 */
function completedPrefix(events) {
  const lastTurnEnd = events.findLast((event) => event.type === 'turn/end')
  if (lastTurnEnd === undefined) return []
  let boundary = lastTurnEnd.seq
  for (const next of events.slice(boundary + 1)) {
    if (next.type === 'turn/start' || next.type === 'agent/inbox/spliced'
      || (next.type === 'user/message' && next.surfaceOp === 'append')) break
    boundary = next.seq
  }
  return events.slice(0, boundary + 1)
}

/**
 * @param {object} query - sessionQuery service.
 * @param {string} sessionId - source session.
 * @returns {Promise<{header: object, seed: object[]}>}
 */
async function observe(query, sessionId) {
  if (query?.observeSession === undefined) {
    throw new CompositionError('CLONE_UNAVAILABLE', 'clone requires the sessionQuery service')
  }
  const observation = await query.observeSession(sessionId)
  try {
    return { header: observation.header, seed: completedPrefix(observation.events) }
  } finally {
    observation[Symbol.dispose]?.()
  }
}

/**
 * Create the clone/bud adapter.
 * @param {{ctx: object, store: object, discovery: object, manager: object,
 *   now?: () => number}} deps - Host services and composition manager.
 */
export function createCloneManager({ ctx, store, discovery, manager, now = () => Date.now() }) {
  const pendingSources = new Map()
  const rootHandles = new Map()
  let providerDispose
  let cloneActive = false

  const agents = () => ctx.get?.('agents')
  const subagents = () => ctx.get?.('subagents')
  const sessions = () => ctx.get?.('sessions')
  const query = () => ctx.get?.('sessionQuery')
  const presets = () => ctx.get?.('agentPresets')
  const permissions = () => ctx.get?.('permissionPresets')

  function ensureProvider() {
    if (providerDispose !== undefined) return
    const service = subagents()
    if (service?.registerProvider === undefined || service?.startActivation === undefined) {
      throw new CompositionError('CLONE_UNAVAILABLE', 'clone requires the subagents service')
    }
    providerDispose = service.registerProvider({
      name: CLONE_PROVIDER,
      capabilities: { agentOptions: false, agentPreset: true, outputSchema: false, depthLimit: true },
      inheritsParentContext: false,
      async prepareContinuable(request) {
        const sourceId = pendingSources.get(request.sessionId)
        if (typeof sourceId !== 'string') {
          throw new CompositionError('CLONE_FAILED', `no clone source reserved for ${request.sessionId}`)
        }
        const source = await observe(query(), sourceId)
        return source.seed.length > 0 ? { seed: source.seed } : {}
      },
    })
  }

  /**
   * @param {string} sessionId - live or persisted session.
   * @returns {Promise<string|null>}
   */
  async function permissionOf(sessionId) {
    const live = sessions()?.get?.(sessionId)
    if (live !== undefined) {
      try {
        return permissions()?.current?.(live) ?? null
      } catch {
        return null
      }
    }
    return (await discovery?.describe?.(sessionId))?.permissionPreset ?? null
  }

  /**
   * Find the workspace that owns a source session (walking native ancestors for
   * subagents, matching the ordinary fork command). A source session created
   * before the workspace registry tracked it has no membership, so fall back to
   * the workspace whose path is its cwd; otherwise the clone root would stay in
   * the ungrouped bucket and be invisible in the sidebar.
   * @param {string} sessionId - source session.
   * @param {object} header - source header.
   * @returns {Promise<object|undefined>}
   */
  async function workspaceOf(sessionId, header) {
    const registry = ctx.get?.('workspaceRegistry')
    const workspaces = registry?.list?.() ?? []
    const direct = workspaces.find((workspace) => workspace.sessionIds?.includes(sessionId))
    if (direct !== undefined) return direct
    if (header?.origin !== 'subagent') return byPath(workspaces, header?.cwd)
    const trace = await ctx.get?.('sessionQuery')?.traceSession?.(sessionId)
    for (const ancestor of trace?.ancestors ?? []) {
      const workspace = workspaces.find((candidate) => candidate.sessionIds?.includes(ancestor.header?.id))
      if (workspace !== undefined) return workspace
    }
    return byPath(workspaces, header?.cwd)
  }

  /**
   * Match a workspace by directory, tolerating separators and Windows casing.
   * @param {object[]} workspaces - registry entries.
   * @param {string|undefined} cwd - session working directory.
   * @returns {object|undefined}
   */
  function byPath(workspaces, cwd) {
    const normalized = normalizePath(cwd)
    if (normalized === null) return undefined
    return workspaces.find((workspace) => normalizePath(workspace.path) === normalized)
  }

  /**
   * @param {unknown} value - path-like value.
   * @returns {string|null} comparable form.
   */
  function normalizePath(value) {
    if (typeof value !== 'string' || value.length === 0) return null
    return value.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
  }

  /**
   * Attach a new clone session to the source workspace so it is visible in the
   * normal session list.
   * @param {string} sourceSessionId - source session.
   * @param {object} sourceHeader - source header.
   * @param {string} newSessionId - clone session.
   */
  async function attachWorkspace(sourceSessionId, sourceHeader, newSessionId) {
    const workspace = await workspaceOf(sourceSessionId, sourceHeader)
    if (workspace?.attachSession === undefined) return null
    await workspace.attachSession(newSessionId)
    return workspace
  }

  /**
   * @param {string} sourceRootSessionId - composition owner or member.
   * @returns {Promise<{rootSessionId: string, record: object}>}
   */
  async function sourceOf(sourceRootSessionId) {
    const resolved = await manager.resolveSession(sourceRootSessionId)
    if (resolved === null) {
      throw new CompositionError('COMPOSITION_NOT_FOUND', `no composition contains ${JSON.stringify(sourceRootSessionId)}`)
    }
    return { rootSessionId: resolved.rootSessionId, record: resolved.record }
  }

  /**
   * One clone/bud at a time per Host. A second request fails fast with a stable
   * 409 instead of doubling session creation and model work.
   * @param {() => Promise<unknown>} task - clone work.
   * @returns {Promise<unknown>}
   */
  async function withCloneSlot(task) {
    if (cloneActive) {
      throw new CompositionError('CLONE_IN_PROGRESS', 'another clone or bud is already running')
    }
    cloneActive = true
    try {
      return await task()
    } finally {
      cloneActive = false
    }
  }

  /**
   * Create one seeded root agent.
   * @param {object} sourceNode - plan node for the clone root.
   * @param {number} snapshotAt - clone time.
   * @returns {Promise<{id: string, handle: object, header: object}>}
   */
  async function createRoot(sourceNode, snapshotAt) {
    const registry = agents()
    if (registry?.create === undefined) {
      throw new CompositionError('CLONE_UNAVAILABLE', 'clone requires the agents service')
    }
    if (sourceNode.kind !== 'session' || sourceNode.sourceSessionId === null) {
      throw new CompositionError('CLONE_SOURCE_NOT_SESSION', 'a clone root must be a local session node')
    }
    let source
    try {
      source = await observe(query(), sourceNode.sourceSessionId)
    } catch (error) {
      throw error instanceof CompositionError ? error : cloneFailure(sourceNode, error)
    }
    const id = `session-${randomUUID()}`
    const presetService = presets()
    let agentPreset
    let setup
    if (typeof source.header.agentPreset === 'string' && source.header.agentPreset.length > 0
      && presetService?.resolve !== undefined && presetService?.mount !== undefined) {
      const resolved = await presetService.resolve(source.header.agentPreset)
      agentPreset = resolved.id
      setup = async (agentCtx) => { await presetService.mount(agentCtx, resolved.id) }
    }
    const handle = await registry.create({
      sessionId: id,
      seed: source.seed,
      inheritedEventCount: source.seed.length,
      meta: {
        ...(typeof source.header.cwd === 'string' ? { cwd: source.header.cwd } : {}),
        isSeeded: true,
        ...(agentPreset === undefined ? {} : { agentPreset }),
      },
      ...(setup === undefined ? {} : { setup }),
    }).catch((error) => {
      throw cloneFailure(sourceNode, error)
    })
    return { id, handle, header: handle.agent.session.header, sourceHeader: source.header, snapshotAt }
  }

  /**
   * Create one seeded native child under a live clone parent.
   * @param {object} sourceNode - plan node for the source child.
   * @param {object} parentAgent - live clone parent agent.
   * @param {number} snapshotAt - clone time.
   * @returns {Promise<{id: string, activation: object, agent: object, header: object}>}
   */
  async function createChild(sourceNode, parentAgent, snapshotAt, signal = undefined) {
    if (sourceNode.kind !== 'session' || sourceNode.sourceSessionId === null) {
      throw new CompositionError('CLONE_SOURCE_NOT_SESSION', 'a local clone child requires a session')
    }
    const service = subagents()
    if (service?.startActivation === undefined) {
      throw new CompositionError('CLONE_UNAVAILABLE', 'clone requires the subagents service')
    }
    const source = await observe(query(), sourceNode.sourceSessionId)
    const id = `session-${randomUUID()}`
    pendingSources.set(id, sourceNode.sourceSessionId)
    let activation
    try {
      activation = await service.startActivation({
        provider: CLONE_PROVIDER,
        label: sourceNode.label,
        childId: id,
        prompt: [{ type: 'text', text: CLONE_NOTICE(sourceNode.sourceSessionId) }],
        parent: parentAgent,
        ...(typeof source.header.cwd === 'string' ? { cwd: source.header.cwd } : {}),
        ...(typeof source.header.agentPreset === 'string' && source.header.agentPreset.length > 0
          ? { agentPreset: source.header.agentPreset }
          : {}),
        maxDepth: 32,
        signal: signal === undefined
          ? AbortSignal.timeout(30000)
          : AbortSignal.any([AbortSignal.timeout(30000), signal]),
        // `caller` still catalogs the child (the catalog commit runs for local
        // activations), but suppresses the settlement notice that `parent`
        // would inject into the clone root. Otherwise disposing each cloned
        // child wakes the clone root and it starts a new turn.
        delivery: 'caller',
      })
      const agent = agents()?.get?.(id)
      if (agent === undefined) {
        throw new CompositionError('CLONE_FAILED', `clone child ${JSON.stringify(id)} did not publish a live agent`)
      }
      pendingSources.delete(id)
      return { id, activation, agent, header: agent.session.header, sourceHeader: source.header, snapshotAt }
    } catch (error) {
      // `startActivation` may have published a live child before a later
      // projection read failed. Release that activation so it cannot sit
      // resident behind a failed clone; the created session still persists
      // and is reported by the caller's failure path.
      if (activation !== undefined) {
        try {
          await activation.dispose?.()
        } catch (disposeError) {
          ctx.logger?.warn?.('dsh-combinagents: failed to release an unpublished clone child', disposeError)
        }
      }
      pendingSources.delete(id)
      throw error instanceof CompositionError ? error : cloneFailure(sourceNode, error)
    }
  }

  /**
   * Build one clone/bud tree from a plan.
   * @param {object} plan - pure plan.
   * @param {object} sourceComposition - source graph.
   * @param {string} kind - clone or bud.
   * @returns {Promise<object>} clone record and installed composition.
   */
  async function execute(plan, sourceComposition, kind, signal = undefined) {
    ensureProvider()
    signal?.throwIfAborted()
    const snapshotAt = plan.snapshotAt
    const rootSourceNode = plan.nodes.find((node) => node.sourceNodeId === plan.rootSourceNodeId)
    if (rootSourceNode === undefined) {
      throw new CompositionError('UNKNOWN_NODE', 'the clone plan has no root node')
    }
    const pendingActivations = new Set()
    let root
    let attachedWorkspace = null
    const cloneNodeBySource = new Map()
    const clonedTeams = []
    const nodes = []
    const edges = []
    try {
      root = await createRoot(rootSourceNode, snapshotAt)
      signal?.throwIfAborted()
      // Make room before registering the new root so the cap can never evict
      // the root that this operation is still building. A running retained root
      // (the user may have resumed it) is never disposed; fail the new clone
      // instead of interrupting live work.
      while (rootHandles.size >= MAX_LIVE_CLONE_ROOTS) {
        const candidate = [...rootHandles.entries()].find(([candidateId]) => {
          try {
            return agents()?.get?.(candidateId)?.status !== 'running'
          } catch {
            return true
          }
        })
        if (candidate === undefined) {
          throw new CompositionError(
            'CLONE_IN_PROGRESS',
            'cannot release a running clone root; retry after it becomes idle',
          )
        }
        const [candidateId, candidateHandle] = candidate
        rootHandles.delete(candidateId)
        try {
          await candidateHandle.dispose?.()
        } catch (error) {
          ctx.logger?.warn?.('dsh-combinagents: releasing an idle clone root failed', error)
        }
      }
      rootHandles.set(root.id, root.handle)
      attachedWorkspace = await attachWorkspace(rootSourceNode.sourceSessionId, root.sourceHeader, root.id)
      cloneNodeBySource.set(rootSourceNode.sourceNodeId, {
        id: randomUUID(),
        sessionId: root.id,
      })
      const rootCloneNode = cloneNodeBySource.get(rootSourceNode.sourceNodeId)
      nodes.push({
        id: rootCloneNode.id,
        sessionId: root.id,
        label: rootSourceNode.label,
        kind: 'session',
        source: rootSourceNode.source,
        mode: 'continuable',
        provider: rootSourceNode.provider,
        nativeParentSessionId: null,
        cwd: rootSourceNode.cwd ?? root.sourceHeader.cwd ?? null,
        permissionPreset: rootSourceNode.permissionPreset,
        cloneOf: rootSourceNode.cloneOf,
        cloneSnapshotAt: snapshotAt,
        sourceCompositionId: sourceComposition.id,
        addedAt: snapshotAt,
      })

      const childrenOf = new Map()
      for (const edge of plan.edges) {
        const list = childrenOf.get(edge.parentSourceNodeId) ?? []
        list.push(edge)
        childrenOf.set(edge.parentSourceNodeId, list)
      }
      /**
       * Build one source subtree depth-first. A child is disposed only after its
       * own descendants are built, so no more than one sibling per depth stays
       * live and a wide team never exceeds the Host's active-child limit.
       * @param {string} sourceNodeId - source node whose children to build.
       * @param {object} parentAgent - live cloned parent.
       * @returns {Promise<void>}
       */
      const build = async (sourceNodeId, parentAgent) => {
        for (const parentEdge of childrenOf.get(sourceNodeId) ?? []) {
          const sourceNode = plan.nodes.find((node) => node.sourceNodeId === parentEdge.childSourceNodeId)
          if (sourceNode === undefined) continue
          const parentClone = cloneNodeBySource.get(sourceNodeId)
          if (parentClone === undefined) continue
          const nodeId = randomUUID()
          if (sourceNode.kind === 'external') {
            cloneNodeBySource.set(sourceNode.sourceNodeId, { id: nodeId, sessionId: null })
            nodes.push({
              id: nodeId,
              sessionId: null,
              label: sourceNode.label,
              kind: 'external',
              source: 'external',
              mode: sourceNode.mode ?? 'external',
              provider: sourceNode.provider,
              nativeParentSessionId: parentClone.sessionId ?? null,
              cwd: null,
              permissionPreset: null,
              cloneOf: sourceNode.cloneOf,
              cloneSnapshotAt: snapshotAt,
              sourceCompositionId: sourceComposition.id,
              addedAt: snapshotAt,
            })
            edges.push({
              id: randomUUID(),
              parentId: parentClone.id,
              childId: nodeId,
              role: 'reports-to',
            })
            continue
          }
          signal?.throwIfAborted()
          const child = await createChild(sourceNode, parentAgent, snapshotAt, signal)
          pendingActivations.add(child.activation)
          cloneNodeBySource.set(sourceNode.sourceNodeId, { id: nodeId, sessionId: child.id })
          nodes.push({
            id: nodeId,
            sessionId: child.id,
            label: sourceNode.label,
            kind: 'session',
            source: sourceNode.source,
            mode: 'continuable',
            provider: sourceNode.provider,
            nativeParentSessionId: parentClone.sessionId ?? null,
            cwd: sourceNode.cwd ?? child.sourceHeader.cwd ?? null,
            permissionPreset: sourceNode.permissionPreset,
            cloneOf: sourceNode.cloneOf,
            cloneSnapshotAt: snapshotAt,
            sourceCompositionId: sourceComposition.id,
            addedAt: snapshotAt,
          })
          edges.push({
            id: randomUUID(),
            parentId: parentClone.id,
            childId: nodeId,
            role: 'reports-to',
          })
          await build(sourceNode.sourceNodeId, child.agent)
          try {
            await child.activation.dispose()
          } catch (error) {
            ctx.logger?.warn?.('dsh-combinagents: clone child dispose failed', error)
          } finally {
            pendingActivations.delete(child.activation)
          }
        }
      }

      await build(rootSourceNode.sourceNodeId, root.handle.agent)

      const composition = createComposition({
        id: randomUUID(),
        title: `${sourceComposition.title} (clone)`.slice(0, 120),
        rootSessionId: root.id,
        nodes,
        edges,
      })

      const installed = await manager.installComposition(root.id, composition)
      const cloneId = randomUUID()
      const clone = {
        id: cloneId,
        kind,
        status: 'completed',
        sourceCompositionId: sourceComposition.id,
        sourceRootSessionId: sourceComposition.rootSessionId,
        newRootSessionId: root.id,
        snapshotAt,
        nodeMapping: plan.nodes.map((node) => {
          const cloned = cloneNodeBySource.get(node.sourceNodeId)
          return {
            sourceNodeId: node.sourceNodeId,
            sourceSessionId: node.sourceSessionId,
            newSessionId: cloned?.sessionId ?? null,
            label: node.label,
            cloneOf: node.cloneOf,
          }
        }),
        cacheProfile: {
          cwd: root.sourceHeader.cwd ?? null,
          agentPreset: root.sourceHeader.agentPreset ?? null,
          permissionPreset: await permissionOf(root.id),
        },
        createdAt: snapshotAt,
      }
      await store.putClone(cloneId, clone)

      const teamIdBySource = new Map()
      if (typeof store.putTeam === 'function' && typeof manager.listTeams === 'function') {
        const sourceTeams = await manager.listTeams(sourceComposition.rootSessionId)
        for (const team of sourceTeams) {
          const teamRoot = cloneNodeBySource.get(team.rootNodeId)
          if (teamRoot === undefined) continue
          let nodeIds
          if (Array.isArray(team.nodeIds)) {
            const mapped = team.nodeIds
              .map((id) => cloneNodeBySource.get(id)?.id)
              .filter((id) => typeof id === 'string')
            if (mapped.length !== team.nodeIds.length) continue
            nodeIds = mapped
          }
          const teamId = randomUUID()
          teamIdBySource.set(team.id, teamId)
          const clonedTeam = {
            id: teamId,
            rootSessionId: root.id,
            rootNodeId: teamRoot.id,
            ...(nodeIds === undefined ? {} : { nodeIds }),
            label: team.label,
            createdBy: 'clone',
            createdAt: snapshotAt,
            updatedAt: snapshotAt,
          }
          await store.putTeam(teamId, clonedTeam)
          clonedTeams.push(teamId)
        }
      }

      const taskIdBySource = new Map()
      const tasks = []
      for (const task of plan.tasks) {
        const taskId = randomUUID()
        taskIdBySource.set(task.sourceTaskId, taskId)
        const ownerNode = task.ownerSourceNodeId === null
          ? undefined
          : cloneNodeBySource.get(task.ownerSourceNodeId)
        tasks.push({
          id: taskId,
          rootSessionId: root.id,
          subject: task.subject,
          description: task.description,
          status: task.status,
          ownerNodeId: ownerNode?.id ?? null,
          ...(ownerNode === undefined ? {} : { ownerName: ownerNode.label }),
          teamId: task.teamId === null || task.teamId === undefined
            ? null
            : (teamIdBySource.get(task.teamId) ?? null),
          blockedBy: [],
          writeScopes: [...task.writeScopes],
          revision: 1,
          createdAt: snapshotAt,
          updatedAt: snapshotAt,
          createdBy: 'clone',
        })
      }
      for (let index = 0; index < tasks.length; index += 1) {
        const sourceTask = plan.tasks[index]
        tasks[index].blockedBy = sourceTask.blockedBy
          .map((sourceTaskId) => taskIdBySource.get(sourceTaskId))
          .filter((taskId) => typeof taskId === 'string')
        await store.putTask(tasks[index].id, tasks[index])
      }

      return {
        clone,
        composition: installed.composition,
        tasks: await manager.getTasks(root.id),
      }
    } catch (error) {
      for (const activation of [...pendingActivations].reverse()) {
        try {
          await activation.dispose()
        } catch {}
      }
      if (root !== undefined) {
        rootHandles.delete(root.id)
        try {
          await attachedWorkspace?.detachSession?.(root.id)
        } catch (error) {
          ctx.logger?.warn?.('dsh-combinagents: could not detach a failed clone from its workspace', error)
        }
        try {
          await root.handle.dispose()
        } catch {}
        try {
          await store.delete(root.id)
        } catch {}
        try {
          for (const [taskId, task] of await store.listTasks(root.id)) {
            if (task.rootSessionId === root.id) await store.deleteTask(taskId)
          }
        } catch {}
        try {
          for (const [cloneId, clone] of await store.listClones(root.id)) {
            if (clone.newRootSessionId === root.id) await store.deleteClone(cloneId)
          }
        } catch {}
        for (const teamId of clonedTeams) {
          try { await store.deleteTeam?.(teamId) } catch {}
        }
      }
      for (const [childId, sourceId] of pendingSources) {
        if (plan.nodes.some((node) => node.sourceSessionId === sourceId)) pendingSources.delete(childId)
      }
      // Sessions already published by `agents.create` or a child activation
      // cannot be rolled back by this plugin (DSH exposes no session delete).
      // Keep the failed clone diagnosable instead of silently leaving them
      // undiscoverable: the caller can archive them through the workspace.
      const createdSessionIds = [...cloneNodeBySource.values()]
        .map((entry) => entry.sessionId)
        .filter((sessionId) => typeof sessionId === 'string')
      if (createdSessionIds.length > 0) {
        ctx.logger?.warn?.('dsh-combinagents: clone failed after creating sessions; sessions remain persisted', {
          rootSessionId: root?.id,
          createdSessionIds,
        })
      }
      if (root !== undefined && typeof store.putClone === 'function') {
        // Durable failure journal: without it a failed clone leaves sessions
        // that no clone record can ever locate again. The cleanup tool reads
        // this record and deletes the sessions only after explicit user
        // confirmation.
        const failedCloneId = randomUUID()
        const failedClone = {
          id: failedCloneId,
          kind,
          status: 'failed',
          sourceCompositionId: sourceComposition.id,
          sourceRootSessionId: sourceComposition.rootSessionId,
          newRootSessionId: root.id,
          snapshotAt,
          nodeMapping: plan.nodes.map((node) => {
            const cloned = cloneNodeBySource.get(node.sourceNodeId)
            return {
              sourceNodeId: node.sourceNodeId,
              sourceSessionId: node.sourceSessionId,
              newSessionId: cloned?.sessionId
                ?? (node.sourceNodeId === plan.rootSourceNodeId ? root.id : null),
              label: node.label,
              cloneOf: node.cloneOf,
            }
          }),
          failure: { code: error?.code ?? 'CLONE_FAILED' },
          createdAt: snapshotAt,
        }
        try {
          await store.putClone(failedCloneId, failedClone)
        } catch (recordError) {
          ctx.logger?.warn?.('dsh-combinagents: failed to journal a failed clone', recordError)
        }
      }
      throw error
    }
  }

  /**
   * Clone the whole root tree of one composition.
   * @param {string} sourceSessionId - composition owner or member.
   * @returns {Promise<object>}
   */
  async function cloneTree(sourceSessionId, options = {}) {
    return withCloneSlot(async () => {
      if (typeof sourceSessionId !== 'string' || sourceSessionId.length === 0) {
        throw new CompositionError('INVALID_FIELD', 'rootSessionId must be a non-empty string')
      }
      const source = await sourceOf(sourceSessionId)
      const composition = source.record.composition
      const tasks = await manager.getTasks(source.rootSessionId)
      const plan = planClone({
        composition,
        tasks,
        snapshotAt: now(),
        kind: 'clone',
      })
      const signal = options.signal === undefined
        ? AbortSignal.timeout(CLONE_TOTAL_TIMEOUT_MS)
        : AbortSignal.any([AbortSignal.timeout(CLONE_TOTAL_TIMEOUT_MS), options.signal])
      return execute(plan, composition, 'clone', signal)
    })
  }

  /**
   * Bud one composition node and its subtree as a new independent root.
   * @param {string} sourceSessionId - composition owner or member.
   * @param {string} nodeId - source node to bud.
   * @returns {Promise<object>}
   */
  async function bud(sourceSessionId, nodeId, options = {}) {
    return withCloneSlot(async () => {
      if (typeof nodeId !== 'string' || nodeId.length === 0) {
        throw new CompositionError('INVALID_FIELD', 'nodeId must be a non-empty string')
      }
      const source = await sourceOf(sourceSessionId)
      const composition = source.record.composition
      const tasks = await manager.getTasks(source.rootSessionId)
      const plan = planClone({
        composition,
        rootNodeId: nodeId,
        tasks,
        snapshotAt: now(),
        kind: 'bud',
      })
      const signal = options.signal === undefined
        ? AbortSignal.timeout(CLONE_TOTAL_TIMEOUT_MS)
        : AbortSignal.any([AbortSignal.timeout(CLONE_TOTAL_TIMEOUT_MS), options.signal])
      return execute(plan, composition, 'bud', signal)
    })
  }

  /**
   * Release one retained clone root after its composition is deleted. The
   * session stays persisted and can still be resumed later.
   * @param {string} rootSessionId - clone root session.
   * @returns {Promise<boolean>} whether a retained handle was released.
   */
  async function releaseRoot(rootSessionId) {
    if (typeof rootSessionId !== 'string' || rootSessionId.length === 0) return false
    const handle = rootHandles.get(rootSessionId)
    if (handle === undefined) return false
    rootHandles.delete(rootSessionId)
    try {
      await handle.dispose?.()
    } catch (error) {
      ctx.logger?.warn?.('dsh-combinagents: releasing a clone root failed', error)
    }
    return true
  }

  return {
    cloneTree,
    bud,
    releaseRoot,
    dispose() {
      for (const [id, handle] of rootHandles) {
        rootHandles.delete(id)
        try {
          void Promise.resolve(handle.dispose?.()).catch(() => {})
        } catch {
          // A synchronous dispose failure must not stop unload cleanup.
        }
      }
      pendingSources.clear()
      if (providerDispose !== undefined) {
        providerDispose()
        providerDispose = undefined
      }
    },
    /** @returns {number} live clone roots retained by this adapter. */
    get liveCount() {
      return rootHandles.size
    },
  }
}
