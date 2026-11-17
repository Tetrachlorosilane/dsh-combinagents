/**
 * dsh-combinagents — Host bundle entry.
 *
 * Phase 1 walking skeleton: a durable per-root composition store, read-only
 * session discovery, serialized graph mutations, and the same-origin JSON bridge
 * the right-sidebar tab consumes. There are no model-facing tools or prompt
 * sections; the overlay never writes a session header, catalog, cwd, or policy.
 */

import { randomUUID } from 'node:crypto'

import { createApi, createNodeHandler, ROUTE_PREFIX } from './src/http.js'
import { createCloneManager } from './src/clone-manager.js'
import { createControls } from './src/controls.js'
import { createDiscovery } from './src/discovery.js'
import { createManager } from './src/manager.js'
import { createStore } from './src/store.js'

/** Package identity used by the bundle and the Client module. */
export const name = '@dsh-external/dsh-combinagents'

/** Version reported to the Client bootstrap response. */
export const version = '0.1.0'

/** Hard dependencies: the live session store and the durable composition domain. */
export const inject = ['sessions', 'storageDomain']

/**
 * Activate the Host half.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const store = createStore(ctx)
  const discovery = createDiscovery(ctx)
  const manager = createManager({ store, discovery, agents: () => ctx.get('agents') })
  const cloneManager = createCloneManager({ ctx, store, discovery, manager })
  const controls = createControls({
    ctx,
    manager,
    discovery,
    mode: config?.mode === 'composed' ? 'composed' : 'overlay',
    subagentProvider: config?.subagentProvider ?? 'spawn',
    forkProvider: config?.forkProvider ?? 'fork',
    maxDepth: config?.maxDepth,
    autoGrantDelegatedEdges: config?.autoGrantDelegatedEdges !== false,
  })

  ctx.effect(() => ctx.inject(['tools'], (toolCtx) => {
    const disposers = controls.definitions.map((definition) => toolCtx.tools.register(definition))
    toolCtx.logger?.info?.('dsh-combinagents: composition tools registered')
    return () => {
      for (const dispose of disposers.reverse()) dispose()
    }
  }), 'dsh-combinagents: control tools')

  ctx.effect(() => ctx.on('subagent/start', (info) => {
    void manager.autoAttach(info.parentSessionId, {
      childId: info.id,
      provider: info.provider,
      local: info.local,
    }).catch((error) => {
      ctx.logger?.warn?.('dsh-combinagents: auto-attach failed', error)
    })
  }), 'dsh-combinagents: native subagent mirror')

  ctx.effect(() => () => {
    cloneManager.dispose()
  }, 'dsh-combinagents: clone manager')

  ctx.effect(() => () => {
    void store.close()
  }, 'dsh-combinagents: composition storage')

  ctx.effect(() => ctx.inject(['webServer'], (webCtx) => {
    const token = randomUUID()
    const api = createApi({
      manager,
      discovery,
      cloneManager,
      token,
      version,
      platform: process.platform,
      logger: webCtx.logger,
    })
    const dispose = webCtx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: createNodeHandler(api, { logger: webCtx.logger }),
    })
    webCtx.logger?.info?.('dsh-combinagents: composition bridge registered')
    return () => dispose()
  }), 'dsh-combinagents: http bridge')

  ctx.logger?.info?.('dsh-combinagents: composition host ready')
}
