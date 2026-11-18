/**
 * Same-origin JSON bridge for the composition tab.
 *
 * The Host half owns the data and the client half cannot use the dynamic
 * package `host.call` channel, so the tab talks to one loopback-only, token
 * authenticated prefix route. The route accepts JSON only, caps the body, and
 * returns stable error codes instead of generic 500s for graph rejections.
 */

import { timingSafeEqual } from 'node:crypto'

import { CompositionError } from './graph.js'

/** Prefix registered on the Web server. */
export const ROUTE_PREFIX = '/dsh-combinagents'

/** Header carrying the per-Host token. */
export const TOKEN_HEADER = 'x-dsh-combinagents-token'

/** Maximum accepted request body. */
export const MAX_BODY_BYTES = 128 * 1024

/** Routes under the prefix. */
const ROUTES = new Set([
  '/bootstrap',
  '/sessions',
  '/titles',
  '/external',
  '/summary',
  '/state',
  '/grants',
  '/tasks',
  '/create-task',
  '/update-task',
  '/create',
  '/add-node',
  '/add-external',
  '/sync-native',
  '/remove-node',
  '/set-parent',
  '/set-title',
  '/rename-node',
  '/set-grant',
  '/delete-composition',
  '/clone-tree',
  '/bud',
])

class HttpError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

/**
 * @param {number} status - HTTP status.
 * @param {object} payload - JSON body.
 * @returns {{status: number, headers: Record<string,string>, body: string}}
 */
function json(status, payload) {
  return {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin',
    },
    body: JSON.stringify(payload),
  }
}

/**
 * @param {unknown} address - socket remote address.
 * @returns {boolean} whether the peer is loopback.
 */
export function isLoopback(address) {
  if (typeof address !== 'string') return false
  const normalized = address.startsWith('::ffff:') ? address.slice(7) : address
  return normalized === '127.0.0.1' || normalized === '::1'
}

const TRUSTED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Compare a supplied bridge token without leaking length/content through an
 * early-exit string comparison.
 * @param {unknown} supplied - request header value.
 * @param {string} token - expected capability token.
 * @returns {boolean}
 */
function tokenMatches(supplied, token) {
  if (typeof supplied !== 'string' || typeof token !== 'string') return false
  const left = Buffer.from(supplied, 'utf8')
  const right = Buffer.from(token, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Parse a Host/Origin authority without accepting userinfo, paths, or queries.
 * @param {string} value - authority text.
 * @returns {{protocol: string, hostname: string, port: string}|null}
 */
function authorityOf(value) {
  if (typeof value !== 'string' || value.length === 0) return null
  let url
  try {
    url = new URL(`http://${value}`)
  } catch {
    return null
  }
  if (url.username.length > 0 || url.password.length > 0) return null
  if (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0) return null
  return { protocol: url.protocol, hostname: url.hostname.toLowerCase(), port: url.port }
}

/**
 * Reject DNS-rebinding hosts: only the three loopback spellings at this exact
 * listener port are accepted. The port comes from the server socket, never from
 * the untrusted Host header.
 * @param {string|undefined} host - Host header.
 * @param {number|undefined} localPort - listening port.
 * @returns {boolean}
 */
export function isTrustedHost(host, localPort) {
  if (!Number.isSafeInteger(localPort) || localPort < 1 || localPort > 65535) return false
  const authority = authorityOf(host)
  if (authority === null) return false
  if (!TRUSTED_HOSTS.has(authority.hostname)) return false
  const port = authority.port === '' ? '80' : authority.port
  return Number(port) === localPort
}

/**
 * When an Origin is present it must be the same http(s) loopback origin. A
 * same-origin GET commonly omits Origin, so Host validation is the primary
 * rebinding defense.
 * @param {string|undefined} origin - Origin header.
 * @param {number|undefined} localPort - listening port.
 * @param {boolean} secure - whether the listener terminated TLS.
 * @returns {boolean}
 */
export function isTrustedOrigin(origin, localPort, secure = false) {
  if (origin === undefined) return true
  if (origin === 'null') return false
  if (!Number.isSafeInteger(localPort) || localPort < 1 || localPort > 65535) return false
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.username.length > 0 || url.password.length > 0) return false
  if (url.pathname !== '/' || url.search.length > 0 || url.hash.length > 0) return false
  if (url.protocol !== (secure ? 'https:' : 'http:')) return false
  if (!TRUSTED_HOSTS.has(url.hostname.toLowerCase())) return false
  const port = url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  return Number(port) === localPort
}

/**
 * @param {Record<string, unknown>} headers - request headers.
 * @param {string} name - case-insensitive name.
 * @returns {string|undefined}
 */
function headerValue(headers, name) {
  if (headers === null || typeof headers !== 'object') return undefined
  const wanted = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue
    return Array.isArray(value) ? String(value[0]) : value === undefined ? undefined : String(value)
  }
  return undefined
}

