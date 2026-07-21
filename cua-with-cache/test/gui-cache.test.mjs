import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { GuiCache, contextMatches } from '../src/core/gui-cache.mjs'
import { scopeContext } from '../src/core/scope.mjs'
import { fakeContext, fakeNode } from '../test-support/helpers.mjs'

async function cacheHarness(t, { node = fakeNode({ name: 'Send' }), context = fakeContext() } = {}) {
  const cacheDir = await mkdtemp(join(tmpdir(), 'gui-cache-engine-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const scope = {
    nodes: [node],
    scoredSearch() { return this.nodes },
  }
  const gui = new GuiCache({
    scope,
    context,
    pidsSeen: 1,
    windowsSeen: 0,
    cacheDir,
    cacheMode: 'auto',
    threshold: 0.35,
    maxNodes: 100,
    logCache: false,
  })
  return { gui, cacheDir, node, scope }
}

test('a failed post-verification never repeats an action', async (t) => {
  const { gui, node } = await cacheHarness(t)
  assert.equal((await gui.observe('Send')).cacheStatus, 'MISS')

  const report = await gui.act('Send', {
    action: 'activate',
    variables: { expected: 'sent' },
    verify: { post: { valueContainsVar: 'expected' } },
  })

  assert.equal(report.cacheStatus, 'REFUSED')
  assert.equal(report.actionPerformed, true)
  assert.equal(node.activateCount, 1)
  assert.match(report.message, /not retried/)
})

test('cache hits use verification from the current call', async (t) => {
  const { gui } = await cacheHarness(t)
  await gui.observe('Send')
  const report = await gui.observe('Send', { verify: { pre: { role: 'textbox' } } })
  assert.equal(report.cacheStatus, 'REFUSED')
  assert.equal(report.message, 'pre-verification failed')
})

test('context drift heals the grounding before use', async (t) => {
  const first = await cacheHarness(t)
  await first.gui.observe('Send')

  const secondNode = fakeNode({ name: 'Send' })
  const second = new GuiCache({
    scope: { scoredSearch: () => [secondNode] },
    context: fakeContext({ processName: 'different-app' }),
    pidsSeen: 1,
    windowsSeen: 0,
    cacheDir: first.cacheDir,
    cacheMode: 'auto',
    threshold: 0.35,
    maxNodes: 100,
    logCache: false,
  })
  assert.equal((await second.observe('Send')).cacheStatus, 'HEALED')
})

test('observe can wait for a temporarily unavailable target', async (t) => {
  const { gui, node, scope } = await cacheHarness(t)
  let attempts = 0
  scope.scoredSearch = () => (++attempts < 3 ? [] : [node])

  const report = await gui.observe('Send', { timeoutMs: 100, pollMs: 1 })

  assert.equal(report.cacheStatus, 'MISS')
  assert.equal(attempts, 3)
})

test('cached descriptors cannot replay against nodes unrelated to the target', async (t) => {
  const first = await cacheHarness(t, { node: fakeNode({ name: 'Inbox' }) })
  await first.gui.observe('Inbox')

  const titleBar = fakeNode({ name: 'Title bar', overallDescription: 'Inbox' })
  const second = new GuiCache({
    scope: { scoredSearch: () => [titleBar] },
    context: fakeContext(),
    pidsSeen: 1,
    windowsSeen: 0,
    cacheDir: first.cacheDir,
    cacheMode: 'auto',
    threshold: 0.35,
    maxNodes: 100,
    logCache: false,
  })

  const report = await second.observe('Inbox')
  assert.equal(report.cacheStatus, 'REFUSED')
  assert.equal(report.match.status, 'low-confidence')
})

test('high-risk actions require explicit verification', async (t) => {
  const { gui, node } = await cacheHarness(t)
  const report = await gui.act('Send', { action: 'activate', risk: 'high' })
  assert.equal(report.cacheStatus, 'REFUSED')
  assert.equal(node.activateCount, 0)
})

test('high-risk actions reject unsupported verification keys', async (t) => {
  const { gui, node } = await cacheHarness(t)
  const report = await gui.act('Send', {
    action: 'activate',
    risk: 'high',
    verify: { pre: { madeUp: true }, post: { alsoMadeUp: true } },
  })
  assert.equal(report.cacheStatus, 'REFUSED')
  assert.match(report.message, /unsupported keys/)
  assert.equal(node.activateCount, 0)
})

test('verification rejects empty assertion values', async (t) => {
  const { gui, node } = await cacheHarness(t)
  const report = await gui.act('Send', {
    action: 'activate',
    verify: { pre: { role: '' } },
  })
  assert.equal(report.cacheStatus, 'REFUSED')
  assert.match(report.message, /non-empty string/)
  assert.equal(node.activateCount, 0)
})

test('high-risk actions require an outcome-oriented postcondition', async (t) => {
  const { gui, node } = await cacheHarness(t)
  const report = await gui.act('Send', {
    action: 'activate',
    risk: 'high',
    verify: { pre: { enabled: true }, post: { enabled: true } },
  })
  assert.equal(report.cacheStatus, 'REFUSED')
  assert.match(report.message, /must assert an outcome/)
  assert.equal(node.activateCount, 0)
})

test('high-risk actions reject a wrong singleton candidate', async (t) => {
  const { gui, scope } = await cacheHarness(t)
  await gui.observe('Send')
  const wrongNode = fakeNode({ name: 'Archive' })
  scope.nodes = [wrongNode]

  const report = await gui.act('Send', {
    action: 'activate',
    risk: 'high',
    verify: { pre: { enabled: true }, post: { textPresent: 'Message sent' } },
  })
  assert.equal(report.cacheStatus, 'REFUSED')
  assert.equal(report.match.status, 'low-confidence')
  assert.equal(wrongNode.activateCount, 0)
})

test('high-risk actions still execute once with strong identity and verification', async (t) => {
  const { gui, node } = await cacheHarness(t)
  const report = await gui.act('Send', {
    action: 'activate',
    risk: 'high',
    verify: { pre: { enabled: true }, post: { textPresent: 'Send' } },
  })
  assert.equal(report.cacheStatus, 'MISS')
  assert.equal(report.actionPerformed, true)
  assert.equal(node.activateCount, 1)
})

test('reports keep live nodes and internal matches out of JSON', async (t) => {
  const { gui } = await cacheHarness(t)
  const report = await gui.observe('Send')
  const serialized = JSON.stringify(report)
  assert.equal(serialized.includes('matchInternal'), false)
  assert.equal(serialized.includes('activateCount'), false)
  assert.ok(report.node)
})

test('context comparison ignores process ids but checks stable signals', () => {
  assert.equal(contextMatches(
    { scopeKind: 'app', processName: 'outlook', pid: 1 },
    { scopeKind: 'app', processName: 'outlook', pid: 2 },
  ), true)
  assert.equal(contextMatches(
    { scopeKind: 'app', processName: 'outlook' },
    { scopeKind: 'app', processName: 'teams' },
  ), false)
})

test('window context is refreshed before every cache lookup', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'gui-cache-context-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const node = fakeNode({ name: 'Send' })
  let snapshot = 'group\n  button'
  const scope = {
    kind: 'window',
    appName: 'Fake App',
    pid: 0,
    title: 'Compose',
    boundingBox: () => ({ left: 0, top: 0, right: 800, bottom: 600 }),
    snapshot: () => snapshot,
    scoredSearch: () => [node],
  }
  const gui = new GuiCache({
    scope,
    context: scopeContext(scope, 'Fake App'),
    pidsSeen: 1,
    windowsSeen: 1,
    cacheDir,
    cacheMode: 'auto',
    threshold: 0.35,
    maxNodes: 100,
    logCache: false,
  })
  assert.equal((await gui.observe('Send')).cacheStatus, 'MISS')
  snapshot = 'group\n  toolbar\n    button'
  assert.equal((await gui.observe('Send')).cacheStatus, 'HEALED')
})

test('app-root callers can separate navigation routes explicitly', async (t) => {
  const { gui } = await cacheHarness(t)
  const first = await gui.observe('Send')
  gui.setRoute('compose')
  const second = await gui.observe('Send')
  assert.equal(second.cacheStatus, 'MISS')
  assert.notEqual(first.key, second.key)
})
