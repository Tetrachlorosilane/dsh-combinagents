/**
 * Pure clone/bud planning for dsh-combinagents.
 *
 * The plan selects the tree rooted at one composition node, keeps source ids as
 * keys, and marks every node with its clone provenance. It never creates a DSH
 * session and never touches the source composition; the Host adapter turns the
 * plan into new Sessions, catalog entries, and task records.
 */

import { CompositionError, descendantsOf } from './graph.js'

/** Current clone-plan shape. */
export const CLONE_PLAN_VERSION = 1

/**
 * @typedef {object} CloneNodePlan
 * @property {string} sourceNodeId
 * @property {string|null} sourceSessionId
 * @property {'session'|'external'} kind
 * @property {string} label
 * @property {string} source
 * @property {string|null} provider
 * @property {string|null} nativeParentSessionId
 * @property {string|null} cwd
 * @property {string|null} permissionPreset
 * @property {string} cloneOf
 */

/**
 * @typedef {object} CloneTaskPlan
 * @property {string} sourceTaskId
 * @property {string} subject
 * @property {string} description
 * @property {string} status
 * @property {string|null} ownerSourceNodeId
 * @property {string[]} blockedBy
 * @property {string[]} writeScopes
 */

/**
 * Select one node and its descendants in stable composition order.
 * @param {object} composition - validated composition.
 * @param {string} rootNodeId - subtree root.
 * @returns {{root: object, nodes: object[], edges: object[]}}
 */
export function treeOf(composition, rootNodeId) {
  if (typeof rootNodeId !== 'string' || rootNodeId.length === 0) {
    throw new CompositionError('INVALID_FIELD', 'rootNodeId must be a non-empty string')
  }
  const root = composition.nodes.find((node) => node.id === rootNodeId)
  if (root === undefined) {
    throw new CompositionError('UNKNOWN_NODE', `node ${JSON.stringify(rootNodeId)} does not exist`)
  }
  const descendants = descendantsOf(composition, rootNodeId)
  const ids = new Set([rootNodeId, ...descendants.map((node) => node.id)])
  return {
    root,
    nodes: composition.nodes.filter((node) => ids.has(node.id)),
    edges: composition.edges.filter((edge) => ids.has(edge.parentId) && ids.has(edge.childId)),
  }
}

/**
 * Resolve the composition root-session node, or an explicit node for a bud.
 * @param {object} composition - validated composition.
 * @param {string|undefined} rootNodeId - explicit subtree root.
 * @returns {object} resolved node.
 */
function resolveRootNode(composition, rootNodeId) {
  if (rootNodeId !== undefined) {
    const node = composition.nodes.find((candidate) => candidate.id === rootNodeId)
    if (node === undefined) {
      throw new CompositionError('UNKNOWN_NODE', `node ${JSON.stringify(rootNodeId)} does not exist`)
    }
    return node
  }
  const root = composition.nodes.find((node) => node.sessionId === composition.rootSessionId)
  if (root === undefined) {
    throw new CompositionError('ROOT_NOT_FOUND', 'the composition root session is not attached as a node')
  }
  return root
}

/**
 * Build one clone or bud plan for a tree.
 * @param {object} input - composition, optional explicit root, tasks, and time.
 * @returns {object} clone plan.
 */
export function planClone({
  composition,
  rootNodeId = undefined,
  tasks = [],
  snapshotAt = Date.now(),
  kind = 'clone',
}) {
  if (kind !== 'clone' && kind !== 'bud') {
    throw new CompositionError('INVALID_FIELD', "kind must be 'clone' or 'bud'")
  }
  if (!Number.isSafeInteger(snapshotAt) || snapshotAt < 0) {
    throw new CompositionError('INVALID_FIELD', 'snapshotAt must be a non-negative safe integer')
  }
  const root = resolveRootNode(composition, rootNodeId)
  const tree = treeOf(composition, root.id)
  const included = new Set(tree.nodes.map((node) => node.id))
  const nodes = tree.nodes.map((node) => ({
    sourceNodeId: node.id,
    sourceSessionId: node.sessionId,
    kind: node.kind,
    label: node.label,
    source: node.source,
    mode: node.mode,
    provider: node.provider,
    nativeParentSessionId: node.nativeParentSessionId,
    cwd: node.cwd,
    permissionPreset: node.permissionPreset,
    cloneOf: node.sessionId ?? node.id,
  }))
  const edges = tree.edges.map((edge) => ({
    parentSourceNodeId: edge.parentId,
    childSourceNodeId: edge.childId,
    role: edge.role,
  }))
  const clonedTasks = tasks
    .filter((task) => task.ownerNodeId === null || included.has(task.ownerNodeId))
    .map((task) => ({
      sourceTaskId: task.id,
      subject: task.subject,
      description: task.description,
      status: task.status,
      ownerSourceNodeId: task.ownerNodeId,
      teamId: task.teamId ?? null,
      blockedBy: Array.isArray(task.blockedBy) ? [...task.blockedBy] : [],
      writeScopes: Array.isArray(task.writeScopes) ? [...task.writeScopes] : [],
    }))
  return {
    version: CLONE_PLAN_VERSION,
    kind,
    sourceCompositionId: composition.id,
    sourceRootSessionId: composition.rootSessionId,
    rootSourceNodeId: root.id,
    snapshotAt,
    nodes,
    edges,
    tasks: clonedTasks,
  }
}
