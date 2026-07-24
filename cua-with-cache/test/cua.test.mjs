import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { CachedCua, CuaDriverCli, CuaDriverError, CuaGuiCache, selectCuaWindow } from '../src/index.mjs'

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

  assert.equal((await runtime.act({ scope: app, instruction: 'click Send' })).cacheStatus, 'MISS')
  assert.equal((await runtime.act({ scope: app, instruction: 'click Send' })).cacheStatus, 'HIT')
  assert.equal(inferenceCalls, 1)
  assert.equal(h.calls.filter((call) => call.tool === 'click').length, 2)

  const actionFile = (await readdir(join(cacheDir, 'test-app', 'actions'))).find((path) => path.endsWith('.json'))
  const cache = await readFile(join(cacheDir, 'test-app', 'actions', actionFile), 'utf8')
  for (const forbidden of ['privateScreenshot', 'fresh-', 'element_index', 'element_token']) assert.equal(cache.includes(forbidden), false)

  const coldRuntime = new CachedCua({ cacheDir, driver: h.driver, inferenceFactory: async () => assert.fail('Pi must stay lazy on a cache hit') })
  const coldApp = await coldRuntime.openApp('Test', { bundleId: 'test.app' })
  assert.equal((await coldRuntime.act({ scope: coldApp, instruction: 'click Send' })).cacheStatus, 'HIT')
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

test('CUA descriptors replay sanitized email identity tokens', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-email-identity-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const gui = new CuaGuiCache({ name: 'Outlook', driver: {}, pid: 1, window: { window_id: 2, title: 'Inbox' }, cacheDir })
  const element = { element_index: 0, role: 'AXWindow', label: 'Inbox • first@example.com', identifier: '', help: '', actions: [] }
  const descriptor = gui.descriptorForElement(element, 'Read email from the Inbox', { elements: [element] })
  assert.deepEqual(descriptor.labelTokens, ['inbox', 'email'])
  const fresh = { elements: [{ ...element, label: 'Inbox • second@example.com' }] }
  assert.equal(gui.resolveDescriptor(descriptor, fresh).success, true)
})

test('CachedCua treats cache persistence after dispatch as best effort', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-write-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness()
  const runtime = new CachedCua({ cacheDir, driver: h.driver, inference: { resolveAction: async () => ({ targetType: 'element', candidateId: 0, confidence: 0.95 }) } })
  const app = await runtime.openApp('Test', { bundleId: 'test.app' })
  const actionsDir = join(cacheDir, 'test-app', 'actions')
  await mkdir(actionsDir, { recursive: true })
  const call = h.driver.call
  h.driver.call = async (tool, input) => {
    const result = await call(tool, input)
    if (tool === 'click') {
      await rm(actionsDir, { recursive: true })
      await writeFile(actionsDir, 'not a directory')
    }
    return result
  }
  const result = await runtime.act({ scope: app, instruction: 'click Send' })
  assert.equal(result.success, true)
  assert.equal(result.actionRequested, true)
  assert.equal(result.actionOutcome, 'accepted')
  assert.match(result.cacheWriteError, /not a directory|ENOTDIR|EEXIST/)
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
  assert.equal((await runtime.act({ scope: app, instruction: 'click Send' })).success, true)
  h.label = 'Submit'
  assert.equal((await runtime.act({ scope: app, instruction: 'click Send' })).cacheStatus, 'HEALED')
  assert.equal(calls, 2)

  h.failAction = true
  const failed = await runtime.act({ scope: app, instruction: 'click Send' })
  assert.equal(failed.actionOutcome, 'unknown')
  assert.equal(failed.safeToRetry, false)
  assert.equal(calls, 3)
  assert.equal(h.calls.filter((call) => call.tool === 'click').length, 3)
})

