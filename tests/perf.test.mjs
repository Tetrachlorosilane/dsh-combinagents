import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createApi, TOKEN_HEADER } from '../src/http.js'
import { createManager } from '../src/manager.js'

const TOKEN = 'perf-token'
const PORT = 60601

function request(api, { method = 'GET', url, body = '' } = {}) {
  return api.handle({
    method,
    url: url ?? '/dsh-combinagents/bootstrap',
    headers: {
      host: `127.0.0.1:${PORT}`,
      [TOKEN_HEADER]: TOKEN,
      'content-type': 'application/json',
    },
    body,
    remoteAddress: '127.0.0.1',
    localPort: PORT,
  })
}

function node(index) {
  return {
    id: `n-${index}`,
    sessionId: `s-${index}`,
    label: `Node ${index}`,
    kind: 'session',
    source: 'top-level',
    provider: null,
    nativeParentSessionId: null,
    cwd: `/work/${index}`,
    permissionPreset: null,
  }
}

test('summary is served from the composition without walking native catalogs', async () => {
  const composition = {
    version: 1,
    id: 'c-1',
    title: 'Team',
    rootSessionId: 's-0',
    nodes: Array.from({ length: 16 }, (_, index) => node(index)),
    edges: Array.from({ length: 15 }, (_, index) => ({
      id: `e-${index}`,
      parentId: 'n-0',
      childId: `n-${index + 1}`,
      role: 'reports-to',
    })),
    createdAt: 1,
    updatedAt: 1,
  }
  const manager = {
    storageMode: 'memory',
    async resolveSession() {
      return { rootSessionId: 's-0', record: { composition, updatedAt: 1 } }
    },
  }
  const discovery = {
    async countNative() {
      throw new Error('summary must not walk native catalogs')
    },
  }
  const api = createApi({ manager, discovery, token: TOKEN })
  const response = await request(api, { url: '/dsh-combinagents/summary?sessionId=s-7' })
  assert.equal(response.status, 200)
  const data = JSON.parse(response.body)
  assert.equal(data.compositionNodes, 16)
  assert.equal(data.subagents, null)
  assert.equal(data.nativeSubagents, null)
  assert.equal(data.available, false)
})

test('summary reports a cached native count without walking native catalogs', async () => {
  const composition = {
    version: 1,
    id: 'c-1',
    title: 'Team',
    rootSessionId: 's-0',
    nodes: [node(0)],
    edges: [],
    createdAt: 1,
    updatedAt: 1,
  }
  const manager = {
    storageMode: 'memory',
    async resolveSession() {
      return { rootSessionId: 's-0', record: { composition, updatedAt: 1 } }
    },
  }
  const discovery = {
    peekNativeCount: () => 15,
    async countNative() {
      throw new Error('summary must not walk native catalogs')
    },
  }
  const api = createApi({ manager, discovery, token: TOKEN })
  const response = await request(api, { url: '/dsh-combinagents/summary?sessionId=s-7' })
  assert.equal(response.status, 200)
  const data = JSON.parse(response.body)
  assert.equal(data.compositionNodes, 1)
  assert.equal(data.subagents, 15)
  assert.equal(data.nativeSubagents, 15)
  assert.equal(data.available, true)
})

test('state reads the composition record once for grants and tasks', async () => {
  const data = new Map()
  const policies = new Map()
  const tasks = new Map()
  let gets = 0
  const store = {
    mode: 'memory',
    async get(key) {
      gets += 1
      return data.get(key)
    },
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
  const discovery = {
    async describe(sessionId) {
      return {
        sessionId, title: sessionId, cwd: null, source: 'top-level', nativeParentSessionId: null,
        agentPreset: null, live: true, persisted: true,
      }
    },
    async listTree() { return { available: true, children: [] } },
    async describeMany(ids) {
      return Object.fromEntries(ids.map((sessionId) => [sessionId, {
        sessionId, title: sessionId, cwd: null, source: 'top-level', nativeParentSessionId: null,
        agentPreset: null, live: true, persisted: true,
      }]))
    },
  }
  const manager = createManager({ store, discovery })
  await manager.create('s-a')
  const root = (await manager.state('s-a')).composition.nodes[0]
  await manager.addNode('s-a', { sessionId: 's-b', parentId: root.id })
  gets = 0

  const api = createApi({ manager, discovery, token: TOKEN })
  const response = await request(api, { url: '/dsh-combinagents/state?rootSessionId=s-a' })
  assert.equal(response.status, 200)
  assert.equal(gets, 1)
})
