import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createComposition } from '../src/graph.js'
import { createManager } from '../src/manager.js'
import { createStore } from '../src/store.js'

function summary(sessionId, title, source = 'top-level') {
  return {
    sessionId,
    title,
    cwd: `/work/${sessionId}`,
    source,
    nativeParentSessionId: source === 'subagent' ? 's-a' : null,
    agentPreset: null,
    live: true,
    persisted: true,
  }
}

function fakeStore(initial = new Map()) {
  const data = new Map(initial)
  const policies = new Map()
  const tasks = new Map()
  const clones = new Map()
  const teams = new Map()
  return {
    mode: 'memory',
    async get(key) {
      return data.get(key)
    },
    async put(key, value) {
      data.set(key, value)
    },
    async delete(key) {
      data.delete(key)
    },
    async list() {
      return [...data.entries()]
    },
    async getPolicy(key) {
      return policies.get(key)
    },
    async putPolicy(key, value) {
      policies.set(key, value)
    },
    async deletePolicy(key) {
      policies.delete(key)
    },
    async appendAudit() {},
    async listAudit() {
      return []
    },
    async getTask(key) {
      return tasks.get(key)
    },
    async putTask(key, value) {
      tasks.set(key, value)
    },
    async deleteTask(key) {
      tasks.delete(key)
    },
    async listTasks(rootSessionId) {
      return [...tasks.entries()].filter(([, task]) => task.rootSessionId === rootSessionId)
    },
    async getTeam(key) { return teams.get(key) },
    async putTeam(key, value) { teams.set(key, value) },
    async deleteTeam(key) { teams.delete(key) },
    async listTeams(rootSessionId) {
      return [...teams.values()].filter((team) => team.rootSessionId === rootSessionId)
    },
    async getClone(key) { return clones.get(key) },
    async putClone(key, value) { clones.set(key, value) },
    async deleteClone(key) { clones.delete(key) },
    async listClones() { return [...clones.entries()] },
  }
}

function delayedStore() {
  const base = fakeStore()
  const wait = () => new Promise((resolve) => setTimeout(resolve, 5))
  return {
    ...base,
    async get(key) {
      await wait()
      return base.get(key)
    },
    async put(key, value) {
      await wait()
      return base.put(key, value)
    },
    async delete(key) {
      await wait()
      return base.delete(key)
    },
    async list() {
      await wait()
      return base.list()
    },
    async getPolicy(key) {
      await wait()
      return base.getPolicy(key)
    },
    async putPolicy(key, value) {
      await wait()
      return base.putPolicy(key, value)
    },
  }
}

function fakeDiscovery(ids = ['s-a', 's-b', 's-c', 's-d'], tree = []) {
  const summaries = new Map(ids.map((id) => [id, summary(id, id === 's-a' ? 'Lead' : `Agent ${id}`)]))
  return {
    async describe(sessionId) {
      return summaries.get(sessionId) ?? null
    },
    async listTree() {
      return { available: true, children: tree }
    },
  }
}

function rejectsWithCode(promise, code) {
  return assert.rejects(promise, (error) => error?.code === code)
}

test('creates one composition per root and is idempotent', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  const record = await manager.create('s-a')
  assert.equal(record.composition.rootSessionId, 's-a')
  assert.equal(record.composition.nodes.length, 1)
  assert.equal(record.composition.nodes[0].label, 'Lead')
  assert.equal(record.composition.nodes[0].cwd, '/work/s-a')

  const again = await manager.create('s-a')
  assert.deepEqual(again, record)
})

test('adds discovered sessions and moves an existing node instead of rejecting it', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]

  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id, label: '  Reviewer  ' })
  const record = await manager.state('s-a')
  const added = record.composition.nodes.find((node) => node.sessionId === 's-b')
  assert.equal(added.label, 'Reviewer')
  assert.equal(added.source, 'top-level')
  assert.equal(record.composition.edges.length, 1)

  await manager.addNode('s-a', { sessionId: 's-b' })
  let moved = await manager.state('s-a')
  assert.equal(moved.composition.edges.length, 0)
  assert.ok(moved.composition.nodes.some((node) => node.sessionId === 's-b'))

  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  moved = await manager.state('s-a')
  assert.equal(moved.composition.edges.length, 1)

  await rejectsWithCode(manager.addNode('s-a', { sessionId: 's-missing' }), 'SESSION_NOT_DISCOVERED')
  await rejectsWithCode(manager.addNode('s-missing', { sessionId: 's-b' }), 'COMPOSITION_NOT_FOUND')
})

test('moves a whole other composition under a target node', async () => {
  const ids = ['s-a', 's-b', 's-c', 's-d']
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(ids) })
  await manager.create('s-a')
  const a = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: a.id })

  await manager.create('s-c')
  const c = (await manager.state('s-c')).composition.nodes[0]
  await manager.addNode('s-c', { sessionId: 's-d', parentId: c.id })

  const merged = await manager.addNode('s-a', { sessionId: 's-c', parentId: a.id })
  assert.deepEqual(merged.composition.nodes.map((node) => node.sessionId).sort(), ['s-a', 's-b', 's-c', 's-d'])
  assert.ok(merged.composition.edges.some((edge) => edge.parentId === a.id && edge.childId === c.id))
  assert.equal(await manager.state('s-c'), null)
  assert.equal((await manager.resolveSession('s-d')).rootSessionId, 's-a')
})

test('moves one source tree and rekeys the remaining source forest', async () => {
  const ids = ['s-a', 's-c', 's-d', 's-e']
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(ids) })
  await manager.create('s-a')
  const a = (await manager.state('s-a')).composition.nodes[0]

  await manager.create('s-c')
  const c = (await manager.state('s-c')).composition.nodes[0]
  await manager.addNode('s-c', { sessionId: 's-d', parentId: c.id })
  await manager.addNode('s-c', { sessionId: 's-e' })
  const e = (await manager.state('s-c')).composition.nodes.find((node) => node.sessionId === 's-e')

  const merged = await manager.addNode('s-a', { sessionId: 's-c', parentId: a.id })
  assert.ok(merged.composition.nodes.some((node) => node.sessionId === 's-c'))
  assert.ok(merged.composition.nodes.some((node) => node.sessionId === 's-d'))
  assert.ok(!merged.composition.nodes.some((node) => node.sessionId === 's-e'))

  const remaining = await manager.state('s-e')
  assert.ok(remaining)
  assert.equal(remaining.composition.rootSessionId, 's-e')
  assert.deepEqual(remaining.composition.nodes.map((node) => node.sessionId), ['s-e'])
  assert.equal((await manager.resolveSession('s-e')).rootSessionId, 's-e')
  assert.equal((await manager.resolveSession('s-c')).rootSessionId, 's-a')
  assert.equal(e.sessionId, 's-e')
})

