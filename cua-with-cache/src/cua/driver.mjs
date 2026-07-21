import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export class CuaDriverError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'CuaDriverError'
    Object.assign(this, details)
  }
}

export class CuaDriverCli {
  constructor({ executable = 'cua-driver', run } = {}) {
    this.executable = executable
    this.run = run ?? ((file, args) => execFileAsync(file, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }))
  }

  async call(tool, input = {}) {
    const args = ['call', tool, JSON.stringify(input)]
    let result
    try {
      result = await this.run(this.executable, args)
    } catch (error) {
      throw new CuaDriverError(`cua-driver ${tool} failed: ${String(error.stderr || error.message).trim()}`, {
        tool, input, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? ''), exitCode: error.code,
      })
    }
    const stdout = typeof result === 'string' ? result : String(result?.stdout ?? '')
    const stderr = typeof result === 'string' ? '' : String(result?.stderr ?? '')
    try {
      const value = JSON.parse(stdout)
      const structuredError = toolError(value)
      if (structuredError) throw new CuaDriverError(`cua-driver ${tool} returned an error: ${structuredError.message}`, {
        tool, input, stdout, stderr, code: structuredError.code, details: structuredError.details,
      })
      return value
    } catch (error) {
      if (error instanceof CuaDriverError) throw error
      throw new CuaDriverError(`cua-driver ${tool} returned invalid/error JSON: ${error.message}`, { tool, input, stdout, stderr })
    }
  }
}

// Driver 0.10 sometimes exits successfully with a tool error as its payload.
// Only explicit error flags and known error codes count: generic `code` fields
// in successful tool metadata must remain valid responses.
const TOOL_ERROR_CODES = new Set(['background_unavailable', 'desktop_scope_disabled'])
function toolError(value) {
  const candidates = [value, value?.error, value?.result, value?.structuredContent, value?.result?.structuredContent].filter((x) => x && typeof x === 'object')
  const coded = candidates.find((x) => TOOL_ERROR_CODES.has(String(x.code ?? x.error_code ?? '')))
  const explicit = candidates.find((x) => x.isError === true || x.is_error === true || (x === value && x.error))
  const hit = coded ?? explicit
  if (!hit) return null
  const nested = hit.error && typeof hit.error === 'object' ? hit.error : hit
  return {
    code: String(nested.code ?? nested.error_code ?? hit.code ?? hit.error_code ?? 'tool_error'),
    message: String(nested.message ?? hit.message ?? (typeof hit.error === 'string' ? hit.error : '') ?? value?.content?.[0]?.text ?? 'driver returned an error'),
    details: nested.details ?? hit.details ?? null,
  }
}