test('CachedCua execute caches its plan and actions while replaying extraction against live data', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-agent-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness({ withMail: true })
  const calls = { plan: 0, action: 0, extraction: 0 }
  const inference = {
    planWorkflow: async () => {
      calls.plan++
      return [
        { kind: 'act', scope: 'test', instruction: 'click Send' },
        { kind: 'extract', scope: 'test', instruction: 'read sender subject and body from Reading Pane' },
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
  const first = await runtime.execute({ scopes: { test: app }, ...request })
  assert.equal(first.success, true)
  assert.deepEqual(first.data, { sender: 'Alice', subject: 'First', body: 'Initial body' })
  const persisted = (await Promise.all((await readdir(cacheDir, { recursive: true })).filter((path) => path.endsWith('.json')).map((path) => readFile(join(cacheDir, path), 'utf8')))).join('\n')
  for (const forbidden of ['Alice', 'First', 'Initial body', 'privateScreenshot', 'fresh-', 'element_index', 'element_token']) assert.equal(persisted.includes(forbidden), false)
  h.nextMail = { sender: 'Bob', subject: 'Second', body: 'Fresh body' }
  const second = await runtime.execute({ scopes: { test: app }, ...request })
  assert.equal(second.cacheStatus, 'HIT')
  assert.deepEqual(second.data, { sender: 'Bob', subject: 'Second', body: 'Fresh body' })
  assert.deepEqual(calls, { plan: 1, action: 1, extraction: 1 })
})

test('CachedCua execute routes each planned step only to its declared scope', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-scopes-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const calls = []
  const driver = { call: async (tool, input) => {
    calls.push({ tool, input })
    if (tool === 'launch_app') {
      const outlook = input.bundle_id === 'test.outlook'
      return { pid: outlook ? 1 : 2, windows: [{ window_id: outlook ? 11 : 22, title: 'Main', is_on_screen: true, bounds: { x: 0, y: 0, width: 200, height: 100 } }] }
    }
    if (tool === 'get_window_state' && input.pid === 1) return { screenshot_width: 100, screenshot_height: 50, screenshot_png_b64: 'privateScreenshot', elements: [
      { element_index: 0, element_token: 'outlook-action', role: 'AXButton', label: 'Open report email', actions: ['AXPress'], frame: { x: 0, y: 0, w: 100, h: 30 } },
    ] }
    if (tool === 'get_window_state' && input.pid === 2) return { elements: [
      { element_index: 0, element_token: 'workbook', role: 'AXGroup', label: 'Workbook', actions: [] },
      { element_index: 1, element_token: 'status', parent_index: 0, role: 'AXStaticText', label: 'Status', value: 'ready', actions: [] },
    ] }
    return { ok: true }
  } }
  const runtime = new CachedCua({ cacheDir, driver, inference: {
    planWorkflow: async ({ scopes }) => {
      assert.deepEqual(scopes.map(({ name }) => name), ['outlook', 'excel'])
      return [
        { kind: 'act', scope: 'outlook', instruction: 'open the report email' },
        { kind: 'extract', scope: 'excel', instruction: 'read the current workbook status' },
      ]
    },
    resolveAction: async () => ({ targetType: 'element', candidateId: 0, confidence: 0.95 }),
    resolveExtraction: async () => ({ rootCandidateId: 0, fields: [{ name: 'status', candidateId: 1, source: 'value' }], confidence: 0.95 }),
  }, logger: false })
  const outlook = await runtime.openApp('Outlook', { bundleId: 'test.outlook' })
  const excel = await runtime.openApp('Excel', { bundleId: 'test.excel' })

  const result = await runtime.execute({
    scopes: { outlook, excel },
    instruction: 'Read an Outlook report and verify the Excel workbook',
    schema: { type: 'object', properties: { status: {} }, required: ['status'] },
  })

  assert.equal(result.success, true)
  assert.deepEqual(result.data, { status: 'ready' })
  const clickIndex = calls.findIndex(({ tool }) => tool === 'click')
  const excelReadIndex = calls.findIndex(({ tool, input }) => tool === 'get_window_state' && input.pid === 2)
  assert.equal(calls[clickIndex].input.pid, 1)
  assert.ok(clickIndex < excelReadIndex, 'cross-scope extraction must happen after dispatching the action')
})

test('CachedCua returns passive runtime-owned scopes and rejects ambiguous names', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-passive-scope-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness()
  const first = new CachedCua({ cacheDir, driver: h.driver, inference: {}, logger: false })
  const second = new CachedCua({ cacheDir, driver: h.driver, inference: {}, logger: false })
  const scope = await first.openApp('Test', { bundleId: 'test.app' })

  assert.deepEqual(Object.keys(scope), ['name'])
  assert.equal(Object.isFrozen(scope), true)
  await assert.rejects(() => second.extract({ scope, instruction: 'read', schema: { type: 'object', properties: { value: {} } } }), /returned by this CachedCua instance/)
  await assert.rejects(() => first.execute({ scopes: { test: scope, ' test ': scope }, instruction: 'read', schema: { type: 'object', properties: { value: {} } } }), /duplicate normalized scope name/)
})

