import assert from 'node:assert/strict'
import test from 'node:test'

import { createLocalPiGrounder, createPiCuaInference, createPiGrounder } from '../src/index.mjs'

test('Pi grounder requests and validates one structured element selection', async () => {
  let context
  const models = { completeSimple: async (_model, value) => {
    context = value
    return {
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'call-1', name: 'select_element', arguments: { candidateId: 7, confidence: 0.91 } }],
    }
  } }
  const grounder = createPiGrounder({ models, model: { id: 'fake' } })
  const result = await grounder.ground({
    target: 'Search', action: 'activate', app: 'Outlook', scope: 'Inbox', reason: 'cache-miss',
    candidates: [{ id: 7, view: { role: 'button', name: 'Search' } }],
  })

  assert.deepEqual(result, { candidateId: 7, confidence: 0.91 })
  assert.equal(context.tools[0].name, 'select_element')
  assert.match(context.messages[0].content, /Search/)
})

test('Pi grounder rejects low-confidence and unknown selections', async () => {
  const response = (arguments_) => ({ completeSimple: async () => ({
    stopReason: 'toolUse',
    content: [{ type: 'toolCall', id: 'call-1', name: 'select_element', arguments: arguments_ }],
  }) })
  const request = { target: 'Search', candidates: [{ id: 1, view: {} }] }
  await assert.rejects(
    () => createPiGrounder({ models: response({ candidateId: 1, confidence: 0.2 }), model: {} }).ground(request),
    /confidence/,
  )
  await assert.rejects(
    () => createPiGrounder({ models: response({ candidateId: 9, confidence: 0.9 }), model: {} }).ground(request),
    /unknown candidate/,
  )
})

test('Pi grounder sends a byte-bounded structural view without live text or descendants', async () => {
  let prompt
  const models = { completeSimple: async (_model, context) => {
    prompt = context.messages[0].content
    return { stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call-1', name: 'select_element', arguments: { candidateId: 2, confidence: 0.9 } }] }
  } }
  const grounder = createPiGrounder({ models, model: {}, maxPromptBytes: 2_000 })
  await grounder.ground({
    target: 'Search',
    scope: 'secretScope',
    candidates: [{ id: 2, view: { role: 'button', name: 'secretName', label: 'secretLabel', description: 'secretDescription', help: 'secretHelp', identifier: 'secretIdentifier', value: 'secretValue', children: [{ name: 'secretChild' }] }, descriptor: { role: 'button', directTokens: ['search'] } }],
  })
  for (const secret of ['secretScope', 'secretName', 'secretLabel', 'secretDescription', 'secretHelp', 'secretIdentifier', 'secretValue', 'secretChild']) assert.equal(prompt.includes(secret), false)
  assert.ok(Buffer.byteLength(prompt) <= 2_000)
})

test('Pi grounder rejects a fixed request larger than maxPromptBytes', async () => {
  const grounder = createPiGrounder({ models: { completeSimple: async () => assert.fail('model should not run') }, model: {}, maxPromptBytes: 32 })
  await assert.rejects(() => grounder.ground({ target: 'Search'.repeat(20), candidates: [{ id: 0, view: {} }] }), /maxPromptBytes/)
})

test('local Pi grounder uses configured model and reasoning defaults', async () => {
  const calls = []
  const models = {
    getModel: (providerId, modelId) => ({ providerId, id: modelId }),
    completeSimple: async (model, _context, options) => {
      calls.push({ model, options })
      return { stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call-1', name: 'select_element', arguments: { candidateId: 0, confidence: 0.9 } }] }
    },
  }
  const settings = {
    getDefaultProvider: () => 'openai-codex',
    getDefaultModel: () => 'gpt-local',
    getDefaultThinkingLevel: () => 'high',
  }
  const grounder = await createLocalPiGrounder({ models, settings })
  await grounder.ground({ target: 'Search', candidates: [{ id: 0, view: { role: 'button' } }] })
  assert.deepEqual(calls[0].model, { providerId: 'openai-codex', id: 'gpt-local' })
  assert.equal(calls[0].options.reasoning, 'high')
})

test('Pi CUA inference resolves an action from bounded AX plus screenshot context', async () => {
  let context
  const models = { completeSimple: async (_model, value) => {
    context = value
    return { stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call-1', name: 'resolve_action', arguments: { targetType: 'element', candidateId: 4, confidence: 0.94 } }] }
  } }
  const inference = createPiCuaInference({ models, model: {} })
  const result = await inference.resolveAction({
    instruction: 'click Search',
    app: 'Test',
    candidates: [{ id: 4, role: 'AXButton', label: 'Search', actions: ['AXPress'], frame: { x: 1, y: 2, w: 3, h: 4 } }],
    screenshot: { data: 'pngBytes', mimeType: 'image/png', width: 100, height: 50 },
  })
  assert.deepEqual(result, { targetType: 'element', candidateId: 4, confidence: 0.94 })
  assert.equal(context.tools[0].name, 'resolve_action')
  assert.deepEqual(context.messages[0].content[1], { type: 'image', data: 'pngBytes', mimeType: 'image/png' })
})

test('Pi CUA inference validates workflow and extraction tool results', async () => {
  const models = { completeSimple: async (_model, context) => {
    const name = context.tools[0].name
    const arguments_ = name === 'plan_workflow'
      ? { pairs: [{ act: { scope: 'test', instruction: ' click Send ' }, extract: { scope: 'test', instruction: 'read result' } }] }
      : { rootCandidateId: 0, fields: [{ name: 'body', candidateId: 1, source: 'value' }], confidence: 0.9 }
    return { stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'call-1', name, arguments: arguments_ }] }
  } }
  const inference = createPiCuaInference({ models, model: {} })
  const candidates = [{ id: 0, role: 'AXGroup', label: 'Reading Pane' }, { id: 1, role: 'AXStaticText', value: 'live' }]
  assert.deepEqual(await inference.planWorkflow({ instruction: 'do it', scopes: [{ name: 'test', app: 'Test' }], schema: { body: {} }, candidates }), [
    { kind: 'act', scope: 'test', instruction: 'click Send' },
    { kind: 'extract', scope: 'test', instruction: 'read result' },
  ])
  assert.equal((await inference.resolveExtraction({ instruction: 'read', schema: { body: {} }, app: 'Test', candidates })).fields[0].name, 'body')
})
