import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { apply } from '../index.js'

/** A minimal Cordis-shaped context: just the surface this plugin touches. */
function makeHarness() {
  const effects = []
  const listeners = new Map()
  const routes = []
  const tools = []
  const ctx = {
    get: () => undefined,
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
      return () => {}
    },
    on(name, fn) {
      listeners.set(name, fn)
      return () => {}
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    tools: {
      register(definition) {
        tools.push(definition)
        return () => {}
      },
    },
  }
  return { ctx, effects, listeners, routes, tools }
}

function request(method, url, headers = {}, body) {
  const chunks = body ? [Buffer.from(body, 'utf8')] : []
  return {
    method,
    url,
    headers: { host: '127.0.0.1:3080', ...headers },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
}

async function call(route, method, url, headers = {}, body) {
  const res = {
    status: 0,
    payload: '',
    writeHead(status) {
      this.status = status
    },
    end(chunk) {
      this.payload = chunk
    },
  }
  await route.handler(request(method, url, headers, body), res)
  return { status: res.status, body: res.payload ? JSON.parse(res.payload) : null }
}

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'nebula-apply-'))
const harness = makeHarness()
await apply(harness.ctx, { dataDir: dir, promptOrder: 58 })

assert.equal(harness.routes.length, 1, 'one prefix route is registered')
assert.equal(harness.routes[0].path, '/memory-nebula')
assert.equal(harness.tools.length, 5, 'five memory tools are registered')
assert.ok(harness.listeners.has('agent/created'))
assert.ok(harness.listeners.has('agent/inbox/claimed'))
assert.ok(harness.listeners.has('agent/disposed'))

const route = harness.routes[0]
const state = await call(route, 'GET', '/memory-nebula/api/state')
assert.equal(state.status, 200)
assert.ok(state.body.settings.promptBudgetChars > 0)

const rejected = await call(route, 'POST', '/memory-nebula/api/memory', {}, JSON.stringify({ op: 'create', text: 'x' }))
assert.equal(rejected.status, 403, 'mutations need the custom header')

const created = await call(
  route,
  'POST',
  '/memory-nebula/api/memory',
  { 'x-memory-nebula': '1', 'content-type': 'application/json' },
  JSON.stringify({ op: 'create', text: '用户偏好：回答先给结论，再展开细节。', tags: ['偏好'] }),
)
assert.equal(created.status, 200)
const memoryId = created.body.item.id

const listed = await call(route, 'GET', '/memory-nebula/api/memories?q=' + encodeURIComponent('结论'))
assert.equal(listed.status, 200)
assert.ok(listed.body.items.some((item) => item.id === memoryId))

const preview = await call(route, 'GET', '/memory-nebula/api/preview?q=' + encodeURIComponent('回答风格'))
assert.equal(preview.status, 200)
assert.ok(preview.body.text.length > 0)

const graph = await call(route, 'GET', '/memory-nebula/api/graph')
assert.equal(graph.status, 200)
assert.equal(graph.body.nodes.length, 1)

const syncStatus = await call(route, 'GET', '/memory-nebula/api/sync')
assert.equal(syncStatus.status, 200)
assert.ok(syncStatus.body.status.token)

const badToken = await call(route, 'GET', '/memory-nebula/api/transport/snapshot')
assert.equal(badToken.status, 403)
const goodToken = await call(route, 'GET', '/memory-nebula/api/transport/snapshot', { 'x-memory-sync-token': syncStatus.body.status.token })
assert.equal(goodToken.status, 200)
assert.equal(goodToken.body.schema, 1)

// --- the agent-facing prompt section
const sections = []
const agent = { id: 'session-test', ctx: { systemPrompt: { section(definition) { sections.push(definition); return () => {} } } } }
harness.listeners.get('agent/created')({ agent })
assert.equal(sections.length, 1)
harness.listeners.get('agent/inbox/claimed')({ agent, message: { content: [{ type: 'text', text: '你平时怎么回答？' }] }, turn: 1 })
const promptText = sections[0].text()
assert.ok(promptText.includes(memoryId), 'the created memory is injected when relevant')

// --- tool call through the registered definition
const tool = harness.tools.find((entry) => entry.name === 'memory_save')
const toolResult = JSON.parse(await tool.execute({ text: '工具也能直接写入。' }, {}))
assert.ok(toolResult.id)
const searchTool = harness.tools.find((entry) => entry.name === 'memory_search')
const searchResult = JSON.parse(await searchTool.execute({ query: '写入' }, {}))
assert.ok(searchResult.items.length >= 1)

await fsp.rm(dir, { recursive: true, force: true })
console.log('APPLY HARNESS PASSED')
