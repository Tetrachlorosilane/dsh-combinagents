import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createCloneManager } from '../src/clone-manager.js'
import { createComposition } from '../src/graph.js'
import { createManager } from '../src/manager.js'

function node(id, sessionId, label) {
  return {
    id,
    sessionId,
    label,
    kind: 'session',
    source: 'top-level',
    provider: null,
    nativeParentSessionId: null,
    cwd: `/work/${sessionId}`,
    permissionPreset: null,
    addedAt: 1,
  }
}

function fakeStore(initial = new Map()) {
  const data = new Map(initial)
  const policies = new Map()
  const tasks = new Map()
  const clones = new Map()
  return {
    mode: 'memory',
    async get(key) { return data.get(key) },
    async put(key, value) { data.set(key, value) },
    async delete(key) { data.delete(key) },
    async list() { return [...data.entries()] },
    async getPolicy(key) { return policies.get(key) },
    async putPolicy(key, value) { policies.set(key, value) },
    async appendAudit() {},
    async listAudit() { return [] },
    async getTask(key) { return tasks.get(key) },
    async putTask(key, value) { tasks.set(key, value) },
    async deleteTask(key) { tasks.delete(key) },
    async listTasks(rootSessionId) { return [...tasks.entries()].filter(([, task]) => task.rootSessionId === rootSessionId) },
    async getClone(key) { return clones.get(key) },
    async putClone(key, value) { clones.set(key, value) },
    async deleteClone(key) { clones.delete(key) },
    async listClones() { return [...clones.entries()] },
  }
}

function fakeDiscovery(summaries) {
  return {
    async describe(sessionId) { return summaries.get(sessionId) ?? null },
  }
}

function sourceSummary(sessionId, parentSession = null) {
  return {
    sessionId,
    title: sessionId,
    cwd: `/work/${sessionId}`,
    source: parentSession === null ? 'top-level' : 'subagent',
    nativeParentSessionId: parentSession,
    agentPreset: null,
    live: false,
    persisted: true,
  }
}

function createHarness({ failChild = false, workspaces = [] } = {}) {
  const summaries = new Map([
    ['s-a', sourceSummary('s-a')],
    ['s-b', sourceSummary('s-b', 's-a')],
    ['s-c', sourceSummary('s-c', 's-b')],
    ['s-x', sourceSummary('s-x')],
  ])
  const store = fakeStore()
  const discovery = fakeDiscovery(summaries)
  const live = new Map()
  const providers = new Map()
  const created = []
  let activeChildren = 0
  let peakChildren = 0
  const agents = {
    async create(options) {
      created.push(options.sessionId)
      const agent = {
        id: options.sessionId,
        session: {
          header: {
            id: options.sessionId,
            cwd: options.meta?.cwd,
            isSeeded: options.meta?.isSeeded,
            ...(options.meta?.agentPreset === undefined ? {} : { agentPreset: options.meta.agentPreset }),
          },
        },
        options: {},
      }
      live.set(agent.id, agent)
      return {
        agent,
        async dispose() { live.delete(agent.id) },
      }
    },
    get(id) { return live.get(id) },
  }
  const subagents = {
    registerProvider(provider) {
      providers.set(provider.name, provider)
      return () => providers.delete(provider.name)
    },
    async startActivation(spec) {
      if (failChild) throw new Error('child creation failed')
      const provider = providers.get(spec.provider)
      if (provider === undefined) throw new Error('missing provider')
      const prepared = await provider.prepareContinuable({
        sessionId: spec.childId,
        parent: spec.parent,
        cwd: spec.cwd,
        signal: spec.signal,
      })
      activeChildren += 1
      peakChildren = Math.max(peakChildren, activeChildren)
      const agent = {
        id: spec.childId,
        session: {
          header: {
            id: spec.childId,
            cwd: spec.cwd,
            parentSession: spec.parent.session.header.id,
            origin: 'subagent',
            delegationDepth: 1,
            isSeeded: prepared.seed !== undefined,
            ...(spec.agentPreset === undefined ? {} : { agentPreset: spec.agentPreset }),
          },
        },
        options: {},
      }
      live.set(agent.id, agent)
      return {
        childId: spec.childId,
        messageId: 'message-1',
        async dispose() {
          live.delete(agent.id)
          activeChildren -= 1
        },
      }
    },
  }
  const sessionQuery = {
    async observeSession(sessionId) {
      return {
        source: 'live',
        header: {
          version: 4,
          id: sessionId,
          createdAt: 1,
          cwd: summaries.get(sessionId)?.cwd,
          isSeeded: false,
        },
        inheritedEventCount: 0,
        events: [{ type: 'turn/end', seq: 0, time: 1, data: { reason: { kind: 'completed' } } }],
        projections: { values: { subagentCatalog: [] } },
        [Symbol.dispose]() {},
      }
    },
  }
  const sessions = {
    get(id) { return live.get(id)?.session },
  }
  const services = {
    agents,
    subagents,
    sessionQuery,
    sessions,
    workspaceRegistry: { list() { return workspaces } },
  }
  const ctx = {
    logger: { info() {}, warn() {} },
    get(name) { return services[name] },
  }
  const manager = createManager({ store, discovery, agents: () => agents })
  const cloneManager = createCloneManager({ ctx, store, discovery, manager, now: () => 5000 })
  return { store, manager, cloneManager, live, created, peakChildren: () => peakChildren }
}

