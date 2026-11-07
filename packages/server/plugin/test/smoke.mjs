import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createStore } from '../lib/store.js'
import { createSync } from '../lib/sync.js'
import { buildContext } from '../lib/prompt.js'
import { memoryToolDefinitions } from '../lib/tools.js'
import { scoreMemory, summarize, keywords, excerpt } from '../lib/text.js'

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-test-'))
const dirA = path.join(root, 'a')
const dirB = path.join(root, 'b')
const shared = path.join(root, 'shared')

const storeA = createStore({ dataDir: dirA, config: {} })
await storeA.load()
const storeB = createStore({ dataDir: dirB, config: {} })
await storeB.load()

// --- create + fuzzy search
const r1 = storeA.create({ text: '用户偏好中文回答，先给结论再展开；不喜欢大段铺垫。', tags: ['偏好', '表达'] })
const r2 = storeA.create({ text: 'DSH 插件项目约定：用普通 JavaScript 写，不引入构建步骤，安装走 plugin_manager。', tags: ['DSH', '工程'] })
const r3 = storeA.create({ text: '用户在做一个记忆星图插件，要求记忆超过 100 天逐渐精简。', tags: ['项目', '记忆'] })
const r4 = storeA.create({ text: '临时：今天下午三点开个短会。', tags: ['临时'] })
assert.equal(storeA.data.memories.length, 4)

let hits = storeA.search('中文 结论')
assert.ok(hits.length >= 1, 'fuzzy search should hit the preference')
assert.equal(hits[0].record.id, r1.id)

hits = storeA.search('插件 构建')
assert.ok(hits.some((hit) => hit.record.id === r2.id), 'partial phrase should hit')

hits = storeA.search('星图')
assert.ok(hits.some((hit) => hit.record.id === r3.id), 'single keyword should hit')

hits = storeA.search('完全不相干的词')
assert.equal(hits.length, 0, 'unrelated query should return nothing')

// --- pin / layers
storeA.update(r2.id, { pinned: true })
assert.equal(storeA.get(r2.id).layer, 'core')
assert.equal(storeA.get(r2.id).pinned, true)
storeA.update(r1.id, { importance: 0.9 })
assert.equal(storeA.get(r1.id).layer, 'important')

// --- 7 day decay ladder (core/important are exempt)
const now = Date.now()
const day = 86_400_000
const ageTo = (record, days) => {
  record.createdAt = now - days * day
  record.updatedAt = now - days * day
  record.lastAccessAt = 0
}
ageTo(storeA.get(r3.id), 108)
ageTo(storeA.get(r4.id), 108)
const longText = Array.from({ length: 12 }, (_, index) => `第 ${index + 1} 句补充细节，用来验证精简确实会缩短长记忆。`).join('')
const r5 = storeA.create({ text: longText, tags: ['长文'] })
ageTo(storeA.get(r5.id), 108)
let decay = storeA.runDecay(now)
assert.ok(decay.compressed >= 3, 'records older than 100 days compress')
assert.equal(storeA.get(r3.id).decayStage, 1)
assert.ok(storeA.get(r3.id).summary.length > 0)
assert.ok(Array.from(storeA.get(r5.id).summary).length < Array.from(storeA.get(r5.id).text).length, 'long memory is compressed')
assert.equal(storeA.get(r2.id).decayStage, 0, 'core memory never decays')

ageTo(storeA.get(r3.id), 215)
ageTo(storeA.get(r4.id), 215)
decay = storeA.runDecay(now)
assert.equal(storeA.get(r3.id).decayStage, 2)
assert.equal(storeA.get(r4.id).decayStage, 2)

ageTo(storeA.get(r3.id), 331)
ageTo(storeA.get(r4.id), 331)
decay = storeA.runDecay(now)
assert.ok(decay.faded >= 2, JSON.stringify(decay))
assert.equal(storeA.get(r3.id).layer, 'faded')
assert.equal(storeA.get(r3.id).text, '')
assert.ok(storeA.get(r3.id).summary.includes('淡化'))

// accessed memories move the clock forward again
storeA.touch(r4.id, now)
assert.equal(storeA.get(r4.id).decayStage, 3, 'touch does not resurrect a faded record by itself')