test('moves a subtree out of another composition without deleting the source root', async () => {
  const ids = ['s-a', 's-b', 's-e', 's-f', 's-g']
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(ids) })
  await manager.create('s-a')
  const a = (await manager.state('s-a')).composition.nodes[0]

  await manager.create('s-e')
  const e = (await manager.state('s-e')).composition.nodes[0]
  await manager.addNode('s-e', { sessionId: 's-f', parentId: e.id })
  const f = (await manager.state('s-e')).composition.nodes.find((node) => node.sessionId === 's-f')
  await manager.addNode('s-e', { sessionId: 's-g', parentId: f.id })

  const merged = await manager.addNode('s-a', { sessionId: 's-f', parentId: a.id })
  assert.ok(merged.composition.nodes.some((node) => node.sessionId === 's-f'))
  assert.ok(merged.composition.nodes.some((node) => node.sessionId === 's-g'))
  assert.ok(merged.composition.edges.some((edge) => edge.parentId === a.id && edge.childId === f.id))
  const source = await manager.state('s-e')
  assert.deepEqual(source.composition.nodes.map((node) => node.sessionId), ['s-e'])
  assert.equal(source.composition.edges.length, 0)
})

test('promotes reports when a non-root node is removed', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  const b = (await manager.state('s-a')).composition.nodes.find((node) => node.sessionId === 's-b')
  await manager.addNode('s-a', { sessionId: 's-c', parentId: b.id })
  const record = await manager.removeNode('s-a', { nodeId: b.id, mode: 'promote' })
  assert.deepEqual(record.composition.nodes.map((node) => node.sessionId).sort(), ['s-a', 's-c'])
  assert.equal(record.composition.edges.length, 0)
})

test('cascades a subtree and protects the root-session node', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  const b = (await manager.state('s-a')).composition.nodes.find((node) => node.sessionId === 's-b')
  await manager.addNode('s-a', { sessionId: 's-c', parentId: b.id })

  const record = await manager.removeNode('s-a', { nodeId: b.id, mode: 'cascade' })
  assert.deepEqual(record.composition.nodes.map((node) => node.sessionId), ['s-a'])
  assert.equal(record.composition.edges.length, 0)

  await rejectsWithCode(manager.removeNode('s-a', { nodeId: root.id, mode: 'promote' }), 'ROOT_PROTECTED')
  await rejectsWithCode(manager.removeNode('s-a', { nodeId: root.id, mode: 'cascade' }), 'ROOT_PROTECTED')
})

test('deletes the composition record without touching sessions', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  await manager.deleteComposition('s-a')
  assert.equal(await manager.state('s-a'), null)
  await rejectsWithCode(manager.deleteComposition('s-a'), 'COMPOSITION_NOT_FOUND')
})

test('serializes concurrent mutations for one root session', async () => {
  const manager = createManager({ store: delayedStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  await Promise.all([
    manager.addNode('s-a', { sessionId: 's-b' }),
    manager.addNode('s-a', { sessionId: 's-c' }),
  ])
  const record = await manager.state('s-a')
  assert.deepEqual(record.composition.nodes.map((node) => node.sessionId).sort(), ['s-a', 's-b', 's-c'])
})

test('moveAcross serializes with an ordinary write to the target root', async () => {
  const ids = ['t-root', 's-root', 'b', 'x']
  const manager = createManager({ store: delayedStore(), discovery: fakeDiscovery(ids) })
  await manager.create('t-root')
  await manager.create('s-root')
  const tRoot = (await manager.state('t-root')).composition.nodes[0]
  const sRoot = (await manager.state('s-root')).composition.nodes[0]
  await manager.addNode('s-root', { sessionId: 'b', parentId: sRoot.id })

  await Promise.all([
    manager.addNode('t-root', { sessionId: 'b', parentId: tRoot.id }),
    manager.addNode('t-root', { sessionId: 'x', parentId: tRoot.id }),
  ])

  const target = (await manager.state('t-root')).composition
  const source = (await manager.state('s-root')).composition
  assert.deepEqual(target.nodes.map((node) => node.sessionId).sort(), ['b', 't-root', 'x'])
  assert.deepEqual(source.nodes.map((node) => node.sessionId), ['s-root'])
  assert.equal((await manager.resolveSession('b'))?.rootSessionId, 't-root')
  assert.equal((await manager.resolveSession('x'))?.rootSessionId, 't-root')
})

test('state returns null for an unknown root and rejects an invalid id', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  assert.equal(await manager.state('s-missing'), null)
  await assert.rejects(manager.state(''), (error) => error?.code === 'INVALID_FIELD')
})

test('adds external leaves and edits labels and parents', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  const b = (await manager.state('s-a')).composition.nodes.find((node) => node.sessionId === 's-b')

  await manager.addExternal('s-a', {
    label: 'ACP helper',
    provider: 'external',
    nativeParentSessionId: 's-b',
    parentId: b.id,
  })
  let record = await manager.state('s-a')
  const external = record.composition.nodes.find((node) => node.kind === 'external')
  assert.equal(external.sessionId, null)
  assert.equal(external.source, 'external')
  assert.equal(external.label, 'ACP helper')

  await manager.renameNode('s-a', { nodeId: external.id, label: 'Renamed helper' })
  record = await manager.state('s-a')
  assert.equal(record.composition.nodes.find((node) => node.id === external.id).label, 'Renamed helper')

  await manager.setParent('s-a', { nodeId: external.id, parentId: root.id })
  record = await manager.state('s-a')
  assert.ok(record.composition.edges.some((edge) => edge.parentId === root.id && edge.childId === external.id))

  await manager.setParent('s-a', { nodeId: external.id, parentId: null })
  record = await manager.state('s-a')
  assert.ok(!record.composition.edges.some((edge) => edge.childId === external.id))

  await rejectsWithCode(manager.setParent('s-a', { nodeId: root.id, parentId: b.id }), 'CYCLE')
  await rejectsWithCode(manager.addExternal('s-a', { label: '   ' }), 'INVALID_FIELD')
})

test('renames a composition title without touching its nodes', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  const record = await manager.setTitle('s-a', { title: 'Review team' })
  assert.equal(record.composition.title, 'Review team')
  const state = await manager.state('s-a')
  assert.equal(state.composition.title, 'Review team')
  assert.equal(state.composition.nodes.length, 1)
  await rejectsWithCode(manager.setTitle('s-a', { title: '   ' }), 'INVALID_FIELD')
  await rejectsWithCode(manager.setTitle('s-missing', { title: 'Review team' }), 'COMPOSITION_NOT_FOUND')
})

test('installComposition refuses a session owned by another composition', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['root-r', 'root-c2', 'child-x']) })
  await manager.create('root-c2')
  const c2 = (await manager.state('root-c2')).composition
  await manager.addNode('root-c2', { sessionId: 'child-x', parentId: c2.nodes[0].id })

  const node = (sessionId) => ({
    sessionId,
    label: sessionId,
    kind: 'session',
    source: 'top-level',
    provider: null,
    nativeParentSessionId: null,
    cwd: `/work/${sessionId}`,
    permissionPreset: null,
  })
  const composition = createComposition({
    rootSessionId: 'root-r',
    nodes: [node('root-r'), node('child-x')],
    edges: [],
  })
  await rejectsWithCode(manager.installComposition('root-r', composition), 'SESSION_ALREADY_COMPOSED')
  assert.equal((await manager.resolveSession('child-x'))?.rootSessionId, 'root-c2')
})