function installSource(store, composition, tasks = []) {
  store.put('s-a', { composition, updatedAt: 1 })
  for (const task of tasks) store.putTask(task.id, task)
}

function task(id, ownerNodeId, subject = id) {
  return {
    id,
    rootSessionId: 's-a',
    subject,
    description: '',
    status: 'pending',
    ownerNodeId,
    blockedBy: [],
    writeScopes: [],
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
  }
}

test('clones the whole root tree, copies tasks, and leaves children idle', async () => {
  const { store, cloneManager, live } = createHarness()
  installSource(store, createComposition({
    id: 'source',
    title: 'Team',
    rootSessionId: 's-a',
    nodes: [node('n-a', 's-a', 'Root'), node('n-b', 's-b', 'Child')],
    edges: [{ id: 'e-1', parentId: 'n-a', childId: 'n-b', role: 'reports-to' }],
  }), [
    task('t-a', 'n-a', 'Root task'),
    task('t-b', 'n-b', 'Child task'),
    task('t-x', 'n-x', 'Outside task'),
  ])

  const result = await cloneManager.cloneTree('s-a')
  assert.notEqual(result.clone.newRootSessionId, 's-a')
  assert.equal(result.clone.kind, 'clone')
  assert.equal(result.clone.nodeMapping.length, 2)
  assert.equal(result.composition.rootSessionId, result.clone.newRootSessionId)
  assert.equal(result.composition.nodes.length, 2)
  assert.equal(result.composition.edges.length, 1)
  assert.equal(result.composition.nodes.find((entry) => entry.cloneOf === 's-a').cloneSnapshotAt, 5000)
  assert.equal(result.composition.nodes.find((entry) => entry.cloneOf === 's-b').cloneOf, 's-b')
  assert.equal(result.tasks.length, 2)
  assert.ok(result.tasks.every((entry) => entry.ownerNodeId !== null))
  assert.ok(result.tasks.every((entry) => entry.createdBy === 'clone'))
  // Root stays live; the child was disposed after cataloging.
  assert.ok(live.has(result.clone.newRootSessionId))
  assert.equal(live.size, 1)
  assert.equal(cloneManager.liveCount, 1)
  cloneManager.dispose()
  assert.equal(live.size, 0)
})

