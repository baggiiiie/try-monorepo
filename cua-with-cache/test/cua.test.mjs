import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CuaDriverCli, CuaDriverError, CuaGuiCache, selectCuaWindow } from '../src/index.mjs'

test('CUA CLI adapter parses JSON and preserves process diagnostics', async () => {
  const cli = new CuaDriverCli({ run: async (_file, args) => ({ stdout: JSON.stringify({ ok: true, args }), stderr: 'warning' }) })
  assert.equal((await cli.call('probe', { a: 1 })).ok, true)
  const broken = new CuaDriverCli({ run: async () => { throw Object.assign(new Error('exit'), { stderr: 'daemon unavailable', stdout: 'partial', code: 9 }) } })
  await assert.rejects(() => broken.call('probe'), (e) => e instanceof CuaDriverError && e.stderr === 'daemon unavailable' && e.exitCode === 9)
})

test('CUA CLI adapter rejects 0-exit structured 0.10 errors but permits response codes', async () => {
  for (const code of ['background_unavailable', 'desktop_scope_disabled']) {
    const cli = new CuaDriverCli({ run: async () => ({ stdout: JSON.stringify({ code, message: 'not available', details: { capability: code } }) }) })
    await assert.rejects(() => cli.call('click'), (e) => e instanceof CuaDriverError && e.code === code && e.details.capability === code)
  }
  const valid = new CuaDriverCli({ run: async () => ({ stdout: JSON.stringify({ code: 'ok', details: { latency: 2 } }) }) })
  assert.equal((await valid.call('probe')).code, 'ok')
})

test('CUA window selection prefers title match, then on-screen largest window', () => {
  const windows = [
    { window_id: 1, title: 'Inbox — Outlook', on_screen: false, bounds: { width: 1000, height: 900 } },
    { window_id: 2, title: 'Calendar', on_screen: true, bounds: { width: 1200, height: 800 } },
    { window_id: 3, title: 'Inbox', on_screen: true, bounds: { width: 700, height: 500 } },
  ]
  assert.equal(selectCuaWindow(windows, 'Inbox').window_id, 3)
})

test('CUA cache hit/heal and actions always use a fresh token', async (t) => {
  const h = await harness(t)
  assert.equal((await h.gui.observe('Send')).cacheStatus, 'MISS')
  h.token = 'fresh-2'
  assert.equal((await h.gui.observe('Send')).cacheStatus, 'HIT')
  h.label = 'Send message'
  h.token = 'fresh-3'
  const acted = await h.gui.act('Send', { action: 'press' })
  assert.equal(acted.actionPerformed, true)
  assert.equal(h.calls.at(-1).input.element_token, 'fresh-3')
})

test('CUA uses a configured grounder on a miss and replays the cached descriptor', async (t) => {
  let calls = 0
  const grounder = { ground: async ({ candidates, reason }) => {
    calls++
    assert.equal(reason, 'cache-miss')
    assert.equal(candidates.some((candidate) => 'element' in candidate), false)
    return { candidateId: 0, confidence: 0.9 }
  } }
  const h = await harness(t, { grounder })
  assert.equal((await h.gui.observe('Send')).cacheStatus, 'MISS')
  assert.equal((await h.gui.observe('Send')).cacheStatus, 'HIT')
  assert.equal(calls, 1)
})

test('CUA gives a grounder only structural and sanitized candidate data', async (t) => {
  const grounder = { ground: async ({ candidates, scope }) => {
    const payload = JSON.stringify({ candidates, scope })
    for (const secret of ['secretSender', 'secretBody', 'secretSubject', 'secretIdentifier', 'secretWindow']) {
      assert.equal(payload.includes(secret), false)
    }
    return { candidateId: 0, confidence: 0.9 }
  } }
  const h = await harness(t, { grounder, label: 'Search secretSender', value: 'secretBody', help: 'secretSubject', identifier: 'secretIdentifier', windowTitle: 'secretWindow' })
  assert.equal((await h.gui.observe('Search')).success, true)
})

test('CUA refuses a same-role cached control with no durable identity overlap', async (t) => {
  const h = await harness(t)
  await h.gui.observe('Send')
  h.label = 'Cancel'

  const report = await h.gui.observe('Send')
  assert.equal(report.success, false)
  assert.equal(report.cacheStatus, 'HEALED')
})

test('CUA refuses a model selection identified only as a generic control', async (t) => {
  const grounder = { ground: async () => ({ candidateId: 0, confidence: 0.9 }) }
  const h = await harness(t, { grounder, label: 'Button' })
  const report = await h.gui.observe('Control')
  assert.equal(report.success, false)
  assert.match(report.message, /durable replay identity/)
})

test('CUA collection items re-resolve by position from a fresh snapshot', async (t) => {
  const h = await harness(t, { label: 'List', role: 'AXGroup', child: true })
  const list = await h.gui.observe('List')
  const rows = await h.gui.observeMany('rows', { within: list, role: 'AXRow', identity: 'position' })
  h.rowToken = 'new-row-token'
  await h.gui.act(rows.items[0], { action: 'click' })
  assert.equal(h.calls.at(-1).input.element_token, 'new-row-token')
})

test('CUA extraction is live and values are never persisted', async (t) => {
  const h = await harness(t, { label: 'Search secretSender', value: 'secretBody', help: 'secretSubject', identifier: 'secretIdentifier' })
  const observed = await h.gui.observe('Search')
  h.value = 'second'
  assert.equal((await h.gui.extract(observed, { project: (v) => v.value })).data, 'second')
  const cached = await readFile(h.gui.storage.pathForKey(observed.key), 'utf8')
  for (const secret of ['secretSender', 'secretBody', 'secretSubject', 'secretIdentifier']) assert.equal(cached.includes(secret), false)
})

test('CUA action is requested at most once even when the driver errors', async (t) => {
  const h = await harness(t)
  h.failAction = true
  const out = await h.gui.act('Send', { action: 'click' })
  assert.equal(out.actionRequested, true)
  assert.equal(out.actionPerformed, false)
  assert.equal(out.actionOutcome, 'unknown')
  assert.equal(h.calls.filter((x) => x.tool === 'click').length, 1)
})

async function harness(t, initial = {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cua-cache-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const state = { label: initial.label ?? 'Send', value: initial.value ?? '', token: 'fresh-1', rowToken: 'row-1', calls: [], failAction: false }
  const driver = { call: async (tool, input) => {
    state.calls.push({ tool, input })
    if (tool === 'get_window_state') return { elements: [
      { element_index: 0, element_token: state.token, role: initial.role ?? 'AXButton', label: state.label, value: state.value, help: initial.help, identifier: initial.identifier, actions: ['AXPress'], frame: { x: 0, y: 0, w: 100, h: 30 } },
      ...(initial.child ? [{ element_index: 1, element_token: state.rowToken, parent_index: 0, role: 'AXRow', label: 'row', actions: ['AXPress'], frame: { x: 0, y: 40, w: 100, h: 30 } }] : []),
    ] }
    if (state.failAction) throw new Error('uncertain failure')
    return { ok: true }
  } }
  state.gui = new CuaGuiCache({ name: 'Test', driver, pid: 1, window: { window_id: 2, title: initial.windowTitle ?? 'Main' }, cacheDir, minScore: 3, grounder: initial.grounder })
  return state
}
