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

import { validateComposition } from './graph.js'

/** Domain name owned by this plugin. */
export const COMPOSITION_DOMAIN_NAME = 'combinagents'

/** Table holding one record per root session. */
export const COMPOSITION_TABLE = 'compositions'

/** Table holding per-composition edge grants. */
export const POLICY_TABLE = 'policies'

/** Table holding append-only capability audit rows. */
export const AUDIT_TABLE = 'audit'

/** Table holding plugin-owned composition tasks (never DSH Team tasks). */
export const TASK_TABLE = 'tasks'

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
    [TASK_TABLE]: { valueSchema: taskRecordSchema },
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
  /** @type {Map<string, Map<string, object>>} */
  const memory = new Map(tableNames.map((name) => [name, new Map()]))
  /** @type {null | {tables: Map<string, object>, close: Function}} */
  let opened = null
  let mode = 'memory'

  const ready = open().catch((error) => {
    // open() handles its own failures; this is a defensive net.
    log?.warn?.('dsh-combinagents: storage open failed', error)
  })

  async function open() {
    const service = ctx.get?.('storageDomain') ?? ctx.storageDomain
    if (service === undefined) {
      log?.warn?.('dsh-combinagents: storageDomain unavailable; using memory storage')
      return
    }
    try {
      const domain = await service.open(COMPOSITION_DOMAIN_SPEC)
      const tables = new Map()
      for (const name of tableNames) tables.set(name, domain.table(name))
      opened = { tables, close: () => domain.close() }
      mode = 'durable'
      log?.info?.('dsh-combinagents: composition domain open')
    } catch (error) {
      log?.warn?.('dsh-combinagents: composition domain open failed; using memory storage', error)
    }
  }

  /**
   * @param {string} name - table name.
   * @returns {Promise<object|null>} durable table or null in memory mode.
   */
  async function tableOf(name) {
    await ready
    return opened === null ? null : opened.tables.get(name) ?? null
  }

  return {
    ready,
    get mode() {
      return mode
    },
    async get(key) {
      const table = await tableOf(COMPOSITION_TABLE)
      if (table !== null) return table.get(key)
      return memory.get(COMPOSITION_TABLE).get(key)
    },
    async put(key, record) {
      const table = await tableOf(COMPOSITION_TABLE)
      if (table !== null) {
        await table.put(key, record)
        return
      }
      memory.get(COMPOSITION_TABLE).set(key, record)
    },
    async delete(key) {
      const table = await tableOf(COMPOSITION_TABLE)
      if (table !== null) {
        await table.delete(key)
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
      const table = await tableOf(POLICY_TABLE)
      if (table !== null) {
        await table.put(rootSessionId, record)
        return
      }
      memory.get(POLICY_TABLE).set(rootSessionId, record)
    },
    async appendAudit(record) {
      const table = await tableOf(AUDIT_TABLE)
      if (table !== null) {
        await table.put(record.id, record)
        return
      }
      memory.get(AUDIT_TABLE).set(record.id, record)
    },
    async listAudit(rootSessionId) {
      const table = await tableOf(AUDIT_TABLE)
      const entries = table !== null ? [...table.entries()] : [...memory.get(AUDIT_TABLE).entries()]
      if (typeof rootSessionId !== 'string') return entries
      return entries.filter(([, record]) => record.rootSessionId === rootSessionId)
    },
    async getTask(taskId) {
      const table = await tableOf(TASK_TABLE)
      if (table !== null) return table.get(taskId)
      return memory.get(TASK_TABLE).get(taskId)
    },
    async putTask(taskId, record) {
      const table = await tableOf(TASK_TABLE)
      if (table !== null) {
        await table.put(taskId, record)
        return
      }
      memory.get(TASK_TABLE).set(taskId, record)
    },
    async deleteTask(taskId) {
      const table = await tableOf(TASK_TABLE)
      if (table !== null) {
        await table.delete(taskId)
        return
      }
      memory.get(TASK_TABLE).delete(taskId)
    },
    async listTasks(rootSessionId) {
      const table = await tableOf(TASK_TABLE)
      const entries = table !== null ? [...table.entries()] : [...memory.get(TASK_TABLE).entries()]
      if (typeof rootSessionId !== 'string') return entries
      return entries.filter(([, record]) => record.rootSessionId === rootSessionId)
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
