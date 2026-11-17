/**
 * Read-only discovery of live and persisted DSH sessions.
 *
 * Discovery never resumes or activates a session: it reads `sessionQuery`
 * headers and titles, or the in-memory session store when persistence query is
 * not installed. Policy and workspace values are observations, not pinned
 * configuration.
 */

/**
 * @typedef {object} SessionSummary
 * @property {string} sessionId
 * @property {string} title
 * @property {string|null} cwd
 * @property {'top-level'|'subagent'} source
 * @property {string|null} nativeParentSessionId
 * @property {string|null} agentPreset
 * @property {boolean} live
 * @property {boolean} persisted
 */

/**
 * Create the discovery facade.
 * @param {object} ctx - Host plugin context.
 * @param {{logger?: {warn?: Function}}} [options] - logger override.
 */
export function createDiscovery(ctx, options = {}) {
  const log = options.logger ?? ctx.logger
  const sessionStore = () => ctx.get?.('sessions') ?? ctx.sessions
  const sessionQuery = () => ctx.get?.('sessionQuery')
  const workingDirectories = () => ctx.get?.('workingDirectory')
  /** @type {{at: number, ids: Set<string>}} */
  let archiveCache = { at: 0, ids: new Set() }
  /** @type {{at: number, data: {sessions: object[], complete: boolean}|null}} */
  let corpusCache = { at: 0, data: null }
  /** @type {Map<string, {at: number, value: SessionSummary}>} */
  const describeCache = new Map()
  /** @type {Map<string, {at: number, title: string}>} */
  const titleCache = new Map()
  /** @type {Map<string, Promise<SessionSummary|null>>} */
  const describeInFlight = new Map()
  const ARCHIVE_TTL_MS = 2000
  const CORPUS_TTL_MS = 5000
  const DESCRIBE_TTL_MS = 5000
  const TITLE_TTL_MS = 60000
  /** @type {Map<string, Promise<object[]>>} */
  const titleInFlight = new Map()
  const NATIVE_TTL_MS = 5000
  /** @type {Map<string, {at: number, entries: object[]}>} */
  const nativeCache = new Map()
  /** @type {Map<string, Promise<object[]>>} */
  const nativeInFlight = new Map()

  /**
   * The workspace registry owns the durable archive set. Cache it briefly: the
   * getter returns the whole array, and a summary must not rebuild a Set per
   * node.
   * @param {string} sessionId - session to classify.
   * @returns {boolean} whether the session is archived.
   */
  function archivedOf(sessionId) {
    const now = Date.now()
    if (now - archiveCache.at > ARCHIVE_TTL_MS) {
      let ids = []
      try {
        ids = ctx.get?.('workspaceRegistry')?.archivedSessionIds ?? []
      } catch {
        ids = []
      }
      archiveCache = { at: now, ids: new Set(ids) }
    }
    return archiveCache.ids.has(sessionId)
  }

  /**
   * @param {string} sessionId - live session id.
   * @returns {object|undefined}
   */
  function liveSession(sessionId) {
    try {
      return sessionStore()?.get?.(sessionId)
    } catch {
      return undefined
    }
  }

  /**
   * Ordinary forks keep a `parentSession` but have no `origin`; they lead their
   * own native tree. Only `origin: 'subagent'` means native subagent lineage.
   * @param {object} header - immutable SessionHeader.
   */
  function sourceOf(header) {
    return header?.origin === 'subagent' ? 'subagent' : 'top-level'
  }

  /**
   * @param {object} header - immutable SessionHeader.
   * @param {object|undefined} live - live Session, when present.
   * @returns {string|null}
   */
  function cwdOf(header, live) {
    if (typeof header?.cwd === 'string' && header.cwd.length > 0) return header.cwd
    if (live === undefined) return null
    try {
      return workingDirectories()?.get?.(live) ?? null
    } catch {
      return null
    }
  }

  /**
   * Read the live session's effective policy for display only. Every service is
   * optional; a missing service leaves the field null rather than failing.
   * @param {object|undefined} live - live Session, when present.
   * @returns {{sandboxMode: string|null, permissionPreset: string|null, approvalPolicy: string|null}}
   */
  function policyOf(live) {
    if (live === undefined) return { sandboxMode: null, permissionPreset: null, approvalPolicy: null }
    let sandboxMode = null
    let permissionPreset = null
    let approvalPolicy = null
    try {
      sandboxMode = ctx.get?.('sandboxPolicy')?.resolve?.({ session: live })?.mode ?? null
    } catch {
      sandboxMode = null
    }
    try {
      permissionPreset = ctx.get?.('permissionPresets')?.current?.(live) ?? null
    } catch {
      permissionPreset = null
    }
    try {
      approvalPolicy = ctx.get?.('approval')?.overrideOf?.(live) ?? null
    } catch {
      approvalPolicy = null
    }
    return { sandboxMode, permissionPreset, approvalPolicy }
  }

  /**
   * @param {object} header - immutable SessionHeader.
   * @param {object|undefined} live - live Session, when present.
   * @param {boolean} persisted - whether a persisted record backs the id.
   * @param {string|undefined} title - latest durable title, when folded.
   * @returns {SessionSummary}
   */
  function summaryOf(header, live, persisted, title, liveHint = false) {
    return {
      sessionId: header.id,
      title: typeof title === 'string' && title.length > 0 ? title : header.id,
      cwd: cwdOf(header, live),
      source: sourceOf(header),
      nativeParentSessionId: header.parentSession ?? null,
      agentPreset: header.agentPreset ?? null,
      ...policyOf(live),
      live: live !== undefined || liveHint === true,
      archived: archivedOf(header.id),
      persisted: persisted === true,
    }
  }

  /**
   * Describe one exact session, sharing an in-flight read between concurrent
   * callers so a cold title/log read is not duplicated.
   * @param {string} sessionId - known or persisted session id.
   * @returns {Promise<SessionSummary|null>}
   */
  async function describe(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null
    const pending = describeInFlight.get(sessionId)
    if (pending !== undefined) return pending
    const promise = describeNow(sessionId).finally(() => {
      describeInFlight.delete(sessionId)
    })
    describeInFlight.set(sessionId, promise)
    return promise
  }

  /**
   * @param {string} sessionId - known or persisted session id.
   * @returns {Promise<SessionSummary|null>}
   */
  async function describeNow(sessionId) {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return null
    const cached = describeCache.get(sessionId)
    if (cached !== undefined && Date.now() - cached.at < DESCRIBE_TTL_MS) return cached.value
    const remember = (summary) => {
      if (summary !== null) describeCache.set(sessionId, { at: Date.now(), value: summary })
      return summary
    }
    const live = liveSession(sessionId)
    const query = sessionQuery()
    if (query?.readTitleSnapshot) {
      try {
        const observation = await query.readTitleSnapshot(sessionId)
        return remember(summaryOf(observation.session, live, live === undefined, observation.title?.title))
      } catch (error) {
        if (live === undefined) {
          log?.warn?.(`dsh-combinagents: cannot describe session ${sessionId}`, error)
          return null
        }
      }
    }
    if (live !== undefined) return remember(summaryOf(live.header, live, false, undefined))
    return null
  }

  /**
   * Filter one cached corpus by a literal query.
   * @param {{sessions: object[], complete: boolean}} corpus - cached list.
   * @param {string|undefined} query - literal text.
   * @returns {{sessions: object[], complete: boolean}}
   */
  function filterCorpus(corpus, query) {
    const text = typeof query === 'string' ? query.trim().toLowerCase() : ''
    if (text.length === 0) return corpus
    return {
      complete: corpus.complete,
      sessions: corpus.sessions.filter((session) => `${session.title} ${session.sessionId} ${session.cwd ?? ''}`
        .toLowerCase()
        .includes(text)),
    }
  }

  /**
   * Fold titles for a bounded batch of sessions. The picker calls this after
   * the fast header-only list, so opening the picker never reads hundreds of
   * session logs up front.
   * @param {readonly string[]} sessionIds - ids to title (at most 20).
   * @returns {Promise<Record<string, string>>}
   */
  async function titles(sessionIds) {
    const unique = [...new Set(sessionIds)]
      .filter((sessionId) => typeof sessionId === 'string' && sessionId.length > 0)
      .slice(0, 20)
    if (unique.length === 0) return {}
    const query = sessionQuery()
    const now = Date.now()
    const missing = unique.filter((sessionId) => {
      const entry = titleCache.get(sessionId)
      return entry === undefined || now - entry.at > TITLE_TTL_MS
    })
    if (missing.length > 0 && query?.readTitleSnapshots) {
      const key = [...missing].sort().join(',')
      let pending = titleInFlight.get(key)
      if (pending === undefined) {
        pending = query.readTitleSnapshots(missing).finally(() => {
          titleInFlight.delete(key)
        })
        titleInFlight.set(key, pending)
      }
      try {
        const results = await pending
        const at = Date.now()
        for (const result of results) {
          if (result.status !== 'fulfilled') continue
          const title = result.value.title?.title
          titleCache.set(result.sessionId, { at, title: typeof title === 'string' && title.length > 0 ? title : result.sessionId })
        }
      } catch (error) {
        log?.warn?.('dsh-combinagents: title batch unavailable', error)
      }
    }
    /** @type {Record<string, string>} */
    const result = {}
    for (const sessionId of unique) {
      const entry = titleCache.get(sessionId)
      if (entry !== undefined) result[sessionId] = entry.title
    }
    return result
  }

  /**
   * List the live-preferred corpus, optionally filtered by a literal query.
   * The unfiltered corpus is cached briefly so the picker does not re-fold every
   * session title on each keystroke or reopen.
   * @param {{query?: string}} [request] - filter.
   * @returns {Promise<{sessions: SessionSummary[], complete: boolean}>} `complete`
   *   is false when persistence discovery is unavailable.
   */
  async function list(request = {}) {
    const now = Date.now()
    if (corpusCache.data !== null && now - corpusCache.at < CORPUS_TTL_MS) {
      return filterCorpus(corpusCache.data, request.query)
    }
    const query = sessionQuery()
    /** @type {Array<{header: object, live: boolean, persisted: boolean}>} */
    let records = []
    let complete = false
    if (query?.listSessions) {
      try {
        records = await query.listSessions()
        complete = true
      } catch (error) {
        log?.warn?.('dsh-combinagents: session listing failed; falling back to live sessions', error)
      }
    }
    if (!complete) {
      records = (sessionStore()?.list?.() ?? []).map((session) => ({
        header: session.header,
        live: true,
        persisted: false,
      }))
    }

    const sessions = records.map((record) => summaryOf(
      record.header,
      record.live ? liveSession(record.header.id) : undefined,
      record.persisted,
      undefined,
      record.live,
    ))
    const corpus = { sessions, complete }
    corpusCache = { at: Date.now(), data: corpus }
    return filterCorpus(corpus, request.query)
  }

  /**
   * Describe several sessions in one call, keyed by session id.
   * @param {readonly string[]} sessionIds - ids to inspect.
   * @returns {Promise<Record<string, SessionSummary>>}
   */
  async function describeMany(sessionIds) {
    const unique = [...new Set(sessionIds)]
    if (unique.length === 0) return {}
    const now = Date.now()
    /** @type {Record<string, SessionSummary>} */
    const result = {}
    const missing = []
    for (const sessionId of unique) {
      const cached = describeCache.get(sessionId)
      if (cached !== undefined && now - cached.at < DESCRIBE_TTL_MS) {
        result[sessionId] = cached.value
        continue
      }
      const live = liveSession(sessionId)
      if (live !== undefined) {
        result[sessionId] = summaryOf(live.header, live, false, undefined, true)
        describeCache.set(sessionId, { at: now, value: result[sessionId] })
      } else {
        missing.push(sessionId)
      }
    }
    if (missing.length === 0) return result

    // Reuse the same 5 s corpus that /sessions already fills. This avoids a
    // full filterSessions() scan for every /state request.
    const corpus = corpusCache.data !== null && now - corpusCache.at < CORPUS_TTL_MS
      ? corpusCache.data
      : await list()
    const byId = new Map(corpus.sessions.map((session) => [session.sessionId, session]))
    const unresolved = []
    for (const sessionId of missing) {
      const summary = byId.get(sessionId)
      if (summary === undefined) {
        unresolved.push(sessionId)
      } else {
        result[sessionId] = summary
        describeCache.set(sessionId, { at: now, value: summary })
      }
    }
    const query = sessionQuery()
    if (unresolved.length > 0 && query?.filterSessions) {
      try {
        const records = await query.filterSessions([{ kind: 'id', values: unresolved }])
        for (const record of records) {
          const summary = summaryOf(record.header, liveSession(record.header.id), record.persisted === true, undefined, record.live === true)
          result[record.header.id] = summary
          describeCache.set(record.header.id, { at: now, value: summary })
        }
      } catch (error) {
        log?.warn?.('dsh-combinagents: persisted headers unavailable', error)
      }
    }
    const stillMissing = unresolved.filter((sessionId) => result[sessionId] === undefined)
    if (stillMissing.length > 0 && stillMissing.length <= 20) {
      const fallback = await Promise.all(stillMissing.map(async (sessionId) => [sessionId, await describe(sessionId)]))
      for (const [sessionId, summary] of fallback) {
        if (summary !== null) result[sessionId] = summary
      }
    }
    return result
  }

  /**
   * Whether the id is in the live-preferred corpus.
   * @param {string} sessionId - candidate id.
   * @returns {Promise<boolean>}
   */
  async function isKnownSession(sessionId) {
    return (await describe(sessionId)) !== null
  }

  /**
   * @param {object} entry - a child row from `subagents.listDescendants`.
   * @returns {object} an external leaf descriptor.
   */
  function leafOf(entry) {
    return {
      externalId: entry.id,
      label: entry.name ?? entry.label ?? entry.id,
      mode: entry.mode,
      nativeParentSessionId: entry.parentId,
      depth: entry.depth,
      path: entry.path ?? null,
      activity: entry.activity ?? null,
    }
  }

  /**
   * One listDescendants() walk per root per short TTL. /summary, /external, and
   * sync-native all read the same native catalogs; in-flight requests share a
   * single walk instead of stampeding it.
   * @param {string} rootSessionId - native tree root.
   * @returns {Promise<object[]>} descendant rows.
   */
  async function nativeEntries(rootSessionId) {
    const now = Date.now()
    const cached = nativeCache.get(rootSessionId)
    if (cached !== undefined && now - cached.at < NATIVE_TTL_MS) return cached.entries
    const pending = nativeInFlight.get(rootSessionId)
    if (pending !== undefined) return pending
    const service = ctx.get?.('subagents')
    if (service?.listDescendants === undefined) return []
    const promise = service.listDescendants(rootSessionId)
      .then((entries) => {
        nativeCache.set(rootSessionId, { at: Date.now(), entries })
        return entries
      })
      .finally(() => {
        nativeInFlight.delete(rootSessionId)
      })
    nativeInFlight.set(rootSessionId, promise)
    return promise
  }

  /**
   * Drop one root's native catalog cache after an observed mutation.
   * @param {string} rootSessionId - native tree root.
   */
  function invalidateNative(rootSessionId) {
    if (typeof rootSessionId === 'string' && rootSessionId.length > 0) {
      nativeCache.delete(rootSessionId)
      nativeInFlight.delete(rootSessionId)
    }
  }

  /**
   * List external/one-shot leaves reachable from a root session's native
   * catalogs. One-shot children that still have a local Session are left to the
   * session picker instead of being treated as external placeholders.
   * @param {string} rootSessionId - session whose catalogs to walk.
   * @returns {Promise<{available: boolean, leaves: object[], diagnostics: object[], count: number}>}
   */
  async function listNative(rootSessionId) {
    if (typeof rootSessionId !== 'string' || rootSessionId.length === 0) {
      return { available: false, leaves: [], diagnostics: [], count: 0 }
    }
    const service = ctx.get?.('subagents')
    if (service?.listDescendants === undefined) {
      return { available: false, leaves: [], diagnostics: [], count: 0 }
    }
    try {
      const entries = await nativeEntries(rootSessionId)
      const leaves = []
      const diagnostics = []
      let count = 0
      for (const entry of entries) {
        if (entry.kind === 'diagnostic') {
          diagnostics.push({ id: entry.id, reason: entry.reason })
          continue
        }
        count += 1
        if (entry.mode === 'external') {
          leaves.push(leafOf(entry))
          continue
        }
        if (entry.mode === 'one-shot') {
          const summary = await describe(entry.id)
          if (summary === null) leaves.push(leafOf(entry))
        }
      }
      return { available: true, leaves, diagnostics, count }
    } catch (error) {
      log?.warn?.('dsh-combinagents: native catalog unavailable', error)
      return { available: false, leaves: [], diagnostics: [], count: 0 }
    }
  }

  /**
   * Count every child row reachable from one root session's native catalogs.
   * @param {string} rootSessionId - session whose catalogs to walk.
   * @returns {Promise<{available: boolean, count: number}>}
   */
  async function countNative(rootSessionId) {
    if (typeof rootSessionId !== 'string' || rootSessionId.length === 0) {
      return { available: false, count: 0 }
    }
    const service = ctx.get?.('subagents')
    if (service?.listDescendants === undefined) return { available: false, count: 0 }
    try {
      const entries = await nativeEntries(rootSessionId)
      return { available: true, count: entries.filter((entry) => entry.kind === 'child').length }
    } catch (error) {
      log?.warn?.('dsh-combinagents: native descendant count unavailable', error)
      return { available: false, count: 0 }
    }
  }

  /**
   * List every child row reachable from one root session's native catalogs.
   * @param {string} rootSessionId - session whose catalogs to walk.
   * @returns {Promise<{available: boolean, children: object[]}>}
   */
  async function listTree(rootSessionId) {
    if (typeof rootSessionId !== 'string' || rootSessionId.length === 0) {
      return { available: false, children: [] }
    }
    const service = ctx.get?.('subagents')
    if (service?.listDescendants === undefined) return { available: false, children: [] }
    try {
      const entries = await nativeEntries(rootSessionId)
      return { available: true, children: entries.filter((entry) => entry.kind === 'child') }
    } catch (error) {
      log?.warn?.('dsh-combinagents: native tree unavailable', error)
      return { available: false, children: [] }
    }
  }

  return { list, titles, describe, describeMany, isKnownSession, listNative, countNative, listTree, invalidateNative }
}
