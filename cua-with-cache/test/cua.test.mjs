import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CachedCua, CachedCuaAgent, CuaDriverCli, CuaDriverError, CuaGuiCache, selectCuaWindow } from '../src/index.mjs'

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

test('CUA pixel addressing converts a fresh AX frame to screenshot coordinates', async (t) => {
  const h = await harness(t)
  const observed = await h.gui.observe('Send')
  const action = await h.gui.act(observed, { action: 'press', addressing: 'pixel', deliveryMode: 'background' })
  assert.equal(action.success, true)
  const click = h.calls.at(-1)
  assert.equal(click.tool, 'click')
  assert.equal(click.input.element_token, undefined)
  assert.equal(click.input.element_index, undefined)
  assert.equal(click.input.x, 25)
  assert.equal(click.input.y, 7.5)
})

test('CachedCua compiles once, replays without Pi, and persists no screenshot or ephemeral handle', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness()
  let inferenceCalls = 0
  const inference = {
    resolveAction: async ({ candidates, screenshot }) => {
      inferenceCalls++
      assert.equal(screenshot.data, 'privateScreenshot')
      return { targetType: 'element', candidateId: candidates.find((candidate) => candidate.label === 'Send').id, confidence: 0.95 }
    },
  }
  const runtime = new CachedCua({ cacheDir, driver: h.driver, inference })
  await runtime.init()
  const app = await runtime.openApp('Test', { bundleId: 'test.app' })

  assert.equal((await app.act('click Send')).cacheStatus, 'MISS')
  assert.equal((await app.act('click Send')).cacheStatus, 'HIT')
  assert.equal(inferenceCalls, 1)
  assert.equal(h.calls.filter((call) => call.tool === 'click').length, 2)

  const cache = await readFile(app.storage.pathForKey(app.actionKey('click Send')), 'utf8')
  for (const forbidden of ['privateScreenshot', 'fresh-', 'element_index', 'element_token']) assert.equal(cache.includes(forbidden), false)

  const coldRuntime = new CachedCua({ cacheDir, driver: h.driver, inferenceFactory: async () => assert.fail('Pi must stay lazy on a cache hit') })
  const coldApp = await coldRuntime.openApp('Test', { bundleId: 'test.app' })
  assert.equal((await coldApp.act('click Send')).cacheStatus, 'HIT')
})

test('CachedCua scopes positional replay to a durable container without caching row labels', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-position-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const gui = new CuaGuiCache({ name: 'Test', driver: {}, pid: 1, window: { window_id: 2, title: 'Main' }, cacheDir })
  const snapshot = { elements: [
    { element_index: 0, role: 'AXList', label: 'Message List', identifier: '', help: '', actions: [] },
    { element_index: 1, parent_index: 0, role: 'AXGroup', label: 'Alice private message subject', identifier: '', help: '', actions: [] },
    { element_index: 2, parent_index: 1, role: 'AXRow', label: 'Alice Private subject', identifier: '', help: '', actions: [] },
    { element_index: 3, parent_index: 0, role: 'AXGroup', label: 'Bob other private message subject', identifier: '', help: '', actions: [] },
    { element_index: 4, parent_index: 3, role: 'AXRow', label: 'Bob Other private subject', identifier: '', help: '', actions: [] },
  ] }
  const descriptor = gui.descriptorForElement(snapshot.elements[2], 'open the first message', snapshot)
  assert.equal(descriptor.scopeOrdinal, 0)
  assert.equal(descriptor.scope.stableUniqueContainer, true)
  assert.deepEqual(descriptor.labelTokens, [])
  assert.equal(JSON.stringify(descriptor).includes('alice'), false)
  assert.equal(JSON.stringify(descriptor).includes('private'), false)
  assert.equal(gui.resolveDescriptor(descriptor, snapshot).element.element_index, 2)
})

test('CachedCua treats cache persistence after dispatch as best effort', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-write-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness()
  const runtime = new CachedCua({ cacheDir, driver: h.driver, inference: { resolveAction: async () => ({ targetType: 'element', candidateId: 0, confidence: 0.95 }) } })
  const app = await runtime.openApp('Test', { bundleId: 'test.app' })
  app.storage.write = async () => { throw new Error('disk full') }
  const result = await app.act('click Send')
  assert.equal(result.success, true)
  assert.equal(result.actionRequested, true)
  assert.equal(result.actionOutcome, 'accepted')
  assert.equal(result.cacheWriteError, 'disk full')
  assert.equal(h.calls.filter((call) => call.tool === 'click').length, 1)
})

