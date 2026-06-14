import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AccessibilityNode,
  App,
  Direction,
  Screen,
  System,
  Window,
  screenshotFull,
} from '@simular-ai/simulang-js'

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export const STEAL_FOCUS = process.env.STEAL_FOCUS === '1'

export function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2))
}

export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

export function createRunDir(prefix: string) {
  const runDir = join(process.cwd(), '.runs', `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runDir, { recursive: true })
  return runDir
}

export function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

// Resolve an app from a single name and hand both candidates back to the
// caller: a deterministic exact match (or null) and the fuzzy best-guess.
// The caller decides which to trust (typically `exact_match ?? fuzzy_match`).
export function findApp(name: string) {
  return {
    exact_match: App.exists(name) ? App.exactName(name) : null,
    fuzzy_match: System.fuzzySearch(name),
  }
}

// List every visible window for `pid` with its title and the usable Window
// handle. `Window` exposes no stable per-window id in the API, so `index` is
// just the positional order from Window.allForPid. The caller owns selection.
export function getWindowsForPid(pid: number) {
  return Window.allForPid(pid).map((window, index) => ({
    index,
    title: window.title,
    window,
  }))
}

type DiagnosticContext = {
  runDir?: string
  pid?: number
  window?: (() => { snapshot(): string }) | null
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function errorStack(err: unknown) {
  return err instanceof Error ? (err.stack ?? err.message) : String(err)
}

export function dumpDiagnostics(label: string, err: unknown, { runDir, pid = 0, window = null }: DiagnosticContext = {}) {
  const dir = join(runDir ?? join(process.cwd(), '.runs', 'diagnostics'), label)
  mkdirSync(dir, { recursive: true })

  writeFileSync(join(dir, 'error.txt'), errorStack(err))
  writeFileSync(
    join(dir, 'windows.json'),
    JSON.stringify(Window.all().map((w) => ({ pid: w.pid, title: w.title })), null, 2),
  )

  try {
    screenshotFull(true, Screen.mainScreen()).save(join(dir, 'screen.png'))
  } catch (e) {
    writeFileSync(join(dir, 'screen-error.txt'), String(e))
  }

  if (process.env.DIAG_AX === '1') {
    try {
      writeFileSync(join(dir, 'focused.ax.txt'), AccessibilityNode.fromFocusedApplication().snapshot())
    } catch (e) {
      writeFileSync(join(dir, 'focused-ax-error.txt'), String(e))
    }

    if (pid && window) {
      try {
        writeFileSync(join(dir, 'app-window.ax.txt'), window().snapshot())
      } catch (e) {
        writeFileSync(join(dir, 'app-window-ax-error.txt'), String(e))
      }
    }
  }

  console.error(`Diagnostics saved to ${dir}`)
}

export function createStepRunner(runDir: string, contextFactory: () => DiagnosticContext = () => ({})) {
  let stepIndex = 0

  return async function step<T>(name: string, action: () => T | Promise<T>, verify?: (result: T) => void | Promise<void>): Promise<T> {
    const id = `${String(++stepIndex).padStart(2, '0')}-${slug(name)}`
    console.log(`\n▶ ${id}`)
    try {
      const result = await action()
      if (verify) await verify(result)
      console.log(`✓ ${id}`)
      return result
    } catch (err) {
      console.error(`✗ ${id}: ${errorMessage(err)}`)
      dumpDiagnostics(id, err, { runDir, ...contextFactory() })
      throw err
    }
  }
}

export function safeNodeInfo(node: any) {
  const info: any = {}
  for (const key of ['role', 'className', 'localizedControlType', 'name', 'value', 'description', 'helpText', 'overallDescription', 'isEnabled']) {
    try { info[key] = node[key] } catch { info[key] = null }
  }
  try { info.boundingBox = node.boundingBox() } catch { info.boundingBox = null }
  try { info.actions = node.supportedActions() } catch { info.actions = [] }
  return info
}

export function chord(keyboard: any, modifiers: any[], key: any) {
  for (const modifier of modifiers) keyboard.key(modifier, Direction.Press)
  keyboard.key(key, Direction.Click)
  for (const modifier of modifiers.slice().reverse()) keyboard.key(modifier, Direction.Release)
}

function errorDetails(err: unknown) {
  return {
    message: errorMessage(err),
    stack: errorStack(err),
  }
}

export async function runStrategies({ app, goal, runDir, strategies, verify, suggestedNextSteps = [] }: any) {
  const attempts: any[] = []

  for (const strategy of strategies) {
    console.log(`Trying strategy: ${strategy.name}`)
    try {
      const action = await strategy.run()
      const verification = await verify({ strategy: strategy.name, action })
      const attempt = { strategy: strategy.name, actionOk: true, action, verification }
      attempts.push(attempt)

      if (verification?.ok) {
        const result = {
          ok: true,
          app,
          goal,
          strategy: strategy.name,
          phase: 'verify',
          artifactsDir: runDir,
          attempts,
          verification,
        }
        writeFileSync(join(runDir, 'result.json'), JSON.stringify(result, null, 2))
        return result
      }

      console.warn(`Strategy ${strategy.name} did not satisfy verifier: ${verification?.reason ?? 'unknown reason'}`)
    } catch (err) {
      attempts.push({ strategy: strategy.name, actionOk: false, error: errorDetails(err) })
      console.warn(`Strategy ${strategy.name} failed: ${errorMessage(err)}`)
    }
  }

  const lastAttempt = attempts.at(-1)
  const result = {
    ok: false,
    app,
    goal,
    phase: lastAttempt?.actionOk === false ? 'action' : 'verify',
    reason: lastAttempt?.verification?.reason ?? lastAttempt?.error?.message ?? 'all_strategies_failed',
    strategiesTried: attempts.map((attempt) => attempt.strategy),
    artifactsDir: runDir,
    attempts,
    suggestedNextSteps,
  }
  writeFileSync(join(runDir, 'result.json'), JSON.stringify(result, null, 2))

  const err: any = new Error(`${goal} failed after ${attempts.length} strategies: ${result.reason}`)
  err.result = result
  throw err
}
