/**
 * DSH storage-domain adapter for dsh-combinagents.
 *
 * The plugin owns one profile-level domain. Each record is keyed by the root
 * session id and carries the composition plus its last write time. The domain
 * uses `per-record` + `backup-and-skip` so one corrupt record cannot make every
 * composition unreadable.
 *
 * The storage-domain contract types record schemas as zod. Its runtime only
 * calls `schema.parse` (and `safeParse` for a global slot), so the pure graph
 * validator doubles as the schema and the bundle stays dependency-free. Re-check
 * this assumption when the DSH storage contract changes.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { CompositionError, validateComposition } from './graph.js'

/** Domain name owned by this plugin. */
export const COMPOSITION_DOMAIN_NAME = 'combinagents'

/** Table holding one record per root session. */
export const COMPOSITION_TABLE = 'compositions'

/** Table holding per-composition edge grants. */
export const POLICY_TABLE = 'policies'

/** Table holding the active append-only capability audit rows. */
export const AUDIT_TABLE = 'audit'

/**
 * Table holding audit rows rotated out of the active window. Rotation must not
 * silently delete accountability evidence; archived rows stay readable.
 */
export const AUDIT_ARCHIVE_TABLE = 'audit_archive'

/** Table holding plugin-owned composition tasks (never DSH Team tasks). */
export const TASK_TABLE = 'tasks'

/** Table holding clone/bud provenance records. */
export const CLONE_TABLE = 'clones'

/** Table holding composition-scoped Team definitions. */
export const TEAM_TABLE = 'teams'

/**
 * Validate one durable composition record.
 * @param {unknown} raw - stored value.
 * @returns {{composition: object, updatedAt: number}} the validated record.
 */
function parseCompositionRecord(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('composition record must be an object')
  }
  if (!Number.isSafeInteger(raw.updatedAt) || raw.updatedAt < 0) {
    throw new TypeError('composition record updatedAt must be a non-negative safe integer')
  }
  const result = validateComposition(raw.composition)
  if (!result.ok) {
    const first = result.errors[0]
    throw new TypeError(`invalid composition record: ${first.code} ${first.message}`)
  }
  return raw
}

