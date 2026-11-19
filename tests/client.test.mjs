import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('client confirmations use the DSH-themed dialog instead of browser dialogs', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /window\.(?:confirm|alert|prompt)\s*\(/)
  assert.match(source, /role: 'dialog'/)
  assert.match(source, /--dsw-alias-bg-mask-1/)
  assert.match(source, /--dsw-radius-panel/)
  assert.match(source, /\/session-cleanup/)
  assert.match(source, /\/session-cleanup\/session/)
  assert.match(source, /\/clone-estimate/)
  assert.match(source, /cleanupConfirm/)
  assert.match(source, /onClick: \(\) => void checkCleanup\(\)/)
  assert.doesNotMatch(source, /checkCleanup\(true\)/)
  assert.match(source, /overflowY: 'auto'/)
  assert.match(source, /onClose: closePicker/)
  assert.match(source, /adding === false/)
  assert.match(source, /\/create-team/)
  assert.match(source, /activeTeamId/)
  assert.match(source, /teamMembers/)
})

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
