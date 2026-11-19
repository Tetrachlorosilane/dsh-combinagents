/**
 * Composition control tools: list, message, and interrupt within the
 * user-owned tree. The tool surface deliberately mirrors the native control
 * tools; authority comes from the composition path's per-edge grants, never
 * from the native subagent tree.
 */

import { randomUUID } from 'node:crypto'

import { CompositionError } from './graph.js'

const NOT_IN_COMPOSITION = 'the calling agent is not attached to a composition'
const TARGET_NOT_FOUND = 'no composition node matches the requested agent'
const TARGET_EXTERNAL = 'the target is an external placeholder; it has no local session'
const TARGET_NOT_LIVE = 'the target session is not live'
const NOT_AUTHORIZED = 'the composition edge path does not grant this capability'
const APPROVAL_DENIED = 'the user did not approve delivery to another workspace'

/** Native tool contracts used by tests and by the internal fallback definitions. */
const NATIVE_TOOLS = {
  list: {
    name: 'list_agents',
    description:
      'List your entire subagent tree: the root agent and all reachable continuable descendants, including yourself. '
      + 'Rows carry names, descriptions, and status. A descendant\'s name is its path from the root, such as reviewer/checker. '
      + 'You can message any other agent in the subagent tree. '
      + 'running means it is working; inactive means no turn is executing; it does not indicate task completion, success, or failure. '
      + 'corrupt, unsupported, or unavailable means this row\'s own descendants could not be read; the row itself is '
      + 'still a member you can message. '
      + 'While you remain active, you will be notified when a direct child finishes; there is no need to keep checking its status. '
      + 'Use send_message to continue the conversation.',
    parameters: { type: 'object', properties: {} },
  },
  send: {
    name: 'send_message',
    description:
      'Send a message to an agent. A working agent receives it at its next step; an idle agent starts a new turn with it. '
      + 'Returns delivery confirmation.',
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'The name of another agent in your subagent tree, as shown by list_agents.',
        },
        message: {
          type: 'string',
          description: 'The message to deliver to the agent.',
        },
      },
      required: ['agent', 'message'],
    },
  },
  interrupt: {
    name: 'interrupt_agent',
    description:
      'Ask a subagent to stop its current work. This call returns without waiting for it to stop. '
      + 'You can continue a local subagent\'s conversation later with send_message. '
      + 'External executions stop permanently and cannot receive follow-ups. Subagents it started will keep running.',
    parameters: {
      type: 'object',
      properties: {
        agent: {
          type: 'string',
          description: 'The name of an agent created under you: your direct child or a deeper descendant.',
        },
      },
      required: ['agent'],
    },
  },
  subagent: {
    name: 'subagent',
    description:
      'Delegate a self-contained task to a subagent (a separate agent that works in its own context) to offload focused, independent work — research, a scoped implementation, an analysis — so it does not consume this conversation\'s context. The subagent returns its result, not its intermediate steps. This tool starts an independently managed subagent and immediately returns its name. If you are still online when it finishes, the runtime automatically delivers its completion notice. The notice includes the final answer unless the child sent you a message just before finishing. Use `send_message` to steer it while running or continue its conversation after it finishes. Omit `provider`, `model`, and `reasoning_effort` to use child defaults, falling back to compatible parent values.',
    parameters: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Initial child working directory. Relative paths use your current directory; omitted inherits it. Later directory changes in either agent are independent.',
        },
        description: {
          type: 'string',
          description: 'A short (3-5 word) description of the delegated task, for display. Use the language of the user\'s current request.',
        },
        name: {
          type: 'string',
          description: 'Optional short name for the subagent, unique among the subagents you create: lower-case letters, digits, and hyphens, starting with a letter, at most 32 characters; lead is reserved for the root agent. Omitted names default to agent-1, agent-2, and so on.',
        },
        prompt: {
          type: 'string',
          description: 'The complete, self-contained task for the subagent. It does not share this conversation\'s context, so include everything it needs.',
        },
        provider: {
          type: 'string',
          description: 'Child LLM provider id; requires `model`.',
        },
        model: {
          type: 'string',
          description: 'Model id within that provider; requires `provider`.',
        },
        reasoning_effort: {
          type: 'string',
          description: 'Reasoning effort id; requires `provider` and `model`. Omit to use the selected model\'s default, even when it matches the parent or configured route.',
        },
      },
      required: ['description', 'prompt'],
    },
  },
  fork: {
    name: 'subagent_fork',
    description:
      'Delegate a task to a subagent that inherits this conversation: a child agent seeded with all completed turns so far (it does not see the current in-flight turn). Use this when the subtask builds on this conversation\'s context — a follow-up analysis, a review, a continuation — without consuming this conversation\'s context for the work itself. You receive its result, not its intermediate steps. This tool starts an independently managed subagent and immediately returns its name. If you are still online when it finishes, the runtime automatically delivers its completion notice. The notice includes the final answer unless the child sent you a message just before finishing. Use `send_message` to steer it while running or continue its conversation after it finishes.',
    parameters: {
      type: 'object',
      properties: {
        cwd: {
          type: 'string',
          description: 'Initial child working directory. Relative paths use your current directory; omitted inherits it. Later directory changes in either agent are independent.',
        },
        description: {
          type: 'string',
          description: 'A short (3-5 word) description of the delegated task, for display. Use the language of the user\'s current request.',
        },
        name: {
          type: 'string',
          description: 'Optional short name for the subagent, unique among the subagents you create: lower-case letters, digits, and hyphens, starting with a letter, at most 32 characters; lead is reserved for the root agent. Omitted names default to agent-1, agent-2, and so on.',
        },
        prompt: {
          type: 'string',
          description: 'The task for the subagent. It already sees this conversation\'s completed turns, so build on them freely and state only what is new.',
        },
      },
      required: ['description', 'prompt'],
    },
  },
  wait: {
    name: 'wait_agent',
    description:
      'Wait for input at your next step, including agent messages, completion notifications, and user steering. Returns immediately if new input is pending. `timedOut: false` means new input is pending. Pending input is delivered to the model after code execution finishes.',
    parameters: {
      type: 'object',
      properties: {
        timeout_ms: {
          type: 'integer',
          description: 'Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000.',
        },
      },
    },
  },
}

export const NATIVE_TOOL_CONTRACTS = NATIVE_TOOLS

/**
 * @param {Record<string, {type: string, description?: string, enum?: string[], items?: object}>} fields - properties.
 * @param {readonly string[]} required - required property names.
 * @returns {object} JSON Schema object.
 */
function objectSchema(fields, required = []) {
  /** @type {Record<string, object>} */
  const properties = {}
  for (const [name, field] of Object.entries(fields)) {
    properties[name] = {
      type: field.type,
      ...field.description === undefined ? {} : { description: field.description },
      ...field.enum === undefined ? {} : { enum: field.enum },
      ...field.items === undefined ? {} : { items: field.items },
    }
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    ...required.length === 0 ? {} : { required: [...required] },
  }
}

/**
 * @param {object} ctx - Host context carrying optional DSH services.
 * @param {object} manager - composition manager.
 * @param {object} discovery - session discovery.
 */
