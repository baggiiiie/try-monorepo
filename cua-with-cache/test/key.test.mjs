import assert from 'node:assert/strict'
import test from 'node:test'

import { cacheKey } from '../src/core/key.mjs'

test('grounding cache keys ignore actions and runtime variable shapes', () => {
  const base = { target: 'Inbox', stableAppId: 'Outlook', routeKey: 'app-root' }
  assert.equal(
    cacheKey({ ...base, action: 'observe', variableKeys: [] }),
    cacheKey({ ...base, action: 'activate', variableKeys: ['message'] }),
  )
})