test('resolves one shared composition from a member session', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })

  const resolved = await manager.resolveSession('s-b')
  assert.equal(resolved.rootSessionId, 's-a')
  assert.equal(resolved.record.composition.nodes.length, 2)

  const created = await manager.create('s-b')
  assert.equal(created.composition.rootSessionId, 's-a')
  const moved = await manager.addNode('s-a', { sessionId: 's-b' })
  assert.equal(moved.composition.edges.length, 0)
})

test('ordinary forks lead a new composition instead of inheriting the source', async () => {
  const fork = {
    ...summary('s-fork', 'Fork'),
    nativeParentSessionId: 's-a',
  }
  const discovery = {
    async describe(sessionId) {
      return sessionId === 's-fork' ? fork : sessionId === 's-a' ? summary('s-a', 'Lead') : null
    },
    async describeHeader(sessionId) {
      return sessionId === 's-fork' ? fork : sessionId === 's-a' ? summary('s-a', 'Lead') : null
    },
    async listTree() {
      return { available: true, children: [] }
    },
  }
  const store = fakeStore()
  const manager = createManager({ store, discovery })
  await manager.create('s-a')

  // `header.parentSession` alone is not native subagent membership: an
  // ordinary fork has no `origin: 'subagent'` and leads a new native tree.
  assert.equal(await manager.resolveSession('s-fork'), null)
  const created = await manager.create('s-fork')
  assert.equal(created.composition.rootSessionId, 's-fork')
  assert.equal((await manager.state('s-fork')).composition.rootSessionId, 's-fork')
  assert.equal((await manager.state('s-a')).composition.nodes.length, 1)
})

test('blocks structural edits in a working branch but not collateral nodes', async () => {
  const running = new Set()
  const manager = createManager({
    store: fakeStore(),
    discovery: fakeDiscovery(),
    agents: () => ({ get: (id) => ({ status: running.has(id) ? 'running' : 'idle' }) }),
  })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  await manager.addNode('s-a', { sessionId: 's-c', parentId: root.id })
  running.add('s-b')
  const state = await manager.state('s-a')
  const b = state.composition.nodes.find((node) => node.sessionId === 's-b')
  const c = state.composition.nodes.find((node) => node.sessionId === 's-c')

  await rejectsWithCode(manager.removeNode('s-a', { nodeId: b.id, mode: 'promote' }), 'AGENT_BUSY')
  await rejectsWithCode(manager.setParent('s-a', { nodeId: b.id, parentId: null }), 'AGENT_BUSY')
  await rejectsWithCode(manager.addNode('s-a', { sessionId: 's-d', parentId: b.id }), 'AGENT_BUSY')
  await rejectsWithCode(manager.addNode('s-a', { sessionId: 's-d', parentId: root.id }), 'AGENT_BUSY')

  const removed = await manager.removeNode('s-a', { nodeId: c.id, mode: 'promote' })
  assert.ok(!removed.composition.nodes.some((node) => node.id === c.id))
  await manager.renameNode('s-a', { nodeId: b.id, label: 'Renamed while running' })
  assert.equal((await manager.state('s-a')).composition.nodes.find((node) => node.id === b.id).label, 'Renamed while running')
})

test('mirrors a started native child without a user edit', async () => {
  const manager = createManager({
    store: fakeStore(),
    discovery: fakeDiscovery(),
    agents: () => ({ get: () => ({ status: 'idle' }) }),
  })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  const b = (await manager.state('s-a')).composition.nodes.find((node) => node.sessionId === 's-b')

  const attached = await manager.autoAttach('s-b', { childId: 's-d', provider: 'spawn', local: true })
  assert.equal(attached.composition.nodes.filter((node) => node.sessionId === 's-d').length, 1)
  const child = attached.composition.nodes.find((node) => node.sessionId === 's-d')
  assert.ok(attached.composition.edges.some((edge) => edge.parentId === b.id && edge.childId === child.id))

  assert.equal(await manager.autoAttach('s-b', { childId: 's-d', provider: 'spawn', local: true }), null)
  assert.equal(await manager.autoAttach('s-missing', { childId: 's-c', provider: 'spawn', local: true }), null)
})

test('mirrors a native descendant even though resolveSession already sees the owner composition', async () => {
  const discovery = fakeDiscovery()
  const describe = discovery.describe
  discovery.describe = async (sessionId) => {
    if (sessionId !== 's-new') return describe(sessionId)
    return {
      ...summary('s-new', 'Child'),
      source: 'subagent',
      nativeParentSessionId: 's-a',
    }
  }
  const manager = createManager({ store: fakeStore(), discovery })
  await manager.create('s-a')
  await manager.autoAttach('s-a', { childId: 's-new', local: true, provider: 'spawn' })
  const state = await manager.state('s-a')
  assert.ok(state.composition.nodes.some((candidate) => candidate.sessionId === 's-new'))
})

test('mirrors a composed child when discovery has no title projection yet', async () => {
  const discovery = fakeDiscovery()
  const describe = discovery.describe
  discovery.describe = async (sessionId) => (sessionId === 's-new' ? null : describe(sessionId))
  const manager = createManager({ store: fakeStore(), discovery })
  await manager.create('s-a')
  await manager.autoAttach('s-a', {
    childId: 's-new',
    local: true,
    provider: 'spawn',
    label: 'agent-1',
  })
  const state = await manager.state('s-a')
  const node = state.composition.nodes.find((candidate) => candidate.sessionId === 's-new')
  assert.ok(node)
  assert.equal(node.label, 'agent-1')
  assert.equal(node.source, 'subagent')
  assert.equal(node.nativeParentSessionId, 's-a')
})

test('imports the existing native tree on create', async () => {
  const tree = [
    { kind: 'child', id: 's-b', parentId: 's-a', depth: 1, mode: 'continuable', label: 'Worker', activity: 'inactive' },
    { kind: 'child', id: 's-c', parentId: 's-b', depth: 2, mode: 'continuable', label: 'Checker', activity: 'inactive' },
    { kind: 'child', id: 's-ext', parentId: 's-a', depth: 1, mode: 'external', label: 'ACP', activity: 'inactive' },
    { kind: 'child', id: 's-one', parentId: 's-a', depth: 1, mode: 'one-shot', label: 'Once', activity: 'inactive' },
  ]
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['s-a', 's-b', 's-c'], tree) })
  const record = await manager.create('s-a')
  const composition = record.composition
  assert.equal(composition.nodes.filter((node) => node.sessionId !== null).length, 3)
  assert.equal(composition.nodes.filter((node) => node.kind === 'external').length, 2)
  const b = composition.nodes.find((node) => node.sessionId === 's-b')
  const c = composition.nodes.find((node) => node.sessionId === 's-c')
  const root = composition.nodes.find((node) => node.sessionId === 's-a')
  assert.equal(root.mode, 'continuable')
  assert.equal(b.mode, 'continuable')
  assert.equal(c.mode, 'continuable')
  assert.equal(composition.nodes.find((node) => node.sessionId === null && node.label === 'Once').mode, 'one-shot')
  assert.ok(composition.edges.some((edge) => edge.parentId === b.id && edge.childId === c.id))
  const nativeEdge = composition.edges.find((edge) => edge.parentId === root.id && edge.childId === b.id)
  assert.deepEqual((await manager.getGrants('s-a'))[nativeEdge.id], { allowMessage: false, allowInterrupt: false })
  assert.equal((await manager.authorizeMessage('s-a', root.id, b.id)).allowed, false)
})

