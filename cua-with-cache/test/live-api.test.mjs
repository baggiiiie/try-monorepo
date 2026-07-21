import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { performAction } from '../src/core/actions.mjs'
import { GuiCache } from '../src/core/gui-cache.mjs'
import { cacheKey } from '../src/core/key.mjs'
import { nodeView } from '../src/core/node-view.mjs'
import { createAppScope } from '../src/core/scope.mjs'
import { fakeContext, fakeNode } from '../test-support/helpers.mjs'

async function harness(t, root) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'gui-cache-live-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const scope = { scoredSearch: (_o, _m, _i, query) => query === root.name.toLowerCase() ? [root] : [] }
  const gui = new GuiCache({ scope, context: fakeContext(), cacheDir, cacheMode: 'auto', threshold: .35, maxNodes: 100, logCache: false })
  return { gui, scope }
}

test('cache identity includes query and serializable match constraints', () => {
  const base = { target: 'item', stableAppId: 'app', routeKey: 'root' }
  assert.notEqual(cacheKey({ ...base, query: 'alpha' }), cacheKey({ ...base, query: 'beta' }))
  assert.notEqual(cacheKey({ ...base, match: { role: 'button' } }), cacheKey({ ...base, match: { role: 'cell' } }))
})

test('app scopes use the opened instance accessibility search', () => {
  const expected = fakeNode({ name: 'Inbox' })
  const instance = { scoredSearch: () => [expected] }
  const scope = createAppScope(123, { instance })

  assert.deepEqual(scope.scoredSearch('ignored'), [expected])
})

test('scoped observations have distinct keys and search only their parent', async (t) => {
  const leftButton = fakeNode({ name: 'Send', box: { left: 10, top: 10, right: 20, bottom: 20 } })
  const rightButton = fakeNode({ name: 'Send', box: { left: 210, top: 10, right: 220, bottom: 20 } })
  const left = fakeNode({ name: 'Left', children: [leftButton], box: { left: 0, top: 0, right: 100, bottom: 100 } })
  const right = fakeNode({ name: 'Right', children: [rightButton], box: { left: 200, top: 0, right: 300, bottom: 100 } })
  left.scoredSearch = () => [leftButton]
  right.scoredSearch = () => [rightButton]
  const { gui, scope } = await harness(t, left)
  scope.scoredSearch = (_o, _m, _i, query) => query === 'left' ? [left] : [right]
  const a = await gui.observe('Send', { within: await gui.observe('Left') })
  const b = await gui.observe('Send', { within: await gui.observe('Right') })
  assert.notEqual(a.key, b.key)
  assert.equal(a.node, leftButton)
  assert.equal(b.node, rightButton)
  assert.equal(a.descriptor.posHint.xRatio, .15)
})

test('extraction is live and is not persisted in observation JSON', async (t) => {
  const node = fakeNode({ name: 'Pane', value: 'first' })
  const { gui } = await harness(t, node)
  const observed = await gui.observe('Pane')
  assert.equal((await gui.extract(observed, { project: (view) => view.value })).data, 'first')
  node.value = 'second'
  assert.equal((await gui.extract(observed, { project: (view) => view.value })).data, 'second')
  assert.equal(JSON.stringify(observed).includes('first'), false)
})

test('waitForChange requires baseline and polls past changed invalid states', async (t) => {
  const { gui } = await harness(t, fakeNode({ name: 'unused' }))
  let attempt = 0
  gui.resolveReference = async () => ({ success: true, node: fakeNode({ name: 'Pane', value: ['old', 'invalid', 'valid'][Math.min(attempt++, 2)] }) })
  await assert.rejects(() => gui.waitForChange('Pane'), /explicit from/)
  const baseline = await gui.extract('Pane', { project: (view) => view.value })
  const report = await gui.waitForChange('Pane', {
    from: baseline, project: (view) => view.value,
    validate: (value) => value === 'valid', until: (value) => value.startsWith('v'),
    timeoutMs: 100, pollMs: 1,
  })
  assert.equal(report.success, true)
  assert.equal(report.data, 'valid')
  assert.equal(attempt, 3)
})

test('collection action re-resolves rebuilt children and position identity is positional', async (t) => {
  const stale = fakeNode({ name: 'Old row', role: 'cell' })
  let children = [stale]
  const parent = fakeNode({ name: 'List' })
  parent.children = () => children
  const { gui } = await harness(t, parent)
  const observed = await gui.observe('List')
  const many = await gui.observeMany('rows', { within: observed, role: 'cell', identity: 'position' })
  const fresh = fakeNode({ name: 'New row', role: 'cell' })
  children = [fresh]
  const report = await gui.act(many.items[0], { action: 'activate' })
  assert.equal(report.success, true)
  assert.equal(report.actionPerformed, true)
  assert.equal(report.cacheStatus, 'LIVE')
  assert.equal(stale.activateCount, 0)
  assert.equal(fresh.activateCount, 1)
  assert.ok(report.locator)
})

