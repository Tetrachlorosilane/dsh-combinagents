/**
 * TEMPORARY clone/bud spike endpoint.
 *
 * This module exists only to validate DSH seed/catalog/permission behavior
 * against a real Host. It is not part of the product API and should be removed
 * once the clone adapter is implemented.
 */

import { randomUUID } from 'node:crypto'

import { CompositionError } from './graph.js'

/** Provider name reserved for this spike. */
export const SPIKE_PROVIDER = 'combinagents-clone-spike'

const CLONE_NOTICE = (sourceId) => [
  'This session is a clone created by dsh-combinagents.',
  `Source session: ${sourceId}.`,
  'The original session remains active and is not replaced.',
  'Continue from the inherited history; do not assume the source\'s in-flight work is still running.',
].join('\n')

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
 * Read one persisted or live source without activating it.
 * @param {object} query - sessionQuery service.
 * @param {string} sessionId - source session.
 * @returns {Promise<{header: object, seed: object[], eventCount: number}>}
 */
async function observe(query, sessionId) {
  if (query?.observeSession === undefined) {
    throw new CompositionError('CLONE_SPIKE_UNAVAILABLE', 'sessionQuery.observeSession is unavailable')
  }
  const observation = await query.observeSession(sessionId)
  try {
    const seed = completedPrefix(observation.events)
    return { header: observation.header, seed, eventCount: observation.events.length }
  } finally {
    observation[Symbol.dispose]?.()
  }
}

/**
 * Create the temporary spike facade.
 * @param {{ctx: object, discovery: object}} deps - Host context and discovery.
 */
