import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createControls, NATIVE_TOOL_CONTRACTS } from '../src/controls.js'
import { CompositionError } from '../src/graph.js'

function harness(options = {}) {
  const cwd = options.cwd ?? { 's-a': '/w', 's-b': '/w' }
  const full = options.full === true
  const approvalOutcome = options.approvalOutcome ?? 'allowed-once'
  const delivered = []
  const steered = []
  const interrupted = []
  const approvals = []
  const started = []
  const attached = []
  const grantedEdges = []
  const nativeSends = []
  const taskCalls = []
  const resolvedModels = []
  const listeners = new Map()
  const promptContexts = []
  const promptSections = []
  const toolsService = { get: () => undefined }
  const parentOptions = options.parentOptions ?? { provider: 'deepseek', model: 'deepseek-chat' }
  const callerAgent = {
    id: 's-a',
    status: 'running',
    options: { ...parentOptions },
    inbox: { nextStep: [] },
    session: {
      requestHeader: () => ({ config: { ...parentOptions } }),
      snapshotEvents: () => options.modelSelectionEvents ?? [],
    },
    followup: (message) => delivered.push(message),
    steer: (message) => steered.push(message),
  }
  const composition = {
    nodes: [
      { id: 'n-a', sessionId: 's-a', label: options.callerLabel ?? 'Lead', kind: 'session', source: 'top-level', mode: 'continuable' },
      { id: 'n-b', sessionId: 's-b', label: 'Worker', kind: 'session', source: 'subagent', mode: 'continuable' },
    ],
    edges: [{ id: 'e1', parentId: 'n-a', childId: 'n-b', role: 'reports-to' }],
  }
  const manager = {
    async resolveSession() {
      return { rootSessionId: 's-a', record: { composition, updatedAt: 1 } }
    },
    async authorizeMessage() {
      return { allowed: true, edgeIds: ['e1'], deniedEdgeIds: [] }
    },
    async authorizeInterrupt() {
      return { allowed: true, edgeIds: ['e1'], deniedEdgeIds: [] }
    },
    async autoAttach(parentSessionId, info) {
      attached.push({ parentSessionId, ...info })
    },
    async grantDelegatedEdge(rootSessionId, parentSessionId, childSessionId) {
      grantedEdges.push({ rootSessionId, parentSessionId, childSessionId })
    },
    async getTasks() {
      taskCalls.push({ kind: 'list' })
      return [{
        id: 't1',
        rootSessionId: 's-a',
        subject: 'Review',
        description: '',
        status: 'pending',
        ownerNodeId: 'n-b',
        blockedBy: [],
        writeScopes: [],
        createdBy: 'user',
        revision: 1,
        createdAt: 1,
        updatedAt: 1,
      }]
    },
    async createTask(rootSessionId, input) {
      taskCalls.push({ kind: 'create', rootSessionId, ...input })
      return [{ id: 't2', subject: input.subject, status: 'pending', revision: 1 }]
    },
    async updateTask(rootSessionId, input) {
      taskCalls.push({ kind: 'update', rootSessionId, ...input })
      return [{ id: input.taskId, subject: 'Review', status: 'in_progress', revision: 2 }]
    },
    async recordAudit() {},
  }
  const ctx = {
    get(name) {
      if (name === 'sessions') {
        return {
          get: (id) => ({ header: { id, cwd: cwd[id] } }),
        }
      }
      if (name === 'agents') {
        return {
          get: (id) => {
            if (id === 's-a') return callerAgent
            if (id !== 's-b') return undefined
            return {
              status: 'idle',
              followup: (message) => delivered.push(message),
              steer: (message) => steered.push(message),
            }
          },
        }
      }
      if (name === 'subagents') {
        return {
          namesOf: () => ({ self: options.nativeName ?? 'Lead' }),
          interrupt: (id, authority) => interrupted.push({ id, authority }),
          async startActivation(spec) {
            started.push(spec)
            return { childId: 's-child', name: 'agent-1' }
          },
          ...(options.nativeSend === true || options.nativeSendError === true) ? {
            async sendMessage(...args) {
              nativeSends.push(args)
              if (options.nativeSendError === true) throw new Error('native authorization denied')
              return 'm-native'
            },
          } : {},
          ...options.nativeRoots === undefined ? {} : { rootOf: options.nativeRoots },
        }
      }
      if (name === 'permissionPresets') {
        return {
          current: (session) => options.permissionById?.[session?.header?.id]
            ?? (full ? 'danger-full-access' : 'ask'),
        }
      }
      if (name === 'sandboxPolicy') {
        return {
          resolve: ({ session }) => ({
            mode: options.sandboxById?.[session?.header?.id]
              ?? (full ? 'danger-full-access' : 'workspace-write'),
          }),
        }
      }
      if (name === 'workingDirectory') {
        return {
          get: (session) => options.effectiveCwd?.[session?.header?.id],
        }
      }
      if (name === 'approval') {
        return {
          overrideOf: (session) => options.approvalById?.[session?.header?.id],
          request: async (request) => {
            approvals.push(request)
            return approvalOutcome
          },
        }
      }
      if (name === 'systemPrompt') {
        return {
          getContextOrder: () => 1,
          getSectionOrder: () => 2,
          context(options) {
            promptContexts.push(options)
            return () => {}
          },
          section(options) {
            promptSections.push(options)
            return () => {}
          },
        }
      }
      if (name === 'tools') return toolsService
      if (name === 'llm' && options.llm === true) {
        return {
          async resolveCallConfig(config) {
            resolvedModels.push(config)
          },
        }
      }
      return undefined
    },
    effect(callback) {
      return callback()
    },
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(callback)
      return () => listeners.get(event)?.delete(callback)
    },
  }
  const controls = createControls({
    ctx,
    manager,
    discovery: { async describeMany() { return {} } },
    agentPreset: options.agentPreset,
    autoGrantDelegatedEdges: options.autoGrantDelegatedEdges,
  })
  const tool = (name) => controls.definitions.find((definition) => definition.name === name)
  return {
    controls,
    tool,
    manager,
    delivered,
    steered,
    interrupted,
    approvals,
    started,
    attached,
    grantedEdges,
    nativeSends,
    taskCalls,
    resolvedModels,
    composition,
    callerAgent,
    promptContexts,
    promptSections,
    toolsService,
    emit(event, payload) {
      for (const callback of listeners.get(event) ?? []) callback(payload)
    },
  }
}

