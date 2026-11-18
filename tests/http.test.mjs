import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'

import { CompositionError } from '../src/graph.js'
import { createApi, createNodeHandler, isLoopback, MAX_BODY_BYTES, TOKEN_HEADER } from '../src/http.js'
import { createManager } from '../src/manager.js'

const TOKEN = 'test-token'
const LOCAL_PORT = 60601

function summary(sessionId, title) {
  return {
    sessionId,
    title,
    cwd: `/work/${sessionId}`,
    source: 'top-level',
    nativeParentSessionId: null,
    agentPreset: null,
    live: true,
    persisted: true,
  }
}

function makeHarness({ running = new Set(), cloneManager = undefined } = {}) {
  const data = new Map()
  const policies = new Map()
  const tasks = new Map()
  const store = {
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
  const summaries = new Map([
    ['s-a', summary('s-a', 'Lead')],
    ['s-b', summary('s-b', 'Reviewer')],
    ['s-c', summary('s-c', 'Checker')],
  ])
  const discovery = {
    async describe(sessionId) {
      return summaries.get(sessionId) ?? null
    },
    async describeMany(ids) {
      const result = {}
      for (const id of ids) {
        const value = summaries.get(id)
        if (value !== undefined) result[id] = value
      }
      return result
    },
    async list(request = {}) {
      const text = (request.query ?? '').toLowerCase()
      const sessions = [...summaries.values()].filter((session) => `${session.title} ${session.sessionId} ${session.cwd ?? ''}`
        .toLowerCase()
        .includes(text))
      return { sessions, complete: true }
    },
    async listNative(rootSessionId) {
      return {
        available: true,
        leaves: [{
          externalId: 'external-1',
          label: 'ACP helper',
          mode: 'external',
          nativeParentSessionId: rootSessionId,
          depth: 1,
          path: null,
          activity: 'inactive',
        }],
        diagnostics: [],
      }
    },
    async countNative() {
      return { available: true, count: 2 }
    },
    async listTree() {
      return { available: true, children: [] }
    },
  }
  const manager = createManager({
    store,
    discovery,
    agents: () => ({ get: (id) => ({ status: running.has(id) ? 'running' : 'idle' }) }),
  })
  const api = createApi({ manager, discovery, cloneManager, token: TOKEN, version: '0.1.0', platform: 'test' })
  return { api, manager, running }
}

async function call(api, request = {}) {
  const headers = { host: `127.0.0.1:${LOCAL_PORT}`, ...(request.headers ?? {}) }
  const response = await api.handle({
    method: request.method ?? 'GET',
    url: request.url ?? '/dsh-combinagents/bootstrap',
    headers,
    body: request.body ?? '',
    remoteAddress: request.remoteAddress ?? '127.0.0.1',
    localPort: request.localPort ?? LOCAL_PORT,
    secure: request.secure === true,
  })
  return { status: response.status, headers: response.headers, data: JSON.parse(response.body) }
}

function authorized(method, url, body) {
  return {
    method,
    url,
    body,
    headers: {
      [TOKEN_HEADER]: TOKEN,
      'content-type': 'application/json',
    },
  }
}

test('bootstrap returns the token and rejects non-loopback peers', async () => {
  const { api } = makeHarness()
  assert.equal(isLoopback('127.0.0.1'), true)
  assert.equal(isLoopback('::1'), true)
  assert.equal(isLoopback('::ffff:127.0.0.1'), true)
  assert.equal(isLoopback('10.0.0.7'), false)

  const ok = await call(api)
  assert.equal(ok.status, 200)
  assert.equal(ok.data.token, TOKEN)
  assert.equal(ok.data.supported, true)

  const remote = await call(api, { remoteAddress: '10.0.0.7' })
  assert.equal(remote.status, 403)
  assert.equal(remote.data.error.code, 'FORBIDDEN')

  const rebound = await call(api, { headers: { host: 'evil.example:60601' } })
  assert.equal(rebound.status, 403)
  assert.match(rebound.data.error.message, /Host/)
  const wrongPort = await call(api, { headers: { host: '127.0.0.1:60602' } })
  assert.equal(wrongPort.status, 403)
  const crossSite = await call(api, { headers: { origin: 'https://evil.example' } })
  assert.equal(crossSite.status, 403)
  assert.match(crossSite.data.error.message, /Origin/)
  const nullOrigin = await call(api, { headers: { origin: 'null' } })
  assert.equal(nullOrigin.status, 403)
  const foreignOrigin = await call(api, { headers: { origin: 'http://10.0.0.7:60601' } })
  assert.equal(foreignOrigin.status, 403)
  const sameOrigin = await call(api, { headers: { origin: `http://127.0.0.1:${LOCAL_PORT}` } })
  assert.equal(sameOrigin.status, 200)
  const localhost = await call(api, { headers: { host: `localhost:${LOCAL_PORT}` } })
  assert.equal(localhost.status, 200)
})

test('requires the token outside bootstrap', async () => {
  const { api } = makeHarness()
  const missing = await call(api, { url: '/dsh-combinagents/state?rootSessionId=s-a' })
  assert.equal(missing.status, 401)
  const wrong = await call(api, {
    url: '/dsh-combinagents/state?rootSessionId=s-a',
    headers: { [TOKEN_HEADER]: 'wrong' },
  })
  assert.equal(wrong.status, 401)
  const crossSite = await call(api, {
    url: '/dsh-combinagents/state?rootSessionId=s-a',
    headers: { [TOKEN_HEADER]: TOKEN, origin: 'https://evil.example' },
  })
  assert.equal(crossSite.status, 403)
})

test('creates a composition and returns observed nodes', async () => {
  const { api } = makeHarness()
  const created = await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  assert.equal(created.status, 200)
  assert.equal(created.data.composition.rootSessionId, 's-a')
  assert.equal(created.data.composition.nodes.length, 1)

  const state = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-a'))
  assert.equal(state.status, 200)
  assert.equal(state.data.observations['s-a'].title, 'Lead')
  assert.equal(state.data.storage, 'memory')
})

test('adds and removes nodes, protecting the root-session node', async () => {
  const { api } = makeHarness()
  await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  const state = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-a'))
  const root = state.data.composition.nodes[0]

  const added = await call(api, authorized('POST', '/dsh-combinagents/add-node', JSON.stringify({
    rootSessionId: 's-a',
    sessionId: 's-b',
    parentId: root.id,
  })))
  assert.equal(added.status, 200)
  assert.equal(added.data.composition.nodes.length, 2)
  const b = added.data.composition.nodes.find((node) => node.sessionId === 's-b')

  const protectedRoot = await call(api, authorized('POST', '/dsh-combinagents/remove-node', JSON.stringify({
    rootSessionId: 's-a',
    nodeId: root.id,
    mode: 'cascade',
  })))
  assert.equal(protectedRoot.status, 403)
  assert.equal(protectedRoot.data.error.code, 'ROOT_PROTECTED')

  const removed = await call(api, authorized('POST', '/dsh-combinagents/remove-node', JSON.stringify({
    rootSessionId: 's-a',
    nodeId: b.id,
    mode: 'cascade',
  })))
  assert.equal(removed.status, 200)
  assert.equal(removed.data.composition.nodes.length, 1)
})

test('validates JSON, body size, route, and method', async () => {
  const { api } = makeHarness()
  const malformed = await call(api, authorized('POST', '/dsh-combinagents/create', '{'))
  assert.equal(malformed.status, 400)
  assert.equal(malformed.data.error.code, 'INVALID_JSON')

  const oversized = await call(api, authorized('POST', '/dsh-combinagents/create', 'x'.repeat(MAX_BODY_BYTES + 1)))
  assert.equal(oversized.status, 413)

  const unknown = await call(api, authorized('GET', '/dsh-combinagents/nope'))
  assert.equal(unknown.status, 404)

  const wrongMethod = await call(api, authorized('GET', '/dsh-combinagents/create'))
  assert.equal(wrongMethod.status, 405)
})

test('renames a composition title through the bridge', async () => {
  const { api } = makeHarness()
  await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  const renamed = await call(api, authorized('POST', '/dsh-combinagents/set-title', JSON.stringify({
    rootSessionId: 's-a',
    title: 'Review team',
  })))
  assert.equal(renamed.status, 200)
  assert.equal(renamed.data.composition.title, 'Review team')

  const state = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-a'))
  assert.equal(state.data.composition.title, 'Review team')

  const invalid = await call(api, authorized('POST', '/dsh-combinagents/set-title', JSON.stringify({
    rootSessionId: 's-a',
    title: '   ',
  })))
  assert.equal(invalid.status, 400)
  assert.equal(invalid.data.error.code, 'INVALID_FIELD')
})

test('wires clone-tree and bud routes to the clone adapter', async () => {
  const calls = []
  const cloneManager = {
    async cloneTree(rootSessionId) {
      calls.push(['clone', rootSessionId])
      return { clone: { newRootSessionId: 'session-clone' }, composition: { rootSessionId: 'session-clone' }, tasks: [] }
    },
    async bud(rootSessionId, nodeId) {
      calls.push(['bud', rootSessionId, nodeId])
      return { clone: { newRootSessionId: 'session-bud' }, composition: { rootSessionId: 'session-bud' }, tasks: [] }
    },
  }
  const { api } = makeHarness({ cloneManager })
  const clone = await call(api, authorized('POST', '/dsh-combinagents/clone-tree', JSON.stringify({ rootSessionId: 's-a' })))
  assert.equal(clone.status, 200)
  assert.equal(clone.data.clone.newRootSessionId, 'session-clone')
  const bud = await call(api, authorized('POST', '/dsh-combinagents/bud', JSON.stringify({ rootSessionId: 's-a', nodeId: 'n-b' })))
  assert.equal(bud.status, 200)
  assert.equal(bud.data.clone.newRootSessionId, 'session-bud')
  assert.deepEqual(calls, [['clone', 's-a'], ['bud', 's-a', 'n-b']])
})

test('maps a concurrent clone to 409', async () => {
  const cloneManager = {
    async cloneTree() {
      throw new CompositionError('CLONE_IN_PROGRESS', 'another clone is running')
    },
  }
  const { api } = makeHarness({ cloneManager })
  const response = await call(api, authorized('POST', '/dsh-combinagents/clone-tree', JSON.stringify({ rootSessionId: 's-a' })))
  assert.equal(response.status, 409)
  assert.equal(response.data.error.code, 'CLONE_IN_PROGRESS')
})

test('lists sessions and deletes a composition', async () => {
  const { api } = makeHarness()
  const sessions = await call(api, authorized('GET', '/dsh-combinagents/sessions?query=review'))
  assert.equal(sessions.status, 200)
  assert.equal(sessions.data.sessions[0].sessionId, 's-b')

  await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  const deleted = await call(api, authorized('POST', '/dsh-combinagents/delete-composition', JSON.stringify({ rootSessionId: 's-a' })))
  assert.equal(deleted.status, 200)
  const state = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-a'))
  assert.equal(state.data.composition, null)
})

test('maps graph rejections to stable status codes', async () => {
  const { api } = makeHarness()
  const missing = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-missing'))
  assert.equal(missing.status, 200)
  assert.equal(missing.data.composition, null)

  const noComposition = await call(api, authorized('POST', '/dsh-combinagents/add-node', JSON.stringify({
    rootSessionId: 's-missing',
    sessionId: 's-b',
  })))
  assert.equal(noComposition.status, 404)
  assert.equal(noComposition.data.error.code, 'COMPOSITION_NOT_FOUND')
})

test('adds external leaves, renames nodes, and reparents them', async () => {
  const { api } = makeHarness()
  await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  let state = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-a'))
  const root = state.data.composition.nodes[0]

  const external = await call(api, authorized('POST', '/dsh-combinagents/add-external', JSON.stringify({
    rootSessionId: 's-a',
    label: 'ACP helper',
    provider: 'external',
    nativeParentSessionId: 's-a',
    parentId: root.id,
  })))
  assert.equal(external.status, 200)
  const ext = external.data.composition.nodes.find((node) => node.kind === 'external')
  assert.equal(ext.sessionId, null)

  const renamed = await call(api, authorized('POST', '/dsh-combinagents/rename-node', JSON.stringify({
    rootSessionId: 's-a',
    nodeId: ext.id,
    label: 'Renamed helper',
  })))
  assert.equal(renamed.status, 200)
  assert.ok(renamed.data.composition.nodes.some((node) => node.id === ext.id && node.label === 'Renamed helper'))

  const moved = await call(api, authorized('POST', '/dsh-combinagents/set-parent', JSON.stringify({
    rootSessionId: 's-a',
    nodeId: ext.id,
    parentId: null,
  })))
  assert.equal(moved.status, 200)
  assert.ok(!moved.data.composition.edges.some((edge) => edge.childId === ext.id))

  state = await call(api, authorized('GET', '/dsh-combinagents/external?rootSessionId=s-a'))
  assert.equal(state.status, 200)
  assert.equal(state.data.available, true)
  assert.equal(state.data.leaves[0].label, 'ACP helper')
})

test('discovers an external leaf and attaches it through the bridge', async () => {
  const { api } = makeHarness()
  await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  const created = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-a'))
  const root = created.data.composition.nodes[0]

  const listed = await call(api, authorized('GET', '/dsh-combinagents/external?rootSessionId=s-a'))
  assert.equal(listed.status, 200)
  const leaf = listed.data.leaves[0]
  assert.equal(leaf.mode, 'external')

  const added = await call(api, authorized('POST', '/dsh-combinagents/add-external', JSON.stringify({
    rootSessionId: 's-a',
    label: leaf.label,
    provider: leaf.mode,
    nativeParentSessionId: leaf.nativeParentSessionId,
    parentId: root.id,
  })))
  assert.equal(added.status, 200)
  const external = added.data.composition.nodes.find((node) => node.kind === 'external')
  assert.equal(external.label, 'ACP helper')
  assert.equal(external.provider, 'external')
  assert.equal(external.nativeParentSessionId, 's-a')
  assert.ok(added.data.composition.edges.some((edge) => edge.parentId === root.id && edge.childId === external.id))
})

test('resolves state and summary from a member session', async () => {
  const { api } = makeHarness()
  const created = await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  const root = created.data.composition.nodes[0]
  await call(api, authorized('POST', '/dsh-combinagents/add-node', JSON.stringify({
    rootSessionId: 's-a',
    sessionId: 's-b',
    parentId: root.id,
  })))

  const state = await call(api, authorized('GET', '/dsh-combinagents/state?sessionId=s-b'))
  assert.equal(state.status, 200)
  assert.equal(state.data.rootSessionId, 's-a')
  assert.equal(state.data.composition.nodes.length, 2)

  const summary = await call(api, authorized('GET', '/dsh-combinagents/summary?sessionId=s-b'))
  assert.equal(summary.status, 200)
  assert.equal(summary.data.rootSessionId, 's-a')
  assert.equal(summary.data.compositionNodes, 2)
  assert.equal(summary.data.subagents, null)
  assert.equal(summary.data.nativeSubagents, null)
})

test('returns 409 while an affected branch is running', async () => {
  const running = new Set()
  const { api } = makeHarness({ running })
  const created = await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  const root = created.data.composition.nodes[0]
  await call(api, authorized('POST', '/dsh-combinagents/add-node', JSON.stringify({
    rootSessionId: 's-a',
    sessionId: 's-b',
    parentId: root.id,
  })))
  running.add('s-b')
  const blocked = await call(api, authorized('POST', '/dsh-combinagents/add-node', JSON.stringify({
    rootSessionId: 's-a',
    sessionId: 's-c',
    parentId: root.id,
  })))
  assert.equal(blocked.status, 409)
  assert.equal(blocked.data.error.code, 'AGENT_BUSY')
})

test('stores per-edge grants and exposes them on state', async () => {
  const { api } = makeHarness()
  const created = await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  const root = created.data.composition.nodes[0]
  const added = await call(api, authorized('POST', '/dsh-combinagents/add-node', JSON.stringify({
    rootSessionId: 's-a',
    sessionId: 's-b',
    parentId: root.id,
  })))
  const edge = added.data.composition.edges[0]
  let state = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-a'))
  assert.equal(state.data.grants[edge.id].allowMessage, true)
  assert.equal(state.data.grants[edge.id].allowInterrupt, false)

  const updated = await call(api, authorized('POST', '/dsh-combinagents/set-grant', JSON.stringify({
    rootSessionId: 's-a',
    edgeId: edge.id,
    allowMessage: true,
    allowInterrupt: true,
  })))
  assert.equal(updated.status, 200)
  assert.equal(updated.data.grants[edge.id].allowMessage, true)

  state = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-a'))
  assert.equal(state.data.grants[edge.id].allowInterrupt, true)
  const grants = await call(api, authorized('GET', '/dsh-combinagents/grants?rootSessionId=s-a'))
  assert.equal(grants.data.grants[edge.id].allowMessage, true)
})

test('moves another composition root under a target node through add-node', async () => {
  const { api } = makeHarness()
  const a = await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  const aRoot = a.data.composition.nodes[0]
  await call(api, authorized('POST', '/dsh-combinagents/add-node', JSON.stringify({
    rootSessionId: 's-a',
    sessionId: 's-b',
    parentId: aRoot.id,
  })))
  const c = await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-c' })))
  const cRoot = c.data.composition.nodes[0]

  const moved = await call(api, authorized('POST', '/dsh-combinagents/add-node', JSON.stringify({
    rootSessionId: 's-a',
    sessionId: 's-c',
    parentId: aRoot.id,
  })))
  assert.equal(moved.status, 200)
  assert.equal(moved.data.composition.nodes.length, 3)
  assert.ok(moved.data.composition.edges.some(
    (edge) => edge.parentId === aRoot.id && edge.childId === cRoot.id,
  ))
  const source = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-c'))
  assert.equal(source.data.rootSessionId, 's-a')
  assert.equal(source.data.composition.nodes.length, 3)
})

test('creates and transitions plugin-owned tasks with revision conflicts', async () => {
  const { api } = makeHarness()
  const created = await call(api, authorized('POST', '/dsh-combinagents/create', JSON.stringify({ rootSessionId: 's-a' })))
  const root = created.data.composition.nodes[0]
  const added = await call(api, authorized('POST', '/dsh-combinagents/create-task', JSON.stringify({
    rootSessionId: 's-a',
    subject: 'Review plan',
    description: 'Read it',
    ownerNodeId: root.id,
  })))
  assert.equal(added.status, 200)
  assert.equal(added.data.tasks.length, 1)
  const task = added.data.tasks[0]

  const started = await call(api, authorized('POST', '/dsh-combinagents/update-task', JSON.stringify({
    rootSessionId: 's-a',
    taskId: task.id,
    expectedRevision: 1,
    action: 'start',
  })))
  assert.equal(started.status, 200)
  assert.equal(started.data.tasks[0].status, 'in_progress')

  const conflict = await call(api, authorized('POST', '/dsh-combinagents/update-task', JSON.stringify({
    rootSessionId: 's-a',
    taskId: task.id,
    expectedRevision: 1,
    action: 'complete',
  })))
  assert.equal(conflict.status, 409)
  assert.equal(conflict.data.error.code, 'TASK_CONFLICT')

  const state = await call(api, authorized('GET', '/dsh-combinagents/state?rootSessionId=s-a'))
  assert.equal(state.data.tasks[0].status, 'in_progress')
  const tasks = await call(api, authorized('GET', '/dsh-combinagents/tasks?rootSessionId=s-a'))
  assert.equal(tasks.data.tasks.length, 1)

  const completed = await call(api, authorized('POST', '/dsh-combinagents/update-task', JSON.stringify({
    rootSessionId: 's-a',
    taskId: task.id,
    expectedRevision: 2,
    action: 'complete',
  })))
  assert.equal(completed.data.tasks[0].status, 'completed')
  const reopened = await call(api, authorized('POST', '/dsh-combinagents/update-task', JSON.stringify({
    rootSessionId: 's-a',
    taskId: task.id,
    expectedRevision: 3,
    action: 'reopen',
  })))
  assert.equal(reopened.data.tasks[0].status, 'pending')
  const deleted = await call(api, authorized('POST', '/dsh-combinagents/update-task', JSON.stringify({
    rootSessionId: 's-a',
    taskId: task.id,
    expectedRevision: 4,
    action: 'delete',
  })))
  assert.deepEqual(deleted.data.tasks, [])
})

test('the Node handler keeps the request signal live for clone routes', async () => {
  const calls = []
  const api = createApi({
    manager: {},
    discovery: {},
    token: TOKEN,
    cloneManager: {
      async cloneTree(id, options) {
        calls.push({ id, aborted: options?.signal?.aborted === true })
        return { ok: true }
      },
    },
  })
  const server = http.createServer(createNodeHandler(api))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const response = await fetch(`http://127.0.0.1:${port}/dsh-combinagents/clone-tree`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'application/json',
        [TOKEN_HEADER]: TOKEN,
      },
      body: JSON.stringify({ rootSessionId: 's-a' }),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(calls, [{ id: 's-a', aborted: false }])
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('the Node handler rejects an oversized declared body before authentication', async () => {
  const api = createApi({ manager: {}, discovery: {}, token: TOKEN })
  const server = http.createServer(createNodeHandler(api))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const response = await fetch(`http://127.0.0.1:${port}/dsh-combinagents/create`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'application/json',
      },
      body: 'a'.repeat(140_000),
    })
    assert.equal(response.status, 413)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('the Node handler requires the token before reading an authorized-size body', async () => {
  const api = createApi({ manager: {}, discovery: {}, token: TOKEN })
  const server = http.createServer(createNodeHandler(api))
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const response = await fetch(`http://127.0.0.1:${port}/dsh-combinagents/create`, {
      method: 'POST',
      headers: {
        host: `127.0.0.1:${port}`,
        'content-type': 'application/json',
      },
      body: 'x'.repeat(100_000),
    })
    assert.equal(response.status, 401)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
})

test('rejects a non-JSON POST content type', async () => {
  const { api } = makeHarness()
  const response = await call(api, {
    method: 'POST',
    url: '/dsh-combinagents/create',
    headers: {
      [TOKEN_HEADER]: TOKEN,
      'content-type': 'text/plain',
    },
    body: JSON.stringify({ rootSessionId: 's-a' }),
  })
  assert.equal(response.status, 415)
  assert.equal(response.data.error.code, 'UNSUPPORTED_MEDIA_TYPE')
})
