/**
 * Pure composition-graph model for dsh-combinagents.
 *
 * A composition is an overlay: it records who reports to whom without changing
 * any DSH session header, catalog, working directory, sandbox mode, or
 * permission preset. The graph is intentionally a forest (each node has at most
 * one parent) because that keeps the authoritative reporting edge unambiguous.
 *
 * The model is plain ESM and has no DSH dependency, so it can be unit-tested
 * outside a running Harness and later stored in a DSH storage domain unchanged.
 */

import { randomUUID } from 'node:crypto'

/** Maximum number of nodes in one composition. */
export const MAX_COMPOSITION_NODES = 256

/** Recognized node kinds. */
export const NODE_KINDS = Object.freeze(['session', 'external'])

/** Recognized coarse sources. */
export const NODE_SOURCES = Object.freeze(['top-level', 'subagent', 'external', 'unknown'])

/** Native subagent lifecycle mode, retained for display and filtering. */
export const NODE_MODES = Object.freeze(['continuable', 'one-shot', 'external', 'unknown'])

/** The only relationship this model currently expresses. */
export const EDGE_ROLES = Object.freeze(['reports-to'])

/** Current durable payload shape. */
export const COMPOSITION_VERSION = 1

/**
 * A rejected graph operation.
 */
export class CompositionError extends Error {
  /**
   * @param {string} code - stable machine-readable failure code.
   * @param {string} message - human-readable explanation.
   */
  constructor(code, message) {
    super(message)
    this.name = 'CompositionError'
    this.code = code
  }
}

/**
 * @typedef {object} CompositionNode
 * @property {string} id - stable node id, independent of the session id.
 * @property {string|null} sessionId - DSH session id, or null for an external placeholder.
 * @property {string} label - user-facing label.
 * @property {'session'|'external'} kind - whether a local DSH session backs this node.
 * @property {'top-level'|'subagent'|'external'|'unknown'} source - coarse origin.
 * @property {'continuable'|'one-shot'|'external'|'unknown'} mode - native lifecycle mode.
 * @property {string|null} provider - subagent provider or source adapter, when known.
 * @property {string|null} nativeParentSessionId - DSH's immutable parent, retained for display.
 * @property {string|null} cwd - workspace snapshot at attach time, for display only.
 * @property {string|null} permissionPreset - preset name snapshot, for display only.
 * @property {string|null} cloneOf - source session/node id for a cloned node.
 * @property {number|null} cloneSnapshotAt - clone snapshot time, or null.
 * @property {string|null} sourceCompositionId - composition the clone came from.
 * @property {number} addedAt - Unix epoch milliseconds.
 */

/**
 * @typedef {object} CompositionEdge
 * @property {string} id - stable edge id.
 * @property {string} parentId - node that receives reports.
 * @property {string} childId - node that reports to the parent.
 * @property {'reports-to'} role - relationship kind.
 */

/**
 * @typedef {object} Composition
 * @property {1} version - payload version.
 * @property {string} id - composition id.
 * @property {string} title - user-facing title.
 * @property {string|null} rootSessionId - the DSH session that owns this overlay, if any.
 * @property {CompositionNode[]} nodes - nodes in insertion order.
 * @property {CompositionEdge[]} edges - edges in insertion order.
 * @property {number} createdAt - Unix epoch milliseconds.
 * @property {number} updatedAt - Unix epoch milliseconds.
 */

/**
 * @typedef {object} ValidationIssue
 * @property {string} code - stable code.
 * @property {string} message - explanation.
 * @property {string} [nodeId] - involved node, when applicable.
 * @property {string} [edgeId] - involved edge, when applicable.
 */