test('sync-native is idempotent for external placeholders and one-shot leaves', async () => {
  const tree = [
    { kind: 'child', id: 's-ext', parentId: 's-a', depth: 1, mode: 'external', label: 'ACP', activity: 'inactive' },
    { kind: 'child', id: 's-one', parentId: 's-a', depth: 1, mode: 'one-shot', label: 'Once', activity: 'inactive' },
  ]
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['s-a'], tree) })
  await manager.create('s-a')
  await manager.syncNativeTree('s-a')
  await manager.syncNativeTree('s-a')
  const composition = (await manager.state('s-a')).composition
  assert.equal(composition.nodes.filter((node) => node.kind === 'external').length, 2)
  assert.equal(composition.nodes.filter((node) => node.kind === 'external' && node.mode === 'external').length, 1)
  assert.equal(composition.nodes.filter((node) => node.kind === 'external' && node.mode === 'one-shot').length, 1)

  await manager.autoAttach('s-a', {
    childId: 's-ext',
    local: false,
    provider: 'external',
  })
  const after = (await manager.state('s-a')).composition
  assert.equal(after.nodes.filter((node) => node.kind === 'external').length, 2)
})

test('sync-native skips title reads for already mirrored nodes', async () => {
  let describes = 0
  const tree = [
    { kind: 'child', id: 's-b', parentId: 's-a', depth: 1, mode: 'continuable', label: 'Worker', activity: 'inactive' },
  ]
  const manager = createManager({
    store: fakeStore(),
    discovery: {
      async describe(sessionId) {
        describes += 1
        return summary(sessionId, sessionId)
      },
      async describeHeader(sessionId) {
        return summary(sessionId, sessionId)
      },
      async listTree() {
        return { available: true, children: tree }
      },
    },
  })
  await manager.create('s-a')
  describes = 0
  tree[0].mode = 'one-shot'
  await manager.syncNativeTree('s-a')
  assert.equal(describes, 0)
  const composition = (await manager.state('s-a')).composition
  assert.equal(composition.nodes.length, 2)
  assert.equal(composition.nodes.find((node) => node.sessionId === 's-b').mode, 'one-shot')
})

test('authorizes messages and interrupts only along granted edge paths', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  const b = (await manager.state('s-a')).composition.nodes.find((node) => node.sessionId === 's-b')
  await manager.addNode('s-a', { sessionId: 's-c', parentId: b.id })
  const state = await manager.state('s-a')
  const c = state.composition.nodes.find((node) => node.sessionId === 's-c')
  const ab = state.composition.edges.find((edge) => edge.childId === b.id)
  const bc = state.composition.edges.find((edge) => edge.childId === c.id)

  const defaults = await manager.getGrants('s-a')
  assert.deepEqual(defaults[ab.id], { allowMessage: true, allowInterrupt: false })
  assert.deepEqual(defaults[bc.id], { allowMessage: true, allowInterrupt: false })
  assert.equal((await manager.authorizeMessage('s-a', root.id, c.id)).allowed, true)
  assert.equal((await manager.authorizeMessage('s-a', c.id, root.id)).allowed, true)
  assert.equal((await manager.authorizeInterrupt('s-a', root.id, c.id)).allowed, false)
  await manager.setEdgeGrant('s-a', bc.id, { allowMessage: false })
  assert.equal((await manager.authorizeMessage('s-a', root.id, c.id)).allowed, false)
  assert.equal((await manager.authorizeMessage('s-a', c.id, root.id)).allowed, false)
  await manager.setEdgeGrant('s-a', bc.id, { allowMessage: true })

  await manager.setEdgeGrant('s-a', ab.id, { allowInterrupt: true })
  await manager.setEdgeGrant('s-a', bc.id, { allowInterrupt: true })
  assert.equal((await manager.authorizeInterrupt('s-a', root.id, c.id)).allowed, true)
  assert.equal((await manager.authorizeInterrupt('s-a', c.id, root.id)).allowed, false)
  await rejectsWithCode(manager.setEdgeGrant('s-a', 'missing', { allowMessage: true }), 'UNKNOWN_EDGE')

  const granted = await manager.grantDelegatedEdge('s-a', 's-a', 's-b')
  assert.equal(granted[ab.id].allowMessage, true)
  assert.equal(granted[ab.id].allowInterrupt, true)
})

test('preserves edge grants when a node changes parent and clears them on detach', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  await manager.addNode('s-a', { sessionId: 's-c', parentId: root.id })
  let state = await manager.state('s-a')
  const b = state.composition.nodes.find((node) => node.sessionId === 's-b')
  const c = state.composition.nodes.find((node) => node.sessionId === 's-c')
  const firstEdge = state.composition.edges.find((edge) => edge.childId === b.id)

  await manager.setEdgeGrant('s-a', firstEdge.id, { allowMessage: true, allowInterrupt: true })
  await manager.setParent('s-a', { nodeId: b.id, parentId: c.id })
  state = await manager.state('s-a')
  const secondEdge = state.composition.edges.find((edge) => edge.childId === b.id)
  assert.notEqual(secondEdge.id, firstEdge.id)
  let grants = await manager.getGrants('s-a')
  assert.equal(grants[firstEdge.id], undefined)
  assert.deepEqual(grants[secondEdge.id], { allowMessage: true, allowInterrupt: true })

  await manager.setParent('s-a', { nodeId: b.id, parentId: root.id })
  state = await manager.state('s-a')
  const thirdEdge = state.composition.edges.find((edge) => edge.childId === b.id)
  grants = await manager.getGrants('s-a')
  assert.deepEqual(grants[thirdEdge.id], { allowMessage: true, allowInterrupt: true })

  await manager.addNode('s-a', { sessionId: 's-b', parentId: c.id })
  state = await manager.state('s-a')
  const fourthEdge = state.composition.edges.find((edge) => edge.childId === b.id)
  grants = await manager.getGrants('s-a')
  assert.deepEqual(grants[fourthEdge.id], { allowMessage: true, allowInterrupt: true })

  await manager.setParent('s-a', { nodeId: b.id, parentId: null })
  state = await manager.state('s-a')
  assert.equal(state.composition.edges.some((edge) => edge.childId === b.id), false)
  grants = await manager.getGrants('s-a')
  assert.equal(grants[fourthEdge.id], undefined)

  await manager.setParent('s-a', { nodeId: b.id, parentId: root.id })
  state = await manager.state('s-a')
  const reattached = state.composition.edges.find((edge) => edge.childId === b.id)
  grants = await manager.getGrants('s-a')
  assert.deepEqual(grants[reattached.id], { allowMessage: true, allowInterrupt: false })
})

