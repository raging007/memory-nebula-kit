import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createStore } from '../lib/store.js'
import { createSync } from '../lib/sync.js'

/** Session archive/import runs against a throwaway DSH home, never the real one. */
const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-sessions-'))
process.env.DSH_HOME = path.join(root, 'home')

const home = process.env.DSH_HOME
const shared = path.join(root, 'shared')
const workspace = '--D-work--'
const localId = 'session-local-1'
const remoteId = 'session-remote-1'
const payload = '{"type":"header"}'

await fsp.mkdir(path.join(home, 'sessions', workspace, localId), { recursive: true })
const localFile = path.join(home, 'sessions', workspace, localId, 'session.v4.jsonl.zstd')
await fsp.writeFile(localFile, payload)
const old = new Date(Date.now() - 10 * 60_000)
await fsp.utimes(localFile, old, old)

const remoteDir = path.join(shared, 'sessions', 'dev_other', workspace, remoteId)
await fsp.mkdir(remoteDir, { recursive: true })
await fsp.writeFile(path.join(remoteDir, 'session.v4.jsonl.zstd'), payload)

const store = createStore({ dataDir: path.join(root, 'data'), config: {} })
await store.load()
store.setSettings({ sync: { enabled: true, folder: shared, sessions: 'export', token: 'tok-test-0001' } })
const sync = createSync({ store, dataDir: path.join(root, 'data') })

const imported = await sync.importSessions()
assert.equal(imported.ok, true, JSON.stringify(imported))
assert.deepEqual(imported.imported.map((entry) => entry.session), [remoteId])
const archived = path.join(home, 'synced-sessions', 'sessions', 'dev_other', workspace, remoteId, 'session.v4.jsonl.zstd')
assert.equal(await fsp.readFile(archived, 'utf8'), payload)
assert.equal(await fsp.stat(path.join(home, 'sessions', workspace, remoteId)).catch(() => null), null, 'the default does not touch the DSH session store')

store.setSettings({ sync: { sessionsIntoDsh: true } })
const installed = await sync.importSessions()
assert.equal(installed.ok, true, JSON.stringify(installed))
assert.equal(installed.installed.length, 1)
const localCopy = path.join(home, 'sessions', workspace, remoteId, 'session.v4.jsonl.zstd')
assert.equal(await fsp.readFile(localCopy, 'utf8'), payload)

const report = {}
await sync.exportSessions(report)
assert.equal(report.sessions.ok, true, JSON.stringify(report))
const exported = path.join(shared, 'sessions', store.device.id, workspace, localId, 'session.v4.jsonl.zstd')
assert.equal(await fsp.readFile(exported, 'utf8'), payload)

const second = await sync.importSessions()
assert.equal(second.imported.length, 0, 'an already imported session is not copied again')
assert.ok(second.skipped >= 1)

await fsp.rm(root, { recursive: true, force: true })
console.log('SESSION SYNC TESTS PASSED')