/**
 * @param {string} body - raw request body.
 * @returns {Record<string, unknown>} parsed object.
 */
function parseJsonBody(body) {
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
    throw new HttpError(413, 'PAYLOAD_TOO_LARGE', `request body exceeds ${MAX_BODY_BYTES} bytes`)
  }
  if (typeof body !== 'string' || body.trim().length === 0) {
    throw new HttpError(400, 'INVALID_JSON', 'request body must be a JSON object')
  }
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'request body is not valid JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'INVALID_JSON', 'request body must be a JSON object')
  }
  return parsed
}

/**
 * @param {unknown} error - thrown value.
 * @returns {{status: number, code: string, message: string}}
 */
function errorOf(error) {
  if (error instanceof HttpError) {
    return { status: error.status, code: error.code, message: error.message }
  }
  if (error instanceof CompositionError) {
    const status = error.code === 'ROOT_PROTECTED' || error.code === 'TASK_FORBIDDEN' || error.code === 'MODEL_SELECTION_FORBIDDEN'
      ? 403
      : error.code === 'CLONE_UNAVAILABLE'
        ? 503
        : error.code === 'CLONE_FAILED'
          ? 500
          : error.code === 'AGENT_BUSY' || error.code === 'SESSION_ALREADY_COMPOSED' || error.code === 'TASK_CONFLICT' || error.code === 'CLONE_IN_PROGRESS'
            ? 409
            : error.code === 'COMPOSITION_NOT_FOUND' || error.code === 'SESSION_NOT_DISCOVERED' || error.code === 'UNKNOWN_NODE' || error.code === 'UNKNOWN_EDGE' || error.code === 'TASK_NOT_FOUND'
              ? 404
              : 400
    return { status, code: error.code, message: error.message }
  }
  return { status: 500, code: 'INTERNAL', message: 'internal error' }
}

/**
 * Create the request-level API. Every response is a plain object so tests and
 * the Node adapter share the same routing and error mapping.
 * @param {object} deps - manager, discovery, token, and display metadata.
 */
