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

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export const RISK_LEVELS = {
  ObserveOnly: 'observe-only',
  ReversibleNavigation: 'reversible-navigation',
  StateChanging: 'state-changing',
  Destructive: 'destructive',
  ExternallyVisible: 'externally-visible',
  ProductionImpacting: 'production-impacting',
}

export function createSafetyPolicy(overrides = {}) {
  const mode = overrides.mode ?? process.env.GUI_AUTOMATION_MODE ?? (process.env.EXECUTE === '1' ? 'execute' : 'explore')
  return {
    mode,
    stealFocus: overrides.stealFocus ?? process.env.STEAL_FOCUS === '1',
    allowStateChanging: overrides.allowStateChanging ?? (mode === 'execute' || process.env.ALLOW_STATE_CHANGING === '1'),
    allowDestructive: overrides.allowDestructive ?? process.env.ALLOW_DESTRUCTIVE === '1',
    allowExternalSend: overrides.allowExternalSend ?? process.env.ALLOW_EXTERNAL_SEND === '1',
    allowProductionChanges: overrides.allowProductionChanges ?? process.env.ALLOW_PRODUCTION_CHANGES === '1',
    maxMutations: overrides.maxMutations ?? Number(process.env.MAX_MUTATIONS ?? 0),
  }
}

export function isRiskAllowed(riskLevel, policy) {
  if (riskLevel === RISK_LEVELS.ObserveOnly) return true
  if (riskLevel === RISK_LEVELS.ReversibleNavigation) return true
  if (riskLevel === RISK_LEVELS.StateChanging) return policy.mode === 'execute' && policy.allowStateChanging
  if (riskLevel === RISK_LEVELS.Destructive) return policy.mode === 'execute' && policy.allowDestructive
  if (riskLevel === RISK_LEVELS.ExternallyVisible) return policy.mode === 'execute' && policy.allowExternalSend
  if (riskLevel === RISK_LEVELS.ProductionImpacting) return policy.mode === 'execute' && policy.allowProductionChanges
  return false
}

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2))
}

export function readJson(path, fallback) {
  if (!existsSync(path)) return fallback
  return JSON.parse(readFileSync(path, 'utf8'))
}

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

export function recordProposedAction(runDir, proposal) {
  const path = join(runDir, 'proposed-actions.json')
  const existing = readJson(path, null)
  const doc = existing ?? {
    proposalId: new Date().toISOString().replace(/[:.]/g, '-'),
    mode: proposal.mode ?? 'dry_run',
    actions: [],
  }
  doc.actions.push({
    recordedAt: new Date().toISOString(),
    ...proposal,
  })
  writeJson(path, doc)
  return doc
}

export function guardGuiAction(runDir, policy, action) {
  const riskLevel = action.riskLevel ?? RISK_LEVELS.StateChanging
  if (isRiskAllowed(riskLevel, policy)) return { allowed: true, riskLevel, policy }

  const proposal = recordProposedAction(runDir, {
    mode: policy.mode === 'execute' ? 'blocked' : 'dry_run',
    ...action,
    riskLevel,
    blockedByPolicy: policy,
  })
  return {
    allowed: false,
    riskLevel,
    policy,
    proposal,
    reason: `blocked_${riskLevel}_action_in_${policy.mode}_mode`,
  }
}

export function assertGuiActionAllowed(runDir, policy, action) {
  const result = guardGuiAction(runDir, policy, action)
  if (result.allowed) return result
  const err = new Error(result.reason)
  err.guard = result
  throw err
}

function errorDetails(err) {
  return {
    message: err?.message ?? String(err),
    stack: err?.stack ?? String(err),
  }
}

export async function runStrategies({ app, goal, runDir, strategies, verify, suggestedNextSteps = [], policy = createSafetyPolicy(), riskLevel = RISK_LEVELS.ObserveOnly }) {
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
          mode: policy.mode,
          riskLevel,
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
    mode: policy.mode,
    riskLevel,
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
