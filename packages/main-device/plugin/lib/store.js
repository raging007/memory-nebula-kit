import path from 'node:path'
import fsp from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  DAY_MS,
  clamp,
  deviceName,
  errorText,
  newId,
  numberIn,
  readJson,
  shortDate,
  writeJsonAtomic,
} from './util.js'
import { cleanText, makeStub, scoreMemory, summarize } from './text.js'

/**
 * The memory store.
 *
 * One JSON document per device. Records carry a per-record `rev` and tombstones carry one too, so
 * two devices can merge snapshots without a server and without a shared clock: the higher rev wins,
 * and `updatedAt` (then the device id) breaks a tie.
 */

export const STORE_VERSION = 1
export const LAYERS = ['core', 'important', 'normal', 'faded']
export const KINDS = ['fact', 'preference', 'event', 'task', 'person', 'insight']

export const DEFAULT_SETTINGS = {
  /** Characters allowed in the injected memory block (roughly 1 char ≈ 1 token for Chinese). */
  promptBudgetChars: 900,
  coreBudgetChars: 380,
  relevantBudgetChars: 460,
  relevantLimit: 6,
  minScore: 0.08,
  autoPromote: true,
  decay: {
    afterDays: 100,
    stage2Days: 200,
    forgetDays: 300,
    purgeDays: 600,
  },
  sync: {
    enabled: false,
    folder: '',
    intervalMinutes: 15,
    peers: [],
    token: '',
    sessions: 'export',
    autoImportSessions: false,
    plugins: true,
    sharePackage: false,
    git: false,
    syncConfig: false,
  },
}