export function createApi({
  manager,
  discovery,
  cloneManager = undefined,
  token,
  version = '0.1.0',
  platform = process.platform,
  logger = undefined,
}) {
  if (typeof token !== 'string' || token.length === 0) throw new Error('createApi: token is required')

  /**
   * @param {object} request - method, url, headers, body, remoteAddress.
   * @returns {Promise<{status: number, headers: object, body: string}>}
   */
  async function handle(request) {
    try {
      const { method = 'GET', url = '/', headers = {}, body = '', remoteAddress, localPort, secure = false, signal } = request
      if (!isLoopback(remoteAddress)) {
        return json(403, { error: { code: 'FORBIDDEN', message: 'this bridge only accepts loopback peers' } })
      }
      if (!isTrustedHost(headerValue(headers, 'host'), localPort)) {
        return json(403, { error: { code: 'FORBIDDEN', message: 'untrusted Host header' } })
      }
      if (!isTrustedOrigin(headerValue(headers, 'origin'), localPort, secure)) {
        return json(403, { error: { code: 'FORBIDDEN', message: 'untrusted Origin header' } })
      }
      if (typeof url !== 'string') throw new HttpError(400, 'INVALID_URL', 'url is required')
      const parsed = new URL(url, 'http://localhost')
      if (!parsed.pathname.startsWith(ROUTE_PREFIX)) {
        return json(404, { error: { code: 'NOT_FOUND', message: 'unknown route' } })
      }
      const route = parsed.pathname.slice(ROUTE_PREFIX.length) || '/'
      if (!ROUTES.has(route)) {
        return json(404, { error: { code: 'NOT_FOUND', message: `unknown route ${JSON.stringify(route)}` } })
      }

      if (route === '/bootstrap' && method === 'GET') {
        return json(200, { token, version, platform, supported: true })
      }

      const supplied = headerValue(headers, TOKEN_HEADER)
      if (!tokenMatches(supplied, token)) {
        return json(401, { error: { code: 'UNAUTHORIZED', message: `missing or invalid ${TOKEN_HEADER}` } })
      }

      if (route === '/bootstrap') {
        return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'use GET' } })
      }

      if (method === 'GET') return await readRoute(route, parsed)
      if (method !== 'POST') {
        return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'use GET or POST' } })
      }
      const contentType = headerValue(headers, 'content-type') ?? ''
      if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
        return json(415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Content-Type must be application/json' } })
      }
      const parsedBody = parseJsonBody(body)
      return await writeRoute(route, parsedBody, signal)
    } catch (error) {
      const failure = errorOf(error)
      if (failure.status >= 500) logger?.warn?.('dsh-combinagents: bridge failure', error)
      return json(failure.status, { error: { code: failure.code, message: failure.message } })
    }
  }

  /**
   * @param {string} route - path after the prefix.
   * @param {URL} url - parsed request URL.
   * @returns {Promise<object>} response.
   */
  async function readRoute(route, url) {
    if (route === '/sessions') {
      const result = await discovery.list({ query: url.searchParams.get('query') ?? '' })
      return json(200, result)
    }
    if (route === '/titles') {
      const ids = (url.searchParams.get('ids') ?? '')
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0)
      return json(200, { titles: await discovery.titles(ids) })
    }
    if (route === '/external') {
      const rootSessionId = url.searchParams.get('rootSessionId') ?? ''
      return json(200, await discovery.listNative(rootSessionId))
    }
    if (route === '/summary') {
      const sessionId = url.searchParams.get('sessionId') ?? ''
      if (sessionId === '') throw new HttpError(400, 'INVALID_REQUEST', 'sessionId is required')
      const resolved = await manager.resolveSession(sessionId)
      const rootSessionId = resolved?.rootSessionId ?? sessionId
      const compositionNodes = resolved?.record.composition.nodes.length ?? 0
      // The header chip needs the overlay size without paying a cold native
      // walk. Report the native count only when a recent /external or
      // sync-native already cached it; never claim native availability
      // otherwise (the old compositionNodes-as-subagents value was misleading).
      const nativeSubagents = discovery.peekNativeCount?.(rootSessionId) ?? null
      return json(200, {
        sessionId,
        rootSessionId,
        compositionNodes,
        subagents: nativeSubagents,
        nativeSubagents,
        available: nativeSubagents !== null,
      })
    }
    if (route === '/grants') {
      const rootSessionId = url.searchParams.get('rootSessionId') ?? ''
      if (rootSessionId === '') throw new HttpError(400, 'INVALID_REQUEST', 'rootSessionId is required')
      return json(200, {
        rootSessionId,
        grants: await manager.getGrants(rootSessionId),
      })
    }
    if (route === '/tasks') {
      const rootSessionId = url.searchParams.get('rootSessionId') ?? ''
      if (rootSessionId === '') throw new HttpError(400, 'INVALID_REQUEST', 'rootSessionId is required')
      return json(200, { tasks: await manager.getTasks(rootSessionId) })
    }
    if (route === '/state') {
      const rootSessionId = url.searchParams.get('rootSessionId')
      const sessionId = url.searchParams.get('sessionId')
      let record = null
      let effectiveRoot = rootSessionId
      if (rootSessionId !== null && rootSessionId !== '') {
        record = await manager.state(rootSessionId)
        if (record === null) {
          const resolved = await manager.resolveSession(rootSessionId)
          record = resolved?.record ?? null
          effectiveRoot = resolved?.rootSessionId ?? rootSessionId
        }
      } else if (sessionId !== null && sessionId !== '') {
        const resolved = await manager.resolveSession(sessionId)
        record = resolved?.record ?? null
        effectiveRoot = resolved?.rootSessionId ?? null
      } else {
        throw new HttpError(400, 'INVALID_REQUEST', 'rootSessionId or sessionId is required')
      }
      if (record === null) {
        return json(200, {
          composition: null,
          rootSessionId: effectiveRoot,
          updatedAt: null,
          observations: {},
          grants: {},
          tasks: [],
          storage: manager.storageMode,
        })
      }
      const sessionIds = record.composition.nodes
        .map((node) => node.sessionId)
        .filter((sessionId) => typeof sessionId === 'string')
      const observations = await discovery.describeMany(sessionIds)
      return json(200, {
        composition: record.composition,
        rootSessionId: effectiveRoot ?? record.composition.rootSessionId,
        updatedAt: record.updatedAt,
        observations,
        grants: await manager.getGrants(record.composition.rootSessionId, record),
        tasks: await manager.getTasks(record.composition.rootSessionId, record),
        storage: manager.storageMode,
      })
    }
    return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'use POST' } })
  }

  /**
   * @param {string} route - path after the prefix.
   * @param {Record<string, unknown>} body - parsed JSON object.
   * @param {AbortSignal} [signal] - request cancellation.
   * @returns {Promise<object>} response.
   */
  async function writeRoute(route, body, signal = undefined) {
    if (route === '/create') {
      const record = await manager.create(body.rootSessionId, { title: body.title })
      return json(200, { composition: record.composition, updatedAt: record.updatedAt })
    }
    if (route === '/add-node') {
      const record = await manager.addNode(body.rootSessionId, {
        sessionId: body.sessionId,
        parentId: body.parentId,
        label: body.label,
      })
      return json(200, { composition: record.composition, updatedAt: record.updatedAt })
    }
    if (route === '/add-external') {
      const record = await manager.addExternal(body.rootSessionId, {
        label: body.label,
        provider: body.provider,
        nativeParentSessionId: body.nativeParentSessionId,
        parentId: body.parentId,
      })
      return json(200, { composition: record.composition, updatedAt: record.updatedAt })
    }
    if (route === '/sync-native') {
      const record = await manager.syncNativeTree(body.rootSessionId)
      return json(200, record === null ? { composition: null } : { composition: record.composition, updatedAt: record.updatedAt })
    }
    if (route === '/set-parent') {
      const record = await manager.setParent(body.rootSessionId, {
        nodeId: body.nodeId,
        parentId: body.parentId,
      })
      return json(200, { composition: record.composition, updatedAt: record.updatedAt })
    }
    if (route === '/set-title') {
      const record = await manager.setTitle(body.rootSessionId, { title: body.title })
      return json(200, { composition: record.composition, updatedAt: record.updatedAt })
    }
    if (route === '/rename-node') {
      const record = await manager.renameNode(body.rootSessionId, {
        nodeId: body.nodeId,
        label: body.label,
      })
      return json(200, { composition: record.composition, updatedAt: record.updatedAt })
    }
    if (route === '/set-grant') {
      const grants = await manager.setEdgeGrant(body.rootSessionId, body.edgeId, {
        allowMessage: body.allowMessage,
        allowInterrupt: body.allowInterrupt,
      })
      return json(200, { grants })
    }
    if (route === '/create-task') {
      const tasks = await manager.createTask(body.rootSessionId, {
        subject: body.subject,
        description: body.description,
        ownerNodeId: body.ownerNodeId,
        blockedBy: body.blockedBy,
        writeScopes: body.writeScopes,
        createdBy: 'user',
        actor: 'user',
      })
      return json(200, { tasks })
    }
    if (route === '/update-task') {
      const tasks = await manager.updateTask(body.rootSessionId, {
        taskId: body.taskId,
        expectedRevision: body.expectedRevision,
        action: body.action,
        actor: 'user',
      })
      return json(200, { tasks })
    }
    if (route === '/remove-node') {
      const record = await manager.removeNode(body.rootSessionId, {
        nodeId: body.nodeId,
        mode: body.mode,
      })
      return json(200, { composition: record.composition, updatedAt: record.updatedAt })
    }
    if (route === '/clone-tree') {
      if (cloneManager === undefined) {
        return json(503, {
          error: { code: 'CLONE_UNAVAILABLE', message: 'the clone adapter is not wired in this Host' },
        })
      }
      return json(200, await cloneManager.cloneTree(body.rootSessionId, { signal }))
    }
    if (route === '/bud') {
      if (cloneManager === undefined) {
        return json(503, {
          error: { code: 'CLONE_UNAVAILABLE', message: 'the clone adapter is not wired in this Host' },
        })
      }
      return json(200, await cloneManager.bud(body.rootSessionId, body.nodeId, { signal }))
    }
    if (route === '/delete-composition') {
      await manager.deleteComposition(body.rootSessionId)
      await cloneManager?.releaseRoot?.(body.rootSessionId)
      return json(200, { ok: true })
    }
    return json(405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'use GET' } })
  }

  return { handle, token }
}

