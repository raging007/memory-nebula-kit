import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createStore } from '../lib/store.js'
import { createSync } from '../lib/sync.js'
import { buildInventory } from '../lib/inventory.js'

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-inventory-'))
const shared = path.join(root, 'shared')
const profileDir = path.join(root, 'profile')
await fsp.mkdir(profileDir, { recursive: true })
await fsp.writeFile(path.join(profileDir, 'package.json'), JSON.stringify({
  name: 'test-profile',
  dependencies: { 'dsh-world': '^0.7.2', 'dsh-memory-nebula': 'link:D:/x/memory-nebula' },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-world', 'dsh-memory-nebula'] } },
}))

const fakeConfigEditor = {
  configuration: () => [
    { entry: { id: 'qq-mode', name: 'qq-mode-console' }, override: { mode: 'chat', token: 'secret-value' } },
    { entry: { id: 'mcp-snowluma', name: '@deepseek-ai/dsh-mcp-client' }, override: { serverName: 'snowluma', command: 'node x.js' } },
    { entry: { id: 'with-path', name: 'something' }, override: { dir: 'D:\\local\\dir' } },
  ],
}
const fakeStore = {
  portableSettings: () => ({ version: 1, patch: { promptBudgetChars: 850 } }),
}
const inventory = await buildInventory({ profileDir, configEditor: fakeConfigEditor, store: fakeStore, deviceName: 'test-device' })
assert.equal(inventory.profile, 'test-profile')
assert.equal(inventory.bundles.find((b) => b.name === 'dsh-world').source, 'npm')
assert.equal(inventory.bundles.find((b) => b.name === 'dsh-memory-nebula').transfer, 'data-repo')
assert.equal(inventory.bundles.find((b) => b.name === '@deepseek-ai/dsh-base').source, 'shipped')
const qq = inventory.rows.find((row) => row.id === 'qq-mode')
assert.equal(qq.config.mode, 'chat')
assert.equal(qq.config.token, '<redacted>')
assert.equal(inventory.mcp.length, 1)
assert.equal(inventory.mcp[0].portable, false)
assert.ok(!JSON.stringify(inventory.mcp).includes('node x.js'), 'mcp commands never travel')
assert.equal(inventory.rows.find((row) => row.id === 'with-path').portableConfig, false)
assert.equal(inventory.memory.settings.promptBudgetChars, 850)

// Sync wiring: the manifest is written once and only rewritten when it changes.
const dataDir = path.join(root, 'data')
const store = createStore({ dataDir, config: {} })
await store.load()
store.setSettings({ sync: { enabled: true, folder: shared, sessions: 'off', shareInventory: true, token: 'token-1234' } })
let bundles = ['a']
const sync = createSync({ store, dataDir, buildInventory: async () => ({ schema: 1, generatedAt: new Date().toISOString(), bundles, rows: [], mcp: [], memory: null }) })

const first = await sync.run('test')
assert.equal(first.inventory.written, true, JSON.stringify(first.inventory))
const file = path.join(shared, 'config', 'plugins.json')
assert.equal(JSON.parse(await fsp.readFile(file, 'utf8')).bundles[0], 'a')

const second = await sync.run('test')
assert.equal(second.inventory.unchanged, true, JSON.stringify(second.inventory))

bundles = ['a', 'b']
const third = await sync.run('test')
assert.equal(third.inventory.written, true)
assert.equal(JSON.parse(await fsp.readFile(file, 'utf8')).bundles.length, 2)

await fsp.rm(root, { recursive: true, force: true })
console.log('INVENTORY TESTS PASSED')