function fail(code, message) {
  throw new CompositionError(code, message)
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value, field, { nullable = false, max = 256 } = {}) {
  if (value === null || value === undefined) {
    if (nullable) return null
    fail('INVALID_FIELD', `${field} is required`)
  }
  if (typeof value !== 'string') fail('INVALID_FIELD', `${field} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    if (nullable) return null
    fail('INVALID_FIELD', `${field} must not be empty`)
  }
  if (trimmed.length > max) fail('INVALID_FIELD', `${field} must be at most ${max} characters`)
  return trimmed
}

function timestamp(value, field, fallback) {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_FIELD', `${field} must be a non-negative safe integer`)
  }
  return value
}

function optionalTimestamp(value, field) {
  if (value === null || value === undefined) return null
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('INVALID_FIELD', `${field} must be null or a non-negative safe integer`)
  }
  return value
}

function oneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    fail('INVALID_FIELD', `${field} must be one of ${allowed.join(', ')}`)
  }
  return value
}

/**
 * @param {Partial<CompositionNode>} input - caller-supplied node fields.
 * @param {number} now - fallback timestamp.
 * @returns {CompositionNode}
 */
function normalizeNode(input, now) {
  if (!isRecord(input)) fail('INVALID_FIELD', 'node must be an object')
  const sessionId = text(input.sessionId ?? null, 'node.sessionId', { nullable: true, max: 128 })
  const kind = oneOf(input.kind ?? (sessionId === null ? 'external' : 'session'), NODE_KINDS, 'node.kind')
  const source = oneOf(input.source ?? 'unknown', NODE_SOURCES, 'node.source')
  const mode = oneOf(input.mode ?? (kind === 'external'
    ? 'external'
    : source === 'subagent' ? 'unknown' : 'continuable'), NODE_MODES, 'node.mode')
  const node = {
    id: text(input.id ?? randomUUID(), 'node.id', { max: 128 }),
    sessionId,
    label: text(input.label ?? (sessionId === null ? 'External agent' : sessionId), 'node.label', { max: 120 }),
    kind,
    source,
    mode,
    provider: text(input.provider ?? null, 'node.provider', { nullable: true, max: 80 }),
    nativeParentSessionId: text(input.nativeParentSessionId ?? null, 'node.nativeParentSessionId', {
      nullable: true,
      max: 128,
    }),
    cwd: text(input.cwd ?? null, 'node.cwd', { nullable: true, max: 4096 }),
    permissionPreset: text(input.permissionPreset ?? null, 'node.permissionPreset', {
      nullable: true,
      max: 120,
    }),
    cloneOf: text(input.cloneOf ?? null, 'node.cloneOf', { nullable: true, max: 128 }),
    cloneSnapshotAt: optionalTimestamp(input.cloneSnapshotAt, 'node.cloneSnapshotAt'),
    sourceCompositionId: text(input.sourceCompositionId ?? null, 'node.sourceCompositionId', {
      nullable: true,
      max: 128,
    }),
    addedAt: timestamp(input.addedAt, 'node.addedAt', now),
  }
  if (node.kind === 'external' && node.sessionId !== null) {
    fail('INVALID_FIELD', 'an external node cannot carry a local sessionId')
  }
  if (node.kind === 'session' && node.sessionId === null) {
    fail('INVALID_FIELD', 'a session node requires a sessionId')
  }
  if (node.kind === 'session' && node.mode === 'external') {
    fail('INVALID_FIELD', 'a session node cannot have mode external')
  }
  return node
}

/**
 * @param {Partial<CompositionEdge>} input - caller-supplied edge fields.
 * @returns {CompositionEdge}
 */
function normalizeEdge(input) {
  if (!isRecord(input)) fail('INVALID_FIELD', 'edge must be an object')
  return {
    id: text(input.id ?? randomUUID(), 'edge.id', { max: 128 }),
    parentId: text(input.parentId, 'edge.parentId', { max: 128 }),
    childId: text(input.childId, 'edge.childId', { max: 128 }),
    role: oneOf(input.role ?? 'reports-to', EDGE_ROLES, 'edge.role'),
  }
}

/**
 * Check a composition and return every issue instead of throwing.
 * @param {unknown} composition - value to inspect.
 * @returns {{ok: true, composition: Composition}|{ok: false, errors: ValidationIssue[]}}
 */
export function validateComposition(composition) {
  /** @type {ValidationIssue[]} */
  const errors = []
  const add = (code, message, extra = {}) => errors.push({ code, message, ...extra })
  if (!isRecord(composition)) {
    return { ok: false, errors: [{ code: 'INVALID_COMPOSITION', message: 'composition must be an object' }] }
  }
  if (composition.version !== COMPOSITION_VERSION) {
    add('INVALID_COMPOSITION', `composition.version must be ${COMPOSITION_VERSION}`)
  }
  if (typeof composition.id !== 'string' || composition.id.trim().length === 0) {
    add('INVALID_COMPOSITION', 'composition.id must be a non-empty string')
  }
  if (typeof composition.title !== 'string' || composition.title.trim().length === 0) {
    add('INVALID_COMPOSITION', 'composition.title must be a non-empty string')
  }
  if (
    composition.rootSessionId !== null
    && (typeof composition.rootSessionId !== 'string' || composition.rootSessionId.trim().length === 0)
  ) {
    add('INVALID_COMPOSITION', 'composition.rootSessionId must be null or a non-empty string')
  }
  if (!Array.isArray(composition.nodes)) {
    add('INVALID_COMPOSITION', 'composition.nodes must be an array')
    return { ok: false, errors }
  }
  if (!Array.isArray(composition.edges)) {
    add('INVALID_COMPOSITION', 'composition.edges must be an array')
    return { ok: false, errors }
  }
  if (composition.nodes.length > MAX_COMPOSITION_NODES) {
    add('TOO_MANY_NODES', `a composition may contain at most ${MAX_COMPOSITION_NODES} nodes`)
  }
  if (composition.edges.length > Math.max(0, composition.nodes.length - 1)) {
    add('TOO_MANY_EDGES', 'a forest may contain at most nodes - 1 reporting edges')
  }

  const nodeIds = new Set()
  const sessionIds = new Set()
  for (const node of composition.nodes) {
    if (!isRecord(node)) {
      add('INVALID_NODE', 'each node must be an object')
      continue
    }
    if (typeof node.id !== 'string' || node.id.trim().length === 0) {
      add('INVALID_NODE', 'node.id must be a non-empty string')
      continue
    }
    if (nodeIds.has(node.id)) add('DUPLICATE_NODE_ID', `duplicate node id ${JSON.stringify(node.id)}`, { nodeId: node.id })
    nodeIds.add(node.id)
    if (node.sessionId !== null) {
      if (typeof node.sessionId !== 'string' || node.sessionId.trim().length === 0) {
        add('INVALID_NODE', 'node.sessionId must be null or a non-empty string', { nodeId: node.id })
      } else if (sessionIds.has(node.sessionId)) {
        add('DUPLICATE_SESSION_ID', `session ${JSON.stringify(node.sessionId)} is attached twice`, {
          nodeId: node.id,
        })
      } else {
        sessionIds.add(node.sessionId)
      }
    }
    if (typeof node.label !== 'string' || node.label.trim().length === 0) {
      add('INVALID_NODE', 'node.label must be a non-empty string', { nodeId: node.id })
    }
    if (!NODE_KINDS.includes(node.kind)) {
      add('INVALID_NODE', `node.kind must be one of ${NODE_KINDS.join(', ')}`, { nodeId: node.id })
    }
    if (!NODE_SOURCES.includes(node.source)) {
      add('INVALID_NODE', `node.source must be one of ${NODE_SOURCES.join(', ')}`, { nodeId: node.id })
    }
    if (node.mode !== undefined && !NODE_MODES.includes(node.mode)) {
      add('INVALID_NODE', `node.mode must be one of ${NODE_MODES.join(', ')}`, { nodeId: node.id })
    }
    if (node.kind === 'external' && node.sessionId !== null) {
      add('INVALID_NODE', 'an external node cannot carry a local sessionId', { nodeId: node.id })
    }
    if (node.kind === 'session' && node.sessionId === null) {
      add('INVALID_NODE', 'a session node requires a sessionId', { nodeId: node.id })
    }
    if (!Number.isSafeInteger(node.addedAt) || node.addedAt < 0) {
      add('INVALID_NODE', 'node.addedAt must be a non-negative safe integer', { nodeId: node.id })
    }
    if (node.cloneOf !== null && node.cloneOf !== undefined
      && (typeof node.cloneOf !== 'string' || node.cloneOf.trim().length === 0)) {
      add('INVALID_NODE', 'node.cloneOf must be null or a non-empty string', { nodeId: node.id })
    }
    if (node.cloneSnapshotAt !== null && node.cloneSnapshotAt !== undefined
      && (!Number.isSafeInteger(node.cloneSnapshotAt) || node.cloneSnapshotAt < 0)) {
      add('INVALID_NODE', 'node.cloneSnapshotAt must be null or a non-negative safe integer', { nodeId: node.id })
    }
    if (node.sourceCompositionId !== null && node.sourceCompositionId !== undefined
      && (typeof node.sourceCompositionId !== 'string' || node.sourceCompositionId.trim().length === 0)) {
      add('INVALID_NODE', 'node.sourceCompositionId must be null or a non-empty string', { nodeId: node.id })
    }
  }

  const edgeIds = new Set()
  const incoming = new Map()
  for (const edge of composition.edges) {
    if (!isRecord(edge)) {
      add('INVALID_EDGE', 'each edge must be an object')
      continue
    }
    if (typeof edge.id !== 'string' || edge.id.trim().length === 0) {
      add('INVALID_EDGE', 'edge.id must be a non-empty string')
      continue
    }
    if (edgeIds.has(edge.id)) add('DUPLICATE_EDGE_ID', `duplicate edge id ${JSON.stringify(edge.id)}`, { edgeId: edge.id })
    edgeIds.add(edge.id)
    if (!EDGE_ROLES.includes(edge.role)) {
      add('INVALID_EDGE', `edge.role must be one of ${EDGE_ROLES.join(', ')}`, { edgeId: edge.id })
    }
    if (!nodeIds.has(edge.parentId)) {
      add('UNKNOWN_NODE', `edge parent ${JSON.stringify(edge.parentId)} does not exist`, { edgeId: edge.id })
    }
    if (!nodeIds.has(edge.childId)) {
      add('UNKNOWN_NODE', `edge child ${JSON.stringify(edge.childId)} does not exist`, { edgeId: edge.id })
    }
    if (edge.parentId === edge.childId) {
      add('SELF_EDGE', 'an agent cannot report to itself', { edgeId: edge.id })
    }
    if (incoming.has(edge.childId)) {
      add('MULTIPLE_PARENTS', `node ${JSON.stringify(edge.childId)} already has a parent`, { edgeId: edge.id })
    } else {
      incoming.set(edge.childId, edge.parentId)
    }
  }

  // A cycle can only involve edges whose endpoints exist.
  const state = new Map()
  const visit = (nodeId, trail) => {
    if (state.get(nodeId) === 'done') return
    if (state.get(nodeId) === 'visiting') {
      add('CYCLE', `reporting cycle: ${[...trail, nodeId].join(' -> ')}`, { nodeId })
      return
    }
    state.set(nodeId, 'visiting')
    const parent = incoming.get(nodeId)
    if (parent !== undefined && nodeIds.has(parent)) visit(parent, [...trail, nodeId])
    state.set(nodeId, 'done')
  }
  for (const nodeId of nodeIds) visit(nodeId, [])

  if (composition.rootSessionId !== null && typeof composition.rootSessionId === 'string') {
    const found = composition.nodes.some(
      (node) => isRecord(node) && node.sessionId === composition.rootSessionId,
    )
    if (!found) {
      add('ROOT_NOT_IN_COMPOSITION', 'rootSessionId must name a node attached to this composition')
    }
  }

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, composition: /** @type {Composition} */ (composition) }
}

/**
 * Throw the first validation issue.
 * @param {Composition} composition - candidate composition.
 * @returns {Composition} the same composition.
 */
export function assertComposition(composition) {
  const result = validateComposition(composition)
  if (!result.ok) {
    const first = result.errors[0]
    fail(first.code, first.message)
  }
  return composition
}

/**
 * Create an empty or seeded composition.
 * @param {Partial<Composition> & {nodes?: CompositionNode[], edges?: CompositionEdge[]}} [input] - seed data.
 * @returns {Composition}
 */
export function createComposition(input = {}) {
  if (!isRecord(input)) fail('INVALID_FIELD', 'composition input must be an object')
  const now = timestamp(input.createdAt, 'createdAt', Date.now())
  const nodes = (input.nodes ?? []).map((node) => normalizeNode(node, now))
  const edges = (input.edges ?? []).map(normalizeEdge)
  return assertComposition({
    version: COMPOSITION_VERSION,
    id: text(input.id ?? randomUUID(), 'composition.id', { max: 128 }),
    title: text(input.title ?? 'Agent composition', 'composition.title', { max: 120 }),
    rootSessionId: text(input.rootSessionId ?? null, 'composition.rootSessionId', {
      nullable: true,
      max: 128,
    }),
    nodes,
    edges,
    createdAt: now,
    updatedAt: timestamp(input.updatedAt, 'updatedAt', now),
  })
}

/**
 * Add one node and optionally attach it under an existing node.
 * @param {Composition} composition - current composition.
 * @param {Partial<CompositionNode>} input - node fields.
 * @param {{parentId?: string|null, now?: number}} [options] - optional initial parent.
 * @returns {Composition}
 */
export function addNode(composition, input, options = {}) {
  assertComposition(composition)
  const now = timestamp(options.now, 'now', Date.now())
  const node = normalizeNode(input, now)
  let next = {
    ...composition,
    nodes: [...composition.nodes, node],
    updatedAt: now,
  }
  assertComposition(next)
  if (options.parentId !== undefined && options.parentId !== null) {
    next = addEdge(next, { parentId: options.parentId, childId: node.id }, { now })
  }
  return next
}

/**
 * Remove one node. Its direct reports become roots; unrelated nodes stay put.
 * @param {Composition} composition - current composition.
 * @param {string} nodeId - node to remove.
 * @param {{now?: number}} [options] - timestamp override.
 * @returns {Composition}
 */
export function removeNode(composition, nodeId, options = {}) {
  assertComposition(composition)
  if (!composition.nodes.some((node) => node.id === nodeId)) {
    fail('UNKNOWN_NODE', `node ${JSON.stringify(nodeId)} does not exist`)
  }
  const removed = composition.nodes.find((node) => node.id === nodeId)
  const next = {
    ...composition,
    rootSessionId: removed?.sessionId === composition.rootSessionId ? null : composition.rootSessionId,
    nodes: composition.nodes.filter((node) => node.id !== nodeId),
    edges: composition.edges.filter((edge) => edge.parentId !== nodeId && edge.childId !== nodeId),
    updatedAt: timestamp(options.now, 'now', Date.now()),
  }
  return assertComposition(next)
}

/**
 * Remove one node and every descendant. Only graph nodes are removed; no DSH
 * session is touched. Unrelated nodes, siblings, and other roots stay put.
 * @param {Composition} composition - current composition.
 * @param {string} nodeId - subtree root to remove.
 * @param {{now?: number}} [options] - timestamp override.
 * @returns {Composition}
 */
export function removeSubtree(composition, nodeId, options = {}) {
  assertComposition(composition)
  if (!composition.nodes.some((node) => node.id === nodeId)) {
    fail('UNKNOWN_NODE', `node ${JSON.stringify(nodeId)} does not exist`)
  }
  const removed = new Set([nodeId, ...descendantsOf(composition, nodeId).map((node) => node.id)])
  const rootRemoved =
    composition.rootSessionId !== null
    && composition.nodes.some(
      (node) => removed.has(node.id) && node.sessionId === composition.rootSessionId,
    )
  const next = {
    ...composition,
    rootSessionId: rootRemoved ? null : composition.rootSessionId,
    nodes: composition.nodes.filter((node) => !removed.has(node.id)),
    edges: composition.edges.filter(
      (edge) => !removed.has(edge.parentId) && !removed.has(edge.childId),
    ),
    updatedAt: timestamp(options.now, 'now', Date.now()),
  }
  return assertComposition(next)
}

/**
 * Rename one node.
 * @param {Composition} composition - current composition.
 * @param {string} nodeId - node to rename.
 * @param {string} label - new label.
 * @param {{now?: number}} [options] - timestamp override.
 * @returns {Composition}
 */
export function renameNode(composition, nodeId, label, options = {}) {
  assertComposition(composition)
  if (!composition.nodes.some((node) => node.id === nodeId)) {
    fail('UNKNOWN_NODE', `node ${JSON.stringify(nodeId)} does not exist`)
  }
  const nextLabel = text(label, 'label', { max: 120 })
  const next = {
    ...composition,
    nodes: composition.nodes.map((node) => (node.id === nodeId ? { ...node, label: nextLabel } : node)),
    updatedAt: timestamp(options.now, 'now', Date.now()),
  }
  return assertComposition(next)
}

/**
 * Change the composition title.
 * @param {Composition} composition - current composition.
 * @param {string} title - new title.
 * @param {{now?: number}} [options] - timestamp override.
 * @returns {Composition}
 */
export function setTitle(composition, title, options = {}) {
  assertComposition(composition)
  const next = {
    ...composition,
    title: text(title, 'title', { max: 120 }),
    updatedAt: timestamp(options.now, 'now', Date.now()),
  }
  return assertComposition(next)
}

/**
 * Add one reporting edge.
 * @param {Composition} composition - current composition.
 * @param {Partial<CompositionEdge>} input - edge fields.
 * @param {{now?: number}} [options] - timestamp override.
 * @returns {Composition}
 */
export function addEdge(composition, input, options = {}) {
  assertComposition(composition)
  const edge = normalizeEdge(input)
  if (!composition.nodes.some((node) => node.id === edge.parentId)) {
    fail('UNKNOWN_NODE', `node ${JSON.stringify(edge.parentId)} does not exist`)
  }
  if (!composition.nodes.some((node) => node.id === edge.childId)) {
    fail('UNKNOWN_NODE', `node ${JSON.stringify(edge.childId)} does not exist`)
  }
  if (edge.parentId === edge.childId) {
    fail('SELF_EDGE', 'an agent cannot report to itself')
  }
  if (composition.edges.some((existing) => existing.childId === edge.childId)) {
    fail('MULTIPLE_PARENTS', `node ${JSON.stringify(edge.childId)} already has a parent`)
  }
  if (isAncestor(composition, edge.parentId, edge.childId)) {
    fail('CYCLE', 'that report would create a reporting cycle')
  }
  const next = {
    ...composition,
    edges: [...composition.edges, edge],
    updatedAt: timestamp(options.now, 'now', Date.now()),
  }
  return assertComposition(next)
}

/**
 * Remove one reporting edge.
 * @param {Composition} composition - current composition.
 * @param {string} edgeId - edge to remove.
 * @param {{now?: number}} [options] - timestamp override.
 * @returns {Composition}
 */
export function removeEdge(composition, edgeId, options = {}) {
  assertComposition(composition)
  if (!composition.edges.some((edge) => edge.id === edgeId)) {
    fail('UNKNOWN_EDGE', `edge ${JSON.stringify(edgeId)} does not exist`)
  }
  const next = {
    ...composition,
    edges: composition.edges.filter((edge) => edge.id !== edgeId),
    updatedAt: timestamp(options.now, 'now', Date.now()),
  }
  return assertComposition(next)
}

/**
 * Set or clear one node's reporting parent.
 * @param {Composition} composition - current composition.
 * @param {string} childId - node whose parent changes.
 * @param {string|null} parentId - new parent, or null to detach.
 * @param {{now?: number}} [options] - timestamp override.
 * @returns {Composition}
 */
export function setParent(composition, childId, parentId, options = {}) {
  assertComposition(composition)
  if (!composition.nodes.some((node) => node.id === childId)) {
    fail('UNKNOWN_NODE', `node ${JSON.stringify(childId)} does not exist`)
  }
  const now = timestamp(options.now, 'now', Date.now())
  const withoutParent = {
    ...composition,
    edges: composition.edges.filter((edge) => edge.childId !== childId),
    updatedAt: now,
  }
  if (parentId === null) return assertComposition(withoutParent)
  if (!composition.nodes.some((node) => node.id === parentId)) {
    fail('UNKNOWN_NODE', `node ${JSON.stringify(parentId)} does not exist`)
  }
  if (parentId === childId) fail('SELF_EDGE', 'an agent cannot report to itself')
  return addEdge(withoutParent, { parentId, childId }, { now })
}

/**
 * Return root nodes in stable insertion order.
 * @param {Composition} composition - composition to inspect.
 * @returns {CompositionNode[]}
 */
export function rootsOf(composition) {
  assertComposition(composition)
  const children = new Set(composition.edges.map((edge) => edge.childId))
  return composition.nodes.filter((node) => !children.has(node.id))
}

/**
 * Return direct reports of one node in edge order.
 * @param {Composition} composition - composition to inspect.
 * @param {string} parentId - parent node.
 * @returns {CompositionNode[]}
 */
export function childrenOf(composition, parentId) {
  assertComposition(composition)
  const byId = new Map(composition.nodes.map((node) => [node.id, node]))
  return composition.edges
    .filter((edge) => edge.parentId === parentId)
    .map((edge) => byId.get(edge.childId))
    .filter(Boolean)
}

/**
 * Return all descendants of one node in breadth-first order.
 * @param {Composition} composition - composition to inspect.
 * @param {string} nodeId - ancestor node.
 * @returns {CompositionNode[]}
 */
export function descendantsOf(composition, nodeId) {
  assertComposition(composition)
  const byId = new Map(composition.nodes.map((node) => [node.id, node]))
  const adjacency = new Map()
  for (const edge of composition.edges) {
    const list = adjacency.get(edge.parentId) ?? []
    list.push(edge.childId)
    adjacency.set(edge.parentId, list)
  }
  const result = []
  const queue = [nodeId]
  const seen = new Set([nodeId])
  while (queue.length > 0) {
    const current = queue.shift()
    for (const childId of adjacency.get(current) ?? []) {
      if (seen.has(childId)) continue
      seen.add(childId)
      const node = byId.get(childId)
      if (node !== undefined) {
        result.push(node)
        queue.push(childId)
      }
    }
  }
  return result
}

/**
 * Detach one subtree from a composition without touching any DSH session.
 * The caller may attach it to another composition; the remaining composition
 * is returned alongside the detached nodes and edges.
 * @param {Composition} composition - source graph.
 * @param {string} nodeId - subtree root.
 * @param {{now?: number}} [options] - timestamp override.
 * @returns {{subtree: {rootId: string, nodes: CompositionNode[], edges: CompositionEdge[]},
 *   remaining: Composition|null}}
 */
export function detachSubtree(composition, nodeId, options = {}) {
  assertComposition(composition)
  if (!composition.nodes.some((node) => node.id === nodeId)) {
    fail('UNKNOWN_NODE', `node ${JSON.stringify(nodeId)} does not exist`)
  }
  const ids = new Set([nodeId, ...descendantsOf(composition, nodeId).map((node) => node.id)])
  const nodes = composition.nodes.filter((node) => ids.has(node.id))
  const edges = composition.edges.filter((edge) => ids.has(edge.parentId) && ids.has(edge.childId))
  const remainingNodes = composition.nodes.filter((node) => !ids.has(node.id))
  const remainingEdges = composition.edges.filter(
    (edge) => !ids.has(edge.parentId) && !ids.has(edge.childId),
  )
  const subtree = { rootId: nodeId, nodes, edges }
  if (remainingNodes.length === 0) return { subtree, remaining: null }
  const rootRemoved = composition.rootSessionId !== null
    && nodes.some((node) => node.sessionId === composition.rootSessionId)
  const remaining = assertComposition({
    ...composition,
    rootSessionId: rootRemoved ? null : composition.rootSessionId,
    nodes: remainingNodes,
    edges: remainingEdges,
    updatedAt: timestamp(options.now, 'now', Date.now()),
  })
  return { subtree, remaining }
}

/**
 * Attach a detached subtree under an existing node (or as a root).
 * @param {Composition} composition - target graph.
 * @param {{rootId: string, nodes: CompositionNode[], edges: CompositionEdge[]}} subtree - detached graph.
 * @param {string|null} parentId - target parent, or null for a new root.
 * @param {{now?: number}} [options] - timestamp override.
 * @returns {Composition}
 */
export function attachSubtree(composition, subtree, parentId, options = {}) {
  assertComposition(composition)
  if (subtree === null || typeof subtree !== 'object' || !Array.isArray(subtree.nodes) || !Array.isArray(subtree.edges)) {
    fail('INVALID_FIELD', 'subtree must contain nodes and edges')
  }
  if (subtree.nodes.length === 0) fail('INVALID_FIELD', 'subtree must contain at least one node')
  if (!subtree.nodes.some((node) => node.id === subtree.rootId)) {
    fail('INVALID_FIELD', 'subtree rootId must name a node in the subtree')
  }
  if (parentId !== null && !composition.nodes.some((node) => node.id === parentId)) {
    fail('UNKNOWN_NODE', `parent ${JSON.stringify(parentId)} does not exist`)
  }
  const nodeIds = new Set(composition.nodes.map((node) => node.id))
  const sessionIds = new Set(
    composition.nodes.map((node) => node.sessionId).filter((sessionId) => typeof sessionId === 'string'),
  )
  for (const node of subtree.nodes) {
    if (nodeIds.has(node.id)) fail('DUPLICATE_NODE', `node ${JSON.stringify(node.id)} already exists`)
    if (typeof node.sessionId === 'string' && sessionIds.has(node.sessionId)) {
      fail('DUPLICATE_SESSION', `session ${JSON.stringify(node.sessionId)} already belongs to this composition`)
    }
  }
  const now = timestamp(options.now, 'now', Date.now())
  let next = assertComposition({
    ...composition,
    nodes: [...composition.nodes, ...subtree.nodes],
    edges: [...composition.edges, ...subtree.edges],
    updatedAt: now,
  })
  if (parentId !== null) {
    next = addEdge(next, { parentId, childId: subtree.rootId }, { now })
  }
  return next
}

/**
 * Return a node's ancestor chain, nearest parent first.
 * @param {Composition} composition - composition to inspect.
 * @param {string} nodeId - node whose ancestors are requested.
 * @returns {CompositionNode[]}
 */
export function ancestorsOf(composition, nodeId) {
  assertComposition(composition)
  const byId = new Map(composition.nodes.map((node) => [node.id, node]))
  const incoming = new Map(composition.edges.map((edge) => [edge.childId, edge.parentId]))
  const result = []
  let current = incoming.get(nodeId)
  const seen = new Set([nodeId])
  while (current !== undefined && !seen.has(current)) {
    seen.add(current)
    const node = byId.get(current)
    if (node === undefined) break
    result.push(node)
    current = incoming.get(current)
  }
  return result
}

/**
 * Whether `candidateAncestorId` is above `nodeId` in the reporting chain.
 * @param {Composition} composition - composition to inspect.
 * @param {string} nodeId - lower node.
 * @param {string} candidateAncestorId - possible ancestor.
 * @returns {boolean}
 */
export function isAncestor(composition, nodeId, candidateAncestorId) {
  return ancestorsOf(composition, nodeId).some((node) => node.id === candidateAncestorId)
}
