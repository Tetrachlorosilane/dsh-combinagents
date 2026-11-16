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

/** Native tool names, descriptions, and parameter schemas used by composed mode. */
/** Native tool names, descriptions, and parameter schemas used by composed mode. */
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
  ctx, manager, discovery, mode = 'overlay', subagentProvider = 'spawn', forkProvider = 'fork', maxDepth,
  autoGrantDelegatedEdges = true,
}) {
  const composed = mode === 'composed'
  const sessions = () => ctx.get?.('sessions')
  const agents = () => ctx.get?.('agents')
  const subagents = () => ctx.get?.('subagents')
  const approval = () => ctx.get?.('approval')
  const permissionPresets = () => ctx.get?.('permissionPresets')
  const sandboxPolicy = () => ctx.get?.('sandboxPolicy')
  const tools = () => ctx.get?.('tools')
  const systemPrompt = () => ctx.get?.('systemPrompt')

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
   * @param {object} callerSession - caller Session.
   * @param {object} targetSession - target Session.
   * @returns {boolean} whether delivery crosses a workspace boundary.
   */
  function crossesWorkspace(callerSession, targetSession) {
    const left = callerSession?.header?.cwd
    const right = targetSession?.header?.cwd
    if (typeof left !== 'string' || typeof right !== 'string') return true
    return left !== right
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
    if (args.provider !== undefined || args.model !== undefined || args.reasoning_effort !== undefined) {
      throw new CompositionError(
        'UNSUPPORTED_MODEL_SELECTION',
        'composed subagent does not support explicit child LLM selection yet; omit provider, model, and reasoning_effort',
      )
    }
    const service = subagents()
    if (service?.startActivation === undefined) {
      throw new CompositionError('SUBAGENTS_UNAVAILABLE', 'the subagent service is unavailable')
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
    })
    try {
      await manager.autoAttach(agent.id, {
        childId: started.childId,
        local: true,
        provider,
        label: started.name,
        ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
      })
      if (autoGrantDelegatedEdges) {
        await manager.grantDelegatedEdge(caller.rootSessionId, agent.id, started.childId)
      }
    } catch {
      // Result delivery is owned by the native runtime; a mirror miss is
      // recoverable with sync-native and must not fail the delegation.
    }
    await manager.recordAudit(caller.rootSessionId, {
      kind: 'delegation',
      fromNodeId: caller.callerNode.id,
      outcome: 'started',
      detail: { childSessionId: started.childId, name: started.name, provider },
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
  function waitForInput(agent, timeoutMs, signal) {
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
      }
      const finish = (settle) => {
        if (settled) return
        settled = true
        cleanup()
        settle()
      }
      const onAbort = () => finish(() => reject(signal.reason ?? new CompositionError('WAIT_UNAVAILABLE', 'wait_agent aborted')))
      timer = setTimeout(() => finish(() => resolve({ timedOut: true })), timeoutMs)
      offInbox = ctx.on?.('agent/inbox/inserted', ({ agent: recipient }) => {
        if (recipient === agent) finish(() => resolve({ timedOut: false }))
      })
      offDisposed = ctx.on?.('agent/disposed', ({ agent: disposed }) => {
        if (disposed === agent) finish(() => reject(new CompositionError('WAIT_UNAVAILABLE', 'the calling agent was disposed')))
      })
      if (signal.aborted) onAbort()
      else {
        signal.addEventListener('abort', onAbort, { once: true })
        // Subscribe before reading pending input so an arrival cannot fall
        // between the check and the listener.
        const pending = agent.inbox?.nextStep
        if (!settled && Array.isArray(pending) && pending.length > 0) {
          finish(() => resolve({ timedOut: false }))
        }
      }
    })
  }

  /**
   * @param {object} agent - live caller.
   * @param {object} callerNode - composition node.
   * @returns {string} sender name for the relay envelope.
   */
  function senderName(agent, callerNode) {
    try {
      const names = subagents()?.namesOf?.(agent)
      if (typeof names?.self === 'string' && names.self.length > 0) return names.self
    } catch {
      // fall back to the composition label
    }
    return callerNode.label
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
    try {
      const messageId = await service.sendMessage(agent, target.sessionId, [{ type: 'text', text: message }], { signal })
      return { messageId: String(messageId) }
    } catch (error) {
      if (signal.aborted) throw error
      return null
    }
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

  const listAgents = {
    name: composed ? NATIVE_TOOLS.list.name : 'composition_list_agents',
    description: composed
      ? NATIVE_TOOLS.list.description
      : 'List the agents in your composition tree, with their node ids, labels, sessions, and live state. '
        + 'Use a label, node id, or session id with composition_send_message and composition_interrupt_agent.',
    parameters: composed ? NATIVE_TOOLS.list.parameters : objectSchema({}),
    output: {
      schema: objectSchema({
        agents: {
          type: 'array',
          items: objectSchema({
            nodeId: { type: 'string' },
            label: { type: 'string' },
            sessionId: { type: 'string' },
            kind: { type: 'string' },
            source: { type: 'string' },
            live: { type: 'boolean' },
            archived: { type: 'boolean' },
            nativeParentSessionId: { type: 'string' },
          }, ['nodeId', 'label', 'kind', 'source', 'live', 'archived']),
        },
      }, ['agents']),
      render: (_args, value) => [{
        type: 'text',
        text: value.agents.map((entry) => `${entry.label} (${entry.sessionId ?? 'external'})`).join('\n') || 'no agents',
      }],
    },
    async execute(_args, exec) {
      const caller = await callerContext(exec.agent)
      if (caller === null) throw new CompositionError('NOT_IN_COMPOSITION', NOT_IN_COMPOSITION)
      const sessionIds = caller.record.composition.nodes
        .map((node) => node.sessionId)
        .filter((sessionId) => typeof sessionId === 'string')
      const observations = await discovery.describeMany(sessionIds)
      return {
        agents: caller.record.composition.nodes.map((node) => ({
          nodeId: node.id,
          label: node.label,
          kind: node.kind,
          source: node.source,
          live: node.sessionId === null ? false : observations[node.sessionId]?.live === true,
          archived: node.sessionId === null ? false : observations[node.sessionId]?.archived === true,
          ...node.sessionId === null ? {} : { sessionId: node.sessionId },
          ...node.nativeParentSessionId === null ? {} : { nativeParentSessionId: node.nativeParentSessionId },
        })),
      }
    },
  }

  const sendMessage = {
    name: composed ? NATIVE_TOOLS.send.name : 'composition_send_message',
    description: composed
      ? NATIVE_TOOLS.send.description
      : 'Send a message to an agent in your composition. A working agent receives it at its next step; '
        + 'an idle agent starts a new turn with it. Returns delivery confirmation.',
    parameters: composed ? NATIVE_TOOLS.send.parameters : objectSchema({
      agent: {
        type: 'string',
        description: 'The label, node id, or session id of an agent in your composition.',
      },
      message: {
        type: 'string',
        description: 'The message to deliver to the agent.',
      },
    }, ['agent', 'message']),
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
      if (agent === undefined) throw new CompositionError('NO_CALLER', 'composition_send_message requires a calling agent')
      const { rootSessionId, callerNode, target } = await resolveOperation(agent, args.agent)
      if (target.sessionId === null) throw new CompositionError('TARGET_EXTERNAL', TARGET_EXTERNAL)
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
      const targetSession = liveSession(target.sessionId) ?? { header: { cwd: target.cwd } }
      if (crossesWorkspace(callerSession, targetSession) && !hasFullPermission(callerSession)) {
        const allowed = await approve(agent, 'composition_send_message', `Send a composition message to ${target.label} in another workspace.`, exec.signal)
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
    name: composed ? NATIVE_TOOLS.interrupt.name : 'composition_interrupt_agent',
    description: composed
      ? NATIVE_TOOLS.interrupt.description
      : 'Ask an agent in your composition to stop its current work. This call returns without waiting for it to stop. '
        + 'Only a composition descendant can be interrupted.',
    parameters: composed ? NATIVE_TOOLS.interrupt.parameters : objectSchema({
      agent: {
        type: 'string',
        description: 'The label, node id, or session id of a descendant in your composition.',
      },
    }, ['agent']),
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
      if (agent === undefined) throw new CompositionError('NO_CALLER', 'composition_interrupt_agent requires a calling agent')
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
        const allowed = await approve(agent, 'composition_interrupt_agent', `Interrupt ${target.label} in another workspace.`, exec.signal)
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
      return waitForInput(exec.agent, timeoutMs, exec.signal)
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
            revision: { type: 'integer' },
          }, ['id', 'subject', 'status', 'revision']),
        },
      }, ['tasks']),
      render: (_args, value) => [{
        type: 'text',
        text: value.tasks.map((task) => `${task.status}: ${task.subject}`).join('\n') || 'no tasks',
      }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new CompositionError('NO_CALLER', 'composition_task requires a calling agent')
      const caller = await callerContext(exec.agent)
      if (caller === null) throw new CompositionError('NOT_IN_COMPOSITION', NOT_IN_COMPOSITION)
      if (args.action === 'list') {
        return { tasks: await manager.getTasks(caller.rootSessionId) }
      }
      if (args.action === 'create') {
        return {
          tasks: await manager.createTask(caller.rootSessionId, {
            subject: args.subject,
            description: args.description,
            ownerNodeId: caller.callerNode.id,
          }),
        }
      }
      const action = args.status === 'in_progress'
        ? 'start'
        : args.status === 'completed' ? 'complete' : 'reopen'
      return {
        tasks: await manager.updateTask(caller.rootSessionId, {
          taskId: args.taskId,
          expectedRevision: args.expected_revision,
          action,
        }),
      }
    },
  }

  const definitions = composed
    ? [listAgents, sendMessage, interruptAgent, subagentTool, forkTool, waitTool, taskTool]
    : [listAgents, sendMessage, interruptAgent]

  /**
   * Reproduce the native subagent identity and delegation guidance that would
   * otherwise disappear when the native control/delegation plugins are off.
   */
  function registerComposedPrompt() {
    if (!composed) return
    const prompt = systemPrompt()
    if (prompt === undefined || typeof prompt.context !== 'function' || typeof prompt.section !== 'function') return
    const setup = () => {
      const toolsService = tools()
      const contextOff = prompt.context({
        name: 'subagent:identity',
        order: prompt.getContextOrder?.('SUBAGENT_DELEGATION'),
        required: true,
        interpolate: false,
        text: ({ agent, scope, toolSet }) => {
          if (agent === undefined) return ''
          try {
            const names = subagents()?.namesOf?.(agent)
            if (names === undefined) return ''
            let identity = names.parent === undefined
              ? `You are the root agent. Your name is ${JSON.stringify(names.self)}.`
              : `You are a subagent delegated by agent ${JSON.stringify(names.parent)}.\n`
                + `Your name is ${JSON.stringify(names.self)}.\n`
                + 'The root agent of your collaboration tree is "lead".'
            const guidance = []
            if (toolsService?.get?.(sendMessage.name, scope, toolSet) === sendMessage) {
              guidance.push('To message other agents, use send_message({ agent: "<agent-name>", message: "..." }).')
            }
            if (toolsService?.get?.(listAgents.name, scope, toolSet) === listAgents) {
              guidance.push('Use list_agents({}) to find your collaborator agents and their names.')
            }
            if (guidance.length > 0) identity += '\n\n' + guidance.join('\n')
            return identity
          } catch (error) {
            const unauthorized = error?.name === 'SubagentError' && error?.code === 'UNAUTHORIZED'
            if (unauthorized) {
              return `Your agent id is ${JSON.stringify(agent.id)}. Your subagent tree root is unavailable. `
                + 'Continue independent work; subagent discovery and messaging require an active root.'
            }
            throw error
          }
        },
      })
      const sectionOff = prompt.section({
        name: 'tool:subagent',
        order: prompt.getSectionOrder?.('TOOL_SUBAGENT'),
        text: ({ scope, toolSet }) => {
          const visible = [subagentTool, forkTool]
            .filter((definition) => toolsService?.get?.(definition.name, scope, toolSet) === definition)
          if (visible.length === 0) return ''
          const names = visible.map((definition) => `\`${definition.name}\``).join(' or ')
          return `Start independent delegations with ${names} together in one assistant message and continue useful work while they run. When only waiting for their results remains, end your turn instead of sleeping or polling; the next result starts a new turn. Collect the subagent results required to complete the task before giving the user a final answer.\n\nBash, formatters, code generators, and scripts can overwrite concurrent edits without conflict detection; coordinate their changes explicitly. The agent integrating the work must review the final diff and run relevant tests.`
        },
      })
      return () => {
        if (typeof sectionOff === 'function') sectionOff()
        if (typeof contextOff === 'function') contextOff()
      }
    }
    if (typeof ctx.effect === 'function') ctx.effect(setup, 'dsh-combinagents: composed prompts')
    else setup()
  }

  registerComposedPrompt()

  return {
    definitions,
    register(tools) {
      for (const definition of definitions) tools.register(definition)
    },
  }
}
