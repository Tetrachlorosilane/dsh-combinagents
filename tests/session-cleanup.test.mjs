import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createComposition } from '../src/graph.js'
import { createSessionCleanup } from '../src/session-cleanup.js'

function session(root, id, bytes = 100) {
  const dir = join(root, 'project', id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), Buffer.alloc(bytes, 1))
  return dir
}

function summary(id, extra = {}) {
  return {
    sessionId: id,
    title: id,
    cwd: '/work',
    source: extra.source ?? 'top-level',
    isSeeded: extra.isSeeded === true,
    nativeParentSessionId: extra.parent ?? null,
    live: extra.live === true,
    persisted: true,
  }
}

function harness() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-combinagents-cleanup-'))
  const ids = [
    'session-root', 'session-child', 'session-one', 'session-wild',
    'session-orphan', 'session-orphan-child', 'session-legacy-root',
    'session-legacy-child', 'session-fork-miss', 'session-live',
  ]
  for (const id of ids) session(root, id, id === 'session-wild' ? 200 : 100)
  const detach = []
  const removed = []
  const deletedClones = []
  const summaries = [
    summary('session-root'),
    summary('session-child', { source: 'subagent', parent: 'session-root' }),
    summary('session-one', { source: 'subagent', parent: 'session-root' }),
    summary('session-wild', { isSeeded: true }),
    summary('session-orphan', { isSeeded: true }),
    summary('session-orphan-child', { isSeeded: true, source: 'subagent', parent: 'session-orphan' }),
    summary('session-legacy-root', { isSeeded: true }),
    summary('session-legacy-child', { isSeeded: true, source: 'subagent', parent: 'session-legacy-root' }),
    summary('session-fork-miss', { isSeeded: true, parent: 'session-auth' }),
    summary('session-live', { isSeeded: true, live: true }),
  ]
  const composition = createComposition({
    id: 'composition-root',
    title: 'Root',
    rootSessionId: 'session-root',
    nodes: [
      { id: 'n-root', sessionId: 'session-root', label: 'Root', kind: 'session', source: 'top-level', mode: 'continuable' },
      { id: 'n-child', sessionId: 'session-child', label: 'Child', kind: 'session', source: 'subagent', mode: 'continuable' },
      { id: 'n-one', sessionId: 'session-one', label: 'One', kind: 'session', source: 'subagent', mode: 'one-shot' },
      { id: 'n-ext', sessionId: null, label: 'External', kind: 'external', source: 'external', mode: 'one-shot' },
    ],
    edges: [
      { id: 'e-child', parentId: 'n-root', childId: 'n-child', role: 'reports-to' },
      { id: 'e-one', parentId: 'n-root', childId: 'n-one', role: 'reports-to' },
      { id: 'e-ext', parentId: 'n-root', childId: 'n-ext', role: 'reports-to' },
    ],
  })
  const clones = new Map([
    ['clone-failed', {
      id: 'clone-failed', kind: 'clone', status: 'failed',
      sourceCompositionId: 'source', sourceRootSessionId: 'session-auth',
      newRootSessionId: 'session-wild', snapshotAt: 1,
      nodeMapping: [{ sourceSessionId: 'session-auth', newSessionId: 'session-wild' }],
    }],
    ['clone-orphan', {
      id: 'clone-orphan', kind: 'clone', status: 'orphaned',
      sourceCompositionId: 'source', sourceRootSessionId: 'session-auth',
      newRootSessionId: 'session-orphan', snapshotAt: 1,
      nodeMapping: [
        { sourceSessionId: 'session-auth', newSessionId: 'session-orphan' },
        { sourceSessionId: 'session-child', newSessionId: 'session-orphan-child' },
      ],
    }],
  ])
  const store = {
    mode: 'durable',
    async list() { return [['session-root', { composition, updatedAt: 1 }]] },
    async get(id) { return id === 'session-root' ? { composition, updatedAt: 1 } : undefined },
    async listClones() { return [...clones.entries()] },
    async deleteClone(id) { deletedClones.push(id); clones.delete(id) },
    async withMutationLock(task) { return task() },
  }
  const discovery = {
    async list() { return { sessions: summaries, complete: true } },
  }
  const live = new Map([['session-live', {}]])
  const workspace = {
    sessionIds: [...ids],
    async detachSession(id) { detach.push(id) },
  }
  const ctx = {
    get(name) {
      if (name === 'sessions') return { get: (id) => live.get(id) }
      if (name === 'workspaceRegistry') {
        return { list: () => [workspace], async unarchiveSession() {}, async unpinSession() {} }
      }
      return undefined
    },
    logger: { info() {}, warn() {} },
  }
  const manager = {
    async removeNode(rootSessionId, input) { removed.push({ rootSessionId, ...input }) },
    async state(rootSessionId) {
      return rootSessionId === 'session-root' ? { composition, updatedAt: 1 } : null
    },
    async getTasks() { return [] },
  }
  const cleanup = createSessionCleanup({ ctx, store, discovery, manager, sessionsRoot: root })
  return { cleanup, store, root, detach, removed, deletedClones, summaries, composition, clones }
}

