import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readJson } from './util.js'

/**
 * Builds the plugin inventory that the main device publishes to `config/plugins.json`.
 *
 * The row data comes from the live `configEditor` service, so no YAML parsing is involved and the
 * output reflects the *effective* user overrides. Secrets are redacted by key name and configs that
 * contain machine-specific paths are flagged, because the file is read by another machine's agent.
 */

const SECRET_KEY = /(token|secret|password|passwd|api[-_]?key|access[-_]?key|private[-_]?key|authorization|cookie)/i
const PATH_LIKE = /[A-Za-z]:\\|\\\\|\/home\/|\/Users\//

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function redact(value, key = '') {
  if (SECRET_KEY.test(key) && typeof value === 'string' && value.trim()) return '<redacted>'
  if (Array.isArray(value)) return value.map((item) => redact(item, key))
  if (value && typeof value === 'object') {
    const copy = {}
    for (const [childKey, childValue] of Object.entries(value)) copy[childKey] = redact(childValue, childKey)
    return copy
  }
  return value
}

function containsPath(value) {
  if (typeof value === 'string') return PATH_LIKE.test(value) || value.startsWith('link:')
  if (Array.isArray(value)) return value.some(containsPath)
  if (value && typeof value === 'object') return Object.values(value).some(containsPath)
  return false
}

async function pluginVersion() {
  try {
    return (await readJson(path.join(PACKAGE_ROOT, 'package.json'), null))?.version ?? null
  } catch {
    return null
  }
}

export async function buildInventory({ profileDir, configEditor, store, deviceName }) {
  const pkg = profileDir ? await readJson(path.join(profileDir, 'package.json'), null) : null
  const deps = pkg && pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
  const names = pkg && Array.isArray(pkg.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []

  const bundles = names.map((name) => {
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

  const rows = []
  const mcp = []
  try {
    if (configEditor && typeof configEditor.configuration === 'function') {
      for (const item of configEditor.configuration()) {
        const entry = item && item.entry ? item.entry : {}
        const override = item && item.override && typeof item.override === 'object' ? item.override : {}
        const name = typeof entry.name === 'string' ? entry.name : null
        const id = entry.id ?? null
        if (!id && !name) continue
        if (name === '@deepseek-ai/dsh-mcp-client') {
          mcp.push({
            id,
            serverName: typeof override.serverName === 'string' ? override.serverName : null,
            portable: false,
            note: 'MCP connections are machine-specific; recreate them on the target device.',
          })
          continue
        }
        const config = redact(override)
        rows.push({
          id,
          name,
          group: entry.group ?? null,
          disabled: entry.disabled ?? null,
          config,
          portableConfig: !containsPath(override),
        })
      }
    }
  } catch {
    /* configEditor is optional; the rest of the inventory still works */
  }

  const portable = typeof store.portableSettings === 'function' ? store.portableSettings() : null
  const memory = portable
    ? { version: await pluginVersion(), settings: portable.patch }
    : null

  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    from: deviceName,
    profile: pkg?.name ?? null,
    bundles,
    rows,
    mcp,
    memory,
  }
}
