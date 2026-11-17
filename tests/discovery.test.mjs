import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createDiscovery } from '../src/discovery.js'

function header(id, extra = {}) {
  return { id, ...extra }
}

test('describes a live session without writing any session state', async () => {
  const writes = []
  const live = { header: header('s-a', { parentSession: 's-parent', agentPreset: 'default' }) }
  const ctx = {
    get(name) {
      if (name === 'sessions') {
        return {
          get: (id) => (id === 's-a' ? live : undefined),
          list: () => [live],
        }
      }
      if (name === 'workingDirectory') {
        return {
          get: () => '/work/effective',
          set: () => {
            writes.push('workingDirectory.set')
          },
        }
      }
      if (name === 'permissionPresets') {
        return {
          current: () => 'default',
          set: () => {
            writes.push('permissionPresets.set')
          },
        }
      }
      if (name === 'sandboxPolicy') {
        return {
          resolve: () => ({ mode: 'read-only' }),
          registerWritableRoot: () => {
            writes.push('sandboxPolicy.registerWritableRoot')
          },
        }
      }
      if (name === 'approval') {
        return { overrideOf: () => 'never' }
      }
      return undefined
    },
    logger: { warn() {} },
  }
  const discovery = createDiscovery(ctx)
  const summary = await discovery.describe('s-a')
  assert.equal(summary.sessionId, 's-a')
  assert.equal(summary.cwd, '/work/effective')
  assert.equal(summary.source, 'top-level')
  assert.equal(summary.nativeParentSessionId, 's-parent')
  assert.equal(summary.agentPreset, 'default')
  assert.equal(summary.sandboxMode, 'read-only')
  assert.equal(summary.permissionPreset, 'default')
  assert.equal(summary.approvalPolicy, 'never')
  assert.equal(summary.live, true)

  const listed = await discovery.list()
  assert.equal(listed.complete, false)
  assert.equal(listed.sessions.length, 1)
  assert.deepEqual(writes, [])
})

test('uses sessionQuery for persisted headers and titles', async () => {
  const persisted = header('s-b', { cwd: '/work/b', origin: 'subagent', parentSession: 's-a' })
  const ctx = {
    get(name) {
      if (name === 'sessions') return { get: () => undefined, list: () => [] }
      if (name === 'sessionQuery') {
        return {
          async listSessions() {
            return [{ header: persisted, live: false, persisted: true }]
          },
          async readTitleSnapshots(ids) {
            return ids.map((sessionId) => ({
              sessionId,
              status: 'fulfilled',
              value: { session: persisted, title: { title: 'Persisted agent' } },
            }))
          },
          async readTitleSnapshot(sessionId) {
            if (sessionId !== 's-b') throw new Error('missing session')
            return { session: persisted, title: { title: 'Persisted agent' } }
          },
        }
      }
      return undefined
    },
    logger: { warn() {} },
  }
  const discovery = createDiscovery(ctx)
  const listed = await discovery.list()
  assert.equal(listed.complete, true)
  assert.equal(listed.sessions[0].title, 's-b')
  assert.equal(listed.sessions[0].persisted, true)
  assert.equal(listed.sessions[0].source, 'subagent')
  const folded = await discovery.titles(['s-b'])
  assert.equal(folded['s-b'], 'Persisted agent')

  const described = await discovery.describe('s-b')
  assert.equal(described.title, 'Persisted agent')
  assert.equal(described.live, false)
  assert.equal(await discovery.isKnownSession('s-b'), true)
  assert.equal(await discovery.isKnownSession('s-missing'), false)
})

test('filters the session corpus by a literal query', async () => {
  const headers = [
    header('s-a', { cwd: '/work/alpha' }),
    header('s-b', { cwd: '/work/beta' }),
  ]
  const ctx = {
    get(name) {
      if (name === 'sessionQuery') {
        return {
          async listSessions() {
            return headers.map((entry) => ({ header: entry, live: true, persisted: true }))
          },
          async readTitleSnapshots(ids) {
            return ids.map((sessionId) => ({
              sessionId,
              status: 'fulfilled',
              value: { session: headers.find((entry) => entry.id === sessionId), title: { title: sessionId } },
            }))
          },
        }
      }
      return undefined
    },
    logger: { warn() {} },
  }
  const discovery = createDiscovery(ctx)
  const result = await discovery.list({ query: 'beta' })
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ['s-b'])
})

