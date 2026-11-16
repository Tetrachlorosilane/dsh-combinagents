import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

test('the bundle manifest points at existing runtime files', () => {
  const root = new URL('../', import.meta.url)
  const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'))

  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(Array.isArray(pkg.dsh.client.inject))
  for (const file of [
    'index.js',
    'client.js',
    'cordis.patch.yml',
    'icon.svg',
    'locale/en.json',
    'locale/zh.json',
    'src/graph.js',
    'src/store.js',
    'src/discovery.js',
    'src/manager.js',
    'src/http.js',
  ]) {
    assert.ok(existsSync(new URL(file, root)), `missing ${file}`)
  }

  const client = readFileSync(new URL('client.js', root), 'utf8')
  assert.ok(client.includes(`id: '${pkg.name}'`), 'client module id must equal the package name')
  const patch = readFileSync(new URL('cordis.patch.yml', root), 'utf8')
  assert.ok(patch.includes(pkg.name), 'the Host patch must insert this package')
})