test('CachedCua heals a stale action before dispatch and never retries an uncertain dispatch', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-heal-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness()
  let calls = 0
  const runtime = new CachedCua({ cacheDir, driver: h.driver, inference: { resolveAction: async ({ screenshot }) => {
    calls++
    return calls === 1
      ? { targetType: 'element', candidateId: 0, confidence: 0.9 }
      : { targetType: 'pixel', x: screenshot.width / 2, y: screenshot.height / 2, confidence: 0.9 }
  } } })
  const app = await runtime.openApp('Test', { bundleId: 'test.app' })
  assert.equal((await app.act('click Send')).success, true)
  h.label = 'Submit'
  assert.equal((await app.act('click Send')).cacheStatus, 'HEALED')
  assert.equal(calls, 2)

  h.failAction = true
  const failed = await app.act('click Send')
  assert.equal(failed.actionOutcome, 'unknown')
  assert.equal(calls, 3)
  assert.equal(h.calls.filter((call) => call.tool === 'click').length, 3)
})

test('CachedCua agent caches its plan and actions while replaying extraction against live data', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-agent-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness({ withMail: true })
  const calls = { plan: 0, action: 0, extraction: 0 }
  const inference = {
    planWorkflow: async () => {
      calls.plan++
      return [
        { kind: 'act', instruction: 'click Send' },
        { kind: 'extract', instruction: 'read sender subject and body from Reading Pane' },
      ]
    },
    resolveAction: async () => { calls.action++; return { targetType: 'element', candidateId: 0, confidence: 0.95 } },
    resolveExtraction: async () => {
      calls.extraction++
      return {
        rootCandidateId: 1,
        fields: [
          { name: 'sender', candidateId: 2, source: 'value' },
          { name: 'subject', candidateId: 3, source: 'value' },
          { name: 'body', candidateId: 4, source: 'value' },
        ],
        confidence: 0.95,
      }
    },
  }
  const runtime = new CachedCua({ cacheDir, driver: h.driver, inference })
  const app = await runtime.openApp('Test', { bundleId: 'test.app' })
  const schema = { type: 'object', properties: { sender: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } } }
  const request = { instruction: 'read the open email', schema }

  h.nextMail = { sender: 'Alice', subject: 'First', body: 'Initial body' }
  const first = await app.agent().execute(request)
  assert.equal(first.success, true)
  assert.deepEqual(first.data, { sender: 'Alice', subject: 'First', body: 'Initial body' })
  const persisted = (await Promise.all((await readdir(cacheDir, { recursive: true })).filter((path) => path.endsWith('.json')).map((path) => readFile(join(cacheDir, path), 'utf8')))).join('\n')
  for (const forbidden of ['Alice', 'First', 'Initial body', 'privateScreenshot', 'fresh-', 'element_index', 'element_token']) assert.equal(persisted.includes(forbidden), false)
  h.nextMail = { sender: 'Bob', subject: 'Second', body: 'Fresh body' }
  const second = await app.agent().execute(request)
  assert.equal(second.cacheStatus, 'HIT')
  assert.deepEqual(second.data, { sender: 'Bob', subject: 'Second', body: 'Fresh body' })
  assert.deepEqual(calls, { plan: 1, action: 1, extraction: 1 })
})

test('CachedCua collects live items with one cached start action and extraction recipe', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-collect-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness({ withMail: true })
  const originalCall = h.driver.call
  const remaining = [
    { sender: 'Bob', subject: 'Second', body: 'Second body' },
    { sender: 'Carol', subject: 'Third', body: 'Third body' },
  ]
  h.driver.call = async (tool, input) => {
    if (tool === 'press_key') {
      if (remaining.length) h.mail = remaining.shift()
      return { ok: true }
    }
    return originalCall(tool, input)
  }
  const inference = {
    resolveAction: async () => ({ targetType: 'element', candidateId: 0, confidence: 0.95 }),
    resolveExtraction: async () => ({
      rootCandidateId: 1,
      fields: [
        { name: 'sender', candidateId: 2, source: 'value' },
        { name: 'subject', candidateId: 3, source: 'value' },
        { name: 'body', candidateId: 4, source: 'value' },
      ],
      confidence: 0.95,
    }),
  }
  const runtime = new CachedCua({ cacheDir, driver: h.driver, inference, logger: false })
  const app = await runtime.openApp('Test', { bundleId: 'test.app' })
  h.nextMail = { sender: 'Alice', subject: 'First', body: 'First body' }
  const result = await app.collect({
    startInstruction: 'open first message',
    extractionInstruction: 'read sender subject and body from Reading Pane',
    schema: { type: 'object', properties: { sender: {}, subject: {}, body: {} } },
    timeoutMs: 10,
    pollMs: 1,
  })
  assert.equal(result.success, true)
  assert.equal(result.complete, true)
  assert.deepEqual(result.data.map((item) => item.sender), ['Alice', 'Bob', 'Carol'])
  assert.equal(h.calls.filter((call) => call.tool === 'click').length, 1)
})

