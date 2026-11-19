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
          agents: { list: () => [] },
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
  assert.deepEqual(tools.map((tool) => tool.name), [
    'composition_task', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
  ])
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/dsh-combinagents')
  assert.equal(typeof routes[0].handler, 'function')

  for (const dispose of effects.reverse()) {
    if (typeof dispose === 'function') dispose()
  }
})

test('host installs execution interception without duplicate tool registrations', async () => {
  const globalTools = []
  const scopedTools = []
  const listeners = new Map()
  const native = Object.fromEntries(['list_agents', 'send_message', 'interrupt_agent', 'subagent', 'subagent_fork', 'wait_agent'].map((name) => [name, {
    name,
    description: `native ${name}`,
    parameters: {},
    output: { schema: {}, render: () => [] },
    async execute() { return null },
  }]))
  const agent = {
    id: 's-a',
    ctx: {
      tools: {
        get(name) { return native[name] },
        register(definition) {
          scopedTools.push(definition)
          return () => {
            const index = scopedTools.indexOf(definition)
            if (index !== -1) scopedTools.splice(index, 1)
          }
        },
      },
    },
  }
  const ctx = {
    logger: { info() {}, warn() {} },
    get(service) {
      if (service === 'storageDomain') {
        return {
          async open() {
            const table = fakeTable()
            return { table: () => table, close: async () => {} }
          },
        }
      }
      if (service === 'sessions') return { get: () => undefined, list: () => [] }
      return undefined
    },
    effect(callback) {
      callback()
      return () => {}
    },
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
    inject(deps, callback) {
      if (deps[0] === 'webServer') return callback({ logger: { info() {}, warn() {} }, webServer: { register() { return () => {} } } })
      if (deps[0] === 'tools' && deps.includes('agents')) {
        return callback({
          logger: { info() {}, warn() {} },
          tools: { register(definition) { globalTools.push(definition.name); return () => {} } },
          agents: { list: () => [agent] },
        })
      }
      throw new Error(`unexpected inject: ${deps.join(',')}`)
    },
  }
  apply(ctx)
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(globalTools, [
    'composition_task', 'team_task_create', 'team_task_list', 'team_task_get', 'team_task_update',
  ])
  assert.deepEqual(scopedTools, [])
  assert.equal(typeof listeners.get('tools/execute'), 'function')
})
