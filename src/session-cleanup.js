/**
 * User-confirmed cleanup of sessions that no longer have an overlay owner.
 *
 * DSH exposes no public "delete Session" service; this adapter therefore
 * operates only on the default JSONL Session directory, and only after the
 * caller has revalidated that a session is persisted, inactive, and not a
 * member (or ancestor) of any composition. Composition members are never
 * removed by the wild-session path; one-shot members are removed through the
 * manager first so their edge is repaired before the session directory is
 * deleted.
 */

import {
  readdir, realpath, rm, stat,
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

import { planClone } from './clone.js'
import { CompositionError } from './graph.js'

/** Maximum number of sessions or one-shot nodes in one cleanup request. */
export const MAX_CLEANUP_ITEMS = 100

/** Default JSONL Session root used by DSH Desktop. */
export function defaultSessionRoot() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'sessions')
}

/**
 * @param {string} dir - session directory.
 * @returns {Promise<number>} total bytes below the directory, symlinks excluded.
 */
async function directoryBytes(dir) {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) continue
    if (entry.isDirectory()) total += await directoryBytes(path)
    else if (entry.isFile()) total += (await stat(path)).size
  }
  return total
}

/**
 * Index the default JSONL root by Session id. A Session directory is a direct
 * child of a project directory; we do not follow symlinks.
 * @param {string} root - absolute session root.
 * @returns {Promise<Map<string, {sessionId: string, dir: string, size: number}>>}
 */
async function scanSessionDirectories(root) {
  const found = new Map()
  async function walk(dir, depth) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isDirectory()) continue
      const path = join(dir, entry.name)
      if (depth >= 1 && entry.name.startsWith('session-')) {
        const files = await readdir(path).catch(() => [])
        if (!files.some((name) => /^session\.v?\d+\.jsonl\.zstd$/.test(name))) {
          if (depth < 3) await walk(path, depth + 1)
          continue
        }
        const size = await directoryBytes(path).catch(() => 0)
        if (!found.has(entry.name)) found.set(entry.name, { sessionId: entry.name, dir: path, size })
        continue
      }
      if (depth < 3) await walk(path, depth + 1)
    }
  }
  await walk(root, 0)
  return found
}

/**
 * @param {object} ctx - Host context.
 * @param {object} store - composition store.
 * @param {object} discovery - discovery facade.
 * @param {object} manager - composition manager.
 * @param {{sessionsRoot?: string, logger?: object, now?: () => number}} [options]
 * @returns {object} preview/clean service.
 */
