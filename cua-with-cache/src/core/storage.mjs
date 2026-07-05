import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export class JsonCacheStorage {
  constructor({ cacheDir = '.gui-cache', cacheMode = 'auto' } = {}) {
    this.cacheDir = cacheDir
    this.cacheMode = cacheMode
  }

  pathForKey(key) {
    return join(this.cacheDir, `${key}.json`)
  }

  async read(key) {
    if (this.cacheMode === 'off') return null
    try {
      return JSON.parse(await readFile(this.pathForKey(key), 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  async write(key, value) {
    if (this.cacheMode === 'off' || this.cacheMode === 'readonly') return false
    const path = this.pathForKey(key)
    await mkdir(dirname(path), { recursive: true })
    const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`)
    await rename(tempPath, path)
    return true
  }
}
