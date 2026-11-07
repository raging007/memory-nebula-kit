/**
 * Export this machine's DSH plugin inventory and per-plugin configuration into one JSON file.
 *
 * The output is meant to be committed to the private data repository and read by the server's
 * agent: it lists every bundle with its source (npm / link), the user's row overrides from the
 * profile patch, MCP connections (without their local commands), and the memory plugin's portable
 * settings. Secrets and machine-specific paths are redacted or flagged so they never travel as
 * actionable instructions.
 *
 * Usage:
 *   node export-plugins-manifest.mjs [-o <output.json>]
 * Env: DSH_PROFILE_DIR (or pass --profile), DSH_HOME (for the memory settings).
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

const profileDir = argOf('--profile', process.env.DSH_PROFILE_DIR)
if (!profileDir) {
  console.error('DSH_PROFILE_DIR is not set; pass --profile <profile dir>')
  process.exit(2)
}
const outFile = argOf('-o', path.join(path.dirname(fileURLToPath(import.meta.url)), 'plugins-manifest.json'))
const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')

const requireProfile = createRequire(path.join(profileDir, 'package.json'))
const yaml = requireProfile('js-yaml')

const jsTag = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  construct: (data) => ({ $js: String(data) }),
})
const schema = yaml.DEFAULT_SCHEMA.extend([jsTag])

const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|access[-_]?key|private[-_]?key|authorization|cookie)/i
const PATH_LIKE = /[A-Za-z]:\\|\\\\|\/home\/|\/Users\//

function redact(value, key = '') {
  if (SECRET_KEY.test(key) && typeof value === 'string' && value.trim()) return '<redacted>'
  if (Array.isArray(value)) return value.map((item) => redact(item, key))
  if (value && typeof value === 'object') {
    const copy = {}
    for (const [childKey, childValue] of Object.entries(value)) copy[childKey] = redact(childValue, childKey)
    return copy
  }
  return value
}

function containsPathOrExpression(value) {
  if (typeof value === 'string') return PATH_LIKE.test(value) || value.startsWith('link:')
  if (Array.isArray(value)) return value.some(containsPathOrExpression)
  if (value && typeof value === 'object') {
    if ('$js' in value) return true
    return Object.values(value).some(containsPathOrExpression)
  }
  return false
}

function flattenRows(entries, rows, group = null) {
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue
    if (Array.isArray(entry.insert)) {
      flattenRows(entry.insert, rows, group)
      continue
    }
    if (entry.group === true && Array.isArray(entry.config)) {
      flattenRows(entry.config, rows, entry.id ?? group)
      continue
    }
    if (typeof entry.name !== 'string' && typeof entry.id !== 'string') continue
    const row = {
      id: entry.id ?? null,
      name: entry.name ?? null,
      group: group ?? null,
      disabled: entry.disabled ?? null,
      config: entry.config && typeof entry.config === 'object' ? entry.config : {},
    }
    rows.push(row)
  }
}

const pkg = JSON.parse(await fs.readFile(path.join(profileDir, 'package.json'), 'utf8'))
const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
const bundleNames = Array.isArray(pkg.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []

let rows = []
const patchPath = path.join(profileDir, 'cordis.patch.yml')
try {
  const text = await fs.readFile(patchPath, 'utf8')
  const parsed = yaml.load(text, { schema, filename: patchPath })
  if (Array.isArray(parsed)) flattenRows(parsed, rows)
} catch (error) {
  console.error(`warning: could not parse ${patchPath}: ${error.message}`)
}

const bundles = bundleNames.map((name) => {
  const spec = typeof deps[name] === 'string' ? deps[name] : null
  const source = spec && /^(link|file):/i.test(spec) ? 'link' : spec ? 'npm' : 'shipped'
  const transfer = name === 'dsh-memory-nebula' ? 'data-repo' : null
  return {
    name,
    spec,
    source,
    path: source === 'link' && spec ? spec.replace(/^link:/i, '') : null,
    portable: source === 'npm' || transfer === 'data-repo',
    transfer,
  }
})

const mcp = []
const pluginRows = []
for (const row of rows) {
  const config = redact(row.config)
  const portableConfig = !containsPathOrExpression(row.config)
  if (row.name === '@deepseek-ai/dsh-mcp-client') {
    mcp.push({
      id: row.id,
      serverName: typeof row.config?.serverName === 'string' ? row.config.serverName : null,
      portable: false,
      note: 'MCP connections are machine-specific (local command, args, credentials); recreate them on the target device.',
    })
    continue
  }
  pluginRows.push({
    id: row.id,
    name: row.name,
    group: row.group,
    disabled: row.disabled,
    config,
    portableConfig,
  })
}

let memory = null
try {
  const store = JSON.parse(await fs.readFile(path.join(dshHome, 'memory-nebula', 'memories.json'), 'utf8'))
  const settings = store.settings ?? {}
  const sync = settings.sync ?? {}
  memory = {
    version: null,
    settings: {
      promptBudgetChars: settings.promptBudgetChars,
      coreBudgetChars: settings.coreBudgetChars,
      relevantBudgetChars: settings.relevantBudgetChars,
      relevantLimit: settings.relevantLimit,
      minScore: settings.minScore,
      autoPromote: settings.autoPromote,
      decay: settings.decay,
      sync: {
        git: sync.git,
        sharePackage: sync.sharePackage,
        syncConfig: sync.syncConfig,
        sessions: sync.sessions,
        intervalMinutes: sync.intervalMinutes,
        plugins: sync.plugins,
      },
    },
  }
} catch {
  /* the memory plugin may not be installed on this machine */
}
try {
  memory.version = JSON.parse(
    await fs.readFile(
      path.join(
        (() => {
          const spec = deps['dsh-memory-nebula']
          if (typeof spec === 'string' && spec.startsWith('link:')) return spec.slice(5)
          return path.join(profileDir, 'node_modules', 'dsh-memory-nebula')
        })(),
        'package.json',
      ),
      'utf8',
    ),
  ).version
} catch {
  /* the linked package may resolve differently; version stays null */
}

const manifest = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  from: os.hostname(),
  profile: pkg.name ?? null,
  bundles,
  rows: pluginRows,
  mcp,
  memory,
}

await fs.mkdir(path.dirname(outFile), { recursive: true })
await fs.writeFile(outFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ok: true, out: outFile, bundles: bundles.length, rows: pluginRows.length, mcp: mcp.length, memory: Boolean(memory) }))