test('CachedCua execute refuses workflow steps outside declared scopes', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-scope-refusal-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness()
  const runtime = new CachedCua({ cacheDir, driver: h.driver, inference: {
    planWorkflow: async () => [
      { kind: 'act', scope: 'teams', instruction: 'send message' },
      { kind: 'extract', scope: 'teams', instruction: 'read confirmation' },
    ],
  }, logger: false })
  const outlook = await runtime.openApp('Outlook', { bundleId: 'test.outlook' })

  const result = await runtime.execute({
    scopes: { outlook },
    instruction: 'send a message',
    schema: { type: 'object', properties: { status: {} } },
  })

  assert.equal(result.success, false)
  assert.match(result.message, /undeclared scope: teams/)
})

test('CachedCua observe resolves without dispatch and act replays the returned action', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-observe-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness()
  let inferenceCalls = 0
  const inference = { resolveAction: async () => { inferenceCalls++; return { targetType: 'element', candidateId: 0, confidence: 0.95 } } }
  const runtime = new CachedCua({ cacheDir, driver: h.driver, inference, logger: false })
  const app = await runtime.openApp('Test', { bundleId: 'test.app' })

  const [action] = await runtime.observe({ scope: app, instruction: 'click Send' })
  assert.equal(action.method, 'click')
  assert.equal(action.cacheStatus, 'MISS')
  assert.equal(Object.isFrozen(action), true)
  assert.equal(JSON.stringify(action).includes('fresh-'), false)
  assert.equal(h.calls.filter((call) => call.tool === 'click').length, 0)
  await assert.rejects(() => readdir(join(cacheDir, 'test-app', 'actions')), (error) => error.code === 'ENOENT')

  const acted = await runtime.act(action)
  assert.equal(acted.success, true)
  assert.equal(acted.safeToRetry, false)
  assert.equal(h.calls.filter((call) => call.tool === 'click').length, 1)
  const [cachedAction] = await runtime.observe({ scope: app, instruction: 'click Send' })
  assert.equal(cachedAction.cacheStatus, 'HIT')
  assert.equal(inferenceCalls, 1)
  assert.equal((await runtime.act(cachedAction)).success, true)
  assert.equal(h.calls.filter((call) => call.tool === 'click').length, 2)
})

test('CachedCua heals an observed action that becomes stale before dispatch', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-observe-heal-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness()
  let inferenceCalls = 0
  const runtime = new CachedCua({ cacheDir, driver: h.driver, inference: { resolveAction: async ({ screenshot }) => {
    inferenceCalls++
    return inferenceCalls === 1
      ? { targetType: 'element', candidateId: 0, confidence: 0.95 }
      : { targetType: 'pixel', x: screenshot.width / 2, y: screenshot.height / 2, confidence: 0.95 }
  } }, logger: false })
  const app = await runtime.openApp('Test', { bundleId: 'test.app' })
  const [action] = await runtime.observe('click Send', { scope: app })
  h.label = 'Submit'

  const result = await runtime.act(action)

  assert.equal(result.success, true)
  assert.equal(result.cacheStatus, 'HEALED')
  assert.equal(result.safeToRetry, false)
  assert.equal(inferenceCalls, 2)
  assert.equal(h.calls.filter((call) => call.tool === 'click').length, 1)
})

test('CachedCua extraction ignores unrelated same-role siblings added after a compiled field', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'cached-cua-extraction-drift-test-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const h = compiledHarness({ withMail: true })
  const inference = {
    resolveExtraction: async () => {
      h.extraMailElements.push({ element_index: 5, element_token: 'status', parent_index: 1, role: 'AXStaticText', label: 'Status', value: 'Connected', actions: [], frame: { x: 10, y: 85, w: 80, h: 10 } })
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
  const runtime = new CachedCua({ cacheDir, driver: h.driver, inference, logger: false })
  const app = await runtime.openApp('Test', { bundleId: 'test.app' })
  h.mail = { sender: 'Alice', subject: 'First', body: 'First body' }

  const result = await runtime.extract({ scope: app, instruction: 'read sender subject and body from Reading Pane', schema: {
    type: 'object',
    properties: { sender: {}, subject: {}, body: {} },
  } })

  assert.equal(result.success, true, result.message)
  assert.deepEqual(result.data, h.mail)
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
  const state = { calls: [], label: 'Send', failAction: false, mail: { sender: 'Before', subject: 'Previous', body: 'Previous body' }, nextMail: null, extraMailElements: [] }
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
          ...state.extraMailElements,
        ] : []),
      ],
    }
    if (state.failAction) throw new Error('uncertain failure')
    if (tool === 'click' && state.nextMail) { state.mail = state.nextMail; state.nextMail = null }
    return { ok: true }
  } }
  return state
}