test('CachedCua accepts an unchanged pane only when it matches the clicked row', async () => {
  const data = { sender: 'Alice Example', subject: 'Quarterly planning notes', body: 'Quarterly planning notes and follow-up details' }
  const action = { success: true, cacheStatus: 'HIT', actionRequested: true, actionPerformed: true, actionOutcome: 'accepted' }
  Object.defineProperty(action, '_targetEvidence', { value: { label: 'Alice Example Quarterly planning notes follow-up details', value: null } })
  const app = {
    gui: { bundleId: 'test.app', name: 'Test', window: { title: 'Main' } },
    workflowStorage: { read: async () => ({ version: 1, steps: [{ kind: 'act', instruction: 'open first message' }, { kind: 'extract', instruction: 'read message' }] }) },
    prepareExtraction: async () => ({ success: true, cacheStatus: 'HIT', instruction: 'read message', data, fingerprint: JSON.stringify(data), recipe: {} }),
    act: async () => action,
    waitForExtractionChange: async () => ({ success: false, message: 'unchanged' }),
  }
  const result = await new CachedCuaAgent(app).execute({ instruction: 'read first message', schema: { type: 'object', properties: { sender: {}, subject: {}, body: {} } } })
  assert.equal(result.success, true)
  assert.deepEqual(result.data, data)
  assert.equal(JSON.stringify(action).includes('Alice'), false)
})

async function harness(t, initial = {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cua-cache-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const state = { label: initial.label ?? 'Send', value: initial.value ?? '', token: 'fresh-1', rowToken: 'row-1', calls: [], failAction: false }
  const driver = { call: async (tool, input) => {
    state.calls.push({ tool, input })
    if (tool === 'get_window_state') return { screenshot_width: input.include_screenshot ? 100 : null, screenshot_height: input.include_screenshot ? 50 : null, elements: [
      { element_index: 0, element_token: state.token, role: initial.role ?? 'AXButton', label: state.label, value: state.value, help: initial.help, identifier: initial.identifier, actions: ['AXPress'], frame: { x: 0, y: 0, w: 100, h: 30 } },
      ...(initial.child ? [{ element_index: 1, element_token: state.rowToken, parent_index: 0, role: 'AXRow', label: 'row', actions: ['AXPress'], frame: { x: 0, y: 40, w: 100, h: 30 } }] : []),
    ] }
    if (state.failAction) throw new Error('uncertain failure')
    return { ok: true }
  } }
  state.gui = new CuaGuiCache({ name: 'Test', driver, pid: 1, window: { window_id: 2, title: initial.windowTitle ?? 'Main', bounds: { x: 0, y: 0, width: 200, height: 100 } }, cacheDir, minScore: 3, grounder: initial.grounder })
  return state
}

function compiledHarness({ withMail = false } = {}) {
  const state = { calls: [], label: 'Send', failAction: false, mail: { sender: 'Before', subject: 'Previous', body: 'Previous body' }, nextMail: null }
  state.driver = { call: async (tool, input) => {
    state.calls.push({ tool, input })
    if (tool === 'launch_app') return { pid: 1, windows: [{ window_id: 2, title: 'Main', is_on_screen: true, bounds: { x: 0, y: 0, width: 200, height: 100 } }] }
    if (tool === 'get_window_state') return {
      screenshot_width: input.include_screenshot ? 100 : null,
      screenshot_height: input.include_screenshot ? 50 : null,
      screenshot_mime_type: input.include_screenshot ? 'image/png' : null,
      screenshot_png_b64: input.include_screenshot ? 'privateScreenshot' : null,
      elements: [
        { element_index: 0, element_token: `fresh-${state.calls.length}`, role: 'AXButton', label: state.label, actions: ['AXPress'], frame: { x: 0, y: 0, w: 100, h: 30 } },
        ...(withMail ? [
          { element_index: 1, element_token: 'pane', role: 'AXGroup', label: 'Reading Pane', actions: [], frame: { x: 0, y: 30, w: 200, h: 70 } },
          { element_index: 2, element_token: 'sender', parent_index: 1, role: 'AXStaticText', label: 'Sender', value: state.mail.sender, actions: [], frame: { x: 10, y: 35, w: 80, h: 10 } },
          { element_index: 3, element_token: 'subject', parent_index: 1, role: 'AXStaticText', label: 'Subject', value: state.mail.subject, actions: [], frame: { x: 10, y: 45, w: 80, h: 10 } },
          { element_index: 4, element_token: 'body', parent_index: 1, role: 'AXStaticText', label: 'Body', value: state.mail.body, actions: [], frame: { x: 10, y: 55, w: 160, h: 30 } },
        ] : []),
      ],
    }
    if (state.failAction) throw new Error('uncertain failure')
    if (tool === 'click' && state.nextMail) { state.mail = state.nextMail; state.nextMail = null }
    return { ok: true }
  } }
  return state
}
