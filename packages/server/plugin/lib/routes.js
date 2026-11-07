import { buildContext } from './prompt.js'
import { excerpt } from './text.js'
import { estimateTokens, errorText } from './util.js'

/**
 * The browser half and peer devices talk to the Host through these routes. Reads are GET; anything
 * that changes a memory requires the `x-memory-nebula` header, so a cross-site form post cannot do
 * it. Peer sync routes additionally require the shared sync token.
 */

const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]', '::1']

function knownHost(host, allowed) {
  const name = String(host ?? '').replace(/:\d+$/, '').toLowerCase()
  if (!name) return false
  if (LOOPBACK.includes(name)) return true
  return allowed.some((entry) => String(entry).toLowerCase() === name)
}

async function readBody(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size <= limit) chunks.push(buffer)
  }
  if (size > limit) return undefined
  return Buffer.concat(chunks).toString('utf8')
}

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function parseJson(raw) {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

const PATCH_KEYS = new Set(['text', 'summary', 'tags', 'kind', 'importance', 'pinned', 'layer', 'links'])

function cleanPatch(raw) {
  const patch = {}
  if (!raw || typeof raw !== 'object') return patch
  for (const [key, value] of Object.entries(raw)) if (PATCH_KEYS.has(key)) patch[key] = value
  return patch
}

function present(store, record, query) {
  return {
    ...store.describe(record),
    preview: excerpt(record.summary || record.text || '', query ?? '', 220),
  }
}

export function createRoutes({ store, sync, config = {}, runtime = null }) {
  const allowedHosts = Array.isArray(config.allowedHosts) ? config.allowedHosts.map(String) : []

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.startsWith('/memory-nebula')) return send(res, 404, { ok: false, error: 'not found' })

    const route = url.pathname.slice('/memory-nebula'.length) || '/'
    const method = (req.method ?? 'GET').toUpperCase()
    const mutation = method !== 'GET' && method !== 'HEAD'
    if (mutation && req.headers['x-memory-nebula'] !== '1') {
      return send(res, 403, { ok: false, error: 'missing x-memory-nebula header' })
    }
    // Peer endpoints are reached by another device's LAN address, which is not a loopback name;
    // the shared sync token is their guard. Browser-facing routes keep the host check.
    const transport = route.startsWith('/api/transport/')
    if (!transport && !knownHost(req.headers.host, allowedHosts)) return send(res, 403, { ok: false, error: 'unknown host' })

    try {
      if (route === '/api/state' && method === 'GET') {
        return send(res, 200, {
          ok: true,
          version: 1,
          device: store.device,
          account: store.data.accountId,
          stats: store.stats(),
          settings: store.getSettings(),
          configVersion: store.configVersion,
          file: store.file,
          syncName: sync.snapshotName(),
          prompt: typeof runtime?.promptStats === 'function' ? runtime.promptStats() : { sections: 0, liveAgents: null, errors: [] },
        })
      }

      if (route === '/api/memories' && method === 'GET') {
        const query = url.searchParams.get('q') ?? ''
        const layer = url.searchParams.get('layer') ?? 'all'
        const tag = url.searchParams.get('tag') ?? ''
        const kind = url.searchParams.get('kind') ?? ''
        const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 200))
        const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0)
        const records = store.list({ layer, tag, kind, query, limit, offset })
        return send(res, 200, {
          ok: true,
          query,
          layer,
          total: store.data.memories.length,
          items: records.map((record) => present(store, record, query)),
        })
      }

      if (route === '/api/memory' && method === 'GET') {
        const record = store.get(url.searchParams.get('id') ?? '')
        if (!record) return send(res, 404, { ok: false, error: '没有这条记忆' })
        return send(res, 200, { ok: true, item: present(store, record), text: record.text, summary: record.summary })
      }

      if (route === '/api/memory' && method === 'POST') {
        const body = parseJson(await readBody(req, 512 * 1024))
        if (!body) return send(res, 400, { ok: false, error: '请求体不是 JSON 对象' })
        const op = String(body.op ?? '')
        if (op === 'create') {
          const record = store.create({
            text: body.text,
            tags: body.tags,
            kind: body.kind,
            importance: body.importance,
            pinned: body.pin === true || body.pinned === true,
            layer: body.layer,
          })
          return send(res, 200, { ok: true, item: present(store, record) })
        }
        if (op === 'update') {
          const record = store.update(String(body.id ?? ''), cleanPatch(body.patch ?? body))
          if (!record) return send(res, 404, { ok: false, error: '没有这条记忆' })
          return send(res, 200, { ok: true, item: present(store, record) })
        }
        if (op === 'forget') {
          const ok = store.forget(String(body.id ?? ''))
          return send(res, ok ? 200 : 404, ok ? { ok: true } : { ok: false, error: '没有这条记忆' })
        }
        if (op === 'pin') {
          const record = store.update(String(body.id ?? ''), { pinned: body.pinned !== false })
          if (!record) return send(res, 404, { ok: false, error: '没有这条记忆' })
          return send(res, 200, { ok: true, item: present(store, record) })
        }
        if (op === 'touch') {
          store.touch(String(body.id ?? ''))
          return send(res, 200, { ok: true })
        }
        return send(res, 400, { ok: false, error: `未知操作：${op}` })
      }

      if (route === '/api/graph' && method === 'GET') {
        return send(res, 200, { ok: true, ...store.graph() })
      }

      if (route === '/api/settings' && method === 'POST') {
        const body = parseJson(await readBody(req, 256 * 1024)) ?? {}
        const settings = store.setSettings(body.patch ?? body)
        await store.save()
        return send(res, 200, { ok: true, settings })
      }

      if (route === '/api/decay' && method === 'POST') {
        const result = store.runDecay(Date.now())
        await store.save()
        return send(res, 200, { ok: true, result, stats: store.stats() })
      }

      if (route === '/api/preview' && method === 'GET') {
        const query = url.searchParams.get('q') ?? ''
        const built = buildContext({ store, query, settings: store.getSettings() })
        return send(res, 200, {
          ok: true,
          query,
          text: built.text,
          tokens: built.tokens || estimateTokens(built.text),
          sections: built.sections.map((section) => ({
            key: section.key,
            title: section.title,
            items: section.items,
          })),
        })
      }

      if (route === '/api/sync' && method === 'GET') {
        return send(res, 200, { ok: true, status: await sync.status() })
      }

      if (route === '/api/sync' && method === 'POST') {
        const body = parseJson(await readBody(req, 256 * 1024)) ?? {}
        const action = String(body.action ?? 'run')
        if (action === 'run') {
          const report = await sync.run('manual')
          return send(res, 200, { ok: true, report, status: await sync.status() })
        }
        if (action === 'import-sessions') {
          const result = await sync.importSessions()
          return send(res, 200, { ok: true, result, status: await sync.status() })
        }
        if (action === 'export-sessions') {
          const report = { at: Date.now(), reason: 'manual-export' }
          await sync.exportSessions(report)
          return send(res, 200, { ok: true, report, status: await sync.status() })
        }
        if (action === 'settings') {
          store.setSettings({ sync: body.patch ?? {} })
          await store.save()
          return send(res, 200, { ok: true, status: await sync.status() })
        }
        return send(res, 400, { ok: false, error: `未知操作：${action}` })
      }

      if (route === '/api/transport/snapshot' && method === 'GET') {
        const token = String(req.headers['x-memory-sync-token'] ?? '')
        if (!token || token !== store.getSettings().sync.token) return send(res, 403, { ok: false, error: 'bad sync token' })
        return send(res, 200, await sync.buildSnapshot())
      }

      if (route === '/api/transport/merge' && method === 'POST') {
        const token = String(req.headers['x-memory-sync-token'] ?? '')
        if (!token || token !== store.getSettings().sync.token) return send(res, 403, { ok: false, error: 'bad sync token' })
        const body = parseJson(await readBody(req, 8 * 1024 * 1024))
        if (!body) return send(res, 400, { ok: false, error: '请求体不是 JSON 对象' })
        const localAccount = store.data.accountId || 'local'
        const remoteAccount = typeof body.accountId === 'string' && body.accountId ? body.accountId : 'local'
        if (localAccount !== 'local' && remoteAccount !== localAccount) {
          return send(res, 409, { ok: false, error: '不同账号，拒绝合并' })
        }
        const merged = store.mergeSnapshot(body)
        return send(res, 200, { ok: true, ...merged })
      }

      return send(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      return send(res, 500, { ok: false, error: errorText(error) })
    }
  }

  return [{ kind: 'prefix', path: '/memory-nebula', handler: handle }]
}
