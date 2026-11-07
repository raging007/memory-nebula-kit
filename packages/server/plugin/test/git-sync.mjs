import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createStore } from '../lib/store.js'
import { createSync } from '../lib/sync.js'

/**
 * The git channel: a bare repository stands in for GitHub. Two clones (A and B) sync through
 * pull --rebase + commit + push; each device's snapshot file is separate, so merges stay clean.
 */

const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-git-'))
const bare = path.join(root, 'remote.git')
const work = path.join(root, 'work')
const cloneA = path.join(root, 'clone-a')
const cloneB = path.join(root, 'clone-b')
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }).trim()

await fsp.mkdir(work, { recursive: true })
git(root, 'init', '--bare', '-b', 'main', bare)
git(work, 'init', '-b', 'main')
git(work, 'config', 'user.name', 'test')
git(work, 'config', 'user.email', 'test@example.com')
await fsp.writeFile(path.join(work, 'README.md'), '# memory data\n')
git(work, 'add', '-A')
git(work, 'commit', '-m', 'init')
git(work, 'remote', 'add', 'origin', bare)
git(work, 'push', '-u', 'origin', 'main')

git(root, 'clone', bare, cloneA)
git(root, 'clone', bare, cloneB)
for (const clone of [cloneA, cloneB]) {
  git(clone, 'config', 'user.name', 'test')
  git(clone, 'config', 'user.email', 'test@example.com')
}

const storeA = createStore({ dataDir: path.join(root, 'data-a'), config: {} })
await storeA.load()
const storeB = createStore({ dataDir: path.join(root, 'data-b'), config: {} })
await storeB.load()
storeA.setAccount('user-1')
storeB.setAccount('user-1')
storeA.setSettings({ sync: { enabled: true, folder: cloneA, sessions: 'off', git: true, token: 'token-a-1234' } })
storeB.setSettings({ sync: { enabled: true, folder: cloneB, sessions: 'off', git: true, token: 'token-b-1234' } })

const syncA = createSync({ store: storeA, dataDir: path.join(root, 'data-a') })
const syncB = createSync({ store: storeB, dataDir: path.join(root, 'data-b') })

const memory = storeA.create({ text: 'A 设备通过 git 仓库同步过来的记忆。', tags: ['git'] })
const reportA = await syncA.run('test')
assert.equal(reportA.git.ok, true, JSON.stringify(reportA.git))
assert.equal(reportA.git.pushed, true, JSON.stringify(reportA.git))
assert.ok(git(cloneA, 'log', '--oneline', '-1').includes('memory sync'))

const reportB = await syncB.run('test')
assert.equal(reportB.git.ok, true, JSON.stringify(reportB.git))
assert.equal(reportB.git.pulled, true)
assert.ok(storeB.get(memory.id), 'device B sees device A through the git repository')

const memoryB = storeB.create({ text: 'B 设备回写的一条记忆。', tags: ['git'] })
await syncB.run('test')
await syncA.run('test')
assert.ok(storeA.get(memoryB.id), 'device A sees device B through the git repository')

// An idle sync must not create a commit: access counters and generation timestamps move every
// turn, so the snapshot is only rewritten when its merge-relevant content changes.
const idle = await syncA.run('test')
assert.equal(idle.git.ok, true, JSON.stringify(idle.git))
assert.equal(idle.git.committed, false, 'an idle sync creates no commit')

// A folder that is not a repository must degrade, not throw.
storeA.setSettings({ sync: { folder: path.join(root, 'not-a-repo') } })
const plain = await syncA.run('test')
assert.equal(plain.git.ok, false)
assert.ok(String(plain.git.error).includes('不是 git 仓库'))

await fsp.rm(root, { recursive: true, force: true })
console.log('GIT SYNC TESTS PASSED')
