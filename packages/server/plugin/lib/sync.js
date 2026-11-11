import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { ensureDir, errorText, findProfileDir, readJson, resolveDshHome, writeJsonAtomic } from './util.js'

/**
 * Cross-device sync without a server of its own:
 *
 * - a shared folder (any cloud drive or Syncthing folder) holding one snapshot file per device;
 * - directly reachable Hub peers over HTTP, each guarded by the sync token;
 * - read-only session archives and an explicit import, because session logs are DSH's own files;
 * - a plugin inventory per device, so a missing bundle is visible instead of silently divergent;
 * - optional package sharing: the owner may let the bundle itself travel through the same folder,
 *   so the other device installs from a local directory instead of a hand-copied zip.
 *
 * Merging is per record: the higher `rev` wins, `updatedAt` breaks a tie. Nothing here needs a
 * shared clock, and a device that has been offline merges as soon as it sees a snapshot.
 */

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SHARED_FILES = ['package.json', 'index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'INSTALL.md']
const SHARED_DIRS = ['lib', 'locale']
const SESSION_FILE = 'session.v4.jsonl.zstd'
const SAFE_NAME = /^[A-Za-z0-9._~-]{1,120}$/
const ACTIVE_WRITE_MS = 3 * 60_000
const MAX_SESSION_FILES = 40
const execFileAsync = promisify(execFile)

/**
 * Run git inside the sync folder. `GIT_TERMINAL_PROMPT=0` turns a missing credential into an
 * error instead of a hidden prompt that would stall the Host until the timeout.
 */
async function gitRun(folder, args, timeout = 30_000) {
  const { stdout } = await execFileAsync('git', args, {
    cwd: folder,
    timeout,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  })
  return String(stdout ?? '').trim()
}

async function isGitRepo(folder) {
  try {
    return (await gitRun(folder, ['rev-parse', '--is-inside-work-tree'])) === 'true'
  } catch {
    return false
  }
}

async function hasUpstream(folder) {
  try {
    return Boolean(await gitRun(folder, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']))
  } catch {
    return false
  }
}

/**
 * The part of a snapshot that matters for merging. Access counters and generation timestamps move
 * on every turn; writing them would make the git channel commit on every sync, so a device only
 * rewrites its snapshot when this fingerprint changes.
 */
function semanticFingerprint(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.memories)) return ''
  const records = snapshot.memories
    .map((m) => [
      m.id, m.rev, m.updatedAt, m.layer, m.pinned, m.importance, m.kind,
      m.createdAt, m.decayStage, m.fadedAt, m.text, m.summary, (m.tags ?? []).join(','),
    ].join('\u0001'))
    .sort()
  const stones = (Array.isArray(snapshot.tombstones) ? snapshot.tombstones : [])
    .map((stone) => `${stone.id}:${stone.rev}`)
    .sort()
  return `${records.join('\n')}\n--\n${stones.join('\n')}`
}

function assertSafe(name) {
  return typeof name === 'string' && SAFE_NAME.test(name) && name !== '.' && name !== '..'
}

async function statOrNull(file) {
  try {
    return await fsp.stat(file)
  } catch {
    return null
  }
}

async function listDir(dir) {
  try {
    return await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

export function createSync({ store, dataDir, buildInventory = null, logger = console }) {
  const settings = () => store.getSettings()
  let lastReport = null
  let running = null

  const accountKey = () => store.data.accountId || 'local'

  function snapshotName() {
    return `memory-nebula.${accountKey()}.${store.device.id}.json`
  }

  let profileDirCache
  async function pluginManifest() {
    if (profileDirCache === undefined) profileDirCache = await findProfileDir()
    if (!profileDirCache) return null
    const pkg = await readJson(path.join(profileDirCache, 'package.json'), null)
    if (!pkg) return null
    const bundles = Array.isArray(pkg.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
    const deps = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
    return {
      bundles: bundles.filter((name) => typeof name === 'string').map((name) => ({ name, version: typeof deps[name] === 'string' ? deps[name] : null })),
      capturedAt: Date.now(),
      profile: pkg.name ?? null,
    }
  }

  async function buildSnapshot() {
    const base = store.snapshot()
    const manifest = settings().sync.plugins ? await pluginManifest() : null
    return {
      ...base,
      meta: {
        plugins: manifest,
        sessions: await countOwnSessions().catch(() => null),
      },
    }
  }

  async function countOwnSessions() {
    const root = path.join(resolveDshHome(), 'sessions')
    let count = 0
    for (const workspace of await listDir(root)) {
      if (!workspace.isDirectory() || !assertSafe(workspace.name)) continue
      for (const session of await listDir(path.join(root, workspace.name))) {
        if (session.isDirectory() && assertSafe(session.name)) count += 1
      }
    }
    return count
  }

  function pluginDiff(local, remote) {
    if (!local || !remote) return null
    const localNames = new Set(local.bundles.map((bundle) => bundle.name))
    const remoteNames = new Set(remote.bundles.map((bundle) => bundle.name))
    return {
      missingHere: remote.bundles.filter((bundle) => !localNames.has(bundle.name)),
      missingThere: local.bundles.filter((bundle) => !remoteNames.has(bundle.name)),
    }
  }

  async function mergeRemote(snapshot, source) {
    if (!snapshot || snapshot.schema !== 1 || !Array.isArray(snapshot.memories)) {
      return { source, ok: false, error: '快照格式无法识别' }
    }
    const localAccount = accountKey()
    const remoteAccount = typeof snapshot.accountId === 'string' && snapshot.accountId ? snapshot.accountId : 'local'
    if (localAccount !== 'local' && remoteAccount !== localAccount) {
      return { source, ok: false, skipped: '不同账号，已跳过', account: remoteAccount }
    }
    if (snapshot.deviceId === store.device.id) return { source, ok: true, skipped: '本机快照' }
    const merged = store.mergeSnapshot(snapshot)
    const diff = settings().sync.plugins ? pluginDiff(await pluginManifest(), snapshot.meta?.plugins ?? null) : null
    return {
      source,
      ok: true,
      device: snapshot.deviceName ?? snapshot.deviceId ?? 'unknown',
      added: merged.added,
      updated: merged.updated,
      removed: merged.removed,
      plugins: diff,
    }
  }

  async function folderSync(report) {
    const folder = settings().sync.folder.trim()
    if (!folder) {
      report.folder = { ok: false, skipped: '未设置同步文件夹' }
      return
    }
    try {
      await ensureDir(folder)
      const target = path.join(folder, snapshotName())
      const initial = await buildSnapshot()
      const before = await readJson(target, null)
      if (!before || semanticFingerprint(before) !== semanticFingerprint(initial)) {
        await writeJsonAtomic(target, initial)
      }
      const entries = await listDir(folder)
      const peers = []
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.startsWith('memory-nebula.') || !entry.name.endsWith('.json')) continue
        if (entry.name === snapshotName()) continue
        const snapshot = await readJson(path.join(folder, entry.name), null)
        if (!snapshot) continue
        peers.push(await mergeRemote(snapshot, entry.name))
      }
      const merged = await buildSnapshot()
      const after = await readJson(target, null)
      if (!after || semanticFingerprint(after) !== semanticFingerprint(merged)) {
        await writeJsonAtomic(target, merged)
      }
      report.folder = { ok: true, path: folder, peers }
      for (const peer of peers) {
        if (peer.ok && (peer.added || peer.updated || peer.removed)) report.changed = true
      }
    } catch (error) {
      report.folder = { ok: false, error: errorText(error) }
    }
  }

  async function fetchPeer(peer, route, init = {}) {
    const url = `${peer.url}/memory-nebula/api/transport/${route}`
    const response = await fetch(url, {
      ...init,
      headers: {
        'x-memory-nebula': '1',
        'x-memory-sync-token': peer.token || '',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(20_000),
    })
    const body = await response.json().catch(() => null)
    if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`)
    return body
  }

  async function httpSync(report) {
    const peers = settings().sync.peers
    report.peers = []
    for (const peer of peers) {
      const entry = { name: peer.name, url: peer.url, ok: false }
      try {
        const pulled = await fetchPeer(peer, 'snapshot')
        const merged = await mergeRemote(pulled, peer.name)
        entry.pull = merged
        if (merged.ok) {
          const pushed = await fetchPeer(peer, 'merge', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(await buildSnapshot()),
          })
          entry.push = pushed
        }
        entry.ok = merged.ok
        if (merged.ok && (merged.added || merged.updated || merged.removed)) report.changed = true
      } catch (error) {
        entry.error = errorText(error)
      }
      report.peers.push(entry)
    }
  }

  async function exportSessions(report) {
    const folder = settings().sync.folder.trim()
    if (!folder) {
      report.sessions = { ok: false, skipped: '未设置同步文件夹' }
      return
    }
    if (settings().sync.sessions === 'off') {
      report.sessions = { ok: true, skipped: '会话归档已关闭' }
      return
    }
    const root = path.join(resolveDshHome(), 'sessions')
    const target = path.join(folder, 'sessions', store.device.id)
    const exported = []
    let skipped = 0
    let bytes = 0
    try {
      for (const workspace of await listDir(root)) {
        if (!workspace.isDirectory() || !assertSafe(workspace.name)) continue
        for (const session of await listDir(path.join(root, workspace.name))) {
          if (!session.isDirectory() || !assertSafe(session.name)) continue
          if (exported.length >= MAX_SESSION_FILES || bytes > 80 * 1024 * 1024) break
          const source = path.join(root, workspace.name, session.name, SESSION_FILE)
          const info = await statOrNull(source)
          if (!info) continue
          if (Date.now() - info.mtimeMs < ACTIVE_WRITE_MS) {
            skipped += 1
            continue
          }
          const destination = path.join(target, workspace.name, session.name)
          const destinationFile = path.join(destination, SESSION_FILE)
          const existing = await statOrNull(destinationFile)
          if (existing && existing.size === info.size) continue
          await ensureDir(destination)
          await fsp.copyFile(source, destinationFile)
          await writeJsonAtomic(path.join(destination, 'meta.json'), {
            id: session.name,
            workspace: workspace.name,
            deviceId: store.device.id,
            deviceName: store.device.name,
            size: info.size,
            mtimeMs: info.mtimeMs,
            exportedAt: Date.now(),
          })
          exported.push(`${workspace.name}/${session.name}`)
          bytes += info.size
        }
      }
      report.sessions = { ok: true, exported, skipped, bytes, folder: target }
    } catch (error) {
      report.sessions = { ok: false, error: errorText(error), exported }
    }
  }

  function sessionsDirResolved() {
    const configured = typeof settings().sync.sessionsDir === 'string' ? settings().sync.sessionsDir.trim() : ''
    if (configured) return path.resolve(configured)
    return path.join(resolveDshHome(), 'synced-sessions')
  }

  /**
   * Copies other devices' archived sessions into the dedicated workspace folder (never into the
   * main DSH session store unless sessionsIntoDsh is on). The folder is a separate tree, so the
   * imported conversations do not mix with this machine's own sessions.
   */
  async function importSessions() {
    const folder = settings().sync.folder.trim()
    if (!folder) return { ok: false, error: '未设置同步文件夹' }
    const targetRoot = sessionsDirResolved()
    const source = path.join(folder, 'sessions')
    const intoDsh = settings().sync.sessionsIntoDsh === true
    const dshRoot = path.join(resolveDshHome(), 'sessions')
    const imported = []
    const installed = []
    const skipped = []
    try {
      for (const device of await listDir(source)) {
        if (!device.isDirectory() || !assertSafe(device.name) || device.name === store.device.id) continue
        for (const workspace of await listDir(path.join(source, device.name))) {
          if (!workspace.isDirectory() || !assertSafe(workspace.name)) continue
          for (const session of await listDir(path.join(source, device.name, workspace.name))) {
            if (!session.isDirectory() || !assertSafe(session.name)) continue
            const fromDir = path.join(source, device.name, workspace.name, session.name)
            const from = path.join(fromDir, SESSION_FILE)
            const info = await statOrNull(from)
            if (!info) continue
            const toDir = path.join(targetRoot, 'sessions', device.name, workspace.name, session.name)
            const to = path.join(toDir, SESSION_FILE)
            const existing = await statOrNull(to)
            if (existing && existing.size === info.size) {
              skipped.push(session.name)
            } else {
              await ensureDir(toDir)
              await fsp.copyFile(from, to)
              const meta = await readJson(path.join(fromDir, 'meta.json'), null)
              imported.push({ session: session.name, workspace: workspace.name, device: meta?.deviceName ?? device.name, file: to })
            }
            if (intoDsh) {
              const dshDir = path.join(dshRoot, workspace.name, session.name)
              const dshFile = path.join(dshDir, SESSION_FILE)
              if (!(await statOrNull(dshFile))) {
                await ensureDir(dshDir)
                await fsp.copyFile(from, dshFile)
                installed.push({ session: session.name, workspace: workspace.name })
              }
            }
          }
        }
      }
      if (imported.length) {
        await ensureDir(targetRoot)
        await writeJsonAtomic(path.join(targetRoot, 'import-index.json'), {
          at: Date.now(),
          device: store.device.name,
          folder: targetRoot,
          sessions: imported.slice(-500),
        })
      }
      return {
        ok: true,
        imported,
        installed,
        skipped: skipped.length,
        folder: targetRoot,
        intoDsh,
        restartRequired: intoDsh && installed.length > 0,
      }
    } catch (error) {
      return { ok: false, error: errorText(error), imported }
    }
  }

  /**
   * Copies this bundle into `<folder>/plugins/memory-nebula` so another device can install from a
   * local directory without a hand-copied zip. Version-pinned: it only rewrites when the version
   * changes, so a cloud client is not asked to upload the same code on every sync. Nothing here
   * installs anything on the other side — that stays an explicit `install_bundle`.
   */
  async function sharePackage(report) {
    const folder = settings().sync.folder.trim()
    if (!folder) {
      report.package = { ok: false, skipped: '未设置同步文件夹' }
      return
    }
    try {
      const target = path.join(folder, 'plugins', 'memory-nebula')
      const local = await readJson(path.join(PACKAGE_ROOT, 'package.json'), null)
      const shared = await readJson(path.join(target, 'package.json'), null)
      const version = local && typeof local.version === 'string' ? local.version : null
      if (version && shared && shared.version === version) {
        report.package = { ok: true, path: target, version, unchanged: true }
        return
      }
      await ensureDir(target)
      for (const file of SHARED_FILES) {
        const from = path.join(PACKAGE_ROOT, file)
        if (!(await statOrNull(from))) continue
        await fsp.copyFile(from, path.join(target, file))
      }
      for (const dir of SHARED_DIRS) {
        const from = path.join(PACKAGE_ROOT, dir)
        if (!(await statOrNull(from))) continue
        await fsp.cp(from, path.join(target, dir), { recursive: true, force: true })
      }
      await fsp.writeFile(
        path.join(target, 'INSTALL-FROM-HERE.md'),
        [
          '# 从同步文件夹安装记忆星图',
          '',
          `这是从另一台设备同步过来的插件包（版本 ${version ?? '未知'}）。不要把云盘里的目录直接 link 进 profile，先复制到本机固定目录：`,
          '',
          '1. 把整个 `memory-nebula` 目录复制到本机可写位置，例如 `C:\\dsh\\plugins\\memory-nebula`；',
          '2. 让 agent 执行 `plugin_manager` 的 `install_bundle`，target 就是上面这个目录；',
          '3. 重启 DSH（或停用再启用该行）并刷新页面，左栏会出现「记忆星图」。',
          '',
          '安装只读这个目录，不会执行任何安装脚本；装完它的记忆库和同步设置都在本机 `DSH_HOME/memory-nebula` 里。',
          '',
        ].join('\n'),
        'utf8',
      )
      report.package = { ok: true, path: target, version, copied: true }
    } catch (error) {
      report.package = { ok: false, error: errorText(error) }
    }
  }

  /**
   * Portable settings travel as `config/desired.json`. Each device owns a monotonic
   * `configVersion`; the newer one wins and is applied by the other without being republished,
   * so two devices converge instead of rewriting each other forever. Folder, peers, token and the
   * enable switches are deliberately not part of the patch.
   */
  async function syncConfig(report) {
    const current = settings().sync
    if (!current.syncConfig) return
    const folder = current.folder.trim()
    if (!folder) {
      report.config = { ok: false, skipped: '未设置同步文件夹' }
      return
    }
    try {
      const file = path.join(folder, 'config', 'desired.json')
      const remote = await readJson(file, null)
      const remoteVersion = remote && Number.isFinite(Number(remote.version)) ? Number(remote.version) : 0
      const from = remote && typeof remote.from === 'string' ? remote.from : null
      // Version 0 means this device never published settings. An established remote config wins;
      // otherwise this device bootstraps the file from its current settings.
      if (store.configVersion === 0) {
        if (remote && remoteVersion > 0) {
          store.applyPortableSettings(remote.patch, remoteVersion)
          report.config = { ok: true, applied: true, initial: true, version: remoteVersion, from }
          return
        }
        const version = store.bumpConfigVersion()
        await ensureDir(path.dirname(file))
        await writeJsonAtomic(file, { version, from: store.device.name, patch: store.portableSettings().patch })
        report.config = { ok: true, published: true, initial: true, version }
        return
      }
      const localVersion = store.configVersion
      if (remoteVersion > localVersion) {
        store.applyPortableSettings(remote.patch, remoteVersion)
        report.config = { ok: true, applied: true, version: remoteVersion, from }
      } else if (localVersion > remoteVersion) {
        await ensureDir(path.dirname(file))
        await writeJsonAtomic(file, {
          version: localVersion,
          from: store.device.name,
          patch: store.portableSettings().patch,
        })
        report.config = { ok: true, published: true, version: localVersion }
      } else {
        report.config = { ok: true, unchanged: true, version: localVersion }
      }
    } catch (error) {
      report.config = { ok: false, error: errorText(error) }
    }
  }

  /** Pull the data repository before this device writes its snapshot. */
  async function gitPull(report) {
    const folder = settings().sync.folder.trim()
    if (!folder) {
      report.git = { ok: false, skipped: '未设置同步文件夹' }
      return false
    }
    try {
      await ensureDir(folder)
      if (!(await isGitRepo(folder))) {
        report.git = { ok: false, error: '同步文件夹不是 git 仓库：先把数据仓库 clone 到这里' }
        return false
      }
      if ((await statOrNull(path.join(folder, '.git', 'rebase-merge'))) || (await statOrNull(path.join(folder, '.git', 'rebase-apply')))) {
        try {
          await gitRun(folder, ['rebase', '--abort'])
        } catch {
          /* an interrupted rebase left the branch detached; abort restores it */
        }
      }
      if (!(await hasUpstream(folder))) {
        try {
          await gitRun(folder, ['branch', '--set-upstream-to=origin/main', 'main'])
        } catch {
          /* origin/main may not exist yet */
        }
      }
      if (!(await hasUpstream(folder))) {
        report.git = { ok: true, pulled: false, note: '仓库没有上游分支，跳过 pull' }
        return true
      }
      await gitRun(folder, ['pull', '--rebase', '--autostash'])
      report.git = { ok: true, pulled: true }
      return true
    } catch (error) {
      try {
        await gitRun(folder, ['rebase', '--abort'])
      } catch {
        /* the failure happened before a rebase started */
      }
      report.git = { ok: false, error: errorText(error) }
      return false
    }
  }

  /** Commit this device's files and push; a git failure never fails the memory merge itself. */
  async function gitPush(report) {
    const folder = settings().sync.folder.trim()
    if (!folder) return
    try {
      if (!(await isGitRepo(folder))) return
      await gitRun(folder, ['add', '-A'])
      const staged = await gitRun(folder, ['status', '--porcelain'])
      let committed = false
      if (staged) {
        const message = `memory sync ${store.device.name} ${new Date().toISOString()}`
        await gitRun(folder, [
          '-c', 'user.name=memory-nebula',
          '-c', 'user.email=memory-nebula@users.noreply.github.com',
          'commit', '-m', message,
        ])
        committed = true
      }
      let pushed = false
      let pushError = null
      if (await hasUpstream(folder)) {
        await gitRun(folder, ['push'])
        pushed = true
      } else {
        try {
          await gitRun(folder, ['push', '-u', 'origin', 'main'])
          pushed = true
        } catch (error) {
          pushError = errorText(error)
        }
      }
      report.git = { ...(report.git || {}), ok: !pushError, committed, pushed, ...(pushError ? { pushError } : {}) }
    } catch (error) {
      report.git = { ...(report.git || {}), ok: false, error: errorText(error) }
    }
  }

  /**
   * Publishes the plugin inventory (`config/plugins.json`) into the sync folder. The main device
   * enables this; the file is only rewritten when the bundle list or a user config changes.
   */
  async function exportInventory(report) {
    const folder = settings().sync.folder.trim()
    if (!folder) {
      report.inventory = { ok: false, skipped: '未设置同步文件夹' }
      return
    }
    if (typeof buildInventory !== 'function') {
      report.inventory = { ok: false, error: 'inventory provider missing' }
      return
    }
    try {
      const manifest = await buildInventory()
      const file = path.join(folder, 'config', 'plugins.json')
      const existing = await readJson(file, null)
      const fingerprint = (doc) => JSON.stringify({ ...doc, generatedAt: undefined })
      if (!existing || fingerprint(existing) !== fingerprint(manifest)) {
        await ensureDir(path.dirname(file))
        await writeJsonAtomic(file, manifest)
        report.inventory = { ok: true, written: true, bundles: manifest.bundles?.length ?? 0, rows: manifest.rows?.length ?? 0 }
      } else {
        report.inventory = { ok: true, unchanged: true }
      }
    } catch (error) {
      report.inventory = { ok: false, error: errorText(error) }
    }
  }

  async function run(reason = 'manual') {
    if (running) return running
    running = (async () => {
      const report = {
        at: Date.now(),
        reason,
        account: accountKey(),
        device: { id: store.device.id, name: store.device.name },
        changed: false,
        peers: [],
      }
      const current = settings().sync
      if (!current.enabled && reason !== 'manual') {
        report.skipped = '同步未开启'
      } else if (!current.enabled && reason === 'manual') {
        report.skipped = '同步未开启'
      }
      if (current.enabled || reason === 'manual') {
        if (current.git) await gitPull(report)
        await syncConfig(report)
        await folderSync(report)
        await httpSync(report)
        if (current.sessions !== 'off') await exportSessions(report)
        if (current.autoImportSessions) report.import = await importSessions()
        if (current.sharePackage) await sharePackage(report)
        if (current.shareInventory) await exportInventory(report)
        if (current.git) await gitPush(report)
      }
      lastReport = report
      try {
        await writeJsonAtomic(path.join(dataDir, 'sync-report.json'), { ...report, peers: report.peers, folder: report.folder })
      } catch {
        /* a failed report write must not fail the sync */
      }
      return report
    })().catch((error) => {
      lastReport = { at: Date.now(), reason, ok: false, error: errorText(error) }
      return lastReport
    })
    try {
      return await running
    } finally {
      running = null
    }
  }

  async function status() {
    const current = settings().sync
    return {
      enabled: current.enabled,
      folder: current.folder,
      intervalMinutes: current.intervalMinutes,
      peers: current.peers.map((peer) => ({ name: peer.name, url: peer.url, hasToken: Boolean(peer.token) })),
      token: current.token,
      sessions: current.sessions,
      sessionsDir: current.sessionsDir,
      sessionsDirResolved: sessionsDirResolved(),
      sessionsIntoDsh: current.sessionsIntoDsh === true,
      autoImportSessions: current.autoImportSessions,
      plugins: current.plugins,
      sharePackage: current.sharePackage,
      shareInventory: current.shareInventory,
      git: current.git,
      syncConfig: current.syncConfig,
      account: accountKey(),
      device: store.device,
      lastReport,
      sessionsOnDisk: await countOwnSessions().catch(() => 0),
      pluginManifest: settings().sync.plugins ? await pluginManifest().catch(() => null) : null,
    }
  }

  return { run, status, importSessions, exportSessions, pluginManifest, snapshotName, buildSnapshot }
}
