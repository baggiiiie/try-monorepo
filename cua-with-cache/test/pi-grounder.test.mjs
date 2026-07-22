import assert from 'node:assert/strict'
import test from 'node:test'

import { createPiGrounder } from '../src/index.mjs'

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
