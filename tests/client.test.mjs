import assert from 'node:assert/strict'
import { test } from 'node:test'

test('client module registers one tab type, its body, and the header utility', async () => {
  let definition
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  }

  await import('../client.js')
  assert.equal(definition.id, '@dsh-external/dsh-combinagents')

  const React = {
    createElement: () => null,
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (callback) => callback,
    useMemo: (callback) => callback(),
  }
  const plugin = definition.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  assert.deepEqual(plugin.inject, ['slots', 'locale'])

  const tabs = []
  const slots = []
  const registrations = []
  const dicts = {}
  const scope = {
    sidebarRightTabs: {
      register: (tab) => {
        tabs.push(tab)
        return () => {}
      },
    },
    slots: {
      inject: (name, callback) => {
        slots.push(name)
        return callback()
      },
      register: (options) => {
        assert.equal(typeof options.name, 'string')
        registrations.push(options)
        return () => {}
      },
    },
  }
  const ctx = {
    logger: { info() {}, warn() {} },
    locale: {
      bind: () => (key) => key,
      register: (ns, locale, dict) => {
        dicts[locale] = dict
        return () => {}
      },
    },
    effect: (callback) => {
      const dispose = callback()
      assert.equal(typeof dispose, 'function')
      return dispose
    },
    get: () => undefined,
    inject: (deps, callback) => {
      assert.deepEqual(deps, ['sidebarRightTabs'])
      const dispose = callback(scope)
      assert.equal(typeof dispose, 'function')
      return dispose
    },
  }

  plugin.apply(ctx)
  assert.equal(tabs.length, 1)
  assert.equal(tabs[0].id, '@dsh-external/dsh-combinagents/composition')
  assert.equal(tabs[0].kind, 'dsh-combinagents')
  assert.equal(tabs[0].guide.length, 1)
  assert.deepEqual(slots.sort(), [
    'conversation.session.header.actions',
    'conversation.session.header.utilities',
    'sidebar.right.pane.tab',
  ])
  assert.ok(registrations.some((options) => options.id === 'dsh-combinagents-count'))
  assert.ok(!registrations.some((options) => options.id === 'subagent-catalog'))
  assert.deepEqual(Object.keys(dicts.en).sort(), Object.keys(dicts.zh).sort())

  delete globalThis.window
})
