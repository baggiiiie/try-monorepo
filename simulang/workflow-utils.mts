import { mkdirSync, writeFileSync } from 'node:fs'
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

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function createRunDir(prefix) {
  const runDir = join(process.cwd(), '.runs', `${prefix}-${new Date().toISOString().replace(/[:.]/g, '-')}`)
  mkdirSync(runDir, { recursive: true })
  return runDir
}

export function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function findApp(exactNames, fuzzyName) {
  for (const name of exactNames) {
    if (App.exists(name)) return App.exactName(name)
  }
  return System.fuzzySearch(fuzzyName)
}

export function latestWindowForPid(pid, titleHint) {
  const windows = Window.allForPid(pid)
  if (!windows.length) throw new Error(`No visible windows for pid ${pid}`)

  return windows.find((w) => titleHint.test(w.title))
    ?? windows.find((w) => w.title.trim())
    ?? windows[0]
}

export function dumpDiagnostics(label, err, { runDir, pid = 0, latestWindow = null } = {}) {
  const dir = join(runDir, label)
  mkdirSync(dir, { recursive: true })

  writeFileSync(join(dir, 'error.txt'), err?.stack ?? String(err))
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

    if (pid && latestWindow) {
      try {
        writeFileSync(join(dir, 'app-window.ax.txt'), latestWindow().snapshot())
      } catch (e) {
        writeFileSync(join(dir, 'app-window-ax-error.txt'), String(e))
      }
    }
  }

  console.error(`Diagnostics saved to ${dir}`)
}

export function createStepRunner(runDir, contextFactory = () => ({})) {
  let stepIndex = 0

  return async function step(name, action, verify) {
    const id = `${String(++stepIndex).padStart(2, '0')}-${slug(name)}`
    console.log(`\n▶ ${id}`)
    try {
      const result = await action()
      if (verify) await verify(result)
      console.log(`✓ ${id}`)
      return result
    } catch (err) {
      console.error(`✗ ${id}: ${err?.message ?? err}`)
      dumpDiagnostics(id, err, { runDir, ...contextFactory() })
      throw err
    }
  }
}

export function safeNodeInfo(node) {
  const info = {}
  for (const key of ['role', 'className', 'localizedControlType', 'name', 'value', 'description', 'helpText', 'overallDescription', 'isEnabled']) {
    try { info[key] = node[key] } catch { info[key] = null }
  }
  try { info.boundingBox = node.boundingBox() } catch { info.boundingBox = null }
  try { info.actions = node.supportedActions() } catch { info.actions = [] }
  return info
}

export function nodeText(info) {
  return [info.name, info.value, info.description, info.helpText, info.overallDescription]
    .filter(Boolean)
    .join(' ')
}

export function chord(keyboard, modifiers, key) {
  for (const modifier of modifiers) keyboard.key(modifier, Direction.Press)
  keyboard.key(key, Direction.Click)
  for (const modifier of modifiers.slice().reverse()) keyboard.key(modifier, Direction.Release)
}

function errorDetails(err) {
  return {
    message: err?.message ?? String(err),
    stack: err?.stack ?? String(err),
  }
}

export async function runStrategies({ app, goal, runDir, strategies, verify, suggestedNextSteps = [] }) {
  const attempts = []

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
      console.warn(`Strategy ${strategy.name} failed: ${err?.message ?? err}`)
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

  const err = new Error(`${goal} failed after ${attempts.length} strategies: ${result.reason}`)
  err.result = result
  throw err
}