export function createSessionCleanup({
  ctx,
  store,
  discovery,
  manager,
  sessionsRoot = defaultSessionRoot(),
  logger = undefined,
  now = () => Date.now(),
}) {
  const configuredRoot = typeof sessionsRoot === 'string' && sessionsRoot.length > 0
    ? sessionsRoot
    : defaultSessionRoot()
  const root = resolve(configuredRoot)
  const rootIsFilesystemRoot = root === parse(root).root
  const log = logger ?? ctx.logger
  const sessions = () => ctx.get?.('sessions') ?? ctx.sessions
  const workspaces = () => ctx.get?.('workspaceRegistry')
  /** @type {Promise<{dirs: Map<string, object>, rootReal: string|null}>|null} */
  let scanInFlight = null

  /**
   * @returns {Promise<{dirs: Map<string, object>, rootReal: string|null}>}
   */
  async function scan() {
    if (scanInFlight !== null) return scanInFlight
    scanInFlight = (async () => {
      try {
        if (rootIsFilesystemRoot) return { dirs: new Map(), rootReal: null }
        const rootStat = await stat(root)
        if (!rootStat.isDirectory()) return { dirs: new Map(), rootReal: null }
        const rootReal = await realpath(root)
        if (rootReal === parse(rootReal).root) return { dirs: new Map(), rootReal: null }
        return { dirs: await scanSessionDirectories(rootReal), rootReal }
      } catch {
        return { dirs: new Map(), rootReal: null }
      }
    })().finally(() => { scanInFlight = null })
    return scanInFlight
  }

  /**
   * @param {string} sessionId - live Session id.
   * @returns {boolean}
   */
  function isLive(sessionId) {
    try {
      return sessions()?.get?.(sessionId) !== undefined
    } catch {
      return true
    }
  }

  /**
   * Compute the current preview. The result intentionally contains labels and
   * sizes only; it never returns cwd, transcript text, or the session root path.
   * @returns {Promise<object>}
   */
  async function preview() {
    if (store.mode !== 'durable' || store.degraded === true) {
      return {
        available: false,
        reason: 'durable composition storage is required for safe cleanup',
        wild: [],
        legacy: [],
        oneShot: [],
        totals: emptyTotals(),
        scanned: 0,
      }
    }
    const listed = await discovery.list()
    if (listed.complete !== true) {
      return {
        available: false,
        reason: 'session query is unavailable',
        wild: [],
        legacy: [],
        oneShot: [],
        totals: emptyTotals(),
        scanned: 0,
      }
    }
    const indexed = await scan()
    if (indexed.rootReal === null) {
      return {
        available: false,
        reason: 'default JSONL session root is unavailable',
        wild: [],
        legacy: [],
        oneShot: [],
        totals: emptyTotals(),
        scanned: 0,
      }
    }

    const summaries = new Map(listed.sessions.map((summary) => [summary.sessionId, summary]))
    const compositions = await store.list()
    const cloneRecords = await store.listClones?.() ?? []
    const live = new Set()
    const protectedIds = new Set()
    if (typeof process.env.DSH_SESSION_ID === 'string') protectedIds.add(process.env.DSH_SESSION_ID)

    for (const [, record] of compositions) {
      const composition = record?.composition
      if (composition === null || typeof composition !== 'object') continue
      for (const node of composition.nodes ?? []) {
        if (typeof node.sessionId !== 'string') continue
        protectedIds.add(node.sessionId)
      }
    }
    for (const [sessionId, summary] of summaries) {
      if (summary.live === true || isLive(sessionId)) live.add(sessionId)
    }
    // A native ancestor of a composition member must never be deleted: it owns
    // the cold resume path that the member's header references.
    const queue = [...protectedIds]
    for (let index = 0; index < queue.length; index += 1) {
      const parent = summaries.get(queue[index])?.nativeParentSessionId
      if (typeof parent === 'string' && !protectedIds.has(parent)) {
        protectedIds.add(parent)
        queue.push(parent)
      }
    }
    // Clone provenance sources are retained even when the clone is orphaned.
    for (const [, record] of cloneRecords) {
      for (const node of record?.nodeMapping ?? []) {
        if (typeof node.sourceSessionId === 'string') protectedIds.add(node.sourceSessionId)
      }
    }

    /** @type {Map<string, object>} */
    const wild = new Map()
    const addWild = (sessionId, reason, record) => {
      if (wild.has(sessionId)) return
      const summary = summaries.get(sessionId)
      const entry = indexed.dirs.get(sessionId)
      if (summary === undefined || entry === undefined) return
      if (live.has(sessionId) || protectedIds.has(sessionId)) return
      wild.set(sessionId, {
        sessionId,
        title: summary.title,
        size: entry.size,
        reason,
        rootSessionId: record?.newRootSessionId ?? null,
        cloneRecordId: record?.id ?? null,
      })
    }
    for (const [, record] of cloneRecords) {
      if (record === null || typeof record !== 'object') continue
      const rootComposed = typeof record.newRootSessionId === 'string'
        && protectedIds.has(record.newRootSessionId)
      if (record.status === 'completed' && rootComposed) continue
      const reason = record.status === 'failed'
        ? 'failed-clone'
        : record.status === 'orphaned'
          ? 'orphaned-clone'
          : 'clone-without-composition'
      for (const node of record.nodeMapping ?? []) {
        if (typeof node.newSessionId === 'string') addWild(node.newSessionId, reason, record)
      }
    }

    /** @type {Map<string, object>} */
    const legacy = new Map()
    const isCandidate = (sessionId) => !wild.has(sessionId)
      && !live.has(sessionId)
      && !protectedIds.has(sessionId)
      && indexed.dirs.has(sessionId)
    for (const summary of summaries.values()) {
      if (summary.isSeeded !== true) continue
      if (!isCandidate(summary.sessionId)) continue
      // Seed-bearing sessions with no composition include both clone roots
      // and the new native root left by a subagent_fork mirror miss. A fork
      // root may still carry a parentSession header, so parent presence alone
      // cannot exclude it; the user opts in to this whole historical group.
      const parent = typeof summary.nativeParentSessionId === 'string'
        ? summary.nativeParentSessionId
        : null
      legacy.set(summary.sessionId, {
        sessionId: summary.sessionId,
        title: summary.title,
        size: indexed.dirs.get(summary.sessionId)?.size ?? 0,
        reason: parent === null ? 'legacy-seeded-root' : 'legacy-seeded-fork',
        rootSessionId: summary.sessionId,
      })
    }
    let added = true
    while (added) {
      added = false
      for (const summary of summaries.values()) {
        if (summary.isSeeded !== true || summary.source !== 'subagent') continue
        const parent = summary.nativeParentSessionId
        if (typeof parent !== 'string' || !legacy.has(parent)) continue
        if (!isCandidate(summary.sessionId) || legacy.has(summary.sessionId)) continue
        legacy.set(summary.sessionId, {
          sessionId: summary.sessionId,
          title: summary.title,
          size: indexed.dirs.get(summary.sessionId)?.size ?? 0,
          reason: 'legacy-seeded-descendant',
          rootSessionId: parent,
        })
        added = true
      }
    }

    /** @type {Map<string, object>} */
    const oneShot = new Map()
    for (const [, record] of compositions) {
      const composition = record?.composition
      if (composition === null || typeof composition !== 'object') continue
      const parents = new Set((composition.edges ?? []).map((edge) => edge.parentId))
      for (const node of composition.nodes ?? []) {
        if (node.mode !== 'one-shot') continue
        if (node.sessionId === composition.rootSessionId) continue
        if (parents.has(node.id)) continue // promote-only removal is unsafe with descendants
        if (typeof node.sessionId === 'string') {
          if (live.has(node.sessionId)) continue
          const entry = indexed.dirs.get(node.sessionId)
          const summary = summaries.get(node.sessionId)
          if (entry === undefined || summary === undefined) continue
          oneShot.set(node.id, {
            nodeId: node.id,
            rootSessionId: composition.rootSessionId,
            sessionId: node.sessionId,
            title: summary.title ?? node.label,
            size: entry.size,
            placeholder: false,
          })
        } else {
          oneShot.set(node.id, {
            nodeId: node.id,
            rootSessionId: composition.rootSessionId,
            sessionId: null,
            title: node.label,
            size: 0,
            placeholder: true,
          })
        }
      }
    }

    const totals = emptyTotals()
    for (const entry of wild.values()) {
      totals.wild.count += 1
      totals.wild.bytes += entry.size
    }
    for (const entry of legacy.values()) {
      totals.legacy.count += 1
      totals.legacy.bytes += entry.size
    }
    for (const entry of oneShot.values()) {
      totals.oneShot.count += 1
      totals.oneShot.bytes += entry.size
    }
    return {
      available: true,
      scanned: indexed.dirs.size,
      wild: [...wild.values()].sort((a, b) => b.size - a.size),
      legacy: [...legacy.values()].sort((a, b) => b.size - a.size),
      oneShot: [...oneShot.values()].sort((a, b) => b.size - a.size),
      totals,
    }
  }

  /**
   * @param {string} sessionId - candidate.
   * @param {{dirs: Map<string, object>, rootReal: string|null}|null} [indexed] - precomputed scan.
   * @returns {Promise<boolean>} whether the directory was removed.
   */
  async function removeSession(sessionId, indexed = null) {
    const current = indexed ?? await scan()
    const entry = current.dirs.get(sessionId)
    if (current.rootReal === null) throw new CompositionError('CLEANUP_UNAVAILABLE', 'session root is unavailable')
    if (entry === undefined) return false
    const dirReal = await realpath(entry.dir)
    const rel = relative(current.rootReal, dirReal)
    if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) || basename(dirReal) !== sessionId) {
      throw new CompositionError('CLEANUP_UNSAFE_PATH', 'session directory is outside the configured root')
    }
    await rm(dirReal, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    return true
  }

  /**
   * Remove a deleted Session from workspace accounting and archive/pin sets.
   * @param {string} sessionId - deleted Session.
   * @returns {Promise<void>}
   */
  async function detachWorkspace(sessionId) {
    const registry = workspaces()
    for (const workspace of registry?.list?.() ?? []) {
      if (!Array.isArray(workspace.sessionIds) || !workspace.sessionIds.includes(sessionId)) continue
      try {
        await workspace.detachSession?.(sessionId)
      } catch (error) {
        log?.warn?.('dsh-combinagents: could not detach a cleaned session from its workspace', error)
      }
    }
    try {
      await registry?.unarchiveSession?.(sessionId)
    } catch {
      // An id that was never archived is already in the desired state.
    }
    try {
      await registry?.unpinSession?.(sessionId)
    } catch {
      // An id that was never pinned is already in the desired state.
    }
  }


  /**
   * Estimate the session count and copied-history size of a clone/bud before
   * the user confirms it. This reads only persisted file sizes; it never opens
   * a transcript.
   * @param {string} rootSessionId - composition owner.
   * @param {string|null} nodeId - bud root, or null for a whole-tree clone.
   * @returns {Promise<{kind: 'clone'|'bud', nodes: number, sessions: number, bytes: number}>}
   */
  async function estimateClone(rootSessionId, nodeId = null) {
    if (typeof rootSessionId !== 'string' || rootSessionId.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'rootSessionId must be a non-empty string')
    }
    const record = await manager.state(rootSessionId)
    if (record === null || record === undefined) {
      throw new CompositionError('COMPOSITION_NOT_FOUND', 'composition not found')
    }
    const composition = record.composition
    const kind = nodeId === null ? 'clone' : 'bud'
    const tasks = await manager.getTasks?.(composition.rootSessionId) ?? []
    const plan = planClone({
      composition,
      rootNodeId: nodeId ?? undefined,
      tasks,
      snapshotAt: now(),
      kind,
    })
    const indexed = await scan()
    const seen = new Set()
    let bytes = 0
    let sessions = 0
    for (const node of plan.nodes) {
      if (typeof node.sourceSessionId !== 'string' || seen.has(node.sourceSessionId)) continue
      seen.add(node.sourceSessionId)
      const entry = indexed.dirs.get(node.sourceSessionId)
      if (entry === undefined) continue
      sessions += 1
      bytes += entry.size
    }
    return { kind, nodes: plan.nodes.length, sessions, bytes }
  }

  /**
   * Delete the requested candidates. The preview is recomputed inside the
   * process-wide composition mutation lock so another profile cannot attach a
   * candidate between verification and removal.
   * @param {{sessionIds?: string[], oneShotNodeIds?: string[], includeLegacy?: boolean}} input
   * @returns {Promise<object>}
   */
  async function clean(input = {}) {
    const sessionIds = Array.isArray(input.sessionIds) ? input.sessionIds : []
    const oneShotNodeIds = Array.isArray(input.oneShotNodeIds) ? input.oneShotNodeIds : []
    if (sessionIds.length === 0 && oneShotNodeIds.length === 0) {
      throw new CompositionError('INVALID_FIELD', 'select at least one session or one-shot node')
    }
    if (sessionIds.length > MAX_CLEANUP_ITEMS || oneShotNodeIds.length > MAX_CLEANUP_ITEMS) {
      throw new CompositionError('TOO_MANY_ITEMS', `at most ${MAX_CLEANUP_ITEMS} items may be cleaned at once`)
    }
    const run = async () => {
      const current = await preview()
      if (!current.available) {
        throw new CompositionError('CLEANUP_UNAVAILABLE', current.reason ?? 'session cleanup is unavailable')
      }
      const indexed = await scan()
      const wild = new Map(current.wild.map((entry) => [entry.sessionId, entry]))
      const legacy = new Map(current.legacy.map((entry) => [entry.sessionId, entry]))
      const oneShot = new Map(current.oneShot.map((entry) => [entry.nodeId, entry]))
      const deleted = []
      const failures = []
      let bytesFreed = 0
      const deletedIds = new Set()
      const remove = async (sessionId) => {
        if (isLive(sessionId)) {
          failures.push({ sessionId, code: 'SESSION_LIVE', message: 'the session is live' })
          return
        }
        try {
          const removed = await removeSession(sessionId, indexed)
          if (removed) {
            bytesFreed += (wild.get(sessionId) ?? legacy.get(sessionId))?.size ?? 0
            deletedIds.add(sessionId)
            await detachWorkspace(sessionId)
          }
          deletedIds.add(sessionId)
          deleted.push(sessionId)
        } catch (error) {
          failures.push({ sessionId, code: error?.code ?? 'CLEANUP_FAILED', message: error?.message ?? String(error) })
        }
      }
      for (const sessionId of new Set(sessionIds)) {
        if (typeof sessionId !== 'string' || sessionId.length === 0) {
          failures.push({ sessionId: String(sessionId), code: 'INVALID_FIELD', message: 'invalid session id' })
          continue
        }
        if (legacy.has(sessionId) && input.includeLegacy !== true) {
          failures.push({ sessionId, code: 'LEGACY_NOT_CONFIRMED', message: 'historical suspects require explicit confirmation' })
          continue
        }
        if (!wild.has(sessionId) && !legacy.has(sessionId)) {
          failures.push({ sessionId, code: 'NOT_ELIGIBLE', message: 'the session is not a current cleanup candidate' })
          continue
        }
        await remove(sessionId)
      }
      let oneShotRemoved = 0
      for (const nodeId of new Set(oneShotNodeIds)) {
        const candidate = oneShot.get(nodeId)
        if (candidate === undefined) {
          failures.push({ nodeId, code: 'NOT_ELIGIBLE', message: 'the one-shot node is not a current cleanup candidate' })
          continue
        }
        try {
          if (candidate.sessionId !== null && isLive(candidate.sessionId)) {
            failures.push({ nodeId, code: 'SESSION_LIVE', message: 'the one-shot session is live' })
            continue
          }
          await manager.removeNode(candidate.rootSessionId, { nodeId, mode: 'promote' })
          oneShotRemoved += 1
          if (candidate.sessionId !== null) {
            const removed = await removeSession(candidate.sessionId, indexed)
            if (removed) {
              bytesFreed += candidate.size
              deletedIds.add(candidate.sessionId)
              await detachWorkspace(candidate.sessionId)
            }
          }
        } catch (error) {
          failures.push({ nodeId, code: error?.code ?? 'CLEANUP_FAILED', message: error?.message ?? String(error) })
        }
      }
      // A failed/orphaned clone record may be removed only after every Session
      // it owns is gone (or no longer has a directory).
      let cloneRecordsDeleted = 0
      const after = await scan()
      for (const [cloneId, record] of await store.listClones?.() ?? []) {
        if (record === null || typeof record !== 'object') continue
        if (record.status === 'completed' && typeof record.newRootSessionId === 'string'
          && (await store.get(record.newRootSessionId)) !== undefined) continue
        const mapped = (record.nodeMapping ?? [])
          .map((node) => node.newSessionId)
          .filter((id) => typeof id === 'string')
        if (mapped.length === 0 || mapped.every((id) => deletedIds.has(id) || !after.dirs.has(id))) {
          try {
            await store.deleteClone?.(cloneId)
            cloneRecordsDeleted += 1
          } catch (error) {
            failures.push({ cloneId, code: 'CLEANUP_FAILED', message: error?.message ?? String(error) })
          }
        }
      }
      discovery.invalidateCorpus?.()
      const auditRoots = new Set()
      for (const sessionId of sessionIds) {
        const rootSessionId = wild.get(sessionId)?.rootSessionId ?? legacy.get(sessionId)?.rootSessionId
        if (typeof rootSessionId === 'string') auditRoots.add(rootSessionId)
      }
      for (const nodeId of oneShotNodeIds) {
        const rootSessionId = oneShot.get(nodeId)?.rootSessionId
        if (typeof rootSessionId === 'string') auditRoots.add(rootSessionId)
      }
      for (const rootSessionId of auditRoots) {
        if (typeof rootSessionId !== 'string') continue
        await manager.recordAudit?.(rootSessionId, {
          kind: 'session-cleanup',
          outcome: 'deleted',
          detail: {
            sessionIds,
            oneShotNodeIds,
            includeLegacy: input.includeLegacy === true,
            bytesFreed,
            failures: failures.length,
          },
        })
      }
      return {
        deleted,
        failures,
        bytesFreed,
        oneShotRemoved,
        cloneRecordsDeleted,
        includeLegacy: input.includeLegacy === true,
        at: now(),
      }
    }
    if (typeof store.withMutationLock === 'function') return store.withMutationLock(run)
    return run()
  }

  return {
    preview,
    clean,
    estimateClone,
    get available() {
      return scan().then((value) => value.rootReal !== null)
    },
  }
}

/** @returns {{wild: {count: number, bytes: number}, legacy: {count: number, bytes: number}, oneShot: {count: number, bytes: number}}} */
function emptyTotals() {
  return {
    wild: { count: 0, bytes: 0 },
    legacy: { count: 0, bytes: 0 },
    oneShot: { count: 0, bytes: 0 },
  }
}