function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const sync = source.sync && typeof source.sync === 'object' ? source.sync : {}
  const decay = source.decay && typeof source.decay === 'object' ? source.decay : {}
  const afterDays = numberIn(decay.afterDays, DEFAULT_SETTINGS.decay.afterDays, 1, 3650)
  // Keep the ladder monotonic: a later stage configured before an earlier one would make a
  // hundred-day memory fade on the next hourly pass instead of degrading over months.
  const stage2Days = Math.max(afterDays + 1, numberIn(decay.stage2Days, DEFAULT_SETTINGS.decay.stage2Days, 2, 3650))
  const forgetDays = Math.max(stage2Days + 1, numberIn(decay.forgetDays, DEFAULT_SETTINGS.decay.forgetDays, 3, 7300))
  const purgeDays = Math.max(forgetDays + 1, numberIn(decay.purgeDays, DEFAULT_SETTINGS.decay.purgeDays, 7, 7300))
  return {
    promptBudgetChars: numberIn(source.promptBudgetChars, DEFAULT_SETTINGS.promptBudgetChars, 200, 6000),
    coreBudgetChars: numberIn(source.coreBudgetChars, DEFAULT_SETTINGS.coreBudgetChars, 120, 4000),
    relevantBudgetChars: numberIn(source.relevantBudgetChars, DEFAULT_SETTINGS.relevantBudgetChars, 120, 4000),
    relevantLimit: Math.round(numberIn(source.relevantLimit, DEFAULT_SETTINGS.relevantLimit, 1, 40)),
    minScore: numberIn(source.minScore, DEFAULT_SETTINGS.minScore, 0, 1),
    autoPromote: source.autoPromote !== false,
    decay: {
      afterDays,
      stage2Days,
      forgetDays,
      purgeDays,
    },
    sync: {
      enabled: sync.enabled === true,
      folder: typeof sync.folder === 'string' ? sync.folder : '',
      intervalMinutes: numberIn(sync.intervalMinutes, DEFAULT_SETTINGS.sync.intervalMinutes, 0, 1440),
      peers: Array.isArray(sync.peers)
        ? sync.peers
            .filter((peer) => peer && typeof peer.url === 'string' && peer.url.trim())
            .map((peer) => ({
              name: typeof peer.name === 'string' && peer.name.trim() ? peer.name.trim() : 'peer',
              url: peer.url.trim().replace(/\/+$/, ''),
              token: typeof peer.token === 'string' ? peer.token : '',
            }))
        : [],
      token: typeof sync.token === 'string' && sync.token.length >= 8 ? sync.token : '',
      sessions: sync.sessions === 'off' ? 'off' : 'export',
      autoImportSessions: sync.autoImportSessions === true,
      plugins: sync.plugins !== false,
      sharePackage: sync.sharePackage === true,
      git: sync.git === true,
      syncConfig: sync.syncConfig === true,
    },
  }
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    if (typeof tags === 'string' && tags.trim()) return tags.split(/[,，、\s]+/).map((tag) => tag.trim()).filter(Boolean).slice(0, 12)
    return []
  }
  return [...new Set(tags.map((tag) => String(tag ?? '').trim()).filter(Boolean))].slice(0, 12)
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') return null
  const text = cleanText(String(raw.text ?? ''))
  const summary = cleanText(String(raw.summary ?? ''))
  if (!text && !summary) return null
  const createdAt = Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now()
  const layer = LAYERS.includes(raw.layer) ? raw.layer : raw.pinned ? 'core' : 'normal'
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : newId(),
    text,
    summary,
    layer,
    kind: KINDS.includes(raw.kind) ? raw.kind : 'fact',
    tags: normalizeTags(raw.tags),
    pinned: raw.pinned === true || layer === 'core',
    importance: numberIn(raw.importance, 0.5, 0, 1),
    createdAt,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : createdAt,
    lastAccessAt: Number.isFinite(raw.lastAccessAt) ? raw.lastAccessAt : 0,
    accessCount: Math.max(0, Math.round(Number(raw.accessCount) || 0)),
    decayStage: clamp(Math.round(Number(raw.decayStage) || 0), 0, 3),
    decayedAt: Number.isFinite(raw.decayedAt) ? raw.decayedAt : 0,
    fadedAt: Number.isFinite(raw.fadedAt) ? raw.fadedAt : 0,
    rev: Math.max(1, Math.round(Number(raw.rev) || 1)),
    origin: raw.origin && typeof raw.origin === 'object' ? {
      sessionId: typeof raw.origin.sessionId === 'string' ? raw.origin.sessionId : undefined,
      deviceId: typeof raw.origin.deviceId === 'string' ? raw.origin.deviceId : undefined,
      deviceName: typeof raw.origin.deviceName === 'string' ? raw.origin.deviceName : undefined,
    } : {},
    links: Array.isArray(raw.links)
      ? raw.links.filter((link) => link && typeof link.id === 'string').map((link) => ({ id: link.id, weight: numberIn(link.weight, 0.5, 0.05, 1) })).slice(0, 24)
      : [],
  }
}

function normalizeTombstone(raw) {
  if (!raw || typeof raw.id !== 'string') return null
  return {
    id: raw.id,
    rev: Math.max(1, Math.round(Number(raw.rev) || 1)),
    at: Number.isFinite(raw.at) ? raw.at : Date.now(),
    by: typeof raw.by === 'string' ? raw.by : undefined,
  }
}

const trimTo = (text, max) => {
  const chars = Array.from(String(text ?? ''))
  return chars.length > max ? chars.slice(0, max).join('') : chars.join('')
}

/**
 * One store per data directory for the life of the process.
 *
 * A plugin reload (HMR, or the manager toggling the row) must not leave a prompt section reading
 * from an older store object while the HTTP routes write to a newer one: both sides ask for the
 * same directory and therefore share the instance. `load()` still re-reads the file each time.
 */
const STORE_REGISTRY = Symbol.for('dsh-memory-nebula.stores')

export function createStore(options = {}) {
  const registry = globalThis[STORE_REGISTRY] ?? (globalThis[STORE_REGISTRY] = new Map())
  const key = path.resolve(options.dataDir ?? path.join(process.cwd(), '.memory-nebula'))
  const cached = registry.get(key)
  if (cached) return cached
  const store = buildStore(options)
  registry.set(key, store)
  return store
}

