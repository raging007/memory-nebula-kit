import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export const DAY_MS = 86_400_000

export const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value))

/** A short, time-sortable record id: `m_` + base36 time + random suffix. */
export function newId(prefix = 'm') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function hash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex')
}

export function resolveDshHome() {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim()) return path.resolve(fromEnv.trim())
  return path.join(os.homedir(), '.dsh')
}

export function resolveDataDir(config) {
  if (config && typeof config.dataDir === 'string' && config.dataDir.trim()) return path.resolve(config.dataDir.trim())
  return path.join(resolveDshHome(), 'memory-nebula')
}

export async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true })
}

export function readJsonSync(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export async function readJson(file, fallback) {
  try {
    const raw = await fsp.readFile(file, 'utf8')
    if (!raw.trim()) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

const pendingWrites = new Map()

/**
 * Write JSON through a temp file and a rename, so a reader never observes a half-written store.
 * Writes to the same path are serialized; concurrent callers share the latest queued value.
 */
export function writeJsonAtomic(file, value) {
  const previous = pendingWrites.get(file) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`
    await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await fsp.rename(tmp, file)
  })
  pendingWrites.set(file, next)
  next.catch(() => { pendingWrites.delete(file) })
  return next
}

export function deviceName() {
  try {
    return os.hostname() || 'device'
  } catch {
    return 'device'
  }
}

export function timeAgo(at, now = Date.now()) {
  if (!at) return '未知'
  const ms = Math.max(0, now - at)
  if (ms < 60_000) return '刚刚'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

export function shortDate(at) {
  if (!at) return ''
  const date = new Date(at)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${mm}-${dd}`
}

export function clip(text, max) {
  const chars = Array.from(String(text ?? ''))
  if (chars.length <= max) return chars.join('')
  return `${chars.slice(0, Math.max(0, max - 1)).join('')}…`
}

/** Keeps a value inside `[lo, hi]`; non-numbers fall back to `fallback`. */
export function numberIn(value, fallback, lo, hi) {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return clamp(n, lo, hi)
}

/** Rough token estimate that is conservative for mixed Chinese/English text. */
export function estimateTokens(text) {
  const chars = Array.from(String(text ?? ''))
  let tokens = 0
  for (const ch of chars) tokens += /[\u4e00-\u9fff]/.test(ch) ? 1 : 0.32
  return Math.ceil(tokens)
}

export function errorText(error) {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return '未知错误'
  }
}