// --- prompt injection: core always, relevant on demand, bounded
const built = buildContext({ store: storeA, query: '插件怎么写', settings: storeA.getSettings() })
assert.ok(built.text.includes(r2.id), 'core memory is always injected')
assert.ok(built.text.length <= 1300, 'prompt stays inside the budget')
const builtNone = buildContext({ store: storeA, query: '', settings: storeA.getSettings() })
assert.ok(builtNone.text.includes('核心'), 'empty query still carries the core tier')

// --- merge across devices
storeB.setAccount(storeA.data.accountId)
storeB.mergeSnapshot(storeA.snapshot())
assert.equal(storeB.data.memories.length, storeA.data.memories.length)
const edited = storeB.update(r1.id, { text: '用户偏好中文回答，先给结论；补充：表格尽量少用。' })
assert.ok(edited)
storeA.mergeSnapshot(storeB.snapshot())
assert.ok(storeA.get(r1.id).text.includes('表格尽量少用'), 'edit propagates back')
const deletedId = r4.id
storeB.forget(deletedId)
storeA.mergeSnapshot(storeB.snapshot())
assert.equal(storeA.get(deletedId), null, 'tombstone removes the memory')

// --- folder sync
storeA.setSettings({ sync: { enabled: true, folder: shared, sessions: 'off', token: 'test-token-1234', sharePackage: true } })
storeB.setSettings({ sync: { enabled: true, folder: shared, sessions: 'off', token: 'test-token-1234', autoImportSessions: true } })
storeA.setAccount('user-1')
storeB.setAccount('user-1')
const syncA = createSync({ store: storeA, dataDir: dirA })
const reportA = await syncA.run('test')
assert.equal(reportA.folder.ok, true, JSON.stringify(reportA))
const sharedPkg = JSON.parse(await fsp.readFile(path.join(shared, 'plugins', 'memory-nebula', 'package.json'), 'utf8'))
assert.equal(sharedPkg.name, 'dsh-memory-nebula', 'the package travels through the sync folder')
assert.equal(reportA.package.copied, true)
const extra = storeB.create({ text: '设备 B 上记下的：每周五下午整理一次记忆。', tags: ['设备B'] })
const syncB = createSync({ store: storeB, dataDir: dirB })
const reportB = await syncB.run('test')
assert.equal(reportB.folder.ok, true, JSON.stringify(reportB))
await syncA.run('test')
assert.ok(storeA.get(extra.id), 'record from device B reaches device A')

// --- tools execute
const tools = memoryToolDefinitions({ store: storeA })
const byName = new Map(tools.map((tool) => [tool.name, tool]))
const saved = JSON.parse(await byName.get('memory_save').execute({ text: '通过工具保存的记忆。', tags: ['工具'] }, {}))
assert.ok(saved.id)
const found = JSON.parse(await byName.get('memory_search').execute({ query: '工具保存' }, {}))
assert.ok(found.items.length >= 1)
const got = JSON.parse(await byName.get('memory_get').execute({ id: saved.id }, {}))
assert.equal(got.id, saved.id)
const updated = JSON.parse(await byName.get('memory_update').execute({ id: saved.id, text: '通过工具更新后的记忆。' }, {}))
assert.equal(updated.ok, true)
const forgot = JSON.parse(await byName.get('memory_forget').execute({ id: saved.id }, {}))
assert.equal(forgot.ok, true)

// --- text helpers
assert.ok(Array.from(summarize('第一句是重点。第二句补充。第三句也补充。', 12)).length <= 13)
assert.ok(keywords('记忆星图插件 记忆检索 记忆', 3).length > 0)
assert.ok(excerpt('这是一个很长的记忆内容，用来测试摘录窗口。', '摘录', 10).includes('摘录'))
assert.ok(scoreMemory({ text: '中文回答', summary: '', tags: [], layer: 'normal', importance: 0.5, createdAt: now, updatedAt: now }, '中文') > 0)

await storeA.save()
await storeB.save()
await fsp.rm(root, { recursive: true, force: true })
console.log('ALL SMOKE TESTS PASSED')
