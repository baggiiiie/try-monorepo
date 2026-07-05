import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { JsonCacheStorage } from '../src/core/storage.mjs'

test('malformed cache files are treated as misses', async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), 'gui-cache-storage-'))
  t.after(() => rm(cacheDir, { recursive: true, force: true }))
  const storage = new JsonCacheStorage({ cacheDir })
  await writeFile(storage.pathForKey('broken'), '{ definitely not json')
  assert.equal(await storage.read('broken'), null)
})
