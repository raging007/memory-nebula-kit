import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createStore } from '../lib/store.js'
import { createSync } from '../lib/sync.js'

/** Config rides the same folder: newer version wins, the receiver applies it without republishing. */
const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-config-'))
const shared = path.join(root, 'shared')
const dirA = path.join(root, 'a')
const dirB = path.join(root, 'b')

const storeA = createStore({ dataDir: dirA, config: {} })
await storeA.load()
const storeB = createStore({ dataDir: dirB, config: {} })
await storeB.load()

storeA.setAccount('user-1')
storeB.setAccount('user-1')
storeA.setSettings({ sync: { enabled: true, folder: shared, sessions: 'off', syncConfig: true, token: 'token-a-1234' } })
storeB.setSettings({ sync: { enabled: true, folder: shared, sessions: 'off', syncConfig: true, token: 'token-b-1234' } })

const syncA = createSync({ store: storeA, dataDir: dirA })
const syncB = createSync({ store: storeB, dataDir: dirB })

// A changes a portable setting; its config version advances and it publishes the file.
storeA.setSettings({ promptBudgetChars: 1234 })
const versionA = storeA.configVersion
const reportA = await syncA.run('test')
assert.equal(reportA.config.ok, true, JSON.stringify(reportA.config))
assert.equal(reportA.config.published, true)

const published = JSON.parse(await fsp.readFile(path.join(shared, 'config', 'desired.json'), 'utf8'))
assert.equal(published.version, versionA)
assert.equal(published.patch.promptBudgetChars, 1234)
assert.equal(published.patch.sync.syncConfig, undefined, 'the switch itself is device-local')
assert.equal(published.patch.sync.folder, undefined, 'the folder is device-local')
assert.equal(published.patch.sync.token, undefined, 'tokens never travel')

// B applies it, keeps its own device-local fields, and does not republish.
const reportB = await syncB.run('test')
assert.equal(reportB.config.applied, true, JSON.stringify(reportB.config))
assert.equal(storeB.getSettings().promptBudgetChars, 1234)
assert.equal(storeB.getSettings().sync.token, 'token-b-1234')
assert.equal(storeB.getSettings().sync.folder, shared)
assert.equal(storeB.configVersion, versionA)

const idleB = await syncB.run('test')
assert.equal(idleB.config.unchanged, true)
assert.equal(JSON.parse(await fsp.readFile(path.join(shared, 'config', 'desired.json'), 'utf8')).version, versionA, 'no ping-pong')

// B changes a different setting; A applies it on its next sync.
storeB.setSettings({ decay: { afterDays: 45 } })
const versionB = storeB.configVersion
assert.ok(versionB > versionA)
const reportB2 = await syncB.run('test')
assert.equal(reportB2.config.published, true)
const reportA2 = await syncA.run('test')
assert.equal(reportA2.config.applied, true, JSON.stringify(reportA2.config))
assert.equal(storeA.getSettings().decay.afterDays, 45)
assert.equal(storeA.configVersion, versionB)

// With the switch off, a device neither publishes nor applies.
storeB.setSettings({ sync: { syncConfig: false } })
storeA.setSettings({ relevantLimit: 9 })
await syncA.run('test')
await syncB.run('test')
assert.notEqual(storeB.getSettings().relevantLimit, 9, 'a device with the switch off ignores the published patch')

await fsp.rm(root, { recursive: true, force: true })
console.log('CONFIG SYNC TESTS PASSED')
