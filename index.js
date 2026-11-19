/**
 * dsh-combinagents — Host bundle entry.
 *
 * Phase 1 walking skeleton: a durable per-root composition store, read-only
 * session discovery, serialized graph mutations, and the same-origin JSON bridge
 * the right-sidebar tab consumes. The model surface is installed as per-Agent
 * scoped wrappers over the native tools; the overlay never writes a session
 * header, catalog, cwd, or policy.
 */

import { randomUUID } from 'node:crypto'

import { createApi, createNodeHandler, ROUTE_PREFIX } from './src/http.js'
import { createCloneManager } from './src/clone-manager.js'
import { createControls } from './src/controls.js'
import { createDiscovery } from './src/discovery.js'
import { createManager } from './src/manager.js'
import { createSessionCleanup } from './src/session-cleanup.js'
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
  const store = createStore(ctx, { storageDir: config?.storageDir, logger: ctx.logger })
  const discovery = createDiscovery(ctx)
  const manager = createManager({ store, discovery, agents: () => ctx.get('agents'), logger: ctx.logger })
  const cloneManager = createCloneManager({ ctx, store, discovery, manager })
  const sessionCleanup = createSessionCleanup({
    ctx,
    store,
    discovery,
    manager,
    sessionsRoot: config?.sessionRoot,
    logger: ctx.logger,
  })
  const controls = createControls({
    ctx,
    manager,
    discovery,
    subagentProvider: config?.subagentProvider ?? 'spawn',
    forkProvider: config?.forkProvider ?? 'fork',
    maxDepth: config?.maxDepth,
    agentPreset: config?.agentPreset,
    autoGrantDelegatedEdges: config?.autoGrantDelegatedEdges !== false,
  })

  ctx.effect(() => ctx.inject(['tools', 'agents'], (toolCtx) => {
    // `composition_task` and the four Team-shaped task tools are global;
    // native Team names win when that profile already mounts them. The six
    // native-name tools are installed per Agent so they shadow the native
    // definitions without changing the global registry other plugins read.
    const disposeTasks = controls.register(toolCtx.tools)
    const attached = new Map()
    const attach = (agent) => {
      if (agent === undefined || attached.has(agent.id)) return
      const attachment = controls.attach(agent)
      if (attachment !== null) attached.set(agent.id, attachment)
    }
    const attachAll = () => {
      for (const agent of toolCtx.agents.list()) attach(agent)
    }
    attachAll()
    const offCreated = ctx.on('agent/created', ({ agent }) => attach(agent))
    const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
      const attachment = attached.get(agent.id)
      attached.delete(agent.id)
      attachment?.dispose()
    })
    // A plugin loaded after us may register a native tool later; retry any
    // Agent whose native definition was not visible at creation.
    const offTools = ctx.on('tools/change', () => attachAll())
    toolCtx.logger?.info?.('dsh-combinagents: composition tools registered')
    return () => {
      offTools?.()
      offDisposed?.()
      offCreated?.()
      for (const attachment of attached.values()) attachment.dispose()
      attached.clear()
      disposeTasks()
    }
  }), 'dsh-combinagents: control tools')

  ctx.effect(() => {
    const off = ctx.on('tools/execute', (exec, next) => controls.intercept(exec, next))
    return () => off?.()
  }, 'dsh-combinagents: execution interception')

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
      sessionCleanup,
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