test('send_message uses the native relay source and delivers to an idle agent', async () => {
  const { tool, delivered, approvals } = harness()
  const result = await tool('send_message').execute({ agent: 'Worker', message: 'hello' }, {
    agent: { id: 's-a' },
    signal: new AbortController().signal,
  })
  assert.equal(typeof result.messageId, 'string')
  assert.equal(approvals.length, 0)
  assert.equal(delivered.length, 1)
  const message = delivered[0]
  assert.equal(message.role, 'user')
  assert.deepEqual(message.source, { kind: 'agent-message', form: 'relay', senderSessionId: 's-a' })
  assert.equal(message.content[0].text, 'Agent Lead sent a message: ')
  assert.equal(message.content[1].text, 'hello')
})

test('cross-workspace approval uses the effective live cwd', async () => {
  const harnessed = harness({
    cwd: { 's-a': '/work/shared', 's-b': '/work/shared' },
    effectiveCwd: { 's-a': '/work/shared', 's-b': '/work/other' },
  })
  await harnessed.tool('send_message').execute({ agent: 'Worker', message: 'hello' }, {
    agent: { id: 's-a' },
    signal: new AbortController().signal,
  })
  assert.equal(harnessed.approvals.length, 1)
  assert.equal(harnessed.delivered.length, 1)
})