/** Runtime-compatible schema for one stored composition record. */
export const compositionRecordSchema = {
  parse: parseCompositionRecord,
  /**
   * @param {unknown} raw - candidate record.
   * @returns {{success: true, data: object}|{success: false, error: unknown}}
   */
  safeParse(raw) {
    try {
      return { success: true, data: parseCompositionRecord(raw) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

/** Runtime-compatible schema for one edge-policy record. */
export const policyRecordSchema = {
  parse(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('policy record must be an object')
    }
    if (raw.version !== 1 || typeof raw.rootSessionId !== 'string' || typeof raw.edges !== 'object' || Array.isArray(raw.edges)) {
      throw new TypeError('policy record is malformed')
    }
    if (!Number.isSafeInteger(raw.updatedAt) || raw.updatedAt < 0) {
      throw new TypeError('policy record updatedAt must be a non-negative safe integer')
    }
    return raw
  },
  safeParse(raw) {
    try {
      return { success: true, data: policyRecordSchema.parse(raw) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

/** Runtime-compatible schema for one audit row. */
export const auditRecordSchema = {
  parse(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('audit record must be an object')
    }
    if (typeof raw.id !== 'string' || typeof raw.rootSessionId !== 'string'
      || typeof raw.kind !== 'string' || typeof raw.outcome !== 'string'
      || !Number.isSafeInteger(raw.at) || raw.at < 0) {
      throw new TypeError('audit record is malformed')
    }
    return raw
  },
  safeParse(raw) {
    try {
      return { success: true, data: auditRecordSchema.parse(raw) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

/** Runtime-compatible schema for one clone/bud provenance record. */
export const cloneRecordSchema = {
  parse(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('clone record must be an object')
    }
    if (typeof raw.id !== 'string' || typeof raw.sourceCompositionId !== 'string'
      || typeof raw.sourceRootSessionId !== 'string' || typeof raw.newRootSessionId !== 'string'
      || (raw.kind !== 'clone' && raw.kind !== 'bud')
      || (raw.status !== 'completed' && raw.status !== 'failed' && raw.status !== 'orphaned')
      || !Number.isSafeInteger(raw.snapshotAt) || raw.snapshotAt < 0
      || !Array.isArray(raw.nodeMapping)) {
      throw new TypeError('clone record is malformed')
    }
    return raw
  },
  safeParse(raw) {
    try {
      return { success: true, data: cloneRecordSchema.parse(raw) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

/** Runtime-compatible schema for one composition-scoped Team. */
export const teamRecordSchema = {
  parse(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('team record must be an object')
    }
    if (typeof raw.id !== 'string' || raw.id.length === 0
      || typeof raw.rootSessionId !== 'string' || raw.rootSessionId.length === 0
      || typeof raw.rootNodeId !== 'string' || raw.rootNodeId.length === 0
      || typeof raw.label !== 'string'
      || !Number.isSafeInteger(raw.createdAt) || raw.createdAt < 0
      || !Number.isSafeInteger(raw.updatedAt) || raw.updatedAt < 0
      || (raw.nodeIds !== undefined
        && (!Array.isArray(raw.nodeIds) || raw.nodeIds.some((id) => typeof id !== 'string')))) {
      throw new TypeError('team record is malformed')
    }
    return raw
  },
  safeParse(raw) {
    try {
      return { success: true, data: teamRecordSchema.parse(raw) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

/** Runtime-compatible schema for one plugin-owned task. */
export const taskRecordSchema = {
  parse(raw) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new TypeError('task record must be an object')
    }
    if (typeof raw.id !== 'string' || typeof raw.rootSessionId !== 'string'
      || typeof raw.subject !== 'string' || raw.subject.length === 0
      || typeof raw.status !== 'string'
      || !Number.isSafeInteger(raw.revision) || raw.revision < 1
      || !Number.isSafeInteger(raw.createdAt) || !Number.isSafeInteger(raw.updatedAt)) {
      throw new TypeError('task record is malformed')
    }
    return raw
  },
  safeParse(raw) {
    try {
      return { success: true, data: taskRecordSchema.parse(raw) }
    } catch (error) {
      return { success: false, error }
    }
  },
}

/** Declare the domain once; `ctx.storageDomain.open` consumes this object. */
export const COMPOSITION_DOMAIN_SPEC = {
  name: COMPOSITION_DOMAIN_NAME,
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    [COMPOSITION_TABLE]: { valueSchema: compositionRecordSchema },
    [POLICY_TABLE]: { valueSchema: policyRecordSchema },
    [AUDIT_TABLE]: { valueSchema: auditRecordSchema },
    [AUDIT_ARCHIVE_TABLE]: { valueSchema: auditRecordSchema },
    [TASK_TABLE]: { valueSchema: taskRecordSchema },
    [CLONE_TABLE]: { valueSchema: cloneRecordSchema },
    [TEAM_TABLE]: { valueSchema: teamRecordSchema },
  },
}

/**
 * Create the storage facade. Opening is asynchronous; every read and write
 * awaits the same `ready` promise so callers never observe a half-open store.
 * An open failure degrades to an in-memory map with a warning, because losing
 * the composition view is worse than losing durability.
 * @param {object} ctx - Host plugin context.
 * @param {{logger?: {info?: Function, warn?: Function}}} [options] - logger override.
 * @returns {{ready: Promise<void>, mode: 'durable'|'memory', get: Function,
 *   put: Function, delete: Function, list: Function, close: Function}}
 */
export function createStore(ctx, options = {}) {
  const log = options.logger ?? ctx.logger
  const tableNames = Object.keys(COMPOSITION_DOMAIN_SPEC.tables)
  const storageDir = options.storageDir ?? (ctx.get?.('storage') === undefined
    ? null
    : join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'storages', COMPOSITION_DOMAIN_NAME))
  const revisionPath = storageDir === null ? null : join(storageDir, '.revision')
  let revision = null
  let generation = 0
  let reloading = null
  let reloadPending = false
  let writeDepth = 0
  let mutationActive = false
  let revisionDirty = false
  let mutationTail = Promise.resolve()
  const mutationScope = new AsyncLocalStorage()
  let onReload
  /** @type {Map<string, Map<string, object>>} */
  const memory = new Map(tableNames.map((name) => [name, new Map()]))
  /** @type {null | {tables: Map<string, object>, close: Function}} */
  let opened = null
  let mode = 'memory'
  /** True only after a durable domain could not be reloaded; reads use the
   * snapshot kept in `memory`, and mutations must fail instead of silently
   * becoming process-local. */
  let degraded = false
  /** @type {{loaded: boolean, byRoot: Map<string, Map<string, object>>}} */
  const taskIndex = { loaded: false, byRoot: new Map() }
  /** @type {{loaded: boolean, byRoot: Map<string, Map<string, object>>}} */
  const cloneIndex = { loaded: false, byRoot: new Map() }
  let auditWrites = 0
  const AUDIT_LIMIT = 5000

  const ready = open().catch((error) => {
    // open() handles its own failures; this is a defensive net.
    log?.warn?.('dsh-combinagents: storage open failed', error)
  })

  /**
   * Read the cross-process revision marker. The marker is a tiny sidecar in
   * the domain directory; it is not part of the domain data and is ignored by
   * the storage backend. A missing marker means the domain predates this
   * coherence path, not that there are no records.
   * @returns {string|null} marker, or null when unavailable.
   */
  function readRevision() {
    if (revisionPath === null) return null
    try {
      return readFileSync(revisionPath, 'utf8').trim() || null
    } catch {
      return null
    }
  }

  /**
   * Publish a new cross-process revision after a durable domain write.
   * @returns {void}
   */
  function writeRevision() {
    if (revisionPath === null) return
    if (mutationActive) {
      revisionDirty = true
      return
    }
    publishRevision()
  }

  /**
   * Publish the deferred revision at the end of one complete mutation. Readers
   * in other profiles therefore reload a composition+policy pair, never a
   * half-written intermediate snapshot.
   * @returns {void}
   */
  function publishRevision() {
    if (revisionPath === null) return
    const token = `${Date.now().toString(36)}-${process.pid}-${randomUUID()}`
    try {
      mkdirSync(storageDir, { recursive: true })
      const temporary = `${revisionPath}.${process.pid}.${randomUUID()}`
      writeFileSync(temporary, token, 'utf8')
      renameSync(temporary, revisionPath)
      revision = token
    } catch (error) {
      log?.warn?.('dsh-combinagents: could not publish a storage revision', error)
    }
  }

  /**
   * Reload the domain when another process published a newer revision.
   * The domain is reopened rather than patched so the storage-domain snapshot
   * remains the single source of truth. Reads after this call see the new
   * snapshot; manager membership is invalidated through `generation`.
   * @returns {Promise<boolean>} whether the snapshot is current (or usable).
   */
  async function refresh(force = false) {
    if (revisionPath === null || mode !== 'durable' || degraded) return true
    if (!force && (writeDepth > 0 || mutationActive)) {
      reloadPending = true
      return true
    }
    const disk = readRevision()
    if (disk === null || disk === revision) return true
    if (reloading !== null) return reloading
    reloading = (async () => {
      const previous = opened
      // The storage facility allows only one open handle per domain name, so
      // the old handle must close before the new snapshot can open. Keep a
      // process-local snapshot first: if the reopen fails, reads must still
      // show the composition instead of an empty memory table.
      if (previous !== null) snapshotTables(previous)
      opened = null
      if (previous !== null) {
        try {
          await previous.close()
        } catch (error) {
          log?.warn?.('dsh-combinagents: closing the previous composition domain failed', error)
        }
      }
      if (!await open()) {
        mode = 'memory'
        degraded = true
        log?.warn?.('dsh-combinagents: composition domain reload failed; serving the in-memory snapshot until restart')
        return false
      }
      generation += 1
      taskIndex.loaded = false
      taskIndex.byRoot.clear()
      cloneIndex.loaded = false
      cloneIndex.byRoot.clear()
      onReload?.()
      return true
    })().finally(() => { reloading = null })
    return reloading
  }

  /**
   * Copy one open domain's records into the memory fallback. Record values are
   * immutable, so sharing references is safe.
   * @param {{tables: Map<string, object>}} source - open domain handle.
   * @returns {void}
   */
  function snapshotTables(source) {
    for (const [name, table] of source.tables) {
      const bucket = memory.get(name)
      if (bucket === undefined) continue
      try {
        bucket.clear()
        for (const [key, value] of table.entries()) bucket.set(key, value)
      } catch (error) {
        log?.warn?.('dsh-combinagents: could not snapshot a composition table', { table: name }, error)
      }
    }
  }

  /**
   * Serialize a composition mutation across Host processes that share the
   * storage domain. The lock is re-entrant within one process: nested
   * per-root locks reuse the outer global lock. Reads do not take it; they
   * refresh from the revision marker instead.
   * @param {() => Promise<unknown>} task - mutation body.
   * @returns {Promise<unknown>} task result.
   */
  async function withMutationLock(task) {
    if (storageDir === null) return task()
    if (mutationScope.getStore() === true) return task()
    const run = async () => {
      if (degraded) {
        throw new CompositionError(
          'STORAGE_UNAVAILABLE',
          'composition storage is unavailable; restart the Host',
        )
      }
      await refresh()
      mkdirSync(storageDir, { recursive: true })
      const lockPath = join(storageDir, '.mutation.lock')
      const deadline = Date.now() + 10_000
      for (;;) {
        try {
          const fd = openSync(lockPath, 'wx')
          try {
            writeSync(fd, `${process.pid} ${Date.now()}`)
          } finally {
            closeSync(fd)
          }
          break
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error
          try {
            if (Date.now() - statSync(lockPath).mtimeMs > 30_000) {
              unlinkSync(lockPath)
              continue
            }
          } catch {
            // The owner may have released it between stat and unlink.
          }
          if (Date.now() > deadline) {
            throw new Error('another DSH profile is changing the composition; retry')
          }
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
      }
      mutationActive = true
      try {
        // Re-read after the lock: the previous owner may have written while we
        // waited. Never apply a mutation to a snapshot that could not be
        // refreshed; that would overwrite another profile's newer state.
        if (!await refresh(true) || degraded) {
          throw new CompositionError(
            'STORAGE_UNAVAILABLE',
            'composition storage is unavailable; restart the Host',
          )
        }
        return await mutationScope.run(true, task)
      } finally {
        mutationActive = false
        if (revisionDirty) {
          revisionDirty = false
          publishRevision()
        }
        try {
          unlinkSync(lockPath)
        } catch {
          // already released by stale-lock recovery
        }
        if (reloadPending) {
          reloadPending = false
          void refresh()
        }
      }
    }
    const result = mutationTail.then(run, run)
    mutationTail = result.then(() => undefined, () => undefined)
    return result
  }

  /**
   * Run one durable write without allowing a concurrent reload to close the
   * table under it.
   * @param {() => Promise<unknown>} task - write body.
   * @returns {Promise<unknown>} body result.
   */
  async function durableWrite(task) {
    writeDepth += 1
    try {
      return await task()
    } finally {
      writeDepth -= 1
      if (writeDepth === 0 && reloadPending) {
        reloadPending = false
        void refresh()
      }
    }
  }

  async function open() {
    const observedRevision = readRevision()
    const service = ctx.get?.('storageDomain') ?? ctx.storageDomain
    if (service === undefined) {
      log?.warn?.('dsh-combinagents: storageDomain unavailable; using memory storage')
      return false
    }
    let domain
    try {
      domain = await service.open(COMPOSITION_DOMAIN_SPEC)
      const tables = new Map()
      for (const name of tableNames) tables.set(name, domain.table(name))
      opened = { tables, close: () => domain.close() }
      mode = 'durable'
      // Keep the marker observed before loadAll: if another Host writes while
      // the snapshot loads, the next refresh sees the newer marker and reloads.
      // Re-reading it here would adopt a revision the snapshot does not contain.
      revision = observedRevision
      log?.info?.('dsh-combinagents: composition domain open')
      return true
    } catch (error) {
      try {
        await domain?.close?.()
      } catch {
        // The failed open still owns nothing useful.
      }
      log?.warn?.('dsh-combinagents: composition domain open failed; using memory storage', error)
      return false
    }
  }

  /**
   * Add one task row to the in-memory per-root index when it is loaded.
   * @param {string} taskId - storage key.
   * @param {object} record - task record.
   */
  function indexTask(taskId, record) {
    if (!taskIndex.loaded || typeof record?.rootSessionId !== 'string') return
    let bucket = taskIndex.byRoot.get(record.rootSessionId)
    if (bucket === undefined) {
      bucket = new Map()
      taskIndex.byRoot.set(record.rootSessionId, bucket)
    }
    bucket.set(taskId, record)
  }

  /**
   * Remove one task row from the in-memory per-root index.
   * @param {string} taskId - storage key.
   * @param {object|undefined} record - task record.
   */
  function unindexTask(taskId, record) {
    if (!taskIndex.loaded || typeof record?.rootSessionId !== 'string') return
    const bucket = taskIndex.byRoot.get(record.rootSessionId)
    if (bucket === undefined) return
    bucket.delete(taskId)
  }

  /**
   * Build the task index once from the durable table or memory map.
   * @returns {Promise<void>}
   */
  async function loadTaskIndex() {
    if (taskIndex.loaded) return
    const table = await tableOf(TASK_TABLE)
    const entries = table !== null ? [...table.entries()] : [...memory.get(TASK_TABLE).entries()]
    taskIndex.byRoot.clear()
    for (const [taskId, record] of entries) {
      if (typeof record?.rootSessionId !== 'string') continue
      let bucket = taskIndex.byRoot.get(record.rootSessionId)
      if (bucket === undefined) {
        bucket = new Map()
        taskIndex.byRoot.set(record.rootSessionId, bucket)
      }
      bucket.set(taskId, record)
    }
    taskIndex.loaded = true
  }

  /**
   * Remove one task id from every root bucket. A task can change its
   * `rootSessionId` during a cross-composition move; leaving the old bucket in
   * place would make the source board show a ghost row that can no longer be
   * updated or deleted through that root.
   * @param {string} taskId - storage key.
   */
  function removeTaskEverywhere(taskId) {
    if (!taskIndex.loaded) return
    for (const bucket of taskIndex.byRoot.values()) bucket.delete(taskId)
  }

  /**
   * @param {string} cloneId - storage key.
   * @param {object} record - clone record.
   */
  function indexClone(cloneId, record) {
    if (!cloneIndex.loaded || typeof record?.newRootSessionId !== 'string') return
    let bucket = cloneIndex.byRoot.get(record.newRootSessionId)
    if (bucket === undefined) {
      bucket = new Map()
      cloneIndex.byRoot.set(record.newRootSessionId, bucket)
    }
    bucket.set(cloneId, record)
  }

  /**
   * @param {string} cloneId - storage key.
   * @param {object|undefined} record - clone record.
   */
  function unindexClone(cloneId, record) {
    if (!cloneIndex.loaded || typeof record?.newRootSessionId !== 'string') return
    const bucket = cloneIndex.byRoot.get(record.newRootSessionId)
    if (bucket === undefined) return
    bucket.delete(cloneId)
  }

  /**
   * @returns {Promise<void>}
   */
  async function loadCloneIndex() {
    if (cloneIndex.loaded) return
    const table = await tableOf(CLONE_TABLE)
    const entries = table !== null ? [...table.entries()] : [...memory.get(CLONE_TABLE).entries()]
    cloneIndex.byRoot.clear()
    for (const [cloneId, record] of entries) {
      if (typeof record?.newRootSessionId !== 'string') continue
      let bucket = cloneIndex.byRoot.get(record.newRootSessionId)
      if (bucket === undefined) {
        bucket = new Map()
        cloneIndex.byRoot.set(record.newRootSessionId, bucket)
      }
      bucket.set(cloneId, record)
    }
    cloneIndex.loaded = true
  }

  /**
   * Trim the append-only audit table to the newest `limit` rows.
   * @param {number} [limit] - retained rows.
   * @returns {Promise<number>} removed rows.
   */
  async function pruneAudit(limit = AUDIT_LIMIT) {
    const table = await tableOf(AUDIT_TABLE)
    const archive = await tableOf(AUDIT_ARCHIVE_TABLE)
    const entries = table !== null ? [...table.entries()] : [...memory.get(AUDIT_TABLE).entries()]
    if (entries.length <= limit) return 0
    entries.sort((left, right) => Number(left[1]?.at ?? 0) - Number(right[1]?.at ?? 0))
    const remove = entries.slice(0, entries.length - limit)
    for (const [id, record] of remove) {
      // Archive before deleting: a failed archive write must not lose the row.
      if (archive !== null) await archive.put(id, record)
      else memory.get(AUDIT_ARCHIVE_TABLE).set(id, record)
      if (table !== null) await table.delete(id)
      else memory.get(AUDIT_TABLE).delete(id)
    }
    return remove.length
  }

  /**
   * @param {string} name - table name.
   * @returns {Promise<object|null>} durable table or null in memory mode.
   */
  async function tableOf(name) {
    await ready
    await refresh()
    return opened === null ? null : opened.tables.get(name) ?? null
  }

  /**
   * Reject durable mutations after a reload failure. Audits keep their own
   * best-effort catch, but composition/task records must not report success
   * for a process-local write that will disappear.
   * @returns {void}
   */
  function assertWritable() {
    if (degraded) {
      throw new CompositionError(
        'STORAGE_UNAVAILABLE',
        'composition storage is unavailable; restart the Host',
      )
    }
  }

  return {
    ready,
    refresh,
    withMutationLock,
    get generation() {
      return generation
    },
    setOnReload(callback) {
      onReload = typeof callback === 'function' ? callback : undefined
    },
    get mode() {
      return mode
    },
    get degraded() {
      return degraded
    },
    async get(key) {
      const table = await tableOf(COMPOSITION_TABLE)
      if (table !== null) return table.get(key)
      return memory.get(COMPOSITION_TABLE).get(key)
    },
    async put(key, record) {
      assertWritable()
      const table = await tableOf(COMPOSITION_TABLE)
      if (table !== null) {
        await durableWrite(() => table.put(key, record))
        writeRevision()
        return
      }
      memory.get(COMPOSITION_TABLE).set(key, record)
    },
    async delete(key) {
      assertWritable()
      const table = await tableOf(COMPOSITION_TABLE)
      if (table !== null) {
        await durableWrite(() => table.delete(key))
        writeRevision()
        return
      }
      memory.get(COMPOSITION_TABLE).delete(key)
    },
    async list() {
      const table = await tableOf(COMPOSITION_TABLE)
      if (table !== null) return [...table.entries()]
      return [...memory.get(COMPOSITION_TABLE).entries()]
    },
    async getPolicy(rootSessionId) {
      const table = await tableOf(POLICY_TABLE)
      if (table !== null) return table.get(rootSessionId)
      return memory.get(POLICY_TABLE).get(rootSessionId)
    },
    async putPolicy(rootSessionId, record) {
      assertWritable()
      const table = await tableOf(POLICY_TABLE)
      if (table !== null) {
        await durableWrite(() => table.put(rootSessionId, record))
        writeRevision()
        return
      }
      memory.get(POLICY_TABLE).set(rootSessionId, record)
    },
    async deletePolicy(rootSessionId) {
      assertWritable()
      const table = await tableOf(POLICY_TABLE)
      if (table !== null) {
        await durableWrite(() => table.delete(rootSessionId))
        writeRevision()
        return
      }
      memory.get(POLICY_TABLE).delete(rootSessionId)
    },
    async appendAudit(record) {
      const table = await tableOf(AUDIT_TABLE)
      if (table !== null) {
        await table.put(record.id, record)
      } else {
        memory.get(AUDIT_TABLE).set(record.id, record)
      }
      auditWrites += 1
      if (auditWrites % 100 === 0) await pruneAudit()
    },
    pruneAudit,
    async listAudit(rootSessionId) {
      const table = await tableOf(AUDIT_TABLE)
      const entries = table !== null ? [...table.entries()] : [...memory.get(AUDIT_TABLE).entries()]
      if (typeof rootSessionId !== 'string') return entries
      return entries.filter(([, record]) => record.rootSessionId === rootSessionId)
    },
    async listAuditArchive(rootSessionId) {
      const table = await tableOf(AUDIT_ARCHIVE_TABLE)
      const entries = table !== null ? [...table.entries()] : [...memory.get(AUDIT_ARCHIVE_TABLE).entries()]
      if (typeof rootSessionId !== 'string') return entries
      return entries.filter(([, record]) => record.rootSessionId === rootSessionId)
    },
    async getTask(taskId) {
      const table = await tableOf(TASK_TABLE)
      if (table !== null) return table.get(taskId)
      return memory.get(TASK_TABLE).get(taskId)
    },
    async putTask(taskId, record) {
      assertWritable()
      const table = await tableOf(TASK_TABLE)
      if (table !== null) {
        await durableWrite(() => table.put(taskId, record))
        writeRevision()
      } else {
        memory.get(TASK_TABLE).set(taskId, record)
      }
      removeTaskEverywhere(taskId)
      indexTask(taskId, record)
    },
    async deleteTask(taskId) {
      assertWritable()
      const table = await tableOf(TASK_TABLE)
      const previous = table !== null ? table.get(taskId) : memory.get(TASK_TABLE).get(taskId)
      if (table !== null) {
        await durableWrite(() => table.delete(taskId))
        writeRevision()
      } else {
        memory.get(TASK_TABLE).delete(taskId)
      }
      removeTaskEverywhere(taskId)
      unindexTask(taskId, previous)
    },
    async listTasks(rootSessionId) {
      if (typeof rootSessionId !== 'string') {
        const table = await tableOf(TASK_TABLE)
        return table !== null ? [...table.entries()] : [...memory.get(TASK_TABLE).entries()]
      }
      await loadTaskIndex()
      return [...(taskIndex.byRoot.get(rootSessionId)?.entries() ?? [])]
        .filter(([, record]) => record?.rootSessionId === rootSessionId)
    },
    async getTeam(teamId) {
      const table = await tableOf(TEAM_TABLE)
      if (table !== null) return table.get(teamId)
      return memory.get(TEAM_TABLE).get(teamId)
    },
    async putTeam(teamId, record) {
      assertWritable()
      const table = await tableOf(TEAM_TABLE)
      if (table !== null) {
        await durableWrite(() => table.put(teamId, record))
        writeRevision()
      } else {
        memory.get(TEAM_TABLE).set(teamId, record)
      }
    },
    async deleteTeam(teamId) {
      assertWritable()
      const table = await tableOf(TEAM_TABLE)
      if (table !== null) {
        await durableWrite(() => table.delete(teamId))
        writeRevision()
      } else {
        memory.get(TEAM_TABLE).delete(teamId)
      }
    },
    async listTeams(rootSessionId) {
      const table = await tableOf(TEAM_TABLE)
      const entries = table !== null ? [...table.entries()] : [...memory.get(TEAM_TABLE).entries()]
      return entries
        .map(([, record]) => record)
        .filter((record) => record?.rootSessionId === rootSessionId)
        .sort((left, right) => left.createdAt - right.createdAt)
    },
    async getClone(cloneId) {
      const table = await tableOf(CLONE_TABLE)
      if (table !== null) return table.get(cloneId)
      return memory.get(CLONE_TABLE).get(cloneId)
    },
    async putClone(cloneId, record) {
      assertWritable()
      const table = await tableOf(CLONE_TABLE)
      if (table !== null) {
        await durableWrite(() => table.put(cloneId, record))
        writeRevision()
      } else {
        memory.get(CLONE_TABLE).set(cloneId, record)
      }
      indexClone(cloneId, record)
    },
    async deleteClone(cloneId) {
      assertWritable()
      const table = await tableOf(CLONE_TABLE)
      const previous = table !== null ? table.get(cloneId) : memory.get(CLONE_TABLE).get(cloneId)
      if (table !== null) {
        await durableWrite(() => table.delete(cloneId))
        writeRevision()
      } else {
        memory.get(CLONE_TABLE).delete(cloneId)
      }
      unindexClone(cloneId, previous)
    },
    async listClones(rootSessionId) {
      if (typeof rootSessionId !== 'string') {
        const table = await tableOf(CLONE_TABLE)
        return table !== null ? [...table.entries()] : [...memory.get(CLONE_TABLE).entries()]
      }
      await loadCloneIndex()
      return [...(cloneIndex.byRoot.get(rootSessionId)?.entries() ?? [])]
    },
    async close() {
      await ready.catch(() => {})
      if (opened !== null) {
        await opened.close()
        opened = null
      }
    },
  }
}
