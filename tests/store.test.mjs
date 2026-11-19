import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createComposition } from '../src/graph.js'
import {
  COMPOSITION_DOMAIN_SPEC,
  compositionRecordSchema,
  createStore,
} from '../src/store.js'

function memoryTable() {
  const data = new Map()
  return {
    get: (key) => data.get(key),
    entries: () => data.entries(),
    keys: () => data.keys(),
    get size() {
      return data.size
    },
    async put(key, value) {
      data.set(key, value)
    },
    async delete(key) {
      return data.delete(key)
    },
  }
}

function fakeContext(service) {
  return {
    get(name) {
      return name === 'storageDomain' ? service : undefined
    },
    logger: { info() {}, warn() {} },
  }
}

test('reads and writes through the storage domain', async () => {
  const table = memoryTable()
  const domainTables = new Map([['compositions', table]])
  let closed = false
  const service = {
    async open(spec) {
      assert.equal(spec.name, 'combinagents')
      return {
        table: (name) => {
          if (!domainTables.has(name)) domainTables.set(name, memoryTable())
          return domainTables.get(name)
        },
        async close() {
          closed = true
        },
      }
    },
  }
  const store = createStore(fakeContext(service))
  await store.ready
  assert.equal(store.mode, 'durable')

  const composition = createComposition({ title: 'Team' })
  const record = { composition, updatedAt: 7 }
  await store.put('s-root', record)
  assert.deepEqual(await store.get('s-root'), record)
  assert.deepEqual([...(await store.list())], [['s-root', record]])
  await store.close()
  assert.equal(closed, true)
})

test('reloads the domain when another process publishes a revision', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-combinagents-store-'))
  const disk = new Map()
  let opens = 0
  const service = {
    async open() {
      opens += 1
      const snapshot = new Map(disk)
      const tables = new Map(Object.keys(COMPOSITION_DOMAIN_SPEC.tables).map((name) => [name, snapshot]))
      return {
        table(name) {
          if (!tables.has(name)) tables.set(name, new Map())
          return {
            get: (key) => tables.get(name).get(key),
            entries: () => tables.get(name).entries(),
            async put(key, value) {
              tables.get(name).set(key, value)
              disk.set(key, value)
            },
            async delete(key) {
              tables.get(name).delete(key)
              return disk.delete(key)
            },
          }
        },
        async close() {},
      }
    },
  }
  try {
    const store = createStore(fakeContext(service), { storageDir: root })
    await store.ready
    const first = { composition: createComposition({ title: 'First' }), updatedAt: 1 }
    await store.put('s-root', first)
    assert.equal((await store.get('s-root')).composition.title, 'First')
    const before = store.generation

    const external = { composition: createComposition({ title: 'External' }), updatedAt: 2 }
    disk.set('s-root', external)
    writeFileSync(join(root, '.revision'), 'external-token', 'utf8')
    await store.refresh()
    assert.equal(store.generation, before + 1)
    assert.equal(opens, 2)
    assert.equal((await store.get('s-root')).composition.title, 'External')
    await store.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})