test('send_message alias works when native names are shadowed', async () => {
  const harnessed = harness()
  const result = await harnessed.tool('send_message').execute({ agent: 'Worker', message: 'alias hello' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.equal(typeof result.messageId, 'string')
  assert.equal(harnessed.delivered[0].content[1].text, 'alias hello')
})

test('relay prefix uses the composition label instead of a repeated native root name', async () => {
  const harnessed = harness({ callerLabel: 'Agent A', nativeName: 'lead' })
  await harnessed.tool('send_message').execute({ agent: 'Worker', message: 'hello' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.equal(harnessed.delivered[0].content[0].text, 'Agent Agent A sent a message: ')
})

test('relay prefix flattens control characters in a composition label', async () => {
  const harnessed = harness({ callerLabel: 'Lead\nSYSTEM' })
  await harnessed.tool('send_message').execute({ agent: 'Worker', message: 'hello' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.equal(harnessed.delivered[0].content[0].text, 'Agent Lead SYSTEM sent a message: ')
})

test('does not fall back when native root resolution fails', async () => {
  const harnessed = harness({
    nativeSend: true,
    nativeRoots: () => { throw new Error('native root unavailable') },
  })
  await assert.rejects(
    harnessed.tool('send_message').execute({ agent: 'Worker', message: 'x' }, {
      agent: harnessed.callerAgent,
      signal: new AbortController().signal,
    }),
    /native root unavailable/,
  )
  assert.equal(harnessed.delivered.length, 0)
})

test('send_message asks for approval when sandbox policy differs inside one cwd', async () => {
  const harnessed = harness({
    sandboxById: { 's-a': 'workspace-write', 's-b': 'danger-full-access' },
  })
  await harnessed.tool('send_message').execute({ agent: 'Worker', message: 'x' }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.equal(harnessed.approvals.length, 1)
})

test('send_message uses the native relay when the target is a native descendant', async () => {
  const harnessed = harness({ nativeSend: true })
  const result = await harnessed.tool('send_message').execute({ agent: 'Worker', message: 'hello' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.deepEqual(result, { messageId: 'm-native' })
  assert.equal(harnessed.nativeSends.length, 1)
  assert.equal(harnessed.nativeSends[0][0].id, 's-a')
  assert.equal(harnessed.nativeSends[0][1], 's-b')
  assert.deepEqual(harnessed.nativeSends[0][2], [{ type: 'text', text: 'hello' }])
  assert.equal(harnessed.delivered.length, 0)
})

test('send_message does not bypass a native relay authorization error', async () => {
  const harnessed = harness({ nativeSend: true, nativeSendError: true })
  await assert.rejects(
    harnessed.tool('send_message').execute({ agent: 'Worker', message: 'x' }, {
      agent: harnessed.callerAgent,
      signal: new AbortController().signal,
    }),
    /native authorization denied/,
  )
  assert.equal(harnessed.nativeSends.length, 1)
  assert.equal(harnessed.delivered.length, 0)
})

test('send_message asks for approval across workspaces without full permission', async () => {
  const same = harness({ cwd: { 's-a': '/w', 's-b': '/w' } })
  await same.tool('send_message').execute({ agent: 'Worker', message: 'x' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.equal(same.approvals.length, 0)

  const crossing = harness({ cwd: { 's-a': '/w', 's-b': '/other' } })
  await crossing.tool('send_message').execute({ agent: 'Worker', message: 'x' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.equal(crossing.approvals.length, 1)
  assert.equal(crossing.approvals[0].toolName, 'send_message')

  const full = harness({ cwd: { 's-a': '/w', 's-b': '/other' }, full: true })
  await full.tool('send_message').execute({ agent: 'Worker', message: 'x' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.equal(full.approvals.length, 0)
})

test('send_message rejects when approval is denied', async () => {
  const { tool, delivered } = harness({
    cwd: { 's-a': '/w', 's-b': '/other' },
    approvalOutcome: 'rejected',
  })
  await assert.rejects(
    tool('send_message').execute({ agent: 'Worker', message: 'x' }, {
      agent: { id: 's-a' }, signal: new AbortController().signal,
    }),
    (error) => error instanceof CompositionError && error.code === 'APPROVAL_DENIED',
  )
  assert.equal(delivered.length, 0)
})

test('interrupt_agent uses user authority after the edge grant', async () => {
  const { tool, interrupted, approvals } = harness()
  const result = await tool('interrupt_agent').execute({ agent: 'Worker' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.deepEqual(result, { accepted: true })
  assert.deepEqual(interrupted, [{ id: 's-b', authority: { kind: 'user' } }])
  assert.equal(approvals.length, 0)
})

test('interception leaves the native interface untouched and returns a canonical value', async () => {
  const nativeByName = Object.fromEntries([
    'list_agents', 'send_message', 'interrupt_agent', 'subagent', 'subagent_fork', 'wait_agent',
  ].map((name) => [name, {
    name,
    description: `native ${name}`,
    parameters: {},
    output: { schema: {}, render: () => [] },
    async execute() { return null },
  }]))
  const registered = new Map()
  const scopedTools = {
    get(name) { return nativeByName[name] },
    register(definition) {
      registered.set(definition.name, definition)
      return () => registered.delete(definition.name)
    },
  }
  const harnessed = harness()
  const agent = { id: 's-a', ctx: { tools: scopedTools } }

  // Visible native definitions are not replaced; only execution is intercepted.
  assert.equal(harnessed.controls.attach(agent), null)
  assert.equal(registered.size, 0)
  let nativeCalled = false
  const result = await harnessed.controls.intercept({
    name: 'list_agents',
    arguments: {},
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  }, async () => {
    nativeCalled = true
    return { isError: false, value: [] }
  })
  assert.deepEqual(result, {
    isError: false,
    value: [
      { name: 'Lead', status: 'running', description: 'top-level; mode=continuable' },
      { name: 'Worker', status: 'inactive', description: 'subagent; mode=continuable' },
    ],
  })
  assert.equal(nativeCalled, false)
  assert.equal(nativeByName.list_agents.execute.name, 'execute')

  // A non-intercepted name delegates to the native continuation.
  let passedThrough = false
  await harnessed.controls.intercept({ name: 'composition_task', args: {}, agent: harnessed.callerAgent }, async () => {
    passedThrough = true
  })
  assert.equal(passedThrough, true)
})

test('interception forwards the live exec.arguments shape to tool bodies', async () => {
  const harnessed = harness()
  const exec = {
    name: 'subagent',
    arguments: { description: 'live-shape probe', prompt: 'Reply OK.' },
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  }
  const result = await harnessed.controls.intercept(exec, async () => {
    throw new Error('native continuation must not run for an intercepted tool')
  })
  assert.deepEqual(result, { isError: false, value: { kind: 'activation', name: 'agent-1' } })
  assert.equal(harnessed.started.length, 1)
  assert.equal(harnessed.attached.length, 1)
})

test('does not recreate a native tool hidden by a scope restriction', () => {
  const native = {
    name: 'list_agents', description: 'native', parameters: {},
    output: { schema: { type: 'array' }, render: () => [] },
    async execute() { return [] },
  }
  const registered = new Map()
  const scopedTools = {
    get(name, scope) {
      if (name !== 'list_agents') return undefined
      return scope === undefined ? native : undefined
    },
    register(definition) {
      registered.set(definition.name, definition)
      return () => registered.delete(definition.name)
    },
  }
  const harnessed = harness()
  harnessed.controls.attach({ id: 's-a', ctx: { tools: scopedTools } })
  assert.equal(registered.has('list_agents'), false)
  assert.equal(registered.has('send_message'), true)
})

test('legacy fallback installs the six tools and upgrades to native definitions', async () => {
  const registered = new Map()
  let native
  const scopedTools = {
    get(name) { return name === 'list_agents' ? native : undefined },
    register(definition) {
      registered.set(definition.name, definition)
      return () => registered.delete(definition.name)
    },
  }
  const harnessed = harness()
  const agent = { id: 's-a', ctx: { tools: scopedTools } }
  const attachment = harnessed.controls.attach(agent)
  assert.equal(attachment.size, 6)
  assert.deepEqual([...registered.keys()].sort(), [
    'interrupt_agent', 'list_agents', 'send_message', 'subagent', 'subagent_fork', 'wait_agent',
  ])
  assert.equal(registered.get('list_agents').description, NATIVE_TOOL_CONTRACTS.list.description)

  native = {
    name: 'list_agents',
    description: 'native contract',
    parameters: {},
    output: { schema: { type: 'array' }, render: () => [] },
    async execute() { return [{ name: 'native', status: 'running' }] },
  }
  const upgraded = harnessed.controls.attach(agent)
  assert.equal(upgraded.size, 5)
  assert.equal(registered.has('list_agents'), false)
  upgraded.dispose()
  assert.equal(registered.size, 0)
})

test('tool definitions use native names and preserve contracts', () => {
  const { controls } = harness()
  assert.deepEqual(controls.definitions.map((definition) => definition.name), [
    'list_agents', 'send_message', 'interrupt_agent',
    'subagent', 'subagent_fork', 'wait_agent', 'composition_task',
    'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
  ])
  const byName = new Map(controls.definitions.map((definition) => [definition.name, definition]))
  for (const contract of [
    NATIVE_TOOL_CONTRACTS.list,
    NATIVE_TOOL_CONTRACTS.send,
    NATIVE_TOOL_CONTRACTS.interrupt,
    NATIVE_TOOL_CONTRACTS.subagent,
    NATIVE_TOOL_CONTRACTS.fork,
    NATIVE_TOOL_CONTRACTS.wait,
  ]) {
    const definition = byName.get(contract.name)
    assert.equal(definition.description, contract.description)
    assert.deepEqual(definition.parameters, contract.parameters)
    assert.equal(definition.parameters.additionalProperties, undefined)
  }
  assert.equal(controls.taskDefinition.name, 'composition_task')
})

test('retries a fork mirror once before reporting a manual-add fallback', async () => {
  const harnessed = harness()
  let calls = 0
  harnessed.manager.autoAttach = async () => {
    calls += 1
    if (calls === 1) throw new Error('fork root still settling')
    return { id: 'attached' }
  }
  const result = await harnessed.tool('subagent_fork').execute({
    description: 'Forked analysis',
    prompt: 'Continue.',
  }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.equal(calls, 2)
  assert.deepEqual(result, { kind: 'activation', name: 'agent-1' })
  assert.equal(harnessed.grantedEdges.length, 1)
})

test('subagent starts a native activation and mirrors the child', async () => {
  const harnessed = harness()
  const result = await harnessed.tool('subagent').execute({
    description: 'Scoped analysis',
    prompt: 'Read the file and report.',
  }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.deepEqual(result, { kind: 'activation', name: 'agent-1' })
  assert.equal(harnessed.started.length, 1)
  assert.equal(harnessed.started[0].provider, 'spawn')
  assert.equal(harnessed.started[0].parent, harnessed.callerAgent)
  assert.equal(harnessed.started[0].delivery, 'parent')
  assert.deepEqual(harnessed.started[0].prompt, [{ type: 'text', text: 'Read the file and report.' }])
  assert.deepEqual(harnessed.attached, [{
    parentSessionId: 's-a', childId: 's-child', local: true, provider: 'spawn', label: 'agent-1',
  }])
  assert.deepEqual(harnessed.grantedEdges, [{ rootSessionId: 's-a', parentSessionId: 's-a', childSessionId: 's-child' }])
})

test('composition_task and the four Team-shaped task tools are globally registered', () => {
  const { controls } = harness()
  const global = []
  controls.register({ register: (definition) => global.push(definition.name) })
  assert.deepEqual(global, [
    'composition_task', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
  ])
})

test('subagent falls back to the configured agentPreset default', async () => {
  const harnessed = harness({ agentPreset: 'reviewer' })
  await harnessed.tool('subagent').execute({
    description: 'Scoped analysis',
    prompt: 'Read the file and report.',
  }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.equal(harnessed.started[0].agentPreset, 'reviewer')
})

test('subagent forwards an allowed agent_preset selection', async () => {
  const harnessed = harness()
  await harnessed.tool('subagent').execute({
    description: 'Scoped analysis',
    prompt: 'Read the file and report.',
    agent_preset: 'reviewer',
  }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.equal(harnessed.started[0].agentPreset, 'reviewer')
})

test('subagent validates and forwards explicit model selection', async () => {
  const harnessed = harness({ llm: true })
  const result = await harnessed.tool('subagent').execute({
    description: 'Scoped analysis',
    prompt: 'Read the file and report.',
    provider: 'deepseek',
    model: 'deepseek-chat',
    reasoning_effort: 'high',
  }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.deepEqual(result, { kind: 'activation', name: 'agent-1' })
  assert.deepEqual(harnessed.resolvedModels, [{ provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high' }])
  assert.deepEqual(harnessed.started[0].agentOptions, {
    provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'high',
  })
})

test('subagent rejects an explicit non-parent route without a recorded policy', async () => {
  const harnessed = harness({ llm: true })
  await assert.rejects(
    harnessed.tool('subagent').execute({
      description: 'Scoped analysis',
      prompt: 'Read the file and report.',
      provider: 'other',
      model: 'other-chat',
    }, {
      agent: harnessed.callerAgent,
      signal: new AbortController().signal,
    }),
    (error) => error instanceof CompositionError && error.code === 'MODEL_SELECTION_FORBIDDEN',
  )
  assert.equal(harnessed.started.length, 0)
  assert.equal(harnessed.resolvedModels.length, 0)
})

test('subagent honors a recorded model-selection policy', async () => {
  const harnessed = harness({
    llm: true,
    modelSelectionEvents: [{
      type: 'subagent/model-selection-policy',
      data: { allowedModels: [{ provider: 'other', model: 'other-chat' }] },
    }],
  })
  const result = await harnessed.tool('subagent').execute({
    description: 'Scoped analysis',
    prompt: 'Read the file and report.',
    provider: 'other',
    model: 'other-chat',
  }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.deepEqual(result, { kind: 'activation', name: 'agent-1' })
  assert.deepEqual(harnessed.resolvedModels, [{ provider: 'other', model: 'other-chat' }])
  assert.deepEqual(harnessed.started[0].agentOptions, { provider: 'other', model: 'other-chat' })
})

test('subagent requires provider and model together', async () => {
  const harnessed = harness({ llm: true })
  await assert.rejects(
    harnessed.tool('subagent').execute({
      description: 'Scoped analysis',
      prompt: 'Read the file and report.',
      provider: 'deepseek',
    }, {
      agent: harnessed.callerAgent,
      signal: new AbortController().signal,
    }),
    (error) => error instanceof CompositionError && error.code === 'INVALID_MODEL_SELECTION',
  )
  assert.equal(harnessed.started.length, 0)
})

test('list_agents reports running/inactive status', async () => {
  const harnessed = harness()
  const listed = await harnessed.tool('list_agents').execute({}, { agent: harnessed.callerAgent })
  assert.deepEqual(listed, [
    { name: 'Lead', status: 'running', description: 'top-level; mode=continuable' },
    { name: 'Worker', status: 'inactive', description: 'subagent; mode=continuable' },
  ])
})

test('wait_agent resolves when fresh input reaches the caller inbox', async () => {
  const harnessed = harness()
  const waiting = harnessed.tool('wait_agent').execute({ timeout_ms: 10_000 }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  harnessed.callerAgent.inbox.nextStep.push({ id: 'fresh-message' })
  harnessed.emit('agent/inbox/inserted', { agent: harnessed.callerAgent })
  assert.deepEqual(await waiting, { timedOut: false })
})

test('wait_agent returns immediately for pending input', async () => {
  const harnessed = harness()
  harnessed.callerAgent.inbox.nextStep.push({ id: 'pending-message' })
  assert.deepEqual(await harnessed.tool('wait_agent').execute({ timeout_ms: 10_000 }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  }), { timedOut: false })
})

test('wait_agent does not spin on input already reported in the same root call', async () => {
  const harnessed = harness()
  harnessed.callerAgent.inbox.nextStep.push({ id: 'pending-message' })
  const controller = new AbortController()
  const signal = controller.signal
  const first = await harnessed.tool('wait_agent').execute({ timeout_ms: 10_000 }, {
    agent: harnessed.callerAgent,
    signal,
    rootCallId: 'root-call-1',
  })
  assert.deepEqual(first, { timedOut: false })

  let settled = false
  const second = harnessed.tool('wait_agent').execute({ timeout_ms: 10_000 }, {
    agent: harnessed.callerAgent,
    signal,
    rootCallId: 'root-call-1',
  })
  second.then(() => { settled = true }, () => { settled = true })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(settled, false)

  controller.abort(new CompositionError('WAIT_UNAVAILABLE', 'test cleanup'))
  await assert.rejects(second, (error) => error?.code === 'WAIT_UNAVAILABLE')
})

test('delegation/list tools declare their concurrency safety', () => {
  const harnessed = harness()
  assert.equal(harnessed.tool('subagent').isConcurrencySafe(), true)
  assert.equal(harnessed.tool('subagent_fork').isConcurrencySafe(), true)
  assert.equal(harnessed.tool('list_agents').isConcurrencySafe(), true)
})

test('subagent can leave the delegation edge ungranted by config', async () => {
  const harnessed = harness({ autoGrantDelegatedEdges: false })
  await harnessed.tool('subagent').execute({
    description: 'Scoped analysis',
    prompt: 'Read the file and report.',
  }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.deepEqual(harnessed.grantedEdges, [])
})

test('subagent_fork uses the fork provider and mirrors the child', async () => {
  const harnessed = harness()
  const result = await harnessed.tool('subagent_fork').execute({
    description: 'Continue the review',
    prompt: 'Review the latest diff.',
  }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.deepEqual(result, { kind: 'activation', name: 'agent-1' })
  assert.equal(harnessed.started[0].provider, 'fork')
  assert.deepEqual(harnessed.attached, [{
    parentSessionId: 's-a', childId: 's-child', local: true, provider: 'fork', label: 'agent-1',
  }])
  assert.deepEqual(harnessed.grantedEdges, [{ rootSessionId: 's-a', parentSessionId: 's-a', childSessionId: 's-child' }])
})

test('task tool lists, creates, and updates the plugin board', async () => {
  const harnessed = harness()
  const exec = { agent: harnessed.callerAgent, signal: new AbortController().signal }
  const listed = await harnessed.tool('composition_task').execute({ action: 'list' }, exec)
  assert.equal(listed.tasks[0].id, 't1')
  assert.equal(listed.tasks[0].createdBy, 'user')
  assert.equal(listed.tasks[0].ownerNodeId, 'n-b')
  const rendered = harnessed.tool('composition_task').output.render({ action: 'list' }, listed)[0].text
  assert.match(rendered, /created by user/)
  const created = await harnessed.tool('composition_task').execute({
    action: 'create',
    subject: 'Review',
    description: 'Read the diff',
  }, exec)
  assert.equal(created.tasks[0].id, 't2')
  const updated = await harnessed.tool('composition_task').execute({
    action: 'update',
    taskId: 't2',
    status: 'in_progress',
    expected_revision: 1,
  }, exec)
  assert.equal(updated.tasks[0].status, 'in_progress')
  assert.deepEqual(harnessed.taskCalls, [
    { kind: 'list' },
    {
      kind: 'create',
      rootSessionId: 's-a',
      subject: 'Review',
      description: 'Read the diff',
      ownerNodeId: 'n-a',
      createdBy: 'agent:s-a',
      actor: 's-a',
    },
    { kind: 'update', rootSessionId: 's-a', taskId: 't2', expectedRevision: 1, action: 'start', actor: 's-a' },
  ])
})

test('Team-shaped task tools expose the native view and owner filters', async () => {
  const harnessed = harness()
  const exec = { agent: harnessed.callerAgent, signal: new AbortController().signal }
  const listed = await harnessed.tool('team_task_list').execute({ owner: 'Worker' }, exec)
  assert.equal(listed.tasks.length, 1)
  assert.equal(listed.tasks[0].owner, 'Worker')
  assert.equal(listed.tasks[0].ready, true)
  const got = await harnessed.tool('team_task_get').execute({ task_id: 't1' }, exec)
  assert.equal(got.id, 't1')
  assert.equal(got.owner, 'Worker')
  const created = await harnessed.tool('team_task_create').execute({
    subject: 'Native-shaped creation',
    description: 'Details',
    blocked_by: ['t1'],
    write_scopes: ['src/'],
  }, exec)
  assert.equal(created.id, 't2')
  const updated = await harnessed.tool('team_task_update').execute({
    task_id: 't1',
    expected_revision: 1,
    action: 'claim',
  }, exec)
  assert.equal(updated.status, 'in_progress')
  const createCall = harnessed.taskCalls.find((call) => call.kind === 'create')
  assert.deepEqual(createCall.blockedBy, ['t1'])
  assert.deepEqual(createCall.writeScopes, ['src/'])
})

test('does not replace native Team task tools when they are already mounted', () => {
  const harnessed = harness()
  const registered = []
  const native = { name: 'team_task_create' }
  harnessed.controls.register({
    get: (name) => name === 'team_task_create' ? native : undefined,
    register: (definition) => {
      registered.push(definition.name)
      return () => {}
    },
  })
  assert.equal(registered.includes('team_task_create'), false)
  assert.equal(registered.includes('team_task_list'), true)
})

test('hides one-shot nodes from list_agents and rejects follow-ups', async () => {
  const harnessed = harness()
  harnessed.composition.nodes.find((node) => node.id === 'n-b').mode = 'one-shot'
  const listed = await harnessed.tool('list_agents').execute({}, { agent: harnessed.callerAgent })
  assert.deepEqual(listed, [
    { name: 'Lead', status: 'running', description: 'top-level; mode=continuable' },
  ])
  await assert.rejects(
    harnessed.tool('send_message').execute({ agent: 'Worker', message: 'x' }, {
      agent: harnessed.callerAgent,
      signal: new AbortController().signal,
    }),
    (error) => error?.code === 'NOT_CONTINUABLE',
  )
  const interrupted = await harnessed.tool('interrupt_agent').execute({ agent: 'Worker' }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.deepEqual(interrupted, { accepted: true })
})

test('does not add duplicate prompt sections when native plugins remain mounted', () => {
  const harnessed = harness()
  assert.deepEqual(harnessed.promptContexts, [])
  assert.deepEqual(harnessed.promptSections, [])
})