test('lists external and one-shot leaves from the native catalogs', async () => {
  const ctx = {
    get(name) {
      if (name === 'subagents') {
        return {
          async listDescendants(rootId) {
            assert.equal(rootId, 's-a')
            return [
              { kind: 'child', id: 's-ext', parentId: 's-a', depth: 1, mode: 'external', label: 'ACP agent', activity: 'inactive' },
              { kind: 'child', id: 's-cont', parentId: 's-a', depth: 1, mode: 'continuable', label: 'Worker', activity: 'running' },
              { kind: 'child', id: 's-one', parentId: 's-a', depth: 1, mode: 'one-shot', label: 'One shot', activity: 'inactive' },
              { kind: 'diagnostic', id: 's-bad', reason: 'corrupt' },
            ]
          },
        }
      }
      if (name === 'sessions') return { get: () => undefined, list: () => [] }
      return undefined
    },
    logger: { warn() {} },
  }
  const discovery = createDiscovery(ctx)
  const result = await discovery.listNative('s-a')
  assert.equal(result.available, true)
  assert.deepEqual(result.leaves.map((leaf) => leaf.externalId), ['s-ext', 's-one'])
  assert.equal(result.leaves[0].label, 'ACP agent')
  assert.equal(result.leaves[0].nativeParentSessionId, 's-a')
  assert.deepEqual(result.diagnostics, [{ id: 's-bad', reason: 'corrupt' }])

  const unavailable = createDiscovery({ get: () => undefined, logger: { warn() {} } })
  assert.deepEqual(await unavailable.listNative('s-a'), { available: false, leaves: [], diagnostics: [], count: 0 })
})

test('keeps active sessions live and only marks the registry archive set archived', async () => {
  const ctx = {
    get(name) {
      if (name === 'workspaceRegistry') return { archivedSessionIds: ['s-archived'] }
      if (name === 'sessions') return { get: () => undefined, list: () => [] }
      if (name === 'sessionQuery') {
        return {
          async listSessions() {
            return [
              { header: { id: 's-live' }, live: true, persisted: true },
              { header: { id: 's-archived' }, live: false, persisted: true },
              { header: { id: 's-saved' }, live: false, persisted: true },
            ]
          },
          async readTitleSnapshots(ids) {
            return ids.map((sessionId) => ({
              sessionId,
              status: 'fulfilled',
              value: { session: { id: sessionId }, title: { title: sessionId } },
            }))
          },
          async readTitleSnapshot(sessionId) {
            return { session: { id: sessionId }, title: { title: sessionId } }
          },
        }
      }
      return undefined
    },
    logger: { warn() {} },
  }
  const discovery = createDiscovery(ctx)
  const result = await discovery.list()
  const byId = new Map(result.sessions.map((session) => [session.sessionId, session]))
  assert.equal(byId.get('s-live').live, true)
  assert.equal(byId.get('s-live').archived, false)
  assert.equal(byId.get('s-archived').archived, true)
  assert.equal(byId.get('s-saved').live, false)
  assert.equal(byId.get('s-saved').archived, false)
})

test('describeMany uses metadata live flags without folding titles', async () => {
  const ctx = {
    get(name) {
      if (name === 'workspaceRegistry') return { archivedSessionIds: ['s-b'] }
      if (name === 'sessions') return { get: () => undefined, list: () => [] }
      if (name === 'sessionQuery') {
        return {
          async filterSessions() {
            return [
              { header: { id: 's-a' }, live: true, persisted: true },
              { header: { id: 's-b' }, live: false, persisted: true },
            ]
          },
        }
      }
      return undefined
    },
    logger: { warn() {} },
  }
  const discovery = createDiscovery(ctx)
  const result = await discovery.describeMany(['s-a', 's-b'])
  assert.equal(result['s-a'].live, true)
  assert.equal(result['s-a'].archived, false)
  assert.equal(result['s-b'].live, false)
  assert.equal(result['s-b'].archived, true)
})

test('caches native catalog walks and invalidates them explicitly', async () => {
  let walks = 0
  const ctx = {
    get(name) {
      if (name === 'subagents') {
        return {
          async listDescendants() {
            walks += 1
            return [{ kind: 'child', id: 's-b', parentId: 's-a', depth: 1, mode: 'continuable', label: 'Worker', activity: 'inactive' }]
          },
        }
      }
      return undefined
    },
    logger: { warn() {} },
  }
  const discovery = createDiscovery(ctx)
  assert.equal((await discovery.countNative('s-a')).count, 1)
  assert.equal((await discovery.countNative('s-a')).count, 1)
  assert.equal(walks, 1)
  discovery.invalidateNative('s-a')
  assert.equal((await discovery.countNative('s-a')).count, 1)
  assert.equal(walks, 2)
})

test('describeMany reuses the corpus cache instead of filterSessions', async () => {
  let filters = 0
  const persisted = { id: 's-b', cwd: '/work/b' }
  const ctx = {
    get(name) {
      if (name === 'sessions') return { get: () => undefined, list: () => [] }
      if (name === 'sessionQuery') {
        return {
          async listSessions() {
            return [{ header: persisted, live: false, persisted: true }]
          },
          async filterSessions() {
            filters += 1
            return [{ header: persisted, live: false, persisted: true }]
          },
        }
      }
      return undefined
    },
    logger: { warn() {} },
  }
  const discovery = createDiscovery(ctx)
  await discovery.list()
  const result = await discovery.describeMany(['s-b'])
  assert.equal(result['s-b'].sessionId, 's-b')
  assert.equal(filters, 0)
  const cached = await discovery.describeMany(['s-b'])
  assert.equal(cached['s-b'].sessionId, 's-b')
  assert.equal(filters, 0)
})