test('creates and transitions plugin-owned tasks with a revision guard', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery() })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  let tasks = await manager.createTask('s-a', { subject: 'Review plan', description: 'Read the plan', ownerNodeId: root.id })
  assert.equal(tasks.length, 1)
  assert.equal(tasks[0].status, 'pending')
  assert.equal(tasks[0].revision, 1)
  const task = tasks[0]

  tasks = await manager.updateTask('s-a', { taskId: task.id, expectedRevision: 1, action: 'start' })
  assert.equal(tasks[0].status, 'in_progress')
  assert.equal(tasks[0].revision, 2)
  await rejectsWithCode(manager.updateTask('s-a', { taskId: task.id, expectedRevision: 1, action: 'complete' }), 'TASK_CONFLICT')
  tasks = await manager.updateTask('s-a', { taskId: task.id, expectedRevision: 2, action: 'complete' })
  assert.equal(tasks[0].status, 'completed')
  tasks = await manager.updateTask('s-a', { taskId: task.id, expectedRevision: 3, action: 'reopen' })
  assert.equal(tasks[0].status, 'pending')
  tasks = await manager.updateTask('s-a', { taskId: task.id, expectedRevision: 4, action: 'delete' })
  assert.deepEqual(tasks, [])
  await rejectsWithCode(manager.createTask('s-a', { subject: '   ' }), 'INVALID_FIELD')
  await rejectsWithCode(manager.createTask('s-a', { subject: 'Bad owner', ownerNodeId: 'missing' }), 'UNKNOWN_NODE')
})

test('supports claim, release, dependencies, reassign, and dependent-safe delete', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['s-a', 's-b']) })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  const b = (await manager.state('s-a')).composition.nodes.find((node) => node.sessionId === 's-b')
  await rejectsWithCode(manager.createTask('s-a', { subject: 'Bad dependency', blockedBy: ['missing'] }), 'TASK_NOT_FOUND')

  let tasks = await manager.createTask('s-a', { subject: 'First', description: 'One', ownerNodeId: b.id })
  let first = tasks[0]
  const secondBoard = await manager.createTask('s-a', { subject: 'Second', description: 'Two', blockedBy: [first.id] })
  let second = secondBoard.find((task) => task.id !== first.id)
  await rejectsWithCode(
    manager.updateTask('s-a', { taskId: second.id, expectedRevision: 1, action: 'claim', actor: 's-b' }),
    'TASK_BLOCKED',
  )

  tasks = await manager.updateTask('s-a', { taskId: first.id, expectedRevision: 1, action: 'claim', actor: 's-b' })
  first = tasks.find((task) => task.id === first.id)
  assert.equal(first.status, 'in_progress')
  assert.equal(first.ownerNodeId, b.id)
  tasks = await manager.updateTask('s-a', { taskId: first.id, expectedRevision: 2, action: 'release', actor: 's-b' })
  first = tasks.find((task) => task.id === first.id)
  assert.equal(first.status, 'pending')
  assert.equal(first.ownerNodeId, null)
  tasks = await manager.updateTask('s-a', { taskId: first.id, expectedRevision: 3, action: 'claim', actor: 's-b' })
  first = tasks.find((task) => task.id === first.id)
  tasks = await manager.updateTask('s-a', { taskId: first.id, expectedRevision: 4, action: 'complete', actor: 's-b' })
  first = tasks.find((task) => task.id === first.id)
  assert.equal(first.status, 'completed')
  tasks = await manager.updateTask('s-a', { taskId: second.id, expectedRevision: 1, action: 'claim', actor: 's-b' })
  second = tasks.find((task) => task.id === second.id)
  assert.equal(second.status, 'in_progress')
  await rejectsWithCode(
    manager.updateTask('s-a', { taskId: first.id, expectedRevision: 5, action: 'delete', actor: 's-b' }),
    'TASK_HAS_DEPENDENTS',
  )
  tasks = await manager.updateTask('s-a', {
    taskId: second.id,
    expectedRevision: 2,
    action: 'edit',
    subject: 'Second edited',
    writeScopes: ['src/'],
    actor: 's-b',
  })
  second = tasks.find((task) => task.id === second.id)
  assert.equal(second.subject, 'Second edited')
  assert.deepEqual(second.writeScopes, ['src'])

  tasks = await manager.createTask('s-a', { subject: 'Third', description: 'Three' })
  let third = tasks.find((task) => task.subject === 'Third')
  tasks = await manager.updateTask('s-a', {
    taskId: third.id,
    expectedRevision: 1,
    action: 'reassign',
    ownerNodeId: b.id,
    actor: 's-a',
  })
  third = tasks.find((task) => task.id === third.id)
  assert.equal(third.ownerNodeId, b.id)
  assert.equal(third.status, 'in_progress')
  tasks = await manager.createTask('s-a', { subject: 'Fourth', description: 'Four' })
  const fourth = tasks.find((task) => task.subject === 'Fourth')
  await manager.updateTask('s-a', {
    taskId: third.id,
    expectedRevision: 2,
    action: 'set_dependencies',
    blockedBy: [fourth.id],
    actor: 's-b',
  })
  await rejectsWithCode(
    manager.updateTask('s-a', {
      taskId: fourth.id,
      expectedRevision: 1,
      action: 'set_dependencies',
      blockedBy: [third.id],
      actor: 's-a',
    }),
    'TASK_DEPENDENCY_CYCLE',
  )
  await manager.updateTask('s-a', { taskId: second.id, expectedRevision: 3, action: 'delete', actor: 's-b' })
  await manager.updateTask('s-a', { taskId: first.id, expectedRevision: 5, action: 'delete', actor: 's-b' })
  assert.equal((await manager.getTasks('s-a')).some((task) => task.id === first.id), false)
})

test('creates connected Team subtrees and scopes tasks to them', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['s-a', 's-b', 's-c', 's-d']) })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  await manager.addNode('s-a', { sessionId: 's-c', parentId: root.id })
  let state = await manager.state('s-a')
  const b = state.composition.nodes.find((node) => node.sessionId === 's-b')
  const c = state.composition.nodes.find((node) => node.sessionId === 's-c')
  const teams = await manager.createTeam('s-a', { rootNodeId: b.id, label: 'B team' })
  assert.equal(teams.length, 1)
  assert.equal(teams[0].label, 'B team')
  assert.deepEqual(teams[0].nodeIds, [b.id])
  await rejectsWithCode(manager.createTeam('s-a', { rootNodeId: root.id, label: 'overlap' }), 'TEAM_OVERLAP')
  await rejectsWithCode(manager.createTeam('s-a', { rootNodeId: 'missing' }), 'UNKNOWN_NODE')
  const teamId = teams[0].id
  await rejectsWithCode(
    manager.createTask('s-a', { subject: 'Outside', teamId, ownerNodeId: c.id }),
    'TEAM_MEMBER_REQUIRED',
  )
  const created = await manager.createTask('s-a', {
    subject: 'Team task',
    description: 'Scoped',
    teamId,
    ownerNodeId: b.id,
  })
  const task = created.find((candidate) => candidate.subject === 'Team task')
  assert.equal(task.teamId, teamId)
  assert.equal((await manager.getTasks('s-a', undefined, teamId)).length, 1)
  assert.equal((await manager.getTasks('s-a', undefined, null)).length, 0)
  await rejectsWithCode(
    manager.updateTask('s-a', {
      taskId: task.id,
      expectedRevision: 1,
      action: 'reassign',
      ownerNodeId: c.id,
      teamId,
      actor: 's-b',
    }),
    'TEAM_MEMBER_REQUIRED',
  )
  await manager.updateTask('s-a', {
    taskId: task.id,
    expectedRevision: 1,
    action: 'claim',
    teamId,
    actor: 's-b',
  })
  await manager.deleteTeam('s-a', teamId)
  assert.deepEqual(await manager.listTeams('s-a'), [])
  assert.equal((await manager.getTasks('s-a', undefined, teamId)).length, 0)
  await rejectsWithCode(manager.createTeam('s-a', {
    rootNodeId: b.id,
    nodeIds: [b.id, c.id],
    label: 'disconnected',
  }), 'TEAM_NOT_CONNECTED')
  const connected = await manager.createTeam('s-a', {
    rootNodeId: root.id,
    nodeIds: [root.id, b.id],
    label: 'connected subset',
  })
  assert.equal(connected.length, 1)
  assert.deepEqual(connected[0].nodeIds, [root.id, b.id])
})

