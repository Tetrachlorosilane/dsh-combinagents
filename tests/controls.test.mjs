import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
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
  const callerAgent = {
    id: 's-a',
    status: 'running',
    inbox: { nextStep: [] },
    followup: (message) => delivered.push(message),
    steer: (message) => steered.push(message),
  }
  const composition = {
    nodes: [
      { id: 'n-a', sessionId: 's-a', label: 'Lead', kind: 'session', source: 'top-level' },
      { id: 'n-b', sessionId: 's-b', label: 'Worker', kind: 'session', source: 'subagent' },
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
      return [{ id: 't1', subject: 'Review', status: 'pending', revision: 1 }]
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
          namesOf: () => ({ self: 'Lead' }),
          interrupt: (id, authority) => interrupted.push({ id, authority }),
          async startActivation(spec) {
            started.push(spec)
            return { childId: 's-child', name: 'agent-1' }
          },
          ...options.nativeSend === true ? {
            async sendMessage(...args) {
              nativeSends.push(args)
              return 'm-native'
            },
          } : {},
        }
      }
      if (name === 'permissionPresets') {
        return { current: () => (full ? 'danger-full-access' : 'ask') }
      }
      if (name === 'sandboxPolicy') {
        return { resolve: () => ({ mode: full ? 'danger-full-access' : 'workspace-write' }) }
      }
      if (name === 'approval') {
        return {
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
    mode: options.mode,
    autoGrantDelegatedEdges: options.autoGrantDelegatedEdges,
  })
  const tool = (name) => controls.definitions.find((definition) => definition.name === name)
  return {
    controls,
    tool,
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

test('composition_send_message uses the native relay source and delivers to an idle agent', async () => {
  const { tool, delivered, approvals } = harness()
  const result = await tool('composition_send_message').execute({ agent: 'Worker', message: 'hello' }, {
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

test('composition_send_message uses the native relay when the target is a native descendant', async () => {
  const harnessed = harness({ nativeSend: true })
  const result = await harnessed.tool('composition_send_message').execute({ agent: 'Worker', message: 'hello' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.deepEqual(result, { messageId: 'm-native' })
  assert.equal(harnessed.nativeSends.length, 1)
  assert.equal(harnessed.nativeSends[0][0].id, 's-a')
  assert.equal(harnessed.nativeSends[0][1], 's-b')
  assert.deepEqual(harnessed.nativeSends[0][2], [{ type: 'text', text: 'hello' }])
  assert.equal(harnessed.delivered.length, 0)
})

test('composition_send_message asks for approval across workspaces without full permission', async () => {
  const same = harness({ cwd: { 's-a': '/w', 's-b': '/w' } })
  await same.tool('composition_send_message').execute({ agent: 'Worker', message: 'x' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.equal(same.approvals.length, 0)

  const crossing = harness({ cwd: { 's-a': '/w', 's-b': '/other' } })
  await crossing.tool('composition_send_message').execute({ agent: 'Worker', message: 'x' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.equal(crossing.approvals.length, 1)
  assert.equal(crossing.approvals[0].toolName, 'composition_send_message')

  const full = harness({ cwd: { 's-a': '/w', 's-b': '/other' }, full: true })
  await full.tool('composition_send_message').execute({ agent: 'Worker', message: 'x' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.equal(full.approvals.length, 0)
})

test('composition_send_message rejects when approval is denied', async () => {
  const { tool, delivered } = harness({
    cwd: { 's-a': '/w', 's-b': '/other' },
    approvalOutcome: 'rejected',
  })
  await assert.rejects(
    tool('composition_send_message').execute({ agent: 'Worker', message: 'x' }, {
      agent: { id: 's-a' }, signal: new AbortController().signal,
    }),
    (error) => error instanceof CompositionError && error.code === 'APPROVAL_DENIED',
  )
  assert.equal(delivered.length, 0)
})

test('composition_interrupt_agent uses user authority after the edge grant', async () => {
  const { tool, interrupted, approvals } = harness()
  const result = await tool('composition_interrupt_agent').execute({ agent: 'Worker' }, {
    agent: { id: 's-a' }, signal: new AbortController().signal,
  })
  assert.deepEqual(result, { accepted: true })
  assert.deepEqual(interrupted, [{ id: 's-b', authority: { kind: 'user' } }])
  assert.equal(approvals.length, 0)
})

test('composed mode exposes native tool names, descriptions, and parameter schemas', () => {
  const { controls } = harness({ mode: 'composed' })
  const byName = new Map(controls.definitions.map((definition) => [definition.name, definition]))
  assert.deepEqual(controls.definitions.map((definition) => definition.name), [
    'wait_agent', 'list_agents', 'send_message', 'interrupt_agent',
    'subagent', 'subagent_fork', 'composition_task',
  ])
  assert.deepEqual([...byName.keys()].sort(), [
    'composition_task', 'interrupt_agent', 'list_agents', 'send_message', 'subagent', 'subagent_fork', 'wait_agent',
  ])
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
})

test('composed subagent starts a native activation and mirrors the child', async () => {
  const harnessed = harness({ mode: 'composed' })
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

test('composed tool order follows the native control/delegation order', () => {
  const { controls } = harness({ mode: 'composed' })
  assert.deepEqual(controls.definitions.map((definition) => definition.name), [
    'wait_agent', 'list_agents', 'send_message', 'interrupt_agent',
    'subagent', 'subagent_fork', 'composition_task',
  ])
  const canonical = controls.definitions.map((definition) => ({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
  }))
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
  assert.equal(fingerprint, 'af83912ba9f7d54e3e002de3e8a8c59958de7958b033bcd43810d7ef5b98956b')
})

test('composed subagent validates and forwards explicit model selection', async () => {
  const harnessed = harness({ mode: 'composed', llm: true })
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

test('composed subagent requires provider and model together', async () => {
  const harnessed = harness({ mode: 'composed', llm: true })
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

test('composed wait_agent resolves when fresh input reaches the caller inbox', async () => {
  const harnessed = harness({ mode: 'composed' })
  const waiting = harnessed.tool('wait_agent').execute({ timeout_ms: 10_000 }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  harnessed.emit('agent/inbox/inserted', { agent: harnessed.callerAgent })
  assert.deepEqual(await waiting, { timedOut: false })
})

test('composed wait_agent returns immediately for pending input', async () => {
  const harnessed = harness({ mode: 'composed' })
  harnessed.callerAgent.inbox.nextStep.push({ id: 'pending-message' })
  assert.deepEqual(await harnessed.tool('wait_agent').execute({ timeout_ms: 10_000 }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  }), { timedOut: false })
})

test('composed subagent can leave the delegation edge ungranted by config', async () => {
  const harnessed = harness({ mode: 'composed', autoGrantDelegatedEdges: false })
  await harnessed.tool('subagent').execute({
    description: 'Scoped analysis',
    prompt: 'Read the file and report.',
  }, {
    agent: harnessed.callerAgent,
    signal: new AbortController().signal,
  })
  assert.deepEqual(harnessed.grantedEdges, [])
})

test('composed subagent_fork uses the fork provider and mirrors the child', async () => {
  const harnessed = harness({ mode: 'composed' })
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

test('composed task tool lists, creates, and updates the plugin board', async () => {
  const harnessed = harness({ mode: 'composed' })
  const exec = { agent: harnessed.callerAgent, signal: new AbortController().signal }
  const listed = await harnessed.tool('composition_task').execute({ action: 'list' }, exec)
  assert.equal(listed.tasks[0].id, 't1')
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
    { kind: 'create', rootSessionId: 's-a', subject: 'Review', description: 'Read the diff', ownerNodeId: 'n-a' },
    { kind: 'update', rootSessionId: 's-a', taskId: 't2', expectedRevision: 1, action: 'start' },
  ])
})

test('composed prompt restores native identity and delegation guidance', () => {
  const harnessed = harness({ mode: 'composed' })
  harnessed.toolsService.get = (name) => harnessed.controls.definitions.find((definition) => definition.name === name)
  const identity = harnessed.promptContexts.find((context) => context.name === 'subagent:identity')
  assert.ok(identity)
  const text = identity.text({ agent: { id: 's-a' }, scope: {}, toolSet: {} })
  assert.match(text, /^You are the root agent\. Your name is "Lead"\./)
  assert.match(text, /To message other agents, use send_message/)
  assert.match(text, /Use list_agents\(\{\}\) to find your collaborator agents/)

  const section = harnessed.promptSections.find((candidate) => candidate.name === 'tool:subagent')
  assert.ok(section)
  const guidance = section.text({ scope: {}, toolSet: {} })
  assert.match(guidance, /`subagent` or `subagent_fork`/)
  assert.match(guidance, /Start independent delegations/)
})