function buildStore({ dataDir, config = {}, logger = console } = {}) {
  const file = path.join(dataDir, 'memories.json')
  let data = {
    version: STORE_VERSION,
    accountId: null,
    device: { id: '', name: deviceName(), os: process.platform },
    rev: 0,
    configVersion: 0,
    updatedAt: 0,
    memories: [],
    tombstones: [],
    settings: normalizeSettings(config),
  }
  let byId = new Map()
  let saveTimer = null
  let saveChain = Promise.resolve()
  let loaded = false

  function reindex() {
    byId = new Map()
    for (const record of data.memories) byId.set(record.id, record)
  }

  function nextRev() {
    data.rev += 1
    return data.rev
  }

  function scheduleSave() {
    if (saveTimer) return
    saveTimer = setTimeout(() => {
      saveTimer = null
      void save()
    }, 400)
    if (typeof saveTimer.unref === 'function') saveTimer.unref()
  }

  async function save() {
    data.updatedAt = Date.now()
    const payload = JSON.parse(JSON.stringify(data))
    saveChain = saveChain.catch(() => {}).then(() => writeJsonAtomic(file, payload))
    return saveChain.catch((error) => {
      logger.warn?.(`[memory-nebula] 保存失败：${errorText(error)}`)
    })
  }

  function applyLoaded(raw) {
    if (!raw || typeof raw !== 'object') return
    data.accountId = typeof raw.accountId === 'string' ? raw.accountId : null
    data.device = {
      id: typeof raw.device?.id === 'string' && raw.device.id ? raw.device.id : `dev_${createHash('sha1').update(`${deviceName()}-${Date.now()}`).digest('hex').slice(0, 10)}`,
      name: typeof raw.device?.name === 'string' && raw.device.name ? raw.device.name : deviceName(),
      os: typeof raw.device?.os === 'string' ? raw.device.os : process.platform,
    }
    data.rev = Math.max(0, Math.round(Number(raw.rev) || 0))
    data.configVersion = Math.max(0, Math.round(Number(raw.configVersion) || 0))
    data.updatedAt = Number.isFinite(raw.updatedAt) ? raw.updatedAt : 0
    data.memories = Array.isArray(raw.memories) ? raw.memories.map(normalizeRecord).filter(Boolean) : []
    data.tombstones = Array.isArray(raw.tombstones) ? raw.tombstones.map(normalizeTombstone).filter(Boolean) : []
    data.settings = normalizeSettings(raw.settings)
    if (!data.settings.sync.token) data.settings.sync.token = newId('tok').replace('tok_', '') + newId('').slice(0, 8)
  }

  async function load() {
    await fsp.mkdir(path.dirname(file), { recursive: true })
    const raw = await readJson(file, null)
    applyLoaded(raw)
    if (!raw) {
      data.device.id = `dev_${createHash('sha1').update(`${deviceName()}-${Date.now()}`).digest('hex').slice(0, 10)}`
      data.settings.sync.token = newId('tok').replace('tok_', '') + newId('').slice(0, 8)
    }
    reindex()
    loaded = true
    runDecay()
    await save()
    return data
  }

  function list({ layer, tag, kind, query, limit = 200, offset = 0 } = {}) {
    let records = data.memories
    if (layer && layer !== 'all') records = records.filter((record) => record.layer === layer)
    if (tag) records = records.filter((record) => record.tags.includes(tag))
    if (kind) records = records.filter((record) => record.kind === kind)
    if (query && String(query).trim()) {
      const now = Date.now()
      records = records
        .map((record) => ({ record, score: scoreMemory(record, query, now) }))
        .filter((entry) => entry.score >= data.settings.minScore)
        .sort((a, b) => b.score - a.score)
        .map((entry) => entry.record)
    } else {
      records = [...records].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.importance - a.importance || b.updatedAt - a.updatedAt)
    }
    return records.slice(Math.max(0, offset), Math.max(0, offset) + Math.max(1, limit))
  }

  function search(query, options = {}) {
    const now = Date.now()
    const minScore = options.minScore ?? data.settings.minScore
    const limit = Math.max(1, Math.min(50, options.limit ?? data.settings.relevantLimit))
    const result = []
    for (const record of data.memories) {
      if (options.layer && options.layer !== 'all' && record.layer !== options.layer) continue
      const score = scoreMemory(record, query, now)
      if (score < minScore) continue
      result.push({ record, score })
    }
    result.sort((a, b) => b.score - a.score)
    return result.slice(0, limit)
  }

  function get(id) {
    return byId.get(String(id)) ?? null
  }

  function create(input = {}) {
    const now = Date.now()
    const text = trimTo(cleanText(input.text), 4000)
    if (!text) throw new Error('记忆内容不能为空')
    const pinned = input.pinned === true || input.layer === 'core'
    const importance = numberIn(input.importance, pinned ? 0.95 : 0.55, 0, 1)
    let layer = LAYERS.includes(input.layer) ? input.layer : pinned ? 'core' : 'normal'
    if (!pinned && (importance >= 0.82 || input.layer === 'important')) layer = 'important'
    const record = normalizeRecord({
      id: newId(),
      text,
      summary: trimTo(cleanText(input.summary), 400),
      layer,
      kind: input.kind,
      tags: input.tags,
      pinned,
      importance,
      createdAt: now,
      updatedAt: now,
      rev: nextRev(),
      origin: {
        sessionId: input.sessionId,
        deviceId: data.device.id,
        deviceName: data.device.name,
      },
    })
    if (!record) throw new Error('记忆内容无法规范化')
    data.memories.push(record)
    byId.set(record.id, record)
    enforceLimit()
    scheduleSave()
    return record
  }

  const EDITABLE = new Set(['text', 'summary', 'tags', 'kind', 'importance', 'pinned', 'layer', 'links'])

  function update(id, patch = {}) {
    const record = get(id)
    if (!record) return null
    let touched = false
    for (const [key, value] of Object.entries(patch)) {
      if (!EDITABLE.has(key) || value === undefined) continue
      if (key === 'text') {
        const text = trimTo(cleanText(value), 4000)
        if (text && text !== record.text) {
          record.text = text
          record.decayStage = 0
          record.decayedAt = 0
          record.fadedAt = 0
          record.summary = ''
          if (record.layer === 'faded') record.layer = 'normal'
          touched = true
        }
      } else if (key === 'summary') {
        record.summary = trimTo(cleanText(value), 400)
        touched = true
      } else if (key === 'tags') {
        record.tags = normalizeTags(value)
        touched = true
      } else if (key === 'kind') {
        if (KINDS.includes(value)) record.kind = value
        touched = true
      } else if (key === 'importance') {
        record.importance = numberIn(value, record.importance, 0, 1)
        touched = true
      } else if (key === 'pinned') {
        record.pinned = value === true
        if (record.pinned) {
          record.layer = 'core'
          record.importance = Math.max(record.importance, 0.9)
        } else if (record.layer === 'core') {
          record.layer = 'important'
        }
        touched = true
      } else if (key === 'layer') {
        if (LAYERS.includes(value)) {
          record.layer = value
          if (value === 'core') record.pinned = true
          if (record.pinned && value !== 'core') record.pinned = false
          touched = true
        }
      } else if (key === 'links') {
        record.links = Array.isArray(value)
          ? value.filter((link) => link && typeof link.id === 'string' && byId.has(link.id)).map((link) => ({ id: link.id, weight: numberIn(link.weight, 0.5, 0.05, 1) })).slice(0, 24)
          : []
        touched = true
      }
    }
    if (!touched) return record
    if (!record.pinned && record.layer === 'normal' && record.importance >= 0.82) record.layer = 'important'
    else if (!record.pinned && record.layer === 'important' && record.importance < 0.6 && record.accessCount < 3) record.layer = 'normal'
    record.updatedAt = Date.now()
    record.rev = nextRev()
    scheduleSave()
    return record
  }

  function forget(id) {
    const record = get(id)
    if (!record) return false
    data.memories = data.memories.filter((entry) => entry.id !== record.id)
    byId.delete(record.id)
    for (const other of data.memories) other.links = other.links.filter((link) => link.id !== record.id)
    data.tombstones.push({ id: record.id, rev: nextRev(), at: Date.now(), by: data.device.id })
    if (data.tombstones.length > 4000) data.tombstones = data.tombstones.slice(-4000)
    scheduleSave()
    return true
  }

  function touch(id, now = Date.now()) {
    const record = get(id)
    if (!record) return
    record.lastAccessAt = now
    record.accessCount += 1
    if (data.settings.autoPromote && record.layer === 'normal' && record.accessCount >= 4) {
      record.layer = 'important'
      record.importance = Math.max(record.importance, 0.7)
      record.rev = nextRev()
      record.updatedAt = now
    }
    scheduleSave()
  }

  function enforceLimit() {
    const limit = 5000
    if (data.memories.length <= limit) return
    const order = [...data.memories].sort((a, b) => {
      const rank = (record) => (record.layer === 'core' ? 3 : record.layer === 'important' ? 2 : record.layer === 'normal' ? 1 : 0)
      return rank(a) - rank(b) || a.updatedAt - b.updatedAt
    })
    for (const record of order.slice(0, data.memories.length - limit)) {
      data.memories = data.memories.filter((entry) => entry.id !== record.id)
      byId.delete(record.id)
      data.tombstones.push({ id: record.id, rev: nextRev(), at: Date.now(), by: data.device.id })
    }
  }

  function runDecay(now = Date.now()) {
    const decay = data.settings.decay
    let compressed = 0
    let faded = 0
    let purged = 0
    for (const record of [...data.memories]) {
      if (record.pinned || record.layer === 'core' || record.layer === 'important') continue
      const base = Math.max(record.updatedAt, record.lastAccessAt ?? 0, record.createdAt)
      const ageDays = (now - base) / DAY_MS
      if (ageDays < decay.afterDays) continue
      if (record.decayStage < 1) {
        record.summary = summarize(record.text || record.summary, 170, record.tags)
        record.decayStage = 1
        record.decayedAt = now
        compressed += 1
        continue
      }
      if (ageDays >= decay.stage2Days && record.decayStage < 2) {
        record.summary = summarize(record.summary || record.text, 90, record.tags)
        record.decayStage = 2
        record.decayedAt = now
        compressed += 1
        continue
      }
      if (ageDays >= decay.forgetDays && record.decayStage < 3) {
        record.summary = makeStub(record)
        record.text = ''
        record.layer = 'faded'
        record.decayStage = 3
        record.fadedAt = now
        faded += 1
      }
    }
    for (const record of [...data.memories]) {
      if (record.layer !== 'faded' || !record.fadedAt) continue
      if (now - record.fadedAt < decay.purgeDays * DAY_MS) continue
      data.memories = data.memories.filter((entry) => entry.id !== record.id)
      byId.delete(record.id)
      data.tombstones.push({ id: record.id, rev: nextRev(), at: now, by: data.device.id })
      purged += 1
    }
    if (compressed || faded || purged) scheduleSave()
    return { compressed, faded, purged }
  }

  function graph(now = Date.now()) {
    const nodes = data.memories.map((record) => ({
      id: record.id,
      layer: record.layer,
      kind: record.kind,
      importance: record.importance,
      tags: record.tags,
      ageDays: Math.max(0, (now - Math.max(record.updatedAt, record.lastAccessAt ?? 0)) / DAY_MS),
      accessCount: record.accessCount,
      decayStage: record.decayStage,
      label: trimTo(record.summary || record.text, 24),
      pinned: record.pinned,
    }))
    const edges = []
    const seen = new Set()
    const addEdge = (a, b, weight) => {
      if (a === b) return
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      if (seen.has(key)) return
      seen.add(key)
      edges.push({ a, b, weight })
    }
    const byTag = new Map()
    for (const record of data.memories) {
      for (const link of record.links) if (byId.has(link.id)) addEdge(record.id, link.id, link.weight)
      for (const tag of record.tags) {
        if (!byTag.has(tag)) byTag.set(tag, [])
        byTag.get(tag).push(record.id)
      }
    }
    for (const ids of byTag.values()) {
      for (let i = 0; i < ids.length && i < 8; i += 1) {
        for (let j = i + 1; j < ids.length && j < 8; j += 1) addEdge(ids[i], ids[j], 0.35)
      }
    }
    return { nodes, edges, generatedAt: now }
  }

  function stats(now = Date.now()) {
    const counts = { core: 0, important: 0, normal: 0, faded: 0 }
    let chars = 0
    for (const record of data.memories) {
      counts[record.layer] = (counts[record.layer] ?? 0) + 1
      chars += Array.from(record.text || record.summary || '').length
    }
    return {
      total: data.memories.length,
      counts,
      chars,
      rev: data.rev,
      updatedAt: data.updatedAt,
      device: data.device,
      accountId: data.accountId,
      oldest: data.memories.reduce((min, record) => Math.min(min, record.createdAt), now),
      tombstones: data.tombstones.length,
    }
  }

  function snapshot() {
    return {
      schema: 1,
      accountId: data.accountId,
      deviceId: data.device.id,
      deviceName: data.device.name,
      generatedAt: Date.now(),
      rev: data.rev,
      memories: data.memories,
      tombstones: data.tombstones,
    }
  }

  function mergeSnapshot(incoming) {
    if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.memories)) {
      return { added: 0, updated: 0, removed: 0, skipped: 'invalid' }
    }
    const result = { added: 0, updated: 0, removed: 0, skipped: null }
    let changed = false
    const incomingTombstones = new Map()
    for (const raw of Array.isArray(incoming.tombstones) ? incoming.tombstones : []) {
      const stone = normalizeTombstone(raw)
      if (stone) incomingTombstones.set(stone.id, stone)
    }
    const localStones = new Map(data.tombstones.map((stone) => [stone.id, stone]))
    for (const [id, stone] of incomingTombstones) {
      const localStone = localStones.get(id)
      const record = byId.get(id)
      if (localStone && localStone.rev >= stone.rev) continue
      if (record && record.rev > stone.rev) continue
      if (record) {
        byId.delete(id)
        data.memories = data.memories.filter((entry) => entry.id !== id)
        result.removed += 1
        changed = true
      }
      if (!localStone || localStone.rev < stone.rev) {
        if (!localStone) data.tombstones.push(stone)
        else Object.assign(localStone, stone)
        changed = true
      }
    }
    for (const raw of incoming.memories) {
      const incomingRecord = normalizeRecord(raw)
      if (!incomingRecord) continue
      const stone = incomingTombstones.get(incomingRecord.id) ?? localStones.get(incomingRecord.id)
      if (stone && stone.rev >= incomingRecord.rev) continue
      const local = byId.get(incomingRecord.id)
      if (!local) {
        data.memories.push(incomingRecord)
        byId.set(incomingRecord.id, incomingRecord)
        result.added += 1
        changed = true
        continue
      }
      if (incomingRecord.rev > local.rev || (incomingRecord.rev === local.rev && incomingRecord.updatedAt > local.updatedAt)) {
        Object.assign(local, incomingRecord)
        result.updated += 1
        changed = true
      }
    }
    data.tombstones = data.tombstones.slice(-4000)
    if (changed) {
      data.rev = Math.max(data.rev, Math.round(Number(incoming.rev) || 0)) + 1
      scheduleSave()
    }
    return result
  }

  function getSettings() {
    return data.settings
  }

  function setSettings(patch = {}, options = {}) {
    data.settings = normalizeSettings({ ...data.settings, ...patch, sync: { ...data.settings.sync, ...(patch.sync ?? {}) }, decay: { ...data.settings.decay, ...(patch.decay ?? {}) } })
    const keys = Object.keys(patch || {})
    const onlySwitch = keys.length === 1 && keys[0] === 'sync' && patch.sync && typeof patch.sync === 'object'
      && Object.keys(patch.sync).length === 1 && 'syncConfig' in patch.sync
    if (options.bump !== false && !onlySwitch) data.configVersion = Math.max(Date.now(), data.configVersion + 1)
    scheduleSave()
    return data.settings
  }

  function bumpConfigVersion() {
    data.configVersion = Math.max(Date.now(), data.configVersion + 1)
    scheduleSave()
    return data.configVersion
  }

  /** Settings that make sense on every device. Folder, peers, token and the enable switches stay local. */
  function portableSettings() {
    const current = data.settings
    return {
      version: data.configVersion,
      patch: {
        promptBudgetChars: current.promptBudgetChars,
        coreBudgetChars: current.coreBudgetChars,
        relevantBudgetChars: current.relevantBudgetChars,
        relevantLimit: current.relevantLimit,
        minScore: current.minScore,
        autoPromote: current.autoPromote,
        decay: { ...current.decay },
        sync: {
          git: current.sync.git,
          sharePackage: current.sync.sharePackage,
          sessions: current.sync.sessions,
          intervalMinutes: current.sync.intervalMinutes,
          plugins: current.sync.plugins,
          autoImportSessions: current.sync.autoImportSessions,
        },
      },
    }
  }

  /** Applies a patch published by another device; it never republishes (no ping-pong). */
  function applyPortableSettings(patch, version) {
    const incoming = patch && typeof patch === 'object' ? patch : {}
    const portable = {}
    for (const key of ['promptBudgetChars', 'coreBudgetChars', 'relevantBudgetChars', 'relevantLimit', 'minScore', 'autoPromote', 'decay']) {
      if (incoming[key] !== undefined) portable[key] = incoming[key]
    }
    if (incoming.sync && typeof incoming.sync === 'object') {
      portable.sync = {}
      for (const key of ['git', 'sharePackage', 'sessions', 'intervalMinutes', 'plugins', 'autoImportSessions']) {
        if (incoming.sync[key] !== undefined) portable.sync[key] = incoming.sync[key]
      }
    }
    setSettings(portable, { bump: false })
    data.configVersion = Math.max(Number(version) || 0, data.configVersion)
    scheduleSave()
    return data.settings
  }

  function setAccount(accountId) {
    if (accountId && data.accountId !== accountId) {
      data.accountId = accountId
      scheduleSave()
    }
  }

  function describe(record, now = Date.now()) {
    return {
      id: record.id,
      text: record.text,
      summary: record.summary,
      layer: record.layer,
      kind: record.kind,
      tags: record.tags,
      pinned: record.pinned,
      importance: record.importance,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      lastAccessAt: record.lastAccessAt,
      accessCount: record.accessCount,
      decayStage: record.decayStage,
      rev: record.rev,
      origin: record.origin,
      date: shortDate(record.createdAt),
      ageDays: Math.round(((now - record.createdAt) / DAY_MS) * 10) / 10,
    }
  }

  return {
    file,
    get data() {
      return data
    },
    get loaded() {
      return loaded
    },
    load,
    save,
    scheduleSave,
    list,
    search,
    get,
    create,
    update,
    forget,
    touch,
    runDecay,
    graph,
    stats,
    snapshot,
    mergeSnapshot,
    getSettings,
    setSettings,
    portableSettings,
    applyPortableSettings,
    bumpConfigVersion,
    get configVersion() {
      return data.configVersion
    },
    setAccount,
    describe,
    get device() {
      return data.device
    },
  }
}