test('rejects graph edits that invalidate a Team and keeps Team labels unique', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['s-a', 's-b', 's-c', 's-d']) })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  await manager.addNode('s-a', { sessionId: 's-c', parentId: root.id })
  await manager.addNode('s-a', { sessionId: 's-d', parentId: root.id })
  let state = await manager.state('s-a')
  const b = state.composition.nodes.find((node) => node.sessionId === 's-b')
  const c = state.composition.nodes.find((node) => node.sessionId === 's-c')
  const d = state.composition.nodes.find((node) => node.sessionId === 's-d')
  const [team] = await manager.createTeam('s-a', {
    rootNodeId: root.id,
    nodeIds: [root.id, b.id, c.id],
    label: 'Stable',
  })
  assert.deepEqual(team.nodeIds, [root.id, b.id, c.id])
  assert.equal((await manager.resolveTeam('s-a', 'Stable')).id, team.id)
  assert.equal((await manager.resolveTeam('s-a', team.id)).id, team.id)
  await rejectsWithCode(manager.createTeam('s-a', { rootNodeId: d.id, label: 'Stable' }), 'TEAM_LABEL_CONFLICT')
  await rejectsWithCode(manager.removeNode('s-a', { nodeId: b.id }), 'TEAM_STRUCTURE_CONFLICT')
  await rejectsWithCode(manager.setParent('s-a', { nodeId: b.id, parentId: d.id }), 'TEAM_STRUCTURE_CONFLICT')
  state = await manager.state('s-a')
  assert.ok(state.composition.nodes.some((node) => node.id === b.id))
  assert.equal((await manager.listTeams('s-a')).length, 1)
})

test('refuses to move a Team member across compositions and rolls back the target', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['s-a', 's-b', 's-c']) })
  await manager.create('s-a')
  await manager.create('s-c')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  const b = (await manager.state('s-a')).composition.nodes.find((node) => node.sessionId === 's-b')
  await manager.createTeam('s-a', {
    rootNodeId: root.id,
    nodeIds: [root.id, b.id],
    label: 'Move guard',
  })
  await rejectsWithCode(manager.addNode('s-c', { sessionId: 's-b' }), 'TEAM_STRUCTURE_CONFLICT')
  assert.equal((await manager.resolveSession('s-b')).rootSessionId, 's-a')
  const target = await manager.state('s-c')
  assert.equal(target.composition.nodes.some((node) => node.sessionId === 's-b'), false)
})

test('rejects a one-shot Team member', async () => {
  const discovery = fakeDiscovery(['s-a', 's-b'])
  const describe = discovery.describe
  discovery.describe = async (sessionId) => {
    const summary = await describe(sessionId)
    return summary === null ? null : { ...summary, ...(sessionId === 's-b' ? { mode: 'one-shot' } : {}) }
  }
  const manager = createManager({ store: fakeStore(), discovery })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  const b = (await manager.state('s-a')).composition.nodes.find((node) => node.sessionId === 's-b')
  assert.equal(b.mode, 'one-shot')
  await rejectsWithCode(manager.createTeam('s-a', {
    rootNodeId: root.id,
    nodeIds: [root.id, b.id],
    label: 'One shot',
  }), 'TEAM_MEMBER_MODE')
})

test('keeps a Team task tombstone and rejects stale edits', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['s-a', 's-b']) })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  const b = (await manager.state('s-a')).composition.nodes.find((node) => node.sessionId === 's-b')
  const [team] = await manager.createTeam('s-a', { rootNodeId: b.id, nodeIds: [b.id], label: 'Tombstones' })
  const created = await manager.createTask('s-a', {
    subject: 'Delete me',
    description: 'Tombstone',
    teamId: team.id,
    ownerNodeId: b.id,
  })
  const task = created.find((candidate) => candidate.subject === 'Delete me')
  assert.equal(task.ownerName, b.label)
  await rejectsWithCode(manager.createTask('s-a', {
    subject: 'Bad scope',
    description: 'Bad',
    teamId: team.id,
    writeScopes: ['../outside'],
  }), 'TEAM_INVALID_WRITE_SCOPE')
  await rejectsWithCode(manager.createTask('s-a', {
    subject: 'Duplicate blocker',
    description: 'Bad',
    teamId: team.id,
    blockedBy: [task.id, task.id],
  }), 'INVALID_FIELD')
  await manager.updateTask('s-a', {
    taskId: task.id,
    expectedRevision: 1,
    action: 'delete',
    teamId: team.id,
    actor: 's-b',
  })
  const all = await manager.getTasks('s-a', undefined, team.id)
  assert.equal(all.find((candidate) => candidate.id === task.id)?.status, 'deleted')
  await rejectsWithCode(manager.updateTask('s-a', {
    taskId: task.id,
    expectedRevision: 2,
    action: 'complete',
    teamId: team.id,
    actor: 's-b',
  }), 'TEAM_TASK_DELETED')
})

test('sync-native refuses a child already owned by another composition', async () => {
  const warnings = []
  const tree = [
    { kind: 'child', id: 'child-x', parentId: 'root-r', depth: 1, mode: 'continuable', label: 'Child X', activity: 'inactive' },
  ]
  const manager = createManager({
    store: fakeStore(),
    discovery: fakeDiscovery(['root-r', 'root-c2', 'child-x'], tree),
    logger: { warn(...args) { warnings.push(args) } },
  })
  await manager.create('root-c2')
  const c2 = (await manager.state('root-c2')).composition
  await manager.addNode('root-c2', { sessionId: 'child-x', parentId: c2.nodes[0].id })

  await manager.create('root-r')
  const r = (await manager.state('root-r')).composition
  assert.equal(r.nodes.length, 1)
  assert.equal(r.nodes.some((node) => node.sessionId === 'child-x'), false)
  assert.equal((await manager.resolveSession('child-x'))?.rootSessionId, 'root-c2')
  assert.ok(warnings.some((entry) => entry[0].includes('sync-native skipped')))
})

test('auto-attach refuses a child already owned by another composition', async () => {
  const warnings = []
  const manager = createManager({
    store: fakeStore(),
    discovery: fakeDiscovery(['root-r', 'root-c2', 'child-x']),
    logger: { warn(...args) { warnings.push(args) } },
  })
  await manager.create('root-r')
  await manager.create('root-c2')
  const c2 = (await manager.state('root-c2')).composition
  await manager.addNode('root-c2', { sessionId: 'child-x', parentId: c2.nodes[0].id })

  const attached = await manager.autoAttach('root-r', { childId: 'child-x', provider: 'local', local: true })
  assert.equal(attached, null)
  const r = (await manager.state('root-r')).composition
  assert.equal(r.nodes.length, 1)
  assert.equal((await manager.resolveSession('child-x'))?.rootSessionId, 'root-c2')
  assert.ok(warnings.some((entry) => entry[0].includes('refusing to mirror')))
})

