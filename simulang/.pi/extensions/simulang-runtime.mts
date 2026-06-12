import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import * as sim from '@simular-ai/simulang-js'

const {
  AccessibilityNode,
  App,
  Button,
  Coordinate,
  Direction,
  FocusPolicy,
  KeyboardController,
  Key,
  MouseController,
  Screen,
  System,
  TraversalOrder,
  Visibility,
  Window,
  screenshotFull,
} = sim

const DEFAULT_MAX_SNAPSHOT_LINES = 90
const DEFAULT_MAX_WINDOWS = 60
const DEFAULT_MAX_CANDIDATES = 12
const DEFAULT_WAIT_MS = 500

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

export function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(toJsonSafe(value), null, 2))
}

export function toJsonSafe(value) {
  if (value === undefined) return null
  const seen = new WeakSet()
  try {
    const json = JSON.stringify(value, (_key, inner) => {
      if (typeof inner === 'bigint') return inner.toString()
      if (typeof inner === 'function') return undefined
      if (!inner || typeof inner !== 'object') return inner
      if (seen.has(inner)) return '[Circular]'
      seen.add(inner)

      const ctor = inner.constructor?.name
      if (ctor === 'AccessibilityNode') return safeNodeInfo(inner)
      if (ctor === 'Window') return safeWindowInfo(inner)
      if (ctor === 'Instance') return safeInstanceInfo(inner)
      return inner
    })
    return json === undefined ? null : JSON.parse(json)
  } catch (error) {
    return { unserializable: true, value: String(value), error: String(error) }
  }
}

function safeError(error) {
  return {
    name: error?.name,
    message: error?.message ?? String(error),
    stack: error?.stack,
  }
}

