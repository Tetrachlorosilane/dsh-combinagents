import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CompositionError,
  addEdge,
  addNode,
  ancestorsOf,
  assertComposition,
  childrenOf,
  createComposition,
  descendantsOf,
  isAncestor,
  removeNode,
  removeSubtree,
  renameNode,
  rootsOf,
  setParent,
  setTitle,
  validateComposition,
} from '../src/graph.js'

function root(label = 'Lead', sessionId = 's-lead') {
  return { label, sessionId, kind: 'session', source: 'top-level' }
}

function child(label, sessionId) {
  return { label, sessionId, kind: 'session', source: 'subagent', provider: 'spawn' }
}

test('creates a valid empty composition', () => {
  const composition = createComposition({ title: 'Review team' })
  assert.equal(composition.version, 1)
  assert.deepEqual(composition.nodes, [])
  assert.deepEqual(composition.edges, [])
  assert.equal(validateComposition(composition).ok, true)
  assert.deepEqual(rootsOf(composition), [])
})

test('adds nodes and attaches a reporting edge', () => {
  let composition = createComposition({
    title: 'Review team',
    nodes: [root()],
    edges: [],
  })
  const lead = composition.nodes[0]
  composition = addNode(composition, child('Reviewer', 's-reviewer'), { parentId: lead.id })
  composition = addNode(composition, child('Checker', 's-checker'))
  const reviewer = composition.nodes.find((node) => node.sessionId === 's-reviewer')
  const checker = composition.nodes.find((node) => node.sessionId === 's-checker')

  composition = setParent(composition, checker.id, reviewer.id)

  assert.equal(composition.edges.length, 2)
  assert.deepEqual(childrenOf(composition, lead.id).map((node) => node.label), ['Reviewer'])
  assert.deepEqual(childrenOf(composition, reviewer.id).map((node) => node.label), ['Checker'])
  assert.deepEqual(descendantsOf(composition, lead.id).map((node) => node.label), ['Reviewer', 'Checker'])
  assert.deepEqual(ancestorsOf(composition, checker.id).map((node) => node.label), ['Reviewer', 'Lead'])
  assert.equal(isAncestor(composition, checker.id, lead.id), true)
  assert.equal(isAncestor(composition, lead.id, checker.id), false)
})

test('supports multiple roots and detaching a node', () => {
  let composition = createComposition({
    nodes: [root('A', 's-a'), root('B', 's-b')],
  })
  const [a, b] = composition.nodes
  composition = addNode(composition, child('C', 's-c'), { parentId: a.id })
  const c = composition.nodes.find((node) => node.sessionId === 's-c')
  composition = setParent(composition, c.id, b.id)
  assert.deepEqual(childrenOf(composition, b.id).map((node) => node.label), ['C'])
  composition = setParent(composition, c.id, null)
  assert.deepEqual(rootsOf(composition).map((node) => node.label), ['A', 'B', 'C'])
})

test('rejects duplicate session ids', () => {
  assert.throws(
    () => createComposition({ nodes: [root('One', 's-same'), root('Two', 's-same')] }),
    (error) => error instanceof CompositionError && error.code === 'DUPLICATE_SESSION_ID',
  )
})

test('rejects a second parent for one node', () => {
  let composition = createComposition({
    nodes: [root('A', 's-a'), root('B', 's-b'), root('C', 's-c')],
  })
  const [a, b, c] = composition.nodes
  composition = addEdge(composition, { parentId: a.id, childId: c.id })
  assert.throws(
    () => addEdge(composition, { parentId: b.id, childId: c.id }),
    (error) => error instanceof CompositionError && error.code === 'MULTIPLE_PARENTS',
  )
})

test('rejects cycles in both directions', () => {
  let composition = createComposition({
    nodes: [root('A', 's-a'), root('B', 's-b'), root('C', 's-c')],
  })
  const [a, b, c] = composition.nodes
  composition = addEdge(composition, { parentId: a.id, childId: b.id })
  assert.throws(
    () => addEdge(composition, { parentId: b.id, childId: a.id }),
    (error) => error instanceof CompositionError && error.code === 'CYCLE',
  )
  composition = addEdge(composition, { parentId: b.id, childId: c.id })
  assert.throws(
    () => setParent(composition, a.id, c.id),
    (error) => error instanceof CompositionError && error.code === 'CYCLE',
  )
})

test('rejects self edges and unknown nodes', () => {
  const composition = createComposition({ nodes: [root()] })
  const lead = composition.nodes[0]
  assert.throws(
    () => addEdge(composition, { parentId: lead.id, childId: lead.id }),
    (error) => error instanceof CompositionError && error.code === 'SELF_EDGE',
  )
  assert.throws(
    () => addEdge(composition, { parentId: lead.id, childId: 'missing' }),
    (error) => error instanceof CompositionError && error.code === 'UNKNOWN_NODE',
  )
})