test('a failed source write rolls the target record back', async () => {
  const store = fakeStore()
  const manager = createManager({ store, discovery: fakeDiscovery(['t-root', 's-root', 'b']) })
  await manager.create('t-root')
  await manager.create('s-root')
  const tRoot = (await manager.state('t-root')).composition.nodes[0]
  const sRoot = (await manager.state('s-root')).composition.nodes[0]
  await manager.addNode('s-root', { sessionId: 'b', parentId: sRoot.id })

  const put = store.put.bind(store)
  let failSource = true
  store.put = async (key, value) => {
    if (failSource && key === 's-root') {
      failSource = false
      throw new Error('source write failed')
    }
    return put(key, value)
  }

  await assert.rejects(
    () => manager.addNode('t-root', { sessionId: 'b', parentId: tRoot.id }),
    /source write failed/,
  )
  const target = (await manager.state('t-root')).composition
  const source = (await manager.state('s-root')).composition
  assert.deepEqual(target.nodes.map((node) => node.sessionId), ['t-root'])
  assert.deepEqual(source.nodes.map((node) => node.sessionId).sort(), ['b', 's-root'])
  assert.equal((await manager.resolveSession('b'))?.rootSessionId, 's-root')
})

test('records task provenance and limits updates to the owner or an ancestor', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['s-a', 's-b', 's-c']) })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  await manager.addNode('s-a', { sessionId: 's-c', parentId: root.id })
  const composition = (await manager.state('s-a')).composition
  const b = composition.nodes.find((node) => node.sessionId === 's-b')

  let tasks = await manager.createTask('s-a', {
    subject: 'Child task',
    ownerNodeId: b.id,
    createdBy: 'agent:s-b',
    actor: 's-b',
  })
  assert.equal(tasks[0].createdBy, 'agent:s-b')
  const task = tasks[0]

  await rejectsWithCode(
    manager.updateTask('s-a', { taskId: task.id, expectedRevision: 1, action: 'start', actor: 's-c' }),
    'TASK_FORBIDDEN',
  )
  tasks = await manager.updateTask('s-a', { taskId: task.id, expectedRevision: 1, action: 'start', actor: 's-a' })
  assert.equal(tasks[0].status, 'in_progress')
  tasks = await manager.updateTask('s-a', { taskId: task.id, expectedRevision: 2, action: 'complete', actor: 's-b' })
  assert.equal(tasks[0].status, 'completed')

  const userTask = (await manager.createTask('s-a', { subject: 'Unowned task' }))
    .find((entry) => entry.subject === 'Unowned task')
  assert.equal(userTask.createdBy, 'user')
  const remaining = await manager.updateTask('s-a', {
    taskId: userTask.id,
    expectedRevision: 1,
    action: 'delete',
    actor: 's-a',
  })
  assert.equal(remaining.some((entry) => entry.id === userTask.id), false)
})


test('deleting a clone composition keeps its clone mapping as orphaned', async () => {
  const store = fakeStore()
  const manager = createManager({ store, discovery: fakeDiscovery() })
  await manager.create('s-a')
  await store.putClone('clone-1', {
    id: 'clone-1',
    kind: 'clone',
    status: 'completed',
    sourceCompositionId: 'source',
    sourceRootSessionId: 's-source',
    newRootSessionId: 's-a',
    snapshotAt: 1,
    nodeMapping: [{ sourceSessionId: 's-source', newSessionId: 's-a' }],
  })
  await manager.deleteComposition('s-a')
  const clones = await store.listClones('s-a')
  assert.equal(clones.length, 1)
  assert.equal(clones[0][1].status, 'orphaned')
  assert.equal(typeof clones[0][1].orphanedAt, 'number')
})

test('deleting a composition removes its stored policy', async () => {
  const store = fakeStore()
  const manager = createManager({ store, discovery: fakeDiscovery(['s-a', 's-b']) })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  let state = await manager.state('s-a')
  const edge = state.composition.edges[0]
  await manager.setEdgeGrant('s-a', edge.id, { allowInterrupt: true })
  assert.ok(await store.getPolicy('s-a'))
  await manager.deleteComposition('s-a')
  assert.equal(await store.getPolicy('s-a'), undefined)
})

test('moves tasks with their subtree across compositions', async () => {
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['t-root', 's-root', 'b']) })
  await manager.create('t-root')
  await manager.create('s-root')
  const tRoot = (await manager.state('t-root')).composition.nodes[0]
  const sRoot = (await manager.state('s-root')).composition.nodes[0]
  await manager.addNode('s-root', { sessionId: 'b', parentId: sRoot.id })
  const b = (await manager.state('s-root')).composition.nodes.find((node) => node.sessionId === 'b')
  await manager.createTask('s-root', { subject: 'Moved work', ownerNodeId: b.id })

  await manager.addNode('t-root', { sessionId: 'b', parentId: tRoot.id })
  const targetTasks = await manager.getTasks('t-root')
  assert.equal(targetTasks.some((task) => task.subject === 'Moved work'), true)
  assert.equal(targetTasks.find((task) => task.subject === 'Moved work').rootSessionId, 't-root')
  assert.equal((await manager.getTasks('s-root')).some((task) => task.subject === 'Moved work'), false)
})

test('sync-native does not hold the root lock while reading the native tree', async () => {
  const discovery = fakeDiscovery(['s-a', 's-b'])
  let releaseTree
  let treeCalls = 0
  const gate = new Promise((resolve) => { releaseTree = resolve })
  discovery.listTree = async () => {
    treeCalls += 1
    if (treeCalls === 1) return { available: true, children: [] }
    await gate
    return { available: true, children: [] }
  }
  const manager = createManager({ store: fakeStore(), discovery })
  await manager.create('s-a')
  const syncing = manager.syncNativeTree('s-a')
  const added = await Promise.race([
    manager.addNode('s-a', { sessionId: 's-b' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('add waited for native tree I/O')), 500)),
  ])
  assert.equal(added.composition.nodes.some((node) => node.sessionId === 's-b'), true)
  releaseTree()
  await syncing
})

test('auto-attach does not hold the root lock while describing the child', async () => {
  const discovery = fakeDiscovery(['s-a', 's-b', 's-c'])
  const summaries = new Map(['s-a', 's-b', 's-c'].map((id) => [id, summary(id, id)]))
  const gate = Promise.withResolvers()
  discovery.describe = async (sessionId) => {
    if (sessionId === 's-b') await gate.promise
    return summaries.get(sessionId) ?? null
  }
  const manager = createManager({ store: fakeStore(), discovery })
  await manager.create('s-a')
  const attaching = manager.autoAttach('s-a', { childId: 's-b', local: true, label: 'Child' })
  await new Promise((resolve) => setTimeout(resolve, 10))
  const added = await Promise.race([
    manager.addNode('s-a', { sessionId: 's-c' }),
    new Promise((_, reject) => setTimeout(() => reject(new Error('add waited for auto-attach describe')), 500)),
  ])
  assert.equal(added.composition.nodes.some((node) => node.sessionId === 's-c'), true)
  gate.resolve()
  const attached = await attaching
  assert.equal(attached.composition.nodes.some((node) => node.sessionId === 's-b'), true)
})

