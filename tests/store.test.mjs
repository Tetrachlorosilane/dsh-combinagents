import assert from 'node:assert/strict'
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