test('previews tracked, legacy, and one-shot candidates without exposing protected sessions', async () => {
  const { cleanup, store, root } = harness()
  try {
    const preview = await cleanup.preview()
    assert.equal(preview.available, true)
    assert.deepEqual(preview.wild.map((entry) => entry.sessionId).sort(), [
      'session-orphan', 'session-orphan-child', 'session-wild',
    ])
    assert.deepEqual(preview.legacy.map((entry) => entry.sessionId).sort(), [
      'session-fork-miss', 'session-legacy-child', 'session-legacy-root',
    ])
    assert.deepEqual(preview.oneShot.map((entry) => entry.nodeId).sort(), ['n-ext', 'n-one'])
    assert.equal(preview.wild.find((entry) => entry.sessionId === 'session-wild').size, 200)
    assert.ok(!preview.wild.some((entry) => entry.sessionId === 'session-root'))
    assert.ok(!preview.wild.some((entry) => entry.sessionId === 'session-live'))
    const estimate = await cleanup.estimateClone('session-root', null)
    assert.equal(estimate.sessions, 3)
    assert.equal(estimate.bytes, 300)
    store.mode = 'memory'
    assert.equal((await cleanup.preview()).available, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('deletes selected wild and one-shot candidates, then removes their clone records', async () => {
  const { cleanup, root, detach, removed, deletedClones } = harness()
  try {
    const result = await cleanup.clean({
      sessionIds: ['session-wild', 'session-orphan', 'session-orphan-child'],
      oneShotNodeIds: ['n-one', 'n-ext'],
    })
    assert.deepEqual(result.failures, [])
    assert.deepEqual(result.deleted.sort(), ['session-orphan', 'session-orphan-child', 'session-wild'])
    assert.equal(result.bytesFreed, 500)
    assert.equal(result.oneShotRemoved, 2)
    assert.deepEqual(result.cloneRecordsDeleted, 2)
    assert.deepEqual(removed.map((entry) => entry.nodeId).sort(), ['n-ext', 'n-one'])
    assert.ok(detach.includes('session-wild'))
    assert.ok(deletedClones.includes('clone-failed'))
    assert.ok(deletedClones.includes('clone-orphan'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('requires explicit confirmation for historical suspects and never deletes live sessions', async () => {
  const { cleanup, root } = harness()
  try {
    const blocked = await cleanup.clean({ sessionIds: ['session-legacy-root'] })
    assert.equal(blocked.failures[0].code, 'LEGACY_NOT_CONFIRMED')
    const live = await cleanup.clean({ sessionIds: ['session-live'] })
    assert.equal(live.failures[0].code, 'NOT_ELIGIBLE')
    const confirmed = await cleanup.clean({ sessionIds: ['session-legacy-root', 'session-legacy-child'], includeLegacy: true })
    assert.deepEqual(confirmed.failures, [])
    assert.deepEqual(confirmed.deleted.sort(), ['session-legacy-child', 'session-legacy-root'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