test('skips malformed composition records when building membership', async () => {
  const store = fakeStore()
  await store.put('bad-root', { composition: { nodes: 5 }, updatedAt: 1 })
  const warnings = []
  const manager = createManager({
    store,
    discovery: fakeDiscovery(),
    logger: { warn(...args) { warnings.push(args) } },
  })
  assert.equal(await manager.resolveSession('s-a'), null)
  assert.ok(warnings.some((entry) => entry[0].includes('malformed nodes')))
})

test('create and add-node re-check membership under the composition lock', async () => {
  const data = new Map()
  const policies = new Map()
  const tasks = new Map()
  let generation = 0
  let inject = null
  const store = {
    mode: 'memory',
    get generation() {
      return generation
    },
    async refresh() {},
    async withMutationLock(task) {
      if (inject !== null) {
        const run = inject
        inject = null
        run()
        generation += 1
      }
      return task()
    },
    async get(key) { return data.get(key) },
    async put(key, value) { data.set(key, value) },
    async delete(key) { data.delete(key) },
    async list() { return [...data.entries()] },
    async getPolicy(key) { return policies.get(key) },
    async putPolicy(key, value) { policies.set(key, value) },
    async deletePolicy(key) { policies.delete(key) },
    async appendAudit() {},
    async listAudit() { return [] },
    async getTask(key) { return tasks.get(key) },
    async putTask(key, value) { tasks.set(key, value) },
    async deleteTask(key) { tasks.delete(key) },
    async listTasks(rootSessionId) {
      return [...tasks.entries()].filter(([, task]) => task.rootSessionId === rootSessionId)
    },
  }
  const ids = ['a', 'b', 's-b', 's-c']
  const discovery = {
    async describe(sessionId) {
      return ids.includes(sessionId) ? summary(sessionId, sessionId) : null
    },
    async describeHeader(sessionId) {
      return ids.includes(sessionId) ? summary(sessionId, sessionId) : null
    },
    async listTree() {
      return { available: true, children: [] }
    },
  }
  const otherComposition = (root, child) => createComposition({
    title: root,
    rootSessionId: root,
    nodes: [
      { id: `n-${root}`, sessionId: root, label: root, kind: 'session', source: 'top-level' },
      { id: `n-${child}`, sessionId: child, label: child, kind: 'session', source: 'top-level' },
    ],
    edges: [{ id: `e-${root}-${child}`, parentId: `n-${root}`, childId: `n-${child}`, role: 'reports-to' }],
  })

  const addManager = createManager({ store, discovery })
  await addManager.create('a')
  inject = () => data.set('b', { composition: otherComposition('b', 's-b'), updatedAt: 1 })
  await rejectsWithCode(addManager.addNode('a', { sessionId: 's-b' }), 'SESSION_ALREADY_COMPOSED')
  assert.equal((await addManager.state('a')).composition.nodes.some((node) => node.sessionId === 's-b'), false)

  data.clear()
  policies.clear()
  generation = 0
  inject = null
  const createManagerInstance = createManager({ store, discovery })
  await createManagerInstance.create('a')
  inject = () => data.set('b', { composition: otherComposition('b', 's-c'), updatedAt: 1 })
  const created = await createManagerInstance.create('s-c')
  assert.equal(created.composition.rootSessionId, 'b')
  assert.equal(await store.get('s-c'), undefined)
})

test('preserves edge grants when a subtree moves across compositions', async () => {
  const manager = createManager({
    store: fakeStore(),
    discovery: fakeDiscovery(['s-a', 's-b', 's-c', 's-d', 's-e']),
  })
  await manager.create('s-a')
  const aRoot = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: aRoot.id })
  const aState = await manager.state('s-a')
  const b = aState.composition.nodes.find((node) => node.sessionId === 's-b')
  await manager.addNode('s-a', { sessionId: 's-c', parentId: b.id })
  let state = await manager.state('s-a')
  const c = state.composition.nodes.find((node) => node.sessionId === 's-c')
  const oldBoundary = state.composition.edges.find((edge) => edge.childId === b.id)
  const internal = state.composition.edges.find((edge) => edge.childId === c.id)
  await manager.setEdgeGrant('s-a', oldBoundary.id, { allowMessage: false, allowInterrupt: false })
  await manager.setEdgeGrant('s-a', internal.id, { allowMessage: true, allowInterrupt: true })

  // An auto-mirrored node has no grant (deny). Moving it must not silently
  // create the manual-connection default.
  await manager.autoAttach('s-a', { childId: 's-e', local: true, provider: 'spawn', label: 'Mirrored' })

  await manager.create('s-d')
  const dRoot = (await manager.state('s-d')).composition.nodes[0]
  await manager.addNode('s-d', { sessionId: 's-b', parentId: dRoot.id })

  state = await manager.state('s-d')
  const b2 = state.composition.nodes.find((node) => node.sessionId === 's-b')
  const c2 = state.composition.nodes.find((node) => node.sessionId === 's-c')
  const newBoundary = state.composition.edges.find((edge) => edge.childId === b2.id)
  const newInternal = state.composition.edges.find((edge) => edge.childId === c2.id)
  const grants = await manager.getGrants('s-d')
  assert.deepEqual(grants[newBoundary.id], { allowMessage: false, allowInterrupt: false })
  assert.deepEqual(grants[newInternal.id], { allowMessage: true, allowInterrupt: true })
  assert.equal(newBoundary.id === oldBoundary.id, false)
  assert.equal(newInternal.id, internal.id)

  const e = (await manager.state('s-a')).composition.nodes.find((node) => node.sessionId === 's-e')
  await manager.addNode('s-d', { sessionId: 's-e', parentId: dRoot.id })
  state = await manager.state('s-d')
  const e2 = state.composition.nodes.find((node) => node.sessionId === 's-e')
  const eEdge = state.composition.edges.find((edge) => edge.childId === e2.id)
  assert.equal((await manager.getGrants('s-d'))[eEdge.id].allowMessage, false)
  assert.ok(e)
})

test('moving a task between compositions removes it from the source on the real store', async () => {
  const store = createStore({ get: () => undefined, logger: { info() {}, warn() {} } })
  await store.ready
  const manager = createManager({ store, discovery: fakeDiscovery(['t-root', 's-root', 'b']) })
  await manager.create('t-root')
  await manager.create('s-root')
  const tRoot = (await manager.state('t-root')).composition.nodes[0]
  const sRoot = (await manager.state('s-root')).composition.nodes[0]
  await manager.addNode('s-root', { sessionId: 'b', parentId: sRoot.id })
  const b = (await manager.state('s-root')).composition.nodes.find((node) => node.sessionId === 'b')
  await manager.createTask('s-root', { subject: 'Moved work', ownerNodeId: b.id })
  assert.equal((await manager.getTasks('s-root')).length, 1)

  await manager.addNode('t-root', { sessionId: 'b', parentId: tRoot.id })
  assert.equal((await manager.getTasks('s-root')).length, 0)
  assert.equal((await manager.getTasks('t-root')).length, 1)
  await store.close()
})