test('removing a middle node promotes its reports and clears a deleted root', () => {
  let composition = createComposition({
    title: 'Team',
    rootSessionId: 's-a',
    nodes: [root('A', 's-a')],
  })
  const a = composition.nodes[0]
  composition = addNode(composition, child('B', 's-b'), { parentId: a.id })
  const b = composition.nodes.find((node) => node.sessionId === 's-b')
  composition = addNode(composition, child('C', 's-c'), { parentId: b.id })

  composition = removeNode(composition, b.id)
  assert.deepEqual(composition.nodes.map((node) => node.label), ['A', 'C'])
  assert.deepEqual(composition.edges, [])
  assert.deepEqual(rootsOf(composition).map((node) => node.label), ['A', 'C'])

  composition = removeNode(composition, a.id)
  assert.equal(composition.rootSessionId, null)
})

test('removes a subtree and leaves siblings in place', () => {
  let composition = createComposition({ nodes: [root('A', 's-a')] })
  const a = composition.nodes[0]
  composition = addNode(composition, child('B', 's-b'), { parentId: a.id })
  composition = addNode(composition, child('D', 's-d'), { parentId: a.id })
  const b = composition.nodes.find((node) => node.sessionId === 's-b')
  composition = addNode(composition, child('C', 's-c'), { parentId: b.id })

  composition = removeSubtree(composition, b.id)
  assert.deepEqual(composition.nodes.map((node) => node.label), ['A', 'D'])
  assert.deepEqual(childrenOf(composition, a.id).map((node) => node.label), ['D'])
  assert.equal(composition.edges.length, 1)
})

test('clears rootSessionId when the removed subtree holds the root session', () => {
  let composition = createComposition({
    title: 'Team',
    rootSessionId: 's-a',
    nodes: [root('A', 's-a')],
  })
  const a = composition.nodes[0]
  composition = addNode(composition, child('B', 's-b'), { parentId: a.id })

  composition = removeSubtree(composition, a.id)
  assert.equal(composition.rootSessionId, null)
  assert.deepEqual(composition.nodes, [])
  assert.deepEqual(composition.edges, [])
})

test('rejects an unknown subtree root', () => {
  const composition = createComposition({ nodes: [root()] })
  assert.throws(
    () => removeSubtree(composition, 'missing'),
    (error) => error instanceof CompositionError && error.code === 'UNKNOWN_NODE',
  )
})

test('removeSubtree does not mutate its input', () => {
  let composition = createComposition({ nodes: [root('A', 's-a')] })
  const a = composition.nodes[0]
  composition = addNode(composition, child('B', 's-b'), { parentId: a.id })
  const snapshot = JSON.parse(JSON.stringify(composition))

  removeSubtree(composition, a.id)
  assert.deepEqual(composition, snapshot)
})

test('renames a composition and a node', () => {
  let composition = createComposition({ title: 'Old title', nodes: [root()] })
  composition = setTitle(composition, 'Review team')
  composition = addNode(composition, child('Old child', 's-child'))
  const node = composition.nodes.find((entry) => entry.sessionId === 's-child')
  composition = renameNode(composition, node.id, 'New child')
  assert.equal(composition.title, 'Review team')
  assert.equal(composition.nodes.find((entry) => entry.id === node.id).label, 'New child')
})

test('rejects an empty title or label', () => {
  const composition = createComposition({ nodes: [root()] })
  assert.throws(
    () => setTitle(composition, '   '),
    (error) => error instanceof CompositionError && error.code === 'INVALID_FIELD',
  )
  assert.throws(
    () => renameNode(composition, composition.nodes[0].id, ''),
    (error) => error instanceof CompositionError && error.code === 'INVALID_FIELD',
  )
})

test('rejects a rootSessionId that is not attached', () => {
  assert.throws(
    () => createComposition({ title: 'Team', rootSessionId: 's-missing', nodes: [root()] }),
    (error) => error instanceof CompositionError && error.code === 'ROOT_NOT_IN_COMPOSITION',
  )
})

test('validation reports malformed data instead of throwing', () => {
  const result = validateComposition({
    version: 1,
    id: 'c',
    title: 'T',
    rootSessionId: null,
    createdAt: 1,
    updatedAt: 1,
    nodes: [{ id: 'n', sessionId: 's', label: 'N', kind: 'session', source: 'unknown', addedAt: 1 }],
    edges: [{ id: 'e', parentId: 'n', childId: 'missing', role: 'reports-to' }],
  })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((issue) => issue.code === 'UNKNOWN_NODE'))
})

test('assertComposition throws the first issue', () => {
  assert.throws(
    () => assertComposition({}),
    (error) => error instanceof CompositionError && error.code === 'INVALID_COMPOSITION',
  )
})