test('does not adopt a revision that the reopened snapshot does not contain', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-combinagents-store-'))
  const disk = new Map()
  let opens = 0
  let afterSnapshot = null
  const service = {
    async open() {
      opens += 1
      const snapshot = new Map(disk)
      const tables = new Map(Object.keys(COMPOSITION_DOMAIN_SPEC.tables).map((name) => [name, snapshot]))
      if (afterSnapshot !== null) {
        const run = afterSnapshot
        afterSnapshot = null
        run()
      }
      return {
        table(name) {
          return {
            get: (key) => tables.get(name).get(key),
            entries: () => tables.get(name).entries(),
            async put(key, value) {
              tables.get(name).set(key, value)
              disk.set(key, value)
            },
            async delete(key) {
              tables.get(name).delete(key)
              return disk.delete(key)
            },
          }
        },
        async close() {},
      }
    },
  }
  try {
    const store = createStore(fakeContext(service), { storageDir: root })
    await store.ready
    const first = { composition: createComposition({ title: 'First' }), updatedAt: 1 }
    await store.put('s-root', first)
    const generation = store.generation
    const second = { composition: createComposition({ title: 'Second' }), updatedAt: 2 }
    disk.set('s-root', second)
    writeFileSync(join(root, '.revision'), 'external-token', 'utf8')

    // Pretend another Host writes once more after the new snapshot was taken.
    const third = { composition: createComposition({ title: 'Third' }), updatedAt: 3 }
    afterSnapshot = () => {
      disk.set('s-root', third)
      writeFileSync(join(root, '.revision'), 'later-token', 'utf8')
    }
    assert.equal(await store.refresh(), true)
    // The first refresh loaded the snapshot that preceded the hook's write.
    // Its revision must stay at the pre-open marker, so the next refresh loads
    // the newer record instead of adopting a revision the snapshot lacks.
    assert.equal(await store.refresh(), true)
    assert.equal(opens, 3)
    assert.equal((await store.get('s-root')).composition.title, 'Third')
    assert.equal(store.generation, generation + 2)
    await store.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('keeps a readable snapshot and fails closed when a reload fails', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-combinagents-store-'))
  const disk = new Map()
  let fail = false
  const service = {
    async open() {
      if (fail) throw new Error('backend down')
      const snapshot = new Map(disk)
      const tables = new Map(Object.keys(COMPOSITION_DOMAIN_SPEC.tables).map((name) => [name, snapshot]))
      return {
        table(name) {
          return {
            get: (key) => tables.get(name).get(key),
            entries: () => tables.get(name).entries(),
            async put(key, value) {
              tables.get(name).set(key, value)
              disk.set(key, value)
            },
            async delete(key) {
              tables.get(name).delete(key)
              return disk.delete(key)
            },
          }
        },
        async close() {},
      }
    },
  }
  try {
    const store = createStore(fakeContext(service), { storageDir: root })
    await store.ready
    const first = { composition: createComposition({ title: 'First' }), updatedAt: 1 }
    await store.put('s-root', first)

    fail = true
    writeFileSync(join(root, '.revision'), 'unreadable-token', 'utf8')
    assert.equal(await store.refresh(), false)
    assert.equal(store.mode, 'memory')
    assert.equal(store.degraded, true)
    assert.equal((await store.get('s-root')).composition.title, 'First')
    await assert.rejects(
      store.withMutationLock(async () => 'should not run'),
      /storage is unavailable/,
    )
    await store.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('falls back to memory when the domain cannot open', async () => {
  const service = {
    async open() {
      throw new Error('backend down')
    },
  }
  const store = createStore(fakeContext(service))
  await store.ready
  assert.equal(store.mode, 'memory')

  const composition = createComposition({ title: 'Memory' })
  const record = { composition, updatedAt: 1 }
  await store.put('s-root', record)
  assert.deepEqual(await store.get('s-root'), record)
  await store.delete('s-root')
  assert.equal(await store.get('s-root'), undefined)
})

test('the record schema rejects corrupt stored data', () => {
  const composition = createComposition({ title: 'Valid' })
  assert.equal(compositionRecordSchema.safeParse({ composition, updatedAt: 1 }).success, true)
  assert.throws(() => compositionRecordSchema.parse({ composition: { version: 1 }, updatedAt: 1 }))
  assert.equal(compositionRecordSchema.safeParse({ composition, updatedAt: -1 }).success, false)
  assert.equal(compositionRecordSchema.safeParse(null).success, false)
  assert.equal(COMPOSITION_DOMAIN_SPEC.layout, 'per-record')
  assert.equal(COMPOSITION_DOMAIN_SPEC.invalidRecords, 'backup-and-skip')
})

test('indexes tasks by root after the first list and keeps it current', async () => {
  const store = createStore({ get: () => undefined, logger: { info() {}, warn() {} } })
  await store.ready
  await store.putTask('t-a', { id: 't-a', rootSessionId: 'root-a', subject: 'A', createdAt: 1 })
  await store.putTask('t-b', { id: 't-b', rootSessionId: 'root-b', subject: 'B', createdAt: 2 })
  assert.deepEqual((await store.listTasks('root-a')).map(([id]) => id), ['t-a'])
  await store.putTask('t-c', { id: 't-c', rootSessionId: 'root-a', subject: 'C', createdAt: 3 })
  assert.deepEqual((await store.listTasks('root-a')).map(([id]) => id).sort(), ['t-a', 't-c'])
  await store.deleteTask('t-a')
  assert.deepEqual((await store.listTasks('root-a')).map(([id]) => id), ['t-c'])
  assert.deepEqual((await store.listTasks('root-b')).map(([id]) => id), ['t-b'])
})

test('moves a task between roots without leaving a source ghost', async () => {
  const store = createStore({ get: () => undefined, logger: { info() {}, warn() {} } })
  await store.ready
  const now = Date.now()
  await store.putTask('t-move', {
    id: 't-move', rootSessionId: 'root-a', subject: 'Move', status: 'pending', revision: 1,
    createdAt: now, updatedAt: now,
  })
  assert.deepEqual((await store.listTasks('root-a')).map(([id]) => id), ['t-move'])
  await store.putTask('t-move', {
    id: 't-move', rootSessionId: 'root-b', subject: 'Move', status: 'pending', revision: 1,
    createdAt: now, updatedAt: now,
  })
  assert.deepEqual(await store.listTasks('root-a'), [])
  assert.deepEqual((await store.listTasks('root-b')).map(([id]) => id), ['t-move'])
  await store.deleteTask('t-move')
  assert.deepEqual(await store.listTasks('root-a'), [])
  assert.deepEqual(await store.listTasks('root-b'), [])
})

test('stores Teams by composition root and deletes them independently', async () => {
  const store = createStore({ get: () => undefined, logger: { info() {}, warn() {} } })
  await store.ready
  await store.putTeam('team-a', {
    id: 'team-a', rootSessionId: 'root-a', rootNodeId: 'node-a', label: 'A',
    createdAt: 1, updatedAt: 1,
  })
  await store.putTeam('team-b', {
    id: 'team-b', rootSessionId: 'root-a', rootNodeId: 'node-b', label: 'B',
    createdAt: 2, updatedAt: 2,
  })
  await store.putTeam('team-c', {
    id: 'team-c', rootSessionId: 'root-b', rootNodeId: 'node-c', label: 'C',
    createdAt: 3, updatedAt: 3,
  })
  assert.deepEqual((await store.listTeams('root-a')).map((team) => team.id), ['team-a', 'team-b'])
  assert.deepEqual((await store.listTeams('root-b')).map((team) => team.id), ['team-c'])
  assert.equal((await store.getTeam('team-a')).label, 'A')
  await store.deleteTeam('team-a')
  assert.equal(await store.getTeam('team-a'), undefined)
  assert.deepEqual((await store.listTeams('root-a')).map((team) => team.id), ['team-b'])
})

test('indexes clones by new root and prunes old audit rows', async () => {
  const store = createStore({ get: () => undefined, logger: { info() {}, warn() {} } })
  await store.ready
  await store.putClone('c-a', { id: 'c-a', newRootSessionId: 'root-a', at: 1 })
  await store.putClone('c-b', { id: 'c-b', newRootSessionId: 'root-b', at: 2 })
  assert.deepEqual((await store.listClones('root-a')).map(([id]) => id), ['c-a'])
  await store.deleteClone('c-a')
  assert.deepEqual(await store.listClones('root-a'), [])

  await store.appendAudit({ id: 'a-1', at: 1 })
  await store.appendAudit({ id: 'a-2', at: 2 })
  await store.appendAudit({ id: 'a-3', at: 3 })
  assert.equal(await store.pruneAudit(2), 1)
  assert.deepEqual((await store.listAudit()).map(([id]) => id).sort(), ['a-2', 'a-3'])
  assert.deepEqual((await store.listAuditArchive()).map(([id]) => id), ['a-1'])
})
