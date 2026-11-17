import assert from 'node:assert/strict'
import { test } from 'node:test'

import { planClone } from '../src/clone.js'
import { createComposition } from '../src/graph.js'

function node(id, sessionId, label, extra = {}) {
  return {
    id,
    sessionId,
    label,
    kind: sessionId === null ? 'external' : 'session',
    source: sessionId === null ? 'external' : 'top-level',
    provider: null,
    nativeParentSessionId: null,
    cwd: sessionId === null ? null : `/work/${sessionId}`,
    permissionPreset: null,
    addedAt: 1,
    ...extra,
  }
}

function fixture() {
  return createComposition({
    id: 'composition-1',
    title: 'Team',
    rootSessionId: 's-a',
    nodes: [
      node('n-a', 's-a', 'Root'),
      node('n-b', 's-b', 'Child'),
      node('n-c', null, 'ACP', { provider: 'acp', source: 'external' }),
      node('n-d', 's-d', 'Sibling root'),
      node('n-e', 's-e', 'Sibling child'),
    ],
    edges: [
      { id: 'e-a-b', parentId: 'n-a', childId: 'n-b', role: 'reports-to' },
      { id: 'e-b-c', parentId: 'n-b', childId: 'n-c', role: 'reports-to' },
      { id: 'e-d-e', parentId: 'n-d', childId: 'n-e', role: 'reports-to' },
    ],
  })
}

const tasks = [
  { id: 't1', subject: 'Root task', description: '', status: 'pending', ownerNodeId: 'n-a', blockedBy: [], writeScopes: [] },
  { id: 't2', subject: 'Child task', description: 'detail', status: 'in_progress', ownerNodeId: 'n-b', blockedBy: ['t1'], writeScopes: ['src/'] },
  { id: 't3', subject: 'Outside task', description: '', status: 'pending', ownerNodeId: 'n-d', blockedBy: [], writeScopes: [] },
  { id: 't4', subject: 'Unowned task', description: '', status: 'completed', ownerNodeId: null, blockedBy: [], writeScopes: [] },
]

test('plans the whole root tree and excludes the parent/sibling branches', () => {
  const plan = planClone({ composition: fixture(), tasks, snapshotAt: 42 })
  assert.equal(plan.kind, 'clone')
  assert.equal(plan.sourceCompositionId, 'composition-1')
  assert.equal(plan.rootSourceNodeId, 'n-a')
  assert.deepEqual(plan.nodes.map((entry) => entry.sourceNodeId), ['n-a', 'n-b', 'n-c'])
  assert.deepEqual(plan.edges.map((entry) => [entry.parentSourceNodeId, entry.childSourceNodeId]), [
    ['n-a', 'n-b'],
    ['n-b', 'n-c'],
  ])
  assert.equal(plan.nodes.find((entry) => entry.sourceNodeId === 'n-c').kind, 'external')
  assert.equal(plan.nodes.find((entry) => entry.sourceNodeId === 'n-c').cloneOf, 'n-c')
  assert.equal(plan.nodes.find((entry) => entry.sourceNodeId === 'n-b').cloneOf, 's-b')
})

test('plans a bud as the selected node and its descendants', () => {
  const plan = planClone({ composition: fixture(), rootNodeId: 'n-b', tasks, snapshotAt: 7, kind: 'bud' })
  assert.equal(plan.kind, 'bud')
  assert.equal(plan.rootSourceNodeId, 'n-b')
  assert.deepEqual(plan.nodes.map((entry) => entry.sourceNodeId), ['n-b', 'n-c'])
  assert.deepEqual(plan.edges.map((entry) => [entry.parentSourceNodeId, entry.childSourceNodeId]), [['n-b', 'n-c']])
})

test('copies tasks owned by the cloned tree and skips outside owners', () => {
  const plan = planClone({ composition: fixture(), tasks, snapshotAt: 42 })
  assert.deepEqual(plan.tasks.map((task) => task.sourceTaskId), ['t1', 't2', 't4'])
  assert.deepEqual(plan.tasks.find((task) => task.sourceTaskId === 't2').blockedBy, ['t1'])
  assert.deepEqual(plan.tasks.find((task) => task.sourceTaskId === 't2').writeScopes, ['src/'])
  assert.equal(plan.tasks.find((task) => task.sourceTaskId === 't4').ownerSourceNodeId, null)
})

test('rejects an unknown node, a missing root, and invalid input', () => {
  const composition = fixture()
  assert.throws(() => planClone({ composition, rootNodeId: 'missing' }), (error) => error.code === 'UNKNOWN_NODE')
  assert.throws(() => planClone({ composition, kind: 'copy' }), (error) => error.code === 'INVALID_FIELD')
  assert.throws(() => planClone({ composition, snapshotAt: -1 }), (error) => error.code === 'INVALID_FIELD')

  const noRoot = createComposition({ title: 'No root', nodes: [node('n-x', 's-x', 'Root')] })
  assert.throws(() => planClone({ composition: noRoot }), (error) => error.code === 'ROOT_NOT_FOUND')
})