test('builds a wide tree depth-first so active children stay under the Host limit', async () => {
  const { store, cloneManager, peakChildren } = createHarness()
  const children = Array.from({ length: 12 }, (_, index) => node(`n-${index}`, `s-${index}`, `Child ${index}`))
  installSource(store, createComposition({
    id: 'source',
    title: 'Wide',
    rootSessionId: 's-a',
    nodes: [node('n-a', 's-a', 'Root'), ...children],
    edges: children.map((child, index) => ({
      id: `e-${index}`,
      parentId: 'n-a',
      childId: child.id,
      role: 'reports-to',
    })),
  }))

  const result = await cloneManager.cloneTree('s-a')
  assert.equal(result.composition.nodes.length, 13)
  assert.equal(result.composition.edges.length, 12)
  assert.ok(peakChildren() <= 1, `peak active children was ${peakChildren()}`)
  cloneManager.dispose()
})

test('attaches the clone root by cwd when the source has no workspace membership', async () => {
  const attached = []
  const workspace = {
    id: 'w-1',
    path: '/work/s-a',
    title: 'work',
    sessionIds: ['s-x'],
    async attachSession(sessionId) { attached.push(sessionId) },
  }
  const { store, cloneManager } = createHarness({ workspaces: [workspace] })
  installSource(store, createComposition({
    id: 'source',
    title: 'Team',
    rootSessionId: 's-a',
    nodes: [node('n-a', 's-a', 'Root'), node('n-b', 's-b', 'Child')],
    edges: [{ id: 'e-1', parentId: 'n-a', childId: 'n-b', role: 'reports-to' }],
  }))

  const result = await cloneManager.cloneTree('s-a')
  assert.ok(attached.includes(result.clone.newRootSessionId))
  assert.equal(attached.filter((id) => id === result.clone.newRootSessionId).length, 1)
  cloneManager.dispose()
})

test('buds a subtree as an independent root without changing the source', async () => {
  const { store, cloneManager } = createHarness()
  installSource(store, createComposition({
    id: 'source',
    title: 'Team',
    rootSessionId: 's-a',
    nodes: [node('n-a', 's-a', 'Root'), node('n-b', 's-b', 'Child'), node('n-c', 's-c', 'Grandchild')],
    edges: [
      { id: 'e-1', parentId: 'n-a', childId: 'n-b', role: 'reports-to' },
      { id: 'e-2', parentId: 'n-b', childId: 'n-c', role: 'reports-to' },
    ],
  }), [task('t-b', 'n-b')])

  const result = await cloneManager.bud('s-a', 'n-b')
  assert.equal(result.clone.kind, 'bud')
  assert.equal(result.composition.nodes.length, 2)
  assert.equal(result.composition.nodes.find((entry) => entry.cloneOf === 's-b').nativeParentSessionId, null)
  assert.equal(result.composition.nodes.find((entry) => entry.cloneOf === 's-c').nativeParentSessionId, result.clone.newRootSessionId)
  assert.equal(result.tasks.length, 1)
  const source = await store.get('s-a')
  assert.equal(source.composition.nodes.length, 3)
  assert.equal(source.composition.edges.length, 2)
  cloneManager.dispose()
})

test('cleans up the new root and records when child creation fails', async () => {
  const { store, cloneManager, live, created } = createHarness({ failChild: true })
  installSource(store, createComposition({
    id: 'source',
    title: 'Team',
    rootSessionId: 's-a',
    nodes: [node('n-a', 's-a', 'Root'), node('n-b', 's-b', 'Child')],
    edges: [{ id: 'e-1', parentId: 'n-a', childId: 'n-b', role: 'reports-to' }],
  }))
  await assert.rejects(() => cloneManager.cloneTree('s-a'), (error) => {
    assert.equal(error.code, 'CLONE_FAILED')
    assert.match(error.message, /Child/)
    assert.match(error.message, /child creation failed/)
    return true
  })
  assert.equal(live.size, 0)
  assert.equal((await store.listClones()).length, 0)
  assert.equal((await store.listTasks(created[0])).length, 0)
  assert.equal(await store.get(created[0]), undefined)
  cloneManager.dispose()
})
