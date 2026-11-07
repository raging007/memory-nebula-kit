import assert from 'node:assert/strict'

/**
 * Loads the browser bundle with a stub module loader and a stub React, then applies it to a stub
 * client context. Catches syntax/shape errors in the client half without a browser.
 */

const React = {
  createElement: (...args) => ({ type: 'element', args }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
}

let factory = null
let declaredId = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      declaredId = entry.id
      factory = entry.factory
    },
  },
}
globalThis.document = { documentElement: {}, head: { appendChild() {} }, createElement: () => ({ style: {} }) }
globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' })
globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) })

await import('../client.js')

assert.equal(declaredId, 'dsh-memory-nebula', 'client module id must equal the package name')
assert.equal(typeof factory, 'function')

const mod = factory((name) => {
  if (name === 'react') return React
  throw new Error(`unexpected require: ${name}`)
})
assert.deepEqual(mod.inject, ['slots'])
assert.equal(typeof mod.apply, 'function')

const registrations = []
const injected = []
const ctx = {
  slots: {
    inject(key, callback) {
      injected.push(key)
      const effect = callback()
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}
mod.apply(ctx)

assert.deepEqual(injected, ['sidebar.panellist', 'main'])
assert.equal(registrations.length, 2)
assert.equal(registrations[0].options.id, 'memory-nebula')
assert.equal(registrations[0].options.name, 'sidebar.panellist')
assert.equal(registrations[1].options.key, 'memory-nebula')
assert.equal(registrations[1].options.name, 'main')
assert.equal(typeof registrations[0].component, 'function')
assert.equal(typeof registrations[1].component, 'function')

// the star map layout must be deterministic and bounded
const layout = mod.__test.layoutGraph({
  nodes: [
    { id: 'a', layer: 'core', importance: 1, label: '核心' },
    { id: 'b', layer: 'normal', importance: 0.5, label: '普通' },
    { id: 'c', layer: 'faded', importance: 0.2, label: '淡化' },
  ],
  edges: [{ a: 'a', b: 'b', weight: 0.5 }, { a: 'b', b: 'c', weight: 0.3 }],
})
assert.equal(layout.nodes.length, 3)
assert.equal(layout.links.length, 2)
for (const node of layout.nodes) {
  assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y))
  assert.ok(Math.abs(node.x) <= 1.06 && Math.abs(node.y) <= 1.06)
}

// rendering the panel with stubbed hooks must not throw
const element = registrations[1].component({})
assert.ok(element && element.type === 'element')

console.log('CLIENT HARNESS PASSED')