export function createControls({
  ctx, manager, discovery, subagentProvider = 'spawn', forkProvider = 'fork', maxDepth,
  agentPreset, autoGrantDelegatedEdges = true,
}) {
  const sessions = () => ctx.get?.('sessions')
  const agents = () => ctx.get?.('agents')
  const subagents = () => ctx.get?.('subagents')
  const approval = () => ctx.get?.('approval')
  const permissionPresets = () => ctx.get?.('permissionPresets')
  const sandboxPolicy = () => ctx.get?.('sandboxPolicy')
  const workingDirectories = () => ctx.get?.('workingDirectory')
  const llm = () => ctx.get?.('llm')
  /** Input ids already reported by a wait in the same model tool call. */
  const reportedInput = new WeakMap()
  /** Aborts outstanding waits when the plugin unloads. */
  const waitLifetime = new AbortController()
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      waitLifetime.abort(new CompositionError('WAIT_UNAVAILABLE', 'wait_agent ended because its plugin was unloaded'))
    }, 'dsh-combinagents: wait lifetime')
  }

  /**
   * @param {string} sessionId - target session.
   * @returns {object|undefined} live agent.
   */
  function liveAgent(sessionId) {
    try {
      return agents()?.get?.(sessionId)
    } catch {
      return undefined
    }
  }

  /**
   * @param {string} sessionId - target session.
   * @returns {object|undefined} live Session.
   */
  function liveSession(sessionId) {
    try {
      return sessions()?.get?.(sessionId)
    } catch {
      return undefined
    }
  }

  /**
   * @param {object} agent - caller.
   * @returns {Promise<{rootSessionId: string, record: object, callerNode: object}|null>}
   */
  async function callerContext(agent) {
    if (agent === undefined || agent === null) return null
    const resolved = await manager.resolveSession(agent.id)
    if (resolved === null) return null
    const node = resolved.record.composition.nodes.find((candidate) => candidate.sessionId === agent.id)
    if (node === undefined) return null
    return { rootSessionId: resolved.rootSessionId, record: resolved.record, callerNode: node }
  }

  /**
   * Resolve a model-supplied reference inside one composition.
   * @param {object} composition - graph.
   * @param {string} reference - node id, session id, or unique label.
   * @returns {object} node.
   */
  function resolveTarget(composition, reference) {
    if (typeof reference !== 'string' || reference.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'agent must be a non-empty string')
    }
    const byId = composition.nodes.find((node) => node.id === reference)
    if (byId !== undefined) return byId
    const bySession = composition.nodes.find((node) => node.sessionId === reference)
    if (bySession !== undefined) return bySession
    const byLabel = composition.nodes.filter((node) => node.label === reference)
    if (byLabel.length === 1) return byLabel[0]
    if (byLabel.length > 1) {
      throw new CompositionError('AMBIGUOUS_TARGET', `multiple composition nodes are labeled ${JSON.stringify(reference)}; use its node id or session id`)
    }
    throw new CompositionError('UNKNOWN_TARGET', `${TARGET_NOT_FOUND}: ${JSON.stringify(reference)}`)
  }

  /**
   * Resolve the parent's current LLM route. DSH's delegation contract uses the
   * request-header route when present, falling back to the live Agent options.
   * @param {object} agent - live caller.
   * @returns {{provider: string|undefined, model: string|undefined}}
   */
  function parentRoute(agent) {
    let config
    try {
      config = agent?.session?.requestHeader?.()?.config
    } catch {
      config = undefined
    }
    const options = agent?.options ?? {}
    const provider = typeof config?.provider === 'string'
      ? config.provider
      : typeof options.provider === 'string' ? options.provider : undefined
    const model = typeof config?.model === 'string'
      ? config.model
      : typeof options.model === 'string' ? options.model : undefined
    return { provider, model }
  }

  /**
   * Read the last durable `subagent/model-selection-policy` event from the
   * caller's session. The native delegation tool uses a projection for this
   * state; the plugin has no projection dependency, so it reads the same
   * append-only event instead. `undefined` means no policy is recorded (or the
   * event API is unavailable), in which case explicit selection is restricted
   * to the parent route; `null` means a recorded policy is malformed.
   * @param {object} session - live caller Session.
   * @returns {Array<{provider: string, model: string}>|null|undefined}
   */
  function recordedModelRoutes(session) {
    let events
    try {
      events = session?.snapshotEvents?.()
    } catch {
      return undefined
    }
    if (!Array.isArray(events)) return undefined
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index]
      if (event?.type !== 'subagent/model-selection-policy') continue
      const allowed = event.data?.allowedModels
      if (allowed === null || allowed === undefined) return undefined
      if (!Array.isArray(allowed)) return null
      const routes = []
      for (const route of allowed) {
        if (route === null || typeof route !== 'object'
          || typeof route.provider !== 'string' || route.provider.length === 0
          || typeof route.model !== 'string' || route.model.length === 0) {
          return null
        }
        routes.push({ provider: route.provider, model: route.model })
      }
      return routes
    }
    return undefined
  }

  /**
   * Enforce DSH's child model-selection authorization before resolving a route.
   * With a recorded policy only its exact routes are allowed; without one,
   * explicit selection is limited to the parent's current route.
   * @param {object} agent - live caller.
   * @param {string} provider - requested provider.
   * @param {string} model - requested model.
   */
  function assertModelSelection(agent, provider, model) {
    const routes = recordedModelRoutes(agent?.session)
    if (routes === null) {
      throw new CompositionError(
        'MODEL_SELECTION_FORBIDDEN',
        'the recorded child model-selection policy is malformed',
      )
    }
    if (routes !== undefined) {
      if (routes.some((route) => route.provider === provider && route.model === model)) return
      throw new CompositionError(
        'MODEL_SELECTION_FORBIDDEN',
        `child LLM route ${JSON.stringify(`${provider}/${model}`)} is not allowed for this Session`,
      )
    }
    const parent = parentRoute(agent)
    if (parent.provider === provider && parent.model === model) return
    throw new CompositionError(
      'MODEL_SELECTION_FORBIDDEN',
      `child LLM route ${JSON.stringify(`${provider}/${model}`)} is not allowed; `
        + 'without a recorded model-selection policy, explicit selection is limited to the parent route',
    )
  }

  /**
   * @param {object} agent - live caller.
   * @param {object} session - caller session.
   * @returns {boolean} whether the session runs with full permissions.
   */
  function hasFullPermission(session) {
    if (session === undefined) return false
    try {
      if (permissionPresets()?.current?.(session) === 'danger-full-access') return true
    } catch {
      // fall through
    }
    try {
      return sandboxPolicy()?.resolve?.({ session })?.mode === 'danger-full-access'
    } catch {
      return false
    }
  }

  /**
   * Read one display/authority fact without letting a missing optional service
   * turn a same-domain delivery into an error.
   * @param {Function} read - service reader.
   * @param {object} session - live Session.
   * @returns {string|null}
   */
  function policyValue(read, session) {
    try {
      return read?.(session) ?? null
    } catch {
      return null
    }
  }

  /**
   * Effective working directory, preferring the live projection over the
   * immutable creation header.
   * @param {object|undefined} session - live Session.
   * @returns {string|null}
   */
  function cwdOfSession(session) {
    if (session === undefined) return null
    try {
      const current = workingDirectories()?.get?.(session)
      if (typeof current === 'string' && current.length > 0) return current
    } catch {
      // fall through to the immutable header
    }
    return typeof session.header?.cwd === 'string' ? session.header.cwd : null
  }

  /**
   * A delivery crosses a security boundary when the effective workspace
   * differs, or when live sandbox/permission/approval state differs inside the
   * same cwd. A missing target Session is treated as crossing (fail closed)
   * instead of trusting a stale composition snapshot.
   * @param {object|undefined} callerSession - caller Session.
   * @param {object|undefined} targetSession - target Session.
   * @returns {boolean} whether delivery crosses a boundary.
   */
  function crossesWorkspace(callerSession, targetSession) {
    if (callerSession === undefined || targetSession === undefined) return true
    const left = cwdOfSession(callerSession)
    const right = cwdOfSession(targetSession)
    if (left === null || right === null) return true
    if (left !== right) return true
    const sandbox = policyValue((session) => sandboxPolicy()?.resolve?.({ session })?.mode, callerSession)
    const targetSandbox = policyValue((session) => sandboxPolicy()?.resolve?.({ session })?.mode, targetSession)
    if (sandbox !== targetSandbox) return true
    const permission = policyValue((session) => permissionPresets()?.current?.(session), callerSession)
    const targetPermission = policyValue((session) => permissionPresets()?.current?.(session), targetSession)
    if (permission !== targetPermission) return true
    const approvalPolicy = policyValue((session) => approval()?.overrideOf?.(session), callerSession)
    const targetApprovalPolicy = policyValue((session) => approval()?.overrideOf?.(session), targetSession)
    return approvalPolicy !== targetApprovalPolicy
  }

  /**
   * Ask the composed approval answerers for one sensitive delivery.
   * @param {object} agent - caller.
   * @param {string} toolName - tool identity.
   * @param {string} reason - user-facing reason.
   * @param {AbortSignal|undefined} signal - call cancellation.
   * @returns {Promise<boolean>} whether allowed once.
   */
  async function approve(agent, toolName, reason, signal) {
    const service = approval()
    if (service?.request === undefined) return false
    try {
      const outcome = await service.request({ agent, toolName, reason, signal })
      return outcome === 'allowed-once'
    } catch {
      return false
    }
  }

  /**
   * Start one native activation under the caller and mirror it into the caller's
   * composition. The native runtime keeps owning result delivery.
   * @param {object} agent - live caller.
   * @param {object} args - tool arguments.
   * @param {string} provider - configured subagent backend.
   * @param {AbortSignal} signal - call cancellation.
   * @returns {Promise<{kind: 'activation', name: string}>}
   */
  async function startDelegation(agent, args, provider, signal) {
    let caller = await callerContext(agent)
    if (caller === null) {
      const session = liveSession(agent.id)
      const parentSession = session?.header?.parentSession
      if (typeof parentSession === 'string' && parentSession.length > 0) {
        throw new CompositionError('NOT_IN_COMPOSITION', NOT_IN_COMPOSITION)
      }
      // A composed root should work before the tab has ever been opened.
      await manager.create(agent.id)
      caller = await callerContext(agent)
    }
    if (caller === null) throw new CompositionError('NOT_IN_COMPOSITION', NOT_IN_COMPOSITION)
    let childOptions
    if (args.provider !== undefined || args.model !== undefined || args.reasoning_effort !== undefined) {
      if (args.provider === undefined || args.model === undefined) {
        throw new CompositionError('INVALID_MODEL_SELECTION', 'child LLM provider and model must be supplied together')
      }
      if (typeof args.provider !== 'string' || args.provider.length === 0
        || typeof args.model !== 'string' || args.model.length === 0) {
        throw new CompositionError('INVALID_MODEL_SELECTION', 'child LLM provider and model must be non-empty strings')
      }
      assertModelSelection(agent, args.provider, args.model)
      const llmService = llm()
      if (typeof llmService?.resolveCallConfig !== 'function') {
        throw new CompositionError('LLM_UNAVAILABLE', 'cannot validate the selected child LLM route without the llm service')
      }
      await llmService.resolveCallConfig({
        provider: args.provider,
        model: args.model,
        ...(args.reasoning_effort === undefined ? {} : { reasoningEffort: args.reasoning_effort }),
      }, signal)
      childOptions = {
        provider: args.provider,
        model: args.model,
        ...(args.reasoning_effort === undefined ? {} : { reasoningEffort: args.reasoning_effort }),
      }
    }
    const service = subagents()
    if (service?.startActivation === undefined) {
      throw new CompositionError('SUBAGENTS_UNAVAILABLE', 'the subagent service is unavailable')
    }
    const selectedPreset = args.agent_preset ?? agentPreset
    if (selectedPreset !== undefined && typeof selectedPreset !== 'string') {
      throw new CompositionError('INVALID_AGENT_PRESET', 'agent_preset must be a string')
    }
    const started = await service.startActivation({
      provider,
      label: args.description,
      ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
      ...(args.name === undefined ? {} : { name: args.name }),
      prompt: [{ type: 'text', text: args.prompt }],
      parent: agent,
      signal,
      delivery: 'parent',
      ...(typeof maxDepth === 'number' ? { maxDepth } : {}),
      ...(selectedPreset === undefined ? {} : { agentPreset: selectedPreset }),
      ...(childOptions === undefined ? {} : { agentOptions: childOptions }),
    })
    let mirrored = false
    let mirrorError
    // A fork root can still be settling when the native activation resolves.
    // Retry once before declaring a mirror miss; a miss must not fail the
    // delegation because result delivery is owned by the native runtime.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const attached = await manager.autoAttach(agent.id, {
          childId: started.childId,
          local: true,
          provider,
          label: started.name,
          ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
        })
        if (attached !== null) {
          mirrored = true
          mirrorError = undefined
          break
        }
      } catch (error) {
        mirrorError = error
      }
      if (attempt === 0) {
        if (signal?.aborted === true) break
        await new Promise((resolve) => setTimeout(resolve, 60))
      }
    }
    if (!mirrored) {
      if (mirrorError !== undefined) {
        ctx.logger?.warn?.('dsh-combinagents: delegated child started but was not mirrored', {
          childSessionId: started.childId,
          provider,
        }, mirrorError)
      }
      ctx.logger?.warn?.('dsh-combinagents: delegated child has no composition node; add it manually if it is a fork root', {
        childSessionId: started.childId,
        provider,
      })
    }
    if (mirrored && autoGrantDelegatedEdges) {
      try {
        await manager.grantDelegatedEdge(caller.rootSessionId, agent.id, started.childId)
      } catch (error) {
        ctx.logger?.warn?.('dsh-combinagents: delegated edge could not be granted', {
          childSessionId: started.childId,
        }, error)
      }
    }
    await manager.recordAudit(caller.rootSessionId, {
      kind: 'delegation',
      fromNodeId: caller.callerNode.id,
      outcome: 'started',
      detail: { childSessionId: started.childId, name: started.name, provider, mirrored },
    })
    return { kind: 'activation', name: started.name }
  }

  /**
   * Wait for fresh input on the exact calling agent, without consuming it.
   * Mirrors the native wait_agent timeout and cancellation semantics.
   * @param {object} agent - live caller.
   * @param {number} timeoutMs - bounded wait.
   * @param {AbortSignal} signal - call cancellation.
   * @returns {Promise<{timedOut: boolean}>}
   */
  function waitForInput(agent, timeoutMs, signal, rootCallId = undefined, lifetime = undefined) {
    lifetime?.throwIfAborted()
    return new Promise((resolve, reject) => {
      let live
      try {
        live = agents()?.get?.(agent.id)
      } catch {
        live = undefined
      }
      if (live !== agent) {
        reject(new CompositionError('WAIT_UNAVAILABLE', 'wait_agent requires the exact live calling agent'))
        return
      }
      const previous = rootCallId === undefined ? undefined : reportedInput.get(agent)
      const seen = previous !== undefined && previous.rootCallId === rootCallId ? previous.ids : undefined
      let settled = false
      /** @type {ReturnType<typeof setTimeout>|undefined} */
      let timer
      let offInbox
      let offDisposed
      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer)
        offInbox?.()
        offDisposed?.()
        signal.removeEventListener('abort', onAbort)
        lifetime?.removeEventListener('abort', onUnload)
      }
      const finish = (settle) => {
        if (settled) return
        settled = true
        cleanup()
        settle()
      }
      const onAbort = () => finish(() => reject(signal.reason ?? new CompositionError('WAIT_UNAVAILABLE', 'wait_agent aborted')))
      const onUnload = () => finish(() => reject(lifetime?.reason ?? new CompositionError('WAIT_UNAVAILABLE', 'wait_agent unloaded')))
      const onInput = () => {
        const pending = agent.inbox?.nextStep
        if (!Array.isArray(pending) || pending.length === 0) return
        // Pending input is not delivered to the model until this tool call
        // finishes. Without this de-duplication a run_code loop would spin on
        // the same message; native wait_agent records the ids per root call.
        if (pending.some((message) => seen?.has(message?.id) !== true)) {
          if (rootCallId !== undefined) {
            reportedInput.set(agent, { rootCallId, ids: new Set(pending.map((message) => message?.id)) })
          }
          finish(() => resolve({ timedOut: false }))
        }
      }
      timer = setTimeout(() => finish(() => resolve({ timedOut: true })), timeoutMs)
      offInbox = ctx.on?.('agent/inbox/inserted', ({ agent: recipient }) => {
        if (recipient === agent) onInput()
      })
      offDisposed = ctx.on?.('agent/disposed', ({ agent: disposed }) => {
        if (disposed === agent) finish(() => reject(new CompositionError('WAIT_UNAVAILABLE', 'the calling agent was disposed')))
      })
      if (signal.aborted) onAbort()
      else {
        signal.addEventListener('abort', onAbort, { once: true })
        lifetime?.addEventListener('abort', onUnload, { once: true })
        // Subscribe before reading pending input so an arrival cannot fall
        // between the check and the listener.
        onInput()
      }
    })
  }

  /**
   * @param {object} agent - live caller.
   * @param {object} callerNode - composition node.
   * @returns {string} sender name for the relay envelope.
   */
  function relayName(value) {
    if (typeof value !== 'string') return ''
    return value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').trim().slice(0, 120)
  }

  function senderName(agent, callerNode) {
    if (typeof callerNode?.label === 'string' && callerNode.label.length > 0) {
      const label = relayName(callerNode.label)
      if (label.length > 0) return label
    }
    try {
      const names = subagents()?.namesOf?.(agent)
      if (typeof names?.self === 'string' && names.self.length > 0) {
        const name = relayName(names.self)
        if (name.length > 0) return name
      }
    } catch {
      // fall back to the session id
    }
    return agent.id
  }

  /**
   * @param {object} agent - caller.
   * @param {object} targetAgent - live target.
   * @param {string} message - text.
   * @returns {object} delivered message.
   */
  function deliver(agent, targetAgent, message, callerNode) {
    const envelope = {
      id: randomUUID(),
      role: 'user',
      content: [
        { type: 'text', text: `Agent ${senderName(agent, callerNode)} sent a message: ` },
        { type: 'text', text: message },
      ],
      source: {
        kind: 'agent-message',
        form: 'relay',
        senderSessionId: agent.id,
      },
    }
    if (targetAgent.status === 'running') targetAgent.steer(envelope)
    else targetAgent.followup(envelope)
    return envelope
  }

  /**
   * Prefer the native relay when the target is a native descendant. The native
   * service owns cold resume and the exact agent-message source.
   * @param {object} agent - caller.
   * @param {object} target - composition node.
   * @param {string} message - text.
   * @param {AbortSignal} signal - call cancellation.
   * @returns {Promise<{messageId: string}|null>} native result, or null when not applicable.
   */
  async function deliverNative(agent, target, message, signal) {
    const service = subagents()
    if (target.sessionId === null || typeof service?.sendMessage !== 'function') return null
    const targetAgent = liveAgent(target.sessionId)
    if (targetAgent !== undefined && typeof service.rootOf === 'function') {
      // The native relay only owns the caller's native tree. A live target in
      // another tree is the composition bridge's job; a same-tree target uses
      // the native service and its errors (authorization, capacity, archival)
      // must fail the delivery instead of being silently bypassed by followup.
      // A rootOf failure is an authority failure, not a fallback signal.
      const sameTree = service.rootOf(agent) === service.rootOf(targetAgent)
      if (!sameTree) return null
    }
    const messageId = await service.sendMessage(agent, target.sessionId, [{ type: 'text', text: message }], { signal })
    return { messageId: String(messageId) }
  }

  /**
   * @param {object} agent - caller.
   * @param {string} reference - target reference.
   * @returns {Promise<object>} resolved operation context.
   */
  async function resolveOperation(agent, reference) {
    const caller = await callerContext(agent)
    if (caller === null) throw new CompositionError('NOT_IN_COMPOSITION', NOT_IN_COMPOSITION)
    const target = resolveTarget(caller.record.composition, reference)
    if (target.id === caller.callerNode.id) {
      throw new CompositionError('SELF_TARGET', 'cannot target the calling node itself')
    }
    return { ...caller, target }
  }

  /**
   * Native lifecycle mode with a fallback for records written before mode.
   * @param {object} node - composition node.
   * @returns {'continuable'|'one-shot'|'external'|'unknown'}
   */
  function modeOfNode(node) {
    if (node?.mode === 'continuable' || node?.mode === 'one-shot'
      || node?.mode === 'external' || node?.mode === 'unknown') return node.mode
    if (node?.kind === 'external') return 'external'
    return node?.source === 'subagent' ? 'unknown' : 'continuable'
  }

  const listAgents = {
    name: NATIVE_TOOLS.list.name,
    description: NATIVE_TOOLS.list.description,
    parameters: NATIVE_TOOLS.list.parameters,
    output: {
      schema: {
        type: 'array',
        items: objectSchema({
          name: { type: 'string' },
          status: { type: 'string', enum: ['running', 'inactive'] },
          description: { type: 'string' },
        }, ['name', 'status']),
      },
      render: (_args, entries) => [{
        type: 'text',
        text: entries.map((entry) => `${entry.name} [${entry.status}]${entry.description === undefined ? '' : ` — ${entry.description}`}`).join('\n'),
      }],
    },
    isConcurrencySafe: () => true,
    async execute(_args, exec) {
      const caller = await callerContext(exec.agent)
      if (caller === null) throw new CompositionError('NOT_IN_COMPOSITION', NOT_IN_COMPOSITION)
      const sessionIds = caller.record.composition.nodes
        .map((node) => node.sessionId)
        .filter((sessionId) => typeof sessionId === 'string')
      const observations = await discovery.describeMany(sessionIds)
      return caller.record.composition.nodes
        .filter((node) => {
          const mode = modeOfNode(node)
          return mode !== 'one-shot' && mode !== 'external'
        })
        .map((node) => {
          const agent = node.sessionId === null ? undefined : liveAgent(node.sessionId)
          const observation = node.sessionId === null ? undefined : observations[node.sessionId]
          const nativeParent = observation?.nativeParentSessionId
          const mode = modeOfNode(node)
          const origin = nativeParent == null ? node.source : `native child of ${nativeParent}`
          return {
            name: node.label,
            status: agent?.status === 'running' ? 'running' : 'inactive',
            description: `${origin}; mode=${mode}`,
          }
        })
    },
  }

  const sendMessage = {
    name: NATIVE_TOOLS.send.name,
    description: NATIVE_TOOLS.send.description,
    parameters: NATIVE_TOOLS.send.parameters,
    output: {
      schema: objectSchema({
        messageId: { type: 'string' },
      }, ['messageId']),
      render: (args, _value) => [{
        type: 'text',
        text: `message delivered to agent ${args.agent}`,
      }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new CompositionError('NO_CALLER', 'send_message requires a calling agent')
      const { rootSessionId, callerNode, target } = await resolveOperation(agent, args.agent)
      if (target.sessionId === null) throw new CompositionError('TARGET_EXTERNAL', TARGET_EXTERNAL)
      if (modeOfNode(target) === 'one-shot') {
        throw new CompositionError('NOT_CONTINUABLE', 'the target is a one-shot agent and cannot receive follow-ups')
      }
      const targetAgent = liveAgent(target.sessionId)
      const auth = await manager.authorizeMessage(rootSessionId, callerNode.id, target.id)
      if (!auth.allowed) {
        await manager.recordAudit(rootSessionId, {
          kind: 'message',
          fromNodeId: callerNode.id,
          toNodeId: target.id,
          outcome: 'denied',
          detail: { edgeIds: auth.edgeIds, deniedEdgeIds: auth.deniedEdgeIds },
        })
        throw new CompositionError('NOT_AUTHORIZED', NOT_AUTHORIZED)
      }
      const callerSession = liveSession(agent.id)
      const targetSession = liveSession(target.sessionId)
      if (crossesWorkspace(callerSession, targetSession) && !hasFullPermission(callerSession)) {
        const allowed = await approve(agent, 'send_message', `Send a composition message to ${relayName(target.label)} in another workspace.`, exec.signal)
        if (!allowed) {
          await manager.recordAudit(rootSessionId, {
            kind: 'message',
            fromNodeId: callerNode.id,
            toNodeId: target.id,
            outcome: 'approval-denied',
            detail: { edgeIds: auth.edgeIds },
          })
          throw new CompositionError('APPROVAL_DENIED', APPROVAL_DENIED)
        }
      }
      const native = await deliverNative(agent, target, args.message, exec.signal)
      if (native !== null) {
        await manager.recordAudit(rootSessionId, {
          kind: 'message',
          fromNodeId: callerNode.id,
          toNodeId: target.id,
          outcome: 'delivered',
          detail: { edgeIds: auth.edgeIds, messageId: native.messageId },
        })
        return native
      }
      if (targetAgent === undefined) throw new CompositionError('TARGET_NOT_LIVE', TARGET_NOT_LIVE)
      const envelope = deliver(agent, targetAgent, args.message, callerNode)
      await manager.recordAudit(rootSessionId, {
        kind: 'message',
        fromNodeId: callerNode.id,
        toNodeId: target.id,
        outcome: 'delivered',
        detail: { edgeIds: auth.edgeIds, messageId: envelope.id },
      })
      return { messageId: envelope.id }
    },
  }

  const interruptAgent = {
    name: NATIVE_TOOLS.interrupt.name,
    description: NATIVE_TOOLS.interrupt.description,
    parameters: NATIVE_TOOLS.interrupt.parameters,
    output: {
      schema: objectSchema({
        accepted: { type: 'boolean' },
      }, ['accepted']),
      render: (args, _value) => [{
        type: 'text',
        text: `interrupt requested for agent ${args.agent}`,
      }],
    },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new CompositionError('NO_CALLER', 'interrupt_agent requires a calling agent')
      const { rootSessionId, callerNode, target } = await resolveOperation(agent, args.agent)
      if (target.sessionId === null) throw new CompositionError('TARGET_EXTERNAL', TARGET_EXTERNAL)
      const targetAgent = liveAgent(target.sessionId)
      if (targetAgent === undefined) throw new CompositionError('TARGET_NOT_LIVE', TARGET_NOT_LIVE)
      const auth = await manager.authorizeInterrupt(rootSessionId, callerNode.id, target.id)
      if (!auth.allowed) {
        await manager.recordAudit(rootSessionId, {
          kind: 'interrupt',
          fromNodeId: callerNode.id,
          toNodeId: target.id,
          outcome: 'denied',
          detail: { edgeIds: auth.edgeIds, deniedEdgeIds: auth.deniedEdgeIds },
        })
        throw new CompositionError('NOT_AUTHORIZED', NOT_AUTHORIZED)
      }
      const callerSession = liveSession(agent.id)
      const targetSession = liveSession(target.sessionId)
      if (crossesWorkspace(callerSession, targetSession) && !hasFullPermission(callerSession)) {
        const allowed = await approve(agent, 'interrupt_agent', `Interrupt ${relayName(target.label)} in another workspace.`, exec.signal)
        if (!allowed) {
          await manager.recordAudit(rootSessionId, {
            kind: 'interrupt',
            fromNodeId: callerNode.id,
            toNodeId: target.id,
            outcome: 'approval-denied',
            detail: { edgeIds: auth.edgeIds },
          })
          throw new CompositionError('APPROVAL_DENIED', APPROVAL_DENIED)
        }
      }
      try {
        const service = subagents()
        if (service?.interrupt === undefined) {
          throw new CompositionError('SUBAGENTS_UNAVAILABLE', 'the subagent service is unavailable')
        }
        service.interrupt(target.sessionId, { kind: 'user' })
      } catch (error) {
        await manager.recordAudit(rootSessionId, {
          kind: 'interrupt',
          fromNodeId: callerNode.id,
          toNodeId: target.id,
          outcome: 'error',
          detail: { edgeIds: auth.edgeIds, error: String(error?.message ?? error) },
        })
        throw error
      }
      await manager.recordAudit(rootSessionId, {
        kind: 'interrupt',
        fromNodeId: callerNode.id,
        toNodeId: target.id,
        outcome: 'accepted',
        detail: { edgeIds: auth.edgeIds },
      })
      return { accepted: true }
    },
  }

  const subagentTool = {
    name: NATIVE_TOOLS.subagent.name,
    description: NATIVE_TOOLS.subagent.description,
    parameters: NATIVE_TOOLS.subagent.parameters,
    output: {
      schema: objectSchema({
        kind: { type: 'string' },
        name: { type: 'string' },
      }, ['kind', 'name']),
      render: (_args, value) => [{ type: 'text', text: `started subagent ${value.name}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new CompositionError('NO_CALLER', 'subagent requires a calling agent')
      return startDelegation(exec.agent, args, subagentProvider, exec.signal)
    },
  }

  const forkTool = {
    name: NATIVE_TOOLS.fork.name,
    description: NATIVE_TOOLS.fork.description,
    parameters: NATIVE_TOOLS.fork.parameters,
    output: {
      schema: objectSchema({
        kind: { type: 'string' },
        name: { type: 'string' },
      }, ['kind', 'name']),
      render: (_args, value) => [{ type: 'text', text: `started subagent ${value.name}` }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (exec.agent === undefined) throw new CompositionError('NO_CALLER', 'subagent_fork requires a calling agent')
      return startDelegation(exec.agent, args, forkProvider, exec.signal)
    },
  }

  const waitTool = {
    name: NATIVE_TOOLS.wait.name,
    description: NATIVE_TOOLS.wait.description,
    parameters: NATIVE_TOOLS.wait.parameters,
    output: {
      schema: objectSchema({
        timedOut: { type: 'boolean' },
      }, ['timedOut']),
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new CompositionError('NO_CALLER', 'wait_agent requires a calling agent')
      const timeoutMs = args.timeout_ms ?? 30_000
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 3_600_000) {
        throw new CompositionError('WAIT_INVALID_TIMEOUT', 'timeout_ms must be an integer from 10000 through 3600000')
      }
      return waitForInput(exec.agent, timeoutMs, exec.signal, exec.rootCallId, waitLifetime.signal)
    },
  }

  /**
   * Project a stored task onto the declared tool-output shape. `ownerNodeId`
   * is null for an unassigned task; the schema uses an empty string to keep one
   * stable scalar type.
   * @param {object} task - stored task.
   * @returns {object}
   */
  function taskView(task) {
    return {
      id: task.id,
      rootSessionId: task.rootSessionId ?? '',
      subject: task.subject,
      description: task.description ?? '',
      status: task.status,
      ownerNodeId: task.ownerNodeId ?? '',
      blockedBy: Array.isArray(task.blockedBy) ? [...task.blockedBy] : [],
      writeScopes: Array.isArray(task.writeScopes) ? [...task.writeScopes] : [],
      createdBy: task.createdBy ?? 'unknown',
      revision: task.revision,
      createdAt: task.createdAt ?? 0,
      updatedAt: task.updatedAt ?? 0,
    }
  }

  /**
   * @param {object} task - stored task.
   * @param {readonly object[]} tasks - board snapshot.
   * @returns {boolean} whether a pending task has no incomplete blockers.
   */
  function taskIsReady(task, tasks) {
    if (task.status !== 'pending') return false
    const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]))
    return (Array.isArray(task.blockedBy) ? task.blockedBy : [])
      .every((id) => byId.get(id)?.status === 'completed')
  }

  /**
   * @param {object} task - stored task.
   * @param {readonly object[]} tasks - board snapshot.
   * @returns {string[]} advisory write-scope overlaps.
   */
  function taskWriteWarnings(task, tasks) {
    const scopes = Array.isArray(task.writeScopes) ? task.writeScopes : []
    const warnings = new Set()
    for (const other of tasks) {
      if (other.id === task.id || other.status === 'completed' || other.status === 'deleted') continue
      const otherScopes = Array.isArray(other.writeScopes) ? other.writeScopes : []
      for (const selfScope of scopes) {
        for (const otherScope of otherScopes) {
          if (selfScope === otherScope
            || selfScope.startsWith(`${otherScope}/`)
            || otherScope.startsWith(`${selfScope}/`)) {
            warnings.add(`${selfScope} overlaps ${otherScope} on ${other.id}`)
          }
        }
      }
    }
    return [...warnings]
  }

  /**
   * @param {object} composition - current graph.
   * @param {object} team - team record.
   * @returns {object[]} root plus all descendants.
   */
  function teamMembers(composition, team) {
    if (Array.isArray(team?.nodeIds) && team.nodeIds.length > 0) {
      return team.nodeIds
        .map((id) => composition.nodes.find((node) => node.id === id))
        .filter((node) => node !== undefined)
    }
    const root = composition.nodes.find((node) => node.id === team?.rootNodeId)
    if (root === undefined) return []
    const byId = new Map(composition.nodes.map((node) => [node.id, node]))
    const children = new Map()
    for (const edge of composition.edges ?? []) {
      const list = children.get(edge.parentId) ?? []
      list.push(edge.childId)
      children.set(edge.parentId, list)
    }
    const result = []
    const queue = [root.id]
    const seen = new Set()
    while (queue.length > 0) {
      const id = queue.shift()
      if (seen.has(id)) continue
      seen.add(id)
      const node = byId.get(id)
      if (node !== undefined) result.push(node)
      for (const childId of children.get(id) ?? []) queue.push(childId)
    }
    return result
  }

  /**
   * Resolve the active task-board scope for one caller. A caller inside a Team
   * uses that Team board; otherwise it uses the composition board.
   * @param {object} caller - composition caller context.
   * @returns {Promise<{team: object|null, teamId: string|null, tasks: object[]}>}
   */
  async function nativeTaskScope(caller) {
    let team = null
    try {
      team = await manager.teamForNode?.(caller.rootSessionId, caller.callerNode.id) ?? null
    } catch {
      team = null
    }
    const teamId = team?.id ?? null
    const tasks = await manager.getTasks(caller.rootSessionId, undefined, teamId)
    return { team, teamId, tasks }
  }

  /**
   * Native-shaped task view used by the four compatibility tools.  /**
   * Native-shaped task view used by the four compatibility tools. The plugin
   * board is composition-owned; the shape matches the Team task view so callers
   * can use the same workflow without writing native Team state.
   * @param {object} task - stored task.
   * @param {readonly object[]} tasks - board snapshot.
   * @param {object} composition - current graph.
   * @returns {object}
   */
  function nativeTaskView(task, tasks, composition) {
    const owner = composition.nodes.find((node) => node.id === task.ownerNodeId)
    const ownerName = owner?.label ?? (typeof task.ownerNodeId === 'string' ? task.ownerNodeId : undefined)
    return {
      id: task.id,
      revision: task.revision,
      subject: task.subject,
      description: task.description ?? '',
      status: task.status,
      ...ownerName === undefined ? {} : { owner: ownerName },
      blockedBy: Array.isArray(task.blockedBy) ? [...task.blockedBy] : [],
      writeScopes: Array.isArray(task.writeScopes) ? [...task.writeScopes] : [],
      ready: taskIsReady(task, tasks),
      writeScopeWarnings: taskWriteWarnings(task, tasks),
    }
  }

  /**
   * @param {object} composition - current graph.
   * @param {string} reference - node id, session id, or unique label.
   * @returns {object} local session node.
   */
  function nativeOwnerNode(composition, reference) {
    if (reference === 'lead') {
      const root = composition.nodes.find((node) => node.sessionId === composition.rootSessionId)
      if (root !== undefined) return root
    }
    const node = resolveTarget(composition, reference)
    if (node?.kind !== 'session') {
      throw new CompositionError('UNKNOWN_TARGET', 'task owner must be a local session node')
    }
    return node
  }

  /**
   * @param {object} exec - tool execution context.
   * @param {string} toolName - diagnostic tool name.
   * @returns {Promise<object>} composition caller context.
   */
  async function nativeTaskCaller(exec, toolName) {
    if (exec.agent === undefined) throw new CompositionError('NO_CALLER', `${toolName} requires a calling agent`)
    const caller = await callerContext(exec.agent)
    if (caller === null) throw new CompositionError('NOT_IN_COMPOSITION', NOT_IN_COMPOSITION)
    return caller
  }

  const nativeTaskViewSchema = objectSchema({
    id: { type: 'string' },
    revision: { type: 'integer' },
    subject: { type: 'string' },
    description: { type: 'string' },
    status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'deleted'] },
    owner: { type: 'string' },
    blockedBy: { type: 'array', items: { type: 'string' } },
    writeScopes: { type: 'array', items: { type: 'string' } },
    ready: { type: 'boolean' },
    writeScopeWarnings: { type: 'array', items: { type: 'string' } },
  }, ['id', 'revision', 'subject', 'description', 'status', 'blockedBy', 'writeScopes', 'ready', 'writeScopeWarnings'])

  const nativeTaskListSchema = objectSchema({
    tasks: { type: 'array', items: nativeTaskViewSchema },
    nextCursor: { type: 'integer' },
  }, ['tasks'])

  const teamTaskCreate = {
    name: 'team_task_create',
    description: 'Create one unowned pending task on the composition-shared task board using the Team task API shape.',
    parameters: objectSchema({
      subject: { type: 'string', description: 'Concise task title.' },
      description: { type: 'string', description: 'Complete task details and acceptance criteria.' },
      blocked_by: { type: 'array', items: { type: 'string' }, description: 'Task ids that must complete first.' },
      write_scopes: { type: 'array', items: { type: 'string' }, description: 'Advisory workspace-relative prefixes this task expects to modify.' },
    }, ['subject', 'description']),
    output: { schema: nativeTaskViewSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const caller = await nativeTaskCaller(exec, 'team_task_create')
      const scope = await nativeTaskScope(caller)
      const beforeIds = new Set(scope.tasks.map((task) => task.id))
      const after = await manager.createTask(caller.rootSessionId, {
        subject: args.subject,
        description: args.description,
        ownerNodeId: null,
        teamId: scope.teamId,
        ...(args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by }),
        ...(args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes }),
        createdBy: `agent:${caller.callerNode.sessionId}`,
        actor: caller.callerNode.sessionId,
      })
      const scoped = after.filter((task) => scope.teamId === null
        ? task.teamId === null || task.teamId === undefined
        : task.teamId === scope.teamId)
      const task = scoped.find((candidate) => !beforeIds.has(candidate.id))
      if (task === undefined) throw new CompositionError('TASK_NOT_FOUND', 'created task was not returned')
      return nativeTaskView(task, scoped, caller.record.composition)
    },
  }

  const teamTaskList = {
    name: 'team_task_list',
    description: 'List composition-shared tasks, including readiness, owner, revision, blockers, and write-scope warnings.',
    parameters: objectSchema({
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed'], description: 'Optional exact status filter.' },
      owner: { type: 'string', description: 'Optional owner agent label, session id, or lead.' },
      unowned: { type: 'boolean', description: 'Filter to tasks without an owner; cannot combine with owner.' },
      ready: { type: 'boolean', description: 'Optional readiness filter.' },
      cursor: { type: 'integer', description: 'Zero-based result offset. Defaults to 0.' },
      limit: { type: 'integer', description: 'Number of rows, 1 through 100. Defaults to 50.' },
    }),
    output: { schema: nativeTaskListSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const caller = await nativeTaskCaller(exec, 'team_task_list')
      const cursor = args.cursor ?? 0
      const limit = args.limit ?? 50
      if (!Number.isSafeInteger(cursor) || cursor < 0) throw new CompositionError('INVALID_FIELD', 'cursor must be a non-negative safe integer')
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new CompositionError('INVALID_FIELD', 'limit must be an integer from 1 through 100')
      if (args.owner !== undefined && args.unowned !== undefined) throw new CompositionError('INVALID_FIELD', 'owner and unowned filters cannot be combined')
      const scope = await nativeTaskScope(caller)
      const ownerNode = args.owner === undefined ? undefined : nativeOwnerNode(caller.record.composition, args.owner)
      if (scope.team !== null && ownerNode !== undefined
        && !teamMembers(caller.record.composition, scope.team).some((node) => node.id === ownerNode.id)) {
        throw new CompositionError('TEAM_MEMBER_REQUIRED', 'owner filter must name a member of this Team')
      }
      const tasks = scope.tasks
      const filtered = tasks.filter((task) =>
        (args.status === undefined || task.status === args.status)
        && (ownerNode === undefined || task.ownerNodeId === ownerNode.id)
        && (args.unowned === undefined || (task.ownerNodeId === null || task.ownerNodeId === undefined) === args.unowned)
        && (args.ready === undefined || taskIsReady(task, tasks) === args.ready))
      const page = filtered.slice(cursor, cursor + limit)
      return {
        tasks: page.map((task) => nativeTaskView(task, tasks, caller.record.composition)),
        ...(cursor + limit < filtered.length ? { nextCursor: cursor + limit } : {}),
      }
    },
  }

  const teamTaskGet = {
    name: 'team_task_get',
    description: 'Read the complete latest value of one composition-shared task before changing or executing it.',
    parameters: objectSchema({
      task_id: { type: 'string', description: 'Shared task id.' },
    }, ['task_id']),
    output: { schema: nativeTaskViewSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const caller = await nativeTaskCaller(exec, 'team_task_get')
      const scope = await nativeTaskScope(caller)
      const task = scope.tasks.find((candidate) => candidate.id === args.task_id)
      if (task === undefined) throw new CompositionError('TASK_NOT_FOUND', `task ${JSON.stringify(args.task_id)} does not exist`)
      return nativeTaskView(task, scope.tasks, caller.record.composition)
    },
  }

  const teamTaskUpdate = {
    name: 'team_task_update',
    description: 'Compare-and-set a composition-shared task action using the latest revision from team_task_get or team_task_list.',
    parameters: objectSchema({
      task_id: { type: 'string', description: 'Shared task id.' },
      expected_revision: { type: 'integer', description: 'Current task revision used as the CAS precondition.' },
      action: { type: 'string', enum: ['claim', 'release', 'edit', 'set_dependencies', 'complete', 'reopen', 'reassign', 'delete'], description: 'Task transition to apply.' },
      subject: { type: 'string', description: 'Replacement title for edit.' },
      description: { type: 'string', description: 'Replacement details for edit.' },
      blocked_by: { type: 'array', items: { type: 'string' }, description: 'Complete blocker list for set_dependencies.' },
      write_scopes: { type: 'array', items: { type: 'string' }, description: 'Replacement advisory write scopes for edit.' },
      owner: { type: 'string', description: 'Owner label/session id for root-only reassign; omit to unassign.' },
    }, ['task_id', 'expected_revision', 'action']),
    output: { schema: nativeTaskViewSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      const caller = await nativeTaskCaller(exec, 'team_task_update')
      const scope = await nativeTaskScope(caller)
      const tasks = scope.tasks
      const task = tasks.find((candidate) => candidate.id === args.task_id)
      if (task === undefined) throw new CompositionError('TASK_NOT_FOUND', `task ${JSON.stringify(args.task_id)} does not exist`)
      const ownerNode = args.owner === undefined ? undefined : nativeOwnerNode(caller.record.composition, args.owner)
      if (scope.team !== null && ownerNode !== undefined
        && !teamMembers(caller.record.composition, scope.team).some((node) => node.id === ownerNode.id)) {
        throw new CompositionError('TEAM_MEMBER_REQUIRED', 'owner must belong to this Team')
      }
      const after = await manager.updateTask(caller.rootSessionId, {
        taskId: args.task_id,
        expectedRevision: args.expected_revision,
        action: args.action,
        ...(args.subject === undefined ? {} : { subject: args.subject }),
        ...(args.description === undefined ? {} : { description: args.description }),
        ...(args.blocked_by === undefined ? {} : { blockedBy: args.blocked_by }),
        ...(args.write_scopes === undefined ? {} : { writeScopes: args.write_scopes }),
        ...(args.owner === undefined ? {} : { ownerNodeId: ownerNode?.id ?? null }),
        teamId: scope.teamId,
        actor: caller.callerNode.sessionId,
      })
      if (args.action === 'delete') {
        return { ...nativeTaskView(task, tasks, caller.record.composition), status: 'deleted', revision: task.revision + 1 }
      }
      const scopedAfter = after.filter((candidate) => scope.teamId === null
        ? candidate.teamId === null || candidate.teamId === undefined
        : candidate.teamId === scope.teamId)
      const updated = scopedAfter.find((candidate) => candidate.id === args.task_id)
      if (updated === undefined) throw new CompositionError('TASK_NOT_FOUND', 'updated task was not returned')
      return nativeTaskView(updated, scopedAfter, caller.record.composition)
    },
  }

  const taskTool = {
    name: 'composition_task',
    description:
      'List, create, or update a task on the composition\'s plugin-owned task board. '
      + 'This is not a DSH Team task and does not write native Team state. '
      + 'Creating a task assigns it to your composition node; updates use an expected revision.',
    parameters: objectSchema({
      action: {
        type: 'string',
        enum: ['list', 'create', 'update'],
        description: 'list reads the board; create adds a task; update changes its status.',
      },
      subject: {
        type: 'string',
        description: 'Task subject; required for create.',
      },
      description: {
        type: 'string',
        description: 'Optional task details.',
      },
      taskId: {
        type: 'string',
        description: 'Task id; required for update.',
      },
      status: {
        type: 'string',
        enum: ['pending', 'in_progress', 'completed'],
        description: 'Target status; required for update.',
      },
      expected_revision: {
        type: 'integer',
        description: 'Current task revision; required for update and used as a conflict guard.',
      },
    }, ['action']),
    output: {
      schema: objectSchema({
        tasks: {
          type: 'array',
          items: objectSchema({
            id: { type: 'string' },
            subject: { type: 'string' },
            description: { type: 'string' },
            status: { type: 'string' },
            ownerNodeId: { type: 'string' },
            rootSessionId: { type: 'string' },
            blockedBy: { type: 'array', items: { type: 'string' } },
            writeScopes: { type: 'array', items: { type: 'string' } },
            createdBy: { type: 'string' },
            revision: { type: 'integer' },
            createdAt: { type: 'integer' },
            updatedAt: { type: 'integer' },
          }, ['id', 'subject', 'status', 'revision']),
        },
      }, ['tasks']),
      render: (_args, value) => [{
        type: 'text',
        text: value.tasks.map((task) => `${task.status}: ${task.subject} [created by ${task.createdBy ?? 'unknown'}]`).join('\n') || 'no tasks',
      }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new CompositionError('NO_CALLER', 'composition_task requires a calling agent')
      const caller = await callerContext(exec.agent)
      if (caller === null) throw new CompositionError('NOT_IN_COMPOSITION', NOT_IN_COMPOSITION)
      if (args.action === 'list') {
        return { tasks: (await manager.getTasks(caller.rootSessionId)).map(taskView) }
      }
      if (args.action === 'create') {
        return {
          tasks: (await manager.createTask(caller.rootSessionId, {
            subject: args.subject,
            description: args.description,
            ownerNodeId: caller.callerNode.id,
            createdBy: `agent:${caller.callerNode.sessionId}`,
            actor: caller.callerNode.sessionId,
          })).map(taskView),
        }
      }
      const action = args.status === 'in_progress'
        ? 'start'
        : args.status === 'completed' ? 'complete' : 'reopen'
      return {
        tasks: (await manager.updateTask(caller.rootSessionId, {
          taskId: args.taskId,
          expectedRevision: args.expected_revision,
          action,
          actor: caller.callerNode.sessionId,
        })).map(taskView),
      }
    },
  }

  const definitions = [
    listAgents, sendMessage, interruptAgent, subagentTool, forkTool, waitTool, taskTool,
    teamTaskCreate, teamTaskList, teamTaskGet, teamTaskUpdate,
  ]
  const NATIVE_NAMES = new Set(['list_agents', 'send_message', 'interrupt_agent', 'subagent', 'subagent_fork', 'wait_agent'])
  const handlers = new Map(definitions
    .filter((definition) => NATIVE_NAMES.has(definition.name))
    .map((definition) => [definition.name, definition]))
  /** @type {WeakMap<object, Map<string, () => void>>} */
  const attachedAgents = new WeakMap()
  /** Native definitions observed for the six names; protects other plugins' scoped tools. */
  const nativeDefinitions = new Map()

  /**
   * Resolve the tool registry for one agent scope.
   * @param {object} agent - live Agent with its scoped context.
   * @returns {object|undefined} scoped ToolsService.
   */
  function toolsOf(agent) {
    try {
      return agent?.ctx?.tools
    } catch {
      return undefined
    }
  }

  /**
   * Replace the execution path for one intercepted native tool call. The
   * native definition, schema, description, output contract, prompt identity,
   * restrictions, and presentation remain untouched; only the canonical value
   * returned by the plugin handler is substituted. The pipeline then validates
   * that value against the native output schema and renders it through the
   * native output declaration.
   * @param {{name: string, args: unknown}} exec - tool execution identity.
   * @param {() => unknown} next - native executor continuation.
   * @returns {Promise<unknown>} canonical success value or the native result.
   */
  async function intercept(exec, next) {
    const definition = handlers.get(exec?.name)
    if (definition === undefined) return next()
    const current = ctx.get?.('tools')?.get?.(exec.name, exec.agent)
    const known = nativeDefinitions.get(exec.name)
    // Never steal a same-name tool installed by another plugin. Intercept the
    // observed native definition or this plugin's own static fallback.
    if (current !== undefined && current !== definition && current !== known) return next()
    // The live `tools/execute` event exposes parsed arguments as
    // `exec.arguments`; tool bodies receive them as their first parameter.
    // Keep the legacy `args` spelling for direct callers and older harnesses.
    const args = exec.arguments ?? exec.args
    const value = await definition.execute(args, exec)
    return { isError: false, value }
  }

  /**
   * Install static fallback definitions only when the native tool is absent.
   * The normal standard profile keeps the native definitions and uses
   * `intercept` from `tools/execute`; the fallback keeps legacy composed
   * sessions usable until they migrate.
   * @param {object} agent - live Agent receiving fallbacks.
   * @returns {{size: number, dispose: () => void}|null}
   */
  function attach(agent) {
    const toolsService = toolsOf(agent)
    if (toolsService?.register === undefined || toolsService?.get === undefined) return null
    let record = attachedAgents.get(agent)
    if (record === undefined) {
      record = new Map()
      attachedAgents.set(agent, record)
    }
    for (const [name, definition] of handlers) {
      const scoped = toolsService.get(name, agent)
      const global = toolsService.get(name)
      if (global !== undefined && !nativeDefinitions.has(name)) nativeDefinitions.set(name, global)
      else if (scoped !== undefined && scoped !== definition && !nativeDefinitions.has(name)) {
        nativeDefinitions.set(name, scoped)
      }
      const existing = record.get(name)
      // Native tool visible (or intentionally hidden by a restriction): never
      // add a scope-local fallback. `tools/execute` intercepts the native path.
      if (global !== undefined || scoped !== undefined) {
        if (existing !== undefined) {
          try { existing() } catch {}
          record.delete(name)
        }
        continue
      }
      if (existing !== undefined) continue
      try {
        record.set(name, toolsService.register(definition))
      } catch (error) {
        try {
          ctx.logger?.warn?.('dsh-combinagents: cannot install a fallback tool', { name }, error)
        } catch {
          // logging is optional
        }
      }
    }
    if (record.size === 0) {
      attachedAgents.delete(agent)
      return null
    }
    return {
      get size() { return record.size },
      dispose() {
        for (const dispose of [...record.values()].reverse()) {
          try {
            dispose()
          } catch {
            // scope may already have been disposed by agent shutdown
          }
        }
        record.clear()
        attachedAgents.delete(agent)
      },
    }
  }

  /**
   * Remove every wrapper this plugin installed for one Agent.
   * @param {object} agent - live Agent.
   * @returns {void}
   */
  function detach(agent) {
    const record = attachedAgents.get(agent)
    if (record === undefined) return
    for (const dispose of [...record.values()].reverse()) {
      try {
        dispose()
      } catch {
        // ignore an already-disposed agent scope
      }
    }
    attachedAgents.delete(agent)
  }

  return {
    definitions,
    /** The only globally unique tool; the six native names are scoped wrappers. */
    taskDefinition: taskTool,
    attach,
    detach,
    intercept,
    register(tools) {
      const disposers = []
      const definitionsToRegister = [taskTool, teamTaskCreate, teamTaskList, teamTaskGet, teamTaskUpdate]
      let nativeTeam = false
      try {
        nativeTeam = ctx.get?.('agentTeams') !== undefined
      } catch {
        nativeTeam = false
      }
      for (const definition of definitionsToRegister) {
        // A profile that mounts the native Team service/tools keeps them
        // authoritative; never shadow real Team task state.
        if (nativeTeam && definition.name.startsWith('team_task_')) continue
        let existing
        try {
          existing = typeof tools.get === 'function' ? tools.get(definition.name) : undefined
        } catch {
          existing = undefined
        }
        if (existing !== undefined) continue
        try {
          disposers.push(tools.register(definition))
        } catch {
          // A duplicate registration means another plugin won the name; leave
          // that tool untouched rather than shadowing it.
        }
      }
      return () => {
        for (const dispose of disposers.reverse()) {
          try { dispose() } catch {}
        }
      }
    },
  }
}