/**
 * Adapt the API to a Node HTTP route handler.
 * @param {ReturnType<typeof createApi>} api - request-level API.
 * @param {{logger?: {warn?: Function}}} [options] - logger override.
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createNodeHandler(api, options = {}) {
  const log = options.logger
  return async function nodeHandler(req, res) {
    const controller = new AbortController()
    // `IncomingMessage` emits 'close' as soon as the request body is consumed,
    // which is not a disconnect. The response's 'close' fires on finish or on a
    // real client abort; only the latter may cancel signal-aware work.
    const onClose = () => {
      if (!res.writableEnded) controller.abort()
    }
    res.on('close', onClose)
    try {
      // Reject an untrusted authority before reading the body. The API repeats
      // these checks for direct callers, but the Node adapter must not let a
      // forged Host force even one body buffer.
      const localPort = req.socket?.localPort
      const secure = req.socket?.encrypted === true
      if (!isLoopback(req.socket?.remoteAddress)
        || !isTrustedHost(req.headers.host, localPort)
        || !isTrustedOrigin(req.headers.origin, localPort, secure)) {
        res.statusCode = 403
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('connection', 'close')
        res.end(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'untrusted request authority' } }))
        return
      }
      // Reject an oversized declared body before buffering it. A chunked
      // request still hits the incremental cap in readBody.
      const declaredLength = Number(req.headers['content-length'])
      if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
        res.statusCode = 413
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('connection', 'close')
        res.end(JSON.stringify({
          error: {
            code: 'PAYLOAD_TOO_LARGE',
            message: `request body exceeds ${MAX_BODY_BYTES} bytes`,
          },
        }))
        return
      }
      let route = null
      try {
        const pathname = new URL(req.url, 'http://localhost').pathname
        if (pathname.startsWith(ROUTE_PREFIX)) route = pathname.slice(ROUTE_PREFIX.length) || '/'
      } catch {
        route = null
      }
      const bootstrapGet = req.method === 'GET' && route === '/bootstrap'
      if (route !== null && ROUTES.has(route) && !bootstrapGet
        && !tokenMatches(headerValue(req.headers, TOKEN_HEADER), api.token)) {
        res.statusCode = 401
        res.setHeader('content-type', 'application/json; charset=utf-8')
        res.setHeader('cache-control', 'no-store')
        res.setHeader('connection', 'close')
        res.end(JSON.stringify({ error: { code: 'UNAUTHORIZED', message: `missing or invalid ${TOKEN_HEADER}` } }))
        return
      }
      const body = await readBody(req)
      const response = await api.handle({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
        remoteAddress: req.socket?.remoteAddress,
        localPort: req.socket?.localPort,
        secure: req.socket?.encrypted === true,
        signal: controller.signal,
      })
      res.statusCode = response.status
      for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value)
      res.end(response.body)
    } catch (error) {
      const status = error?.code === 'PAYLOAD_TOO_LARGE' ? 413 : 500
      log?.warn?.('dsh-combinagents: bridge request failed', error)
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify({
        error: {
          code: error?.code === 'PAYLOAD_TOO_LARGE' ? 'PAYLOAD_TOO_LARGE' : 'INTERNAL',
          message: error?.code === 'PAYLOAD_TOO_LARGE' ? `request body exceeds ${MAX_BODY_BYTES} bytes` : 'internal error',
        },
      }))
    } finally {
      res.off('close', onClose)
    }
  }
}

/**
 * @param {import('node:http').IncomingMessage} req - request stream.
 * @returns {Promise<string>} UTF-8 body.
 */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error = new Error(`request body exceeds ${MAX_BODY_BYTES} bytes`)
      error.code = 'PAYLOAD_TOO_LARGE'
      throw error
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}