function slug(s) {
  return String(s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'
}

function truncate(s, max = 12_000) {
  s = String(s ?? '')
  return s.length > max ? `${s.slice(0, max)}\n... [truncated ${s.length - max} chars]` : s
}

function firstLines(s, maxLines = DEFAULT_MAX_SNAPSHOT_LINES) {
  const lines = String(s ?? '').split('\n')
  return {
    text: lines.slice(0, maxLines).join('\n'),
    totalLines: lines.length,
    truncated: lines.length > maxLines,
  }
}

function safeWindowInfo(w) {
  try {
    return { pid: w.pid, title: w.title }
  } catch (error) {
    return { error: String(error) }
  }
}

function safeInstanceInfo(inst) {
  try {
    return {
      pid: inst.pid,
      hasFocus: safeCall(() => inst.hasFocus()),
      hasAccessibility: safeCall(() => inst.hasAccessibility()),
    }
  } catch (error) {
    return { error: String(error) }
  }
}

function safeCall(fn, fallback = undefined) {
  try { return fn() } catch { return fallback }
}

function safeBox(node) {
  return safeCall(() => node.boundingBox(), undefined)
}

export function safeNodeInfo(node, extra = {}) {
  const info = {
    role: safeCall(() => String(node.role), ''),
    name: safeCall(() => node.name, ''),
    value: safeCall(() => node.value, ''),
    description: safeCall(() => node.description, ''),
    className: safeCall(() => node.className, ''),
    localizedControlType: safeCall(() => node.localizedControlType, ''),
    overallDescription: safeCall(() => node.overallDescription, ''),
    helpText: safeCall(() => node.helpText, ''),
    automationId: safeCall(() => node.automationId, ''),
    isEnabled: safeCall(() => node.isEnabled, undefined),
    boundingBox: safeBox(node),
    supportedActions: safeCall(() => node.supportedActions(), []),
    ...extra,
  }
  info.text = nodeText(info)
  return info
}

export function nodeText(info) {
  return [
    info.name,
    info.value,
    info.description,
    info.localizedControlType,
    info.className,
    info.helpText,
    info.overallDescription,
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

function inferRisk(action = {}) {
  const explicit = action.riskLevel || action.risk
  if (explicit) return explicit

  const actionType = String(action.type || action.kind || '').toLowerCase()
  const intentText = [
    action.query,
    action.text,
    action.name,
    action.label,
    action.description,
    action.intent,
  ].filter(Boolean).join(' ').toLowerCase()

  if (/\b(production|prod|billing|permission|security|admin|customer)\b/.test(intentText)) return 'production-impacting'
  if (/\b(send|submit|post|publish|invite|share|reply|forward)\b/.test(intentText)) return 'externally-visible'
  if (/\b(delete|remove|archive|discard|cancel|erase|trash|permanently)\b/.test(intentText)) return 'destructive'
  if (/\b(setvalue|type|typetext|paste|drag|drop|upload|save)\b/.test(actionType)) return 'state-changing'
  if (/\b(openapp|press|activate|clickax|wait|screenshot|scroll|key|presskey)\b/.test(actionType)) return 'reversible-navigation'
  return 'reversible-navigation'
}

function isRiskAllowed(risk, safety) {
  if (risk === 'observe-only') return true
  if (risk === 'reversible-navigation') return true
  if (risk === 'state-changing') return safety.allowStateChanging !== false
  if (risk === 'destructive') return safety.allowDestructive === true
  if (risk === 'externally-visible') return safety.allowExternal === true || safety.allowExternalSend === true
  if (risk === 'production-impacting') return safety.allowProduction === true || safety.allowProductionChanges === true
  return false
}

function makeSafety(params = {}) {
  const safety = params.safety || params.options?.safety || {}
  return {
    stealFocus: params.stealFocus ?? safety.stealFocus ?? process.env.STEAL_FOCUS === '1',
    allowStateChanging: safety.allowStateChanging ?? process.env.ALLOW_STATE_CHANGING !== '0',
    allowDestructive: safety.allowDestructive ?? process.env.ALLOW_DESTRUCTIVE === '1',
    allowExternal: safety.allowExternal ?? safety.allowExternalSend ?? process.env.ALLOW_EXTERNAL_SEND === '1',
    allowProduction: safety.allowProduction ?? safety.allowProductionChanges ?? process.env.ALLOW_PRODUCTION_CHANGES === '1',
    allowCoordinates: safety.allowCoordinates ?? process.env.ALLOW_COORDINATES === '1',
  }
}

function keyByName(name) {
  if (typeof name === 'number') return name
  const raw = String(name || '')
  const aliases = {
    enter: 'Return', return: 'Return', esc: 'Escape', escape: 'Escape',
    cmd: 'Meta', command: 'Meta', meta: 'Meta', ctrl: 'Control', control: 'Control',
    option: 'Alt', alt: 'Alt', shift: 'Shift', space: 'Space', tab: 'Tab',
    left: 'LeftArrow', right: 'RightArrow', up: 'UpArrow', down: 'DownArrow',
    backspace: 'Backspace', delete: 'Delete', del: 'Delete',
  }
  const normalized = aliases[raw.toLowerCase()] || raw
  if (Key[normalized] !== undefined) return Key[normalized]
  const title = normalized.slice(0, 1).toUpperCase() + normalized.slice(1)
  if (Key[title] !== undefined) return Key[title]
  const upper = normalized.toUpperCase()
  if (upper.length === 1 && Key[upper] !== undefined) return Key[upper]
  throw new Error(`Unknown key: ${name}`)
}

function buttonByName(name) {
  if (typeof name === 'number') return name
  const raw = String(name || 'left').toLowerCase()
  if (raw === 'left') return Button.Left
  if (raw === 'right') return Button.Right
  if (raw === 'middle') return Button.Middle
  throw new Error(`Unknown mouse button: ${name}`)
}

export function createGui({ runDir, params = {} } = {}) {
  mkdirSync(runDir, { recursive: true })

  const keyboard = new KeyboardController()
  const mouse = new MouseController()
  const trace = []
  const safety = makeSafety(params)
  let currentPid = params.pid || params.target?.pid || 0
  let stepIndex = 0

  function artifactPath(name) {
    return join(runDir, name)
  }

  function writeArtifact(name, value, kind = 'json') {
    const path = artifactPath(name)
    if (kind === 'text') writeFileSync(path, String(value))
    else writeJson(path, value)
    return path
  }

  function record(type, data = {}) {
    const entry = toJsonSafe({ index: trace.length + 1, time: new Date().toISOString(), type, ...data })
    trace.push(entry)
    writeJson(artifactPath('trace.json'), trace)
    return entry
  }

  function windowsSummary() {
    return Window.all().slice(0, DEFAULT_MAX_WINDOWS).map(safeWindowInfo)
  }

  function resolveWindow(target = undefined) {
    target = target || params.target || {}
    let windows = []
    if (target.pid || currentPid) windows = Window.allForPid(target.pid || currentPid)
    else windows = Window.all()

    if (target.titleRegex) {
      const re = new RegExp(target.titleRegex, target.titleRegexFlags || 'i')
      windows = windows.filter((w) => re.test(w.title))
    }
    if (target.titleIncludes) {
      const needle = String(target.titleIncludes).toLowerCase()
      windows = windows.filter((w) => String(w.title).toLowerCase().includes(needle))
    }
    if (!windows.length) return null
    return windows.find((w) => w.title?.trim()) || windows[0]
  }

  function searchNodes(query, options = {}) {
    const maxNodes = options.maxNodes ?? 4000
    const threshold = options.threshold ?? 0.04
    const collapseStructural = options.collapseStructural ?? true
    const order = options.order === 'depth' ? TraversalOrder.DepthFirst : TraversalOrder.BreadthFirst
    const win = resolveWindow(options.target)
    if (win) {
      return { source: 'window', window: safeWindowInfo(win), nodes: win.scoredSearch(order, maxNodes, collapseStructural, query, threshold) }
    }
    const root = AccessibilityNode.fromFocusedApplication()
    return { source: 'focusedApplication', window: null, nodes: root.scoredSearch(order, maxNodes, collapseStructural, query, threshold) }
  }

  async function observe(options = {}) {
    const id = `${String(++stepIndex).padStart(2, '0')}-observe`
    const windows = windowsSummary()
    const win = resolveWindow(options.target)
    let snapshot = null
    let snapshotPath = null
    let targetWindow = win ? safeWindowInfo(win) : null

    try {
      const full = win ? win.snapshot() : AccessibilityNode.fromFocusedApplication().snapshot()
      snapshotPath = artifactPath(`${id}-snapshot.txt`)
      writeFileSync(snapshotPath, full)
      const compact = firstLines(full, options.maxSnapshotLines ?? DEFAULT_MAX_SNAPSHOT_LINES)
      snapshot = { ...compact, path: snapshotPath }
    } catch (error) {
      snapshot = { error: safeError(error) }
    }

    let candidates = []
    if (options.query) {
      try {
        const found = searchNodes(options.query, options)
        candidates = found.nodes.slice(0, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES).map((node, index) => safeNodeInfo(node, { index }))
        writeArtifact(`${id}-candidates.json`, { query: options.query, source: found.source, window: found.window, candidates })
      } catch (error) {
        candidates = [{ error: safeError(error) }]
      }
    }

    const observation = {
      ok: true,
      mode: 'observe',
      artifactDir: runDir,
      targetWindow,
      windows,
      snapshot,
      candidates,
      summary: summarizeObservation({ targetWindow, snapshot, candidates, windows }),
    }
    record('observe', { options, observation })
    writeArtifact(`${id}.json`, observation)
    return observation
  }

  function summarizeObservation(observation) {
    const title = observation.targetWindow?.title ? `window=${JSON.stringify(observation.targetWindow.title)}` : 'window=focused app/unknown'
    const snapshot = observation.snapshot?.text ? observation.snapshot.text.split('\n').slice(0, 12).join('\n') : JSON.stringify(observation.snapshot)
    const candidates = observation.candidates?.length ? `\nCandidates: ${observation.candidates.slice(0, 5).map((c) => `${c.index ?? '?'}:${nodeText(c).slice(0, 80)}`).join(' | ')}` : ''
    return `${title}\n${snapshot || ''}${candidates}`.trim()
  }

  async function act(action = {}, options = {}) {
    const risk = inferRisk(action)
    const id = `${String(++stepIndex).padStart(2, '0')}-${slug(action.type || 'action')}`
    record('action:start', { id, action, risk })

    if (!isRiskAllowed(risk, safety)) {
      const blocked = { ok: false, blocked: true, risk, reason: `Risk ${risk} is not allowed by current safety policy`, action }
      writeArtifact(`${id}-blocked.json`, blocked)
      record('action:blocked', blocked)
      return blocked
    }

    try {
      const type = action.type || action.kind
      let result
      if (type === 'openApp') result = await openApp(action)
      else if (type === 'press' || type === 'activate' || type === 'clickAx') result = await press(action, id)
      else if (type === 'setValue') result = await setValue(action, id)
      else if (type === 'type' || type === 'typeText') result = await typeText(action)
      else if (type === 'pressKey' || type === 'key') result = await pressKey(action)
      else if (type === 'wait') result = await wait(action)
      else if (type === 'screenshot') result = await screenshot(action, id)
      else if (type === 'scroll') result = await scroll(action)
      else if (type === 'click' || type === 'clickCoordinates') result = await clickCoordinates(action)
      else throw new Error(`Unsupported action type: ${type}`)

      const out = { ok: true, id, risk, action, result }
      record('action:done', out)
      writeArtifact(`${id}.json`, out)
      return out
    } catch (error) {
      const out = { ok: false, id, risk, action, error: safeError(error) }
      record('action:error', out)
      writeArtifact(`${id}-error.json`, out)
      return out
    }
  }

  async function openApp(action) {
    const appName = action.app || action.name || action.query
    if (!appName) throw new Error('openApp action requires app/name/query')
    const app = App.exists(appName) ? App.exactName(appName) : System.fuzzySearch(appName)
    const focusPolicy = (action.stealFocus ?? safety.stealFocus) ? FocusPolicy.Steal : FocusPolicy.DoNotSteal
    const visibility = action.hidden ? Visibility.Hidden : Visibility.Show
    const inst = app.open(action.url ?? null, focusPolicy, visibility, action.waitForLoadComplete ?? true)
    currentPid = inst.pid
    if (action.enableAccessibility !== false) safeCall(() => inst.enableAccessibility())
    await sleep(action.waitMs ?? 1500)
    return { app: appName, instance: safeInstanceInfo(inst), windows: Window.allForPid(currentPid).map(safeWindowInfo) }
  }

  async function press(action, id) {
    const query = action.query || action.text || action.name
    if (!query) throw new Error('press action requires query/text/name')
    const found = searchNodes(query, action)
    const candidates = found.nodes.slice(0, action.maxCandidates ?? DEFAULT_MAX_CANDIDATES).map((node, index) => safeNodeInfo(node, { index }))
    writeArtifact(`${id}-candidates.json`, { query, source: found.source, window: found.window, candidates })
    const selectedIndex = action.index ?? 0
    const node = found.nodes[selectedIndex]
    if (!node) throw new Error(`No AX candidate found for query: ${query}`)
    const selected = safeNodeInfo(node, { index: selectedIndex })
    if (action.scrollIntoView) safeCall(() => node.scrollIntoView())
    if (action.focus || action.stealFocus || safety.stealFocus) safeCall(() => node.focus())
    await sleep(action.beforeMs ?? 100)
    node.activate()
    await sleep(action.waitMs ?? DEFAULT_WAIT_MS)
    return { query, selected, candidateCount: found.nodes.length }
  }

  async function setValue(action, id) {
    const query = action.query || action.text || action.name
    if (!query) throw new Error('setValue action requires query/text/name')
    const value = action.value ?? ''
    const found = searchNodes(query, action)
    const candidates = found.nodes.slice(0, action.maxCandidates ?? DEFAULT_MAX_CANDIDATES).map((node, index) => safeNodeInfo(node, { index }))
    writeArtifact(`${id}-candidates.json`, { query, source: found.source, window: found.window, candidates })
    const node = found.nodes[action.index ?? 0]
    if (!node) throw new Error(`No AX candidate found for query: ${query}`)
    const selected = safeNodeInfo(node, { index: action.index ?? 0 })
    if (action.focus || action.stealFocus || safety.stealFocus) safeCall(() => node.focus())
    node.setValue(String(value))
    await sleep(action.waitMs ?? DEFAULT_WAIT_MS)
    return { query, value, selected }
  }

  async function typeText(action) {
    keyboard.text(String(action.text ?? action.value ?? ''))
    await sleep(action.waitMs ?? DEFAULT_WAIT_MS)
    return { typedChars: String(action.text ?? action.value ?? '').length }
  }

  async function pressKey(action) {
    const key = keyByName(action.key || action.name)
    const modifiers = (action.modifiers || []).map(keyByName)
    for (const mod of modifiers) keyboard.key(mod, Direction.Press)
    keyboard.key(key, Direction.Click)
    for (const mod of modifiers.reverse()) keyboard.key(mod, Direction.Release)
    await sleep(action.waitMs ?? DEFAULT_WAIT_MS)
    return { key: action.key || action.name, modifiers: action.modifiers || [] }
  }

  async function wait(action) {
    const ms = action.ms ?? action.waitMs ?? DEFAULT_WAIT_MS
    await sleep(ms)
    return { waitedMs: ms }
  }

  async function screenshot(action, id) {
    const path = artifactPath(action.path || `${id}-screen.png`)
    screenshotFull(action.hideCursor ?? true, Screen.mainScreen()).save(path)
    return { path }
  }

  async function scroll(action) {
    mouse.scroll(action.deltaX ?? 0, action.deltaY ?? action.amount ?? 0)
    await sleep(action.waitMs ?? DEFAULT_WAIT_MS)
    return { deltaX: action.deltaX ?? 0, deltaY: action.deltaY ?? action.amount ?? 0 }
  }

  async function clickCoordinates(action) {
    if (!safety.allowCoordinates && action.allowCoordinates !== true) {
      throw new Error('Coordinate clicks are disabled. Set safety.allowCoordinates or action.allowCoordinates explicitly.')
    }
    mouse.moveMouse(action.x, action.y, Coordinate.Abs)
    mouse.button(buttonByName(action.button), Direction.Click)
    await sleep(action.waitMs ?? DEFAULT_WAIT_MS)
    return { x: action.x, y: action.y, button: action.button || 'left' }
  }

  async function step(action, options = {}) {
    const actionResult = await act(action, options)
    const observation = options.observeAfter === false ? null : await observe(options.observe || {})
    return { ok: actionResult.ok, action: actionResult, observation }
  }

  async function batch(actions = [], options = {}) {
    const results = []
    for (const action of actions) {
      const actionResult = await act(action, options)
      const item = { action: actionResult }
      if (options.observe === 'afterEach') item.observation = await observe(options.observeOptions || {})
      results.push(item)
      if (!actionResult.ok && options.stopOnFailure !== false) break
    }
    const finalObservation = options.observe === false || options.observe === 'afterEach' ? null : await observe(options.observeOptions || {})
    return { ok: results.every((r) => r.action.ok), results, observation: finalObservation }
  }

  async function find(query, options = {}) {
    const found = searchNodes(query, options)
    const candidates = found.nodes.slice(0, options.maxCandidates ?? DEFAULT_MAX_CANDIDATES).map((node, index) => safeNodeInfo(node, { index }))
    record('find', { query, options, source: found.source, window: found.window, candidates })
    return { ok: true, query, source: found.source, window: found.window, candidates }
  }

  async function verify(description, predicateOrOptions = {}) {
    let ok = false
    let details = {}
    if (typeof predicateOrOptions === 'function') {
      ok = Boolean(await predicateOrOptions())
    } else {
      const obs = await observe(predicateOrOptions.observe || {})
      if (predicateOrOptions.textIncludes) ok = obs.summary.toLowerCase().includes(String(predicateOrOptions.textIncludes).toLowerCase())
      else if (predicateOrOptions.textRegex) ok = new RegExp(predicateOrOptions.textRegex, predicateOrOptions.flags || 'i').test(obs.summary)
      else ok = true
      details = { observation: obs }
    }
    const result = { ok, description, details }
    record('verify', result)
    writeArtifact(`verify-${slug(description)}.json`, result)
    return result
  }

  async function captureFailure(label = 'failure') {
    const safeLabel = slug(label)
    const artifacts = { windows: null, screenshot: null }
    try {
      artifacts.windows = writeArtifact(`${safeLabel}-windows.json`, windowsSummary())
    } catch {}
    try {
      artifacts.screenshot = (await screenshot({ path: `${safeLabel}-screen.png` }, `${safeLabel}`)).path
    } catch (error) {
      writeArtifact(`${safeLabel}-screen-error.txt`, String(error), 'text')
    }
    return artifacts
  }

  return {
    sim,
    runDir,
    safety,
    get currentPid() { return currentPid },
    set currentPid(pid) { currentPid = pid },
    artifactPath,
    writeArtifact,
    record,
    trace: () => trace,
    observe,
    act,
    step,
    batch,
    find,
    verify,
    screenshot,
    sleep,
    captureFailure,
    safeNodeInfo,
    nodeText,
    relativeArtifactPath(path) { return relative(process.cwd(), path) || basename(path) },
  }
}