test('key collection identity refuses duplicate and missing identities', async (t) => {
  const parent = fakeNode({ name: 'List', children: [fakeNode({ role: 'cell' }), fakeNode({ role: 'cell' })] })
  const { gui } = await harness(t, parent)
  const observed = await gui.observe('List')
  assert.equal((await gui.observeMany('rows', { within: observed, role: 'cell', identity: () => 'same' })).success, false)
  assert.equal((await gui.observeMany('rows', { within: observed, role: 'cell', identity: () => null })).success, false)
})

test('NodeView safely reads throwing properties and callbacks receive JSON-safe views', async (t) => {
  const child = fakeNode({ role: 'cell' })
  Object.defineProperty(child, 'name', { get() { throw new Error('stale') } })
  assert.doesNotThrow(() => nodeView(child))
  const parent = fakeNode({ name: 'List', children: [child] })
  const { gui } = await harness(t, parent)
  let callbackView
  await gui.observeMany('rows', { within: await gui.observe('List'), role: 'cell', where: (view) => { callbackView = view; return true } })
  assert.doesNotThrow(() => JSON.stringify(callbackView))
  assert.equal('activate' in callbackView, false)
})

test('activate uses accessibility once and never clicks when it succeeds', () => {
  let moves = 0; let clicks = 0
  const mouse = { moveMouse: () => { moves++ }, button: () => { clicks++ } }
  const node = fakeNode()
  performAction(node, { action: 'activate', strategies: ['accessibility', 'click'], mouseController: mouse })
  assert.equal(node.activateCount, 1); assert.equal(moves, 0); assert.equal(clicks, 0)
})

test('activate clicks exactly once for AX AttributeUnsupported', () => {
  let moves = 0; let clicks = 0
  const mouse = { moveMouse: () => { moves++ }, button: () => { clicks++ } }
  const node = fakeNode({ activate: () => { throw Object.assign(new Error('AXError AttributeUnsupported (-25205)'), { code: -25205 }) } })
  performAction(node, { action: 'activate', strategies: ['accessibility', 'click'], mouseController: mouse })
  assert.equal(node.activateCount, 1); assert.equal(moves, 1); assert.equal(clicks, 1)
})

test('activate propagates generic accessibility errors without clicking', () => {
  let clicks = 0
  const mouse = { moveMouse: () => {}, button: () => { clicks++ } }
  const node = fakeNode({ activate: () => { throw new Error('permission denied') } })
  assert.throws(() => performAction(node, { action: 'activate', strategies: ['accessibility', 'click'], mouseController: mouse }), /permission denied/)
  assert.equal(clicks, 0)
})

test('runtime locator refuses high-risk action without verification', async (t) => {
  const node = fakeNode({ name: 'Row', role: 'cell' })
  const { gui } = await harness(t, fakeNode({ name: 'List', children: [node] }))
  const list = await gui.observe('List')
  const rows = await gui.observeMany('rows', { within: list, role: 'cell' })
  const report = await gui.act(rows.items[0], { action: 'activate', risk: 'high' })
  assert.equal(report.success, false)
  assert.equal(node.activateCount, 0)
  assert.match(report.message, /require explicit pre- and post/)
})

test('collection identity checks duplicates beyond limit', async (t) => {
  const rows = ['duplicate', 'unique', 'duplicate'].map((name) => fakeNode({ name, role: 'cell' }))
  const { gui } = await harness(t, fakeNode({ name: 'List', children: rows }))
  const report = await gui.observeMany('rows', { within: await gui.observe('List'), role: 'cell', limit: 1, identity: (row) => row.text })
  assert.equal(report.success, false)
  assert.match(report.message, /unique across all candidates/)
})

test('collection item identity creates distinct keys for observations beneath rows', async (t) => {
  const buttons = [fakeNode({ name: 'Open' }), fakeNode({ name: 'Open' })]
  const rows = buttons.map((button, index) => {
    const row = fakeNode({ name: `row-${index}`, role: 'cell', children: [button] })
    row.scoredSearch = () => [button]
    return row
  })
  const { gui } = await harness(t, fakeNode({ name: 'List', children: rows }))
  const many = await gui.observeMany('rows', { within: await gui.observe('List'), role: 'cell', identity: (row) => row.text })
  const first = await gui.observe('Open', { within: many.items[0] })
  const second = await gui.observe('Open', { within: many.items[1] })
  assert.notEqual(first.key, second.key)
})

test('locator retry rebuilds the whole parent and item chain', async (t) => {
  const staleRow = fakeNode({ name: 'old', role: 'cell' })
  const staleParent = fakeNode({ name: 'List', children: [staleRow] })
  const { gui, scope } = await harness(t, staleParent)
  const many = await gui.observeMany('rows', { within: await gui.observe('List'), role: 'cell' })
  const freshRow = fakeNode({ name: 'fresh', role: 'cell' })
  const freshParent = fakeNode({ name: 'List', children: [freshRow] })
  let attempts = 0
  scope.scoredSearch = () => (++attempts === 1 ? [] : [freshParent])
  const report = await gui.act(many.items[0], { action: 'activate', timeoutMs: 100, pollMs: 1 })
  assert.equal(report.success, true)
  assert.equal(freshRow.activateCount, 1)
  assert.equal(staleRow.activateCount, 0)
  assert.equal(attempts, 2)
})
