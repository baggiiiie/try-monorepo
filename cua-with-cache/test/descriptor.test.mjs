import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveTarget } from '../src/core/descriptor.mjs'
import { fakeNode } from '../test-support/helpers.mjs'

test('candidate selection refuses a narrow score gap', () => {
  const nodes = [
    fakeNode({ name: 'Send', box: { left: 10, top: 10, right: 100, bottom: 40 } }),
    fakeNode({ name: 'Send', box: { left: 120, top: 10, right: 210, bottom: 40 } }),
  ]
  const scope = { scoredSearch: () => nodes }
  const match = resolveTarget(scope, 'Send', { minScoreGap: 0.25 })
  assert.equal(match.status, 'ambiguous')
  assert.equal(match.scoreGap, 0)
})

test('candidate selection applies structural role constraints before choosing', () => {
  const button = fakeNode({ name: 'Inbox', role: 'button' })
  const window = fakeNode({ name: 'Inbox', role: 'window' })
  const scope = { scoredSearch: () => [button, window] }

  const match = resolveTarget(scope, 'Inbox', { role: 'window' })

  assert.equal(match.status, 'unique')
  assert.equal(match.selectedNode, window)
})
