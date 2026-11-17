import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createComposition } from '../src/graph.js'
import { createManager } from '../src/manager.js'

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
  ]
  const manager = createManager({ store: fakeStore(), discovery: fakeDiscovery(['s-a', 's-b', 's-c'], tree) })
  const record = await manager.create('s-a')
  const composition = record.composition
  assert.equal(composition.nodes.filter((node) => node.sessionId !== null).length, 3)
  assert.equal(composition.nodes.filter((node) => node.kind === 'external').length, 1)
  const b = composition.nodes.find((node) => node.sessionId === 's-b')
  const c = composition.nodes.find((node) => node.sessionId === 's-c')
  const root = composition.nodes.find((node) => node.sessionId === 's-a')
  assert.ok(composition.edges.some((edge) => edge.parentId === b.id && edge.childId === c.id))
  const nativeEdge = composition.edges.find((edge) => edge.parentId === root.id && edge.childId === b.id)
  assert.deepEqual((await manager.getGrants('s-a'))[nativeEdge.id], { allowMessage: false, allowInterrupt: false })
  assert.equal((await manager.authorizeMessage('s-a', root.id, b.id)).allowed, false)
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
  await rejectsWithCode(
    manager.updateTask('s-a', { taskId: userTask.id, expectedRevision: 1, action: 'delete', actor: 's-a' }),
    'TASK_FORBIDDEN',
  )
  const remaining = await manager.updateTask('s-a', {
    taskId: userTask.id,
    expectedRevision: 1,
    action: 'delete',
    actor: 'user',
  })
  assert.equal(remaining.some((entry) => entry.id === userTask.id), false)
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
