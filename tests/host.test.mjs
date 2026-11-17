import assert from 'node:assert/strict'
import { test } from 'node:test'

import { apply, inject, name } from '../index.js'

function fakeTable() {
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

test('host entry registers the composition bridge and injects its hard services', async () => {
  assert.equal(name, '@dsh-external/dsh-combinagents')
  assert.deepEqual(inject, ['sessions', 'storageDomain'])

  const routes = []
  const tools = []
  const effects = []
  const table = fakeTable()
  const ctx = {
    logger: { info() {}, warn() {} },
    get(service) {
      if (service === 'storageDomain') {
        return {
          async open() {
            return { table: () => table, close: async () => {} }
          },
        }
      }
      if (service === 'sessions') {
        return { get: () => undefined, list: () => [] }
      }
      return undefined
    },
    effect(callback) {
      const dispose = callback()
      effects.push(dispose)
      return dispose
    },
    on(event, listener) {
      assert.equal(event, 'subagent/start')
      assert.equal(typeof listener, 'function')
      return () => {}
    },
    inject(deps, callback) {
      if (deps[0] === 'webServer') {
        const scope = {
          logger: { info() {}, warn() {} },
          webServer: {
            register(route) {
              routes.push(route)
              return () => {}
            },
          },
        }
        const dispose = callback(scope)
        effects.push(dispose)
        return dispose
      }
      if (deps[0] === 'tools') {
        const scope = {
          logger: { info() {}, warn() {} },
          tools: {
            register(definition) {
              tools.push(definition)
              return () => {}
            },
          },
        }
        const dispose = callback(scope)
        effects.push(dispose)
        return dispose
      }
      throw new Error(`unexpected inject: ${deps.join(',')}`)
    },
  }

  apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert.equal(routes.length, 1)
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'composition_interrupt_agent',
    'composition_list_agents',
    'composition_send_message',
  ])
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/dsh-combinagents')
  assert.equal(typeof routes[0].handler, 'function')

  for (const dispose of effects.reverse()) {
    if (typeof dispose === 'function') dispose()
  }
})

test('composed config mounts the native-name tool surface', async () => {
  const tools = []
  const table = fakeTable()
  const ctx = {
    logger: { info() {}, warn() {} },
    get(service) {
      if (service === 'storageDomain') {
        return {
          async open() {
            return { table: () => table, close: async () => {} }
          },
        }
      }
      if (service === 'sessions') return { get: () => undefined, list: () => [] }
      return undefined
    },
    effect(callback) {
      return callback()
    },
    on() {
      return () => {}
    },
    inject(deps, callback) {
      if (deps[0] === 'webServer') return callback({ logger: { info() {}, warn() {} }, webServer: { register() { return () => {} } } })
      if (deps[0] === 'tools') {
        return callback({
          logger: { info() {}, warn() {} },
          tools: {
            register(definition) {
              tools.push(definition)
              return () => {}
            },
          },
        })
      }
      throw new Error(`unexpected inject: ${deps.join(',')}`)
    },
  }

  apply(ctx, { mode: 'composed' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(tools.map((tool) => tool.name).sort(), [
    'composition_interrupt_agent', 'composition_list_agents', 'composition_send_message', 'composition_task',
    'interrupt_agent', 'list_agents', 'send_message', 'subagent', 'subagent_fork', 'wait_agent',
  ])
})