export function createCloneSpike({ ctx, discovery }) {
  const pendingSources = new Map()
  const live = new Map()
  let providerDispose

  const agents = () => ctx.get?.('agents')
  const subagents = () => ctx.get?.('subagents')
  const sessions = () => ctx.get?.('sessions')
  const query = () => ctx.get?.('sessionQuery')
  const presets = () => ctx.get?.('agentPresets')
  const permissions = () => ctx.get?.('permissionPresets')

  function ensureProvider() {
    if (providerDispose !== undefined) return
    const service = subagents()
    if (service?.registerProvider === undefined) {
      throw new CompositionError('CLONE_SPIKE_UNAVAILABLE', 'the subagents service is unavailable')
    }
    providerDispose = service.registerProvider({
      name: SPIKE_PROVIDER,
      capabilities: { agentOptions: false, agentPreset: true, outputSchema: false, depthLimit: true },
      inheritsParentContext: false,
      async prepareContinuable(request) {
        const sourceId = pendingSources.get(request.sessionId)
        if (typeof sourceId !== 'string') {
          throw new CompositionError('CLONE_SPIKE_FAILED', `no clone source reserved for ${request.sessionId}`)
        }
        const source = await observe(query(), sourceId)
        return source.seed.length > 0 ? { seed: source.seed } : {}
      },
    })
  }

  /**
   * Read the display permission preset for a live or persisted session.
   * @param {string} sessionId - session to inspect.
   * @returns {Promise<string|null>}
   */
  async function permissionOf(sessionId) {
    const liveSession = sessions()?.get?.(sessionId)
    if (liveSession !== undefined) {
      try {
        return permissions()?.current?.(liveSession) ?? null
      } catch {
        return null
      }
    }
    return (await discovery?.describe?.(sessionId))?.permissionPreset ?? null
  }

  /**
   * @param {string} sessionId - clone root session.
   * @param {'live'|'dispose'} mode - keep the child activation or dispose it.
   * @param {boolean} cleanup - dispose everything after diagnostics.
   */
  async function run({ rootSessionId, childSessionId, mode = 'dispose', cleanup = false } = {}) {
    if (typeof rootSessionId !== 'string' || rootSessionId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'rootSessionId is required')
    }
    if (mode !== 'live' && mode !== 'dispose') {
      throw new CompositionError('INVALID_FIELD', "mode must be 'live' or 'dispose'")
    }
    if (childSessionId !== undefined && (typeof childSessionId !== 'string' || childSessionId.length === 0)) {
      throw new CompositionError('INVALID_FIELD', 'childSessionId must be a non-empty string when supplied')
    }
    const agentRegistry = agents()
    if (agentRegistry?.create === undefined) {
      throw new CompositionError('CLONE_SPIKE_UNAVAILABLE', 'the agents service is unavailable')
    }
    ensureProvider()

    const sourceRoot = await observe(query(), rootSessionId)
    const sourceRootHeader = JSON.parse(JSON.stringify(sourceRoot.header))
    const rootPermissionBefore = await permissionOf(rootSessionId)
    const cloneRootId = `session-${randomUUID()}`
    const presetService = presets()
    let agentPreset
    let setup
    if (presetService?.resolve !== undefined && presetService?.mount !== undefined) {
      const resolved = await presetService.resolve(sourceRoot.header.agentPreset)
      if (typeof sourceRoot.header.agentPreset === 'string' && sourceRoot.header.agentPreset.length > 0) {
        agentPreset = resolved.id
      }
      setup = async (agentCtx) => { await presetService.mount(agentCtx, resolved.id) }
    }

    let rootHandle
    let childActivation
    const diagnostics = {
      sourceRootSessionId: rootSessionId,
      sourceRootHeader,
      sourceRootPermission: rootPermissionBefore,
      cloneRootSessionId: cloneRootId,
      mode,
      cleanup,
    }
    try {
      rootHandle = await agentRegistry.create({
        sessionId: cloneRootId,
        seed: sourceRoot.seed,
        inheritedEventCount: sourceRoot.seed.length,
        meta: {
          ...(typeof sourceRoot.header.cwd === 'string' ? { cwd: sourceRoot.header.cwd } : {}),
          isSeeded: true,
          ...(agentPreset === undefined ? {} : { agentPreset }),
        },
        ...(setup === undefined ? {} : { setup }),
      })
      const rootSession = rootHandle.agent.session
      diagnostics.cloneRootHeader = rootSession.header
      diagnostics.cloneRootPermission = await permissionOf(cloneRootId)
      diagnostics.cloneRootLive = sessions()?.get?.(cloneRootId) !== undefined
      diagnostics.catalogsBeforeChild = await subagents()?.listChildren?.(rootSession.header.id) ?? []

      if (childSessionId !== undefined) {
        const sourceChild = await observe(query(), childSessionId)
        diagnostics.sourceChildHeader = JSON.parse(JSON.stringify(sourceChild.header))
        diagnostics.sourceChildPermission = await permissionOf(childSessionId)
        const cloneChildId = `session-${randomUUID()}`
        diagnostics.cloneChildSessionId = cloneChildId
        pendingSources.set(cloneChildId, childSessionId)
        childActivation = await subagents().startActivation({
          provider: SPIKE_PROVIDER,
          label: `clone:${childSessionId}`,
          childId: cloneChildId,
          request: {
            prompt: [{ type: 'text', text: CLONE_NOTICE(childSessionId) }],
            parent: rootHandle.agent,
            ...(typeof sourceChild.header.cwd === 'string' ? { cwd: sourceChild.header.cwd } : {}),
            ...(typeof sourceChild.header.agentPreset === 'string' && sourceChild.header.agentPreset.length > 0
              ? { agentPreset: sourceChild.header.agentPreset }
              : {}),
            maxDepth: 8,
          },
          signal: AbortSignal.timeout(30000),
          delivery: 'caller',
        })
        diagnostics.cloneChildActivation = { childId: childActivation.childId, messageId: childActivation.messageId }
        diagnostics.catalogsWithChild = await subagents()?.listChildren?.(rootSession.header.id) ?? []
        diagnostics.cloneChildLiveBeforeDispose = sessions()?.get?.(cloneChildId) !== undefined
        diagnostics.cloneChildPermission = await permissionOf(cloneChildId)
        if (mode === 'dispose') {
          await childActivation.dispose()
          diagnostics.childDisposed = true
          diagnostics.catalogsAfterDispose = await subagents()?.listChildren?.(rootSession.header.id) ?? []
          diagnostics.cloneChildLiveAfterDispose = sessions()?.get?.(cloneChildId) !== undefined
          diagnostics.cloneChildObservation = await discovery?.describe?.(cloneChildId) ?? null
        }
      }

      diagnostics.sourceRootHeaderAfter = JSON.parse(JSON.stringify((await observe(query(), rootSessionId)).header))
      diagnostics.sourceRootUnchanged = JSON.stringify(diagnostics.sourceRootHeader) === JSON.stringify(diagnostics.sourceRootHeaderAfter)
      diagnostics.catalogCount = diagnostics.catalogsWithChild?.length ?? diagnostics.catalogsBeforeChild?.length ?? 0
      if (cleanup !== true) {
        live.set(cloneRootId, { rootHandle, childActivation, childId: diagnostics.cloneChildSessionId, pendingChild: diagnostics.cloneChildSessionId })
      }
      return { ok: true, diagnostics }
    } catch (error) {
      diagnostics.error = String(error?.message ?? error)
      try {
        if (childActivation !== undefined) await childActivation.dispose()
      } catch {}
      try {
        if (rootHandle !== undefined) await rootHandle.dispose()
      } catch {}
      for (const [childId, sourceId] of pendingSources) {
        if (sourceId === childSessionId) pendingSources.delete(childId)
      }
      return { ok: false, diagnostics }
    } finally {
      if (cleanup === true) {
        try {
          if (childActivation !== undefined && diagnostics.childDisposed !== true) await childActivation.dispose()
        } catch {}
        try {
          if (rootHandle !== undefined) await rootHandle.dispose()
        } catch {}
        for (const [childId, sourceId] of pendingSources) {
          if (sourceId === childSessionId) pendingSources.delete(childId)
        }
      }
    }
  }

  /**
   * Dispose one previously created spike clone.
   * @param {string} cloneRootSessionId - clone root id returned by run().
   */
  async function cleanup(cloneRootSessionId) {
    const entry = live.get(cloneRootSessionId)
    if (entry === undefined) {
      throw new CompositionError('CLONE_SPIKE_NOT_FOUND', `no live spike clone ${JSON.stringify(cloneRootSessionId)}`)
    }
    live.delete(cloneRootSessionId)
    try {
      if (entry.childActivation !== undefined) await entry.childActivation.dispose()
    } finally {
      try {
        await entry.rootHandle.dispose()
      } finally {
        if (typeof entry.pendingChild === 'string') pendingSources.delete(entry.pendingChild)
      }
    }
    return { ok: true, cloneRootSessionId }
  }

  return {
    run,
    cleanup,
    dispose() {
      for (const [id, entry] of live) {
        live.delete(id)
        void entry.childActivation?.dispose?.().catch?.(() => {})
        void entry.rootHandle?.dispose?.().catch?.(() => {})
      }
      pendingSources.clear()
      if (providerDispose !== undefined) {
        providerDispose()
        providerDispose = undefined
      }
    },
  }
}
