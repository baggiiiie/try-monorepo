#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { execFileSync } from 'node:child_process'

import {
  AccessibilityNode,
  App,
  FocusPolicy,
  ScreenshotCoordinateType,
  TraversalOrder,
  Visibility,
  Window,
  ariaRoleToString,
} from '@simular-ai/simulang-js'

const DEFAULT_TARGETS = [
  'Search',
  'Inbox',
]

const UI_TOKEN_ALLOWLIST = new Set([
  'account', 'all', 'archive', 'back', 'button', 'calendar', 'compose',
  'contacts', 'delete', 'drafts', 'filter', 'folder', 'folders', 'focused',
  'forward', 'inbox', 'mail', 'message', 'messages', 'new', 'next', 'other',
  'people', 'previous', 'reply', 'search', 'send', 'sent', 'settings', 'tab',
  'toolbar', 'unread', 'view',
])

const ACTIONABLE_ACTIONS = new Set([
  'activate',
  'set_value',
  'toggle',
  'select',
  'expand_collapse',
  'scroll_into_view',
  'focus',
])

function parseArgs(argv) {
  const opts = {
    app: 'Microsoft Outlook',
    appCandidates: ['Microsoft Outlook', 'Outlook'],
    targets: [],
    thresholds: [0.2, 0.35, 0.5, 0.65],
    resolveThreshold: 0.35,
    maxNodes: 4000,
    trials: 3,
    pauseMs: 250,
    outDir: 'phase1-results',
    groundOnMiss: false,
    openApp: false,
    focusWindow: false,
    scanAllWindows: false,
    windowScope: false,
    windowTitle: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value == null) throw new Error(`Missing value for ${arg}`)
      return value
    }

    if (arg === '--help' || arg === '-h') {
      opts.help = true
    } else if (arg === '--app') {
      opts.app = next()
      opts.appCandidates = [opts.app]
    } else if (arg === '--app-candidate') {
      opts.appCandidates.push(next())
    } else if (arg === '--target') {
      opts.targets.push(next())
    } else if (arg === '--targets') {
      opts.targets.push(...next().split(',').map((v) => v.trim()).filter(Boolean))
    } else if (arg === '--thresholds') {
      opts.thresholds = next().split(',').map((v) => Number(v.trim())).filter(Number.isFinite)
    } else if (arg === '--threshold') {
      opts.resolveThreshold = Number(next())
    } else if (arg === '--max-nodes') {
      opts.maxNodes = Number(next())
    } else if (arg === '--trials') {
      opts.trials = Number(next())
    } else if (arg === '--pause-ms') {
      opts.pauseMs = Number(next())
    } else if (arg === '--out-dir') {
      opts.outDir = next()
    } else if (arg === '--ground-on-miss' || arg === '--ground') {
      opts.groundOnMiss = true
    } else if (arg === '--open') {
      opts.openApp = true
    } else if (arg === '--focus') {
      opts.focusWindow = true
    } else if (arg === '--scan-all-windows') {
      opts.scanAllWindows = true
    } else if (arg === '--window-scope') {
      opts.windowScope = true
    } else if (arg === '--no-open') {
      opts.openApp = false
    } else if (arg === '--window-title') {
      opts.windowTitle = next()
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  if (opts.targets.length === 0) opts.targets = DEFAULT_TARGETS
  opts.thresholds = [...new Set(opts.thresholds)].sort((a, b) => a - b)
  if (!opts.thresholds.includes(opts.resolveThreshold)) {
    opts.thresholds.push(opts.resolveThreshold)
    opts.thresholds.sort((a, b) => a - b)
  }
  return opts
}

function printHelp() {
  console.log(`Usage: simulang run scripts/phase1-outlook.mjs [options]

Non-destructive Outlook descriptor stability probe.

Options:
  --app <name>              App name to attach/open (default: Microsoft Outlook)
  --open                    Open Outlook if it is not already visible
  --focus                   Focus the selected window (off by default; Outlook can hang)
  --window-scope            Use Window.allForPid + Window.scoredSearch (can hang on Outlook)
  --scan-all-windows        Fallback to Window.all() scan if PID lookup finds nothing
  --no-open                 Do not open the app; attach to existing windows (default)
  --window-title <text>     Prefer a visible window whose title contains text
  --target <text>           Add a target concept; repeatable
  --targets <a,b,c>         Comma-separated target concepts
  --threshold <n>           Main scoredSearch threshold (default: 0.35)
  --thresholds <a,b,c>      Threshold sweep (default: 0.2,0.35,0.5,0.65)
  --max-nodes <n>           Max AX nodes visited per search (default: 4000)
  --trials <n>              Re-resolution trials per target (default: 3)
  --pause-ms <n>            Pause between trials; move/resize manually here
  --ground-on-miss          Opt-in Anthropic screenshot grounding for misses
  --out-dir <path>          Report directory (default: phase1-results)
`)
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

function hashObject(value) {
  return sha256(JSON.stringify(value))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safe(_label, fn, fallback = null) {
  try {
    const value = fn()
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

function processName(pid) {
  if (!pid) return ''
  try {
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return basename(output).toLowerCase()
  } catch {
    return ''
  }
}

function pidsForAppCandidates(candidates) {
  const pids = new Set()
  for (const candidate of candidates) {
    for (const args of [['-x', candidate], ['-if', candidate]]) {
      try {
        const output = execFileSync('pgrep', args, {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        }).trim()
        for (const line of output.split('\n')) {
          const pid = Number(line.trim())
          if (Number.isFinite(pid) && pid > 0) pids.add(pid)
        }
      } catch {
        // no match for this candidate/form
      }
    }
  }
  return [...pids]
    .filter((pid) => {
      const proc = processName(pid)
      return proc.includes('outlook') || candidates.some((candidate) => proc.includes(candidate.toLowerCase()))
    })
    .sort((a, b) => a - b)
}

function appScope(pid) {
  console.log(`[phase1] creating app AX root for pid=${pid}`)
  const root = AccessibilityNode.fromPid(pid)
  return {
    kind: 'app',
    pid,
    title: '',
    boundingBox: () => root.boundingBox(),
    snapshot: () => root.snapshot(),
    scoredSearch: (...args) => root.scoredSearch(...args),
  }
}

function windowScope(window) {
  return {
    kind: 'window',
    pid: safe('pid', () => window.pid, 0),
    title: safe('title', () => window.title, ''),
    boundingBox: () => window.boundingBox(),
    snapshot: () => window.snapshot(),
    scoredSearch: (...args) => window.scoredSearch(...args),
    screenshot: (...args) => window.screenshot(...args),
  }
}

function boxArea(box) {
  if (!box) return 0
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top)
}

function boxCenter(box) {
  if (!box) return null
  return {
    x: (box.left + box.right) / 2,
    y: (box.top + box.bottom) / 2,
  }
}

function round(value, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function posHint(box, windowBox) {
  const center = boxCenter(box)
  if (!center || !windowBox) return null
  const width = Math.max(1, windowBox.right - windowBox.left)
  const height = Math.max(1, windowBox.bottom - windowBox.top)
  return {
    xRatio: round((center.x - windowBox.left) / width, 4),
    yRatio: round((center.y - windowBox.top) / height, 4),
  }
}

function roleName(role) {
  return safe('role', () => ariaRoleToString(role), String(role))
}

function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' url ')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, ' email ')
    .match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && token.length <= 24) ?? []
}

function sanitizedTokens(text, query) {
  const allowed = new Set([...UI_TOKEN_ALLOWLIST, ...tokenize(query)])
  const seen = new Set()
  const result = []
  for (const token of tokenize(text)) {
    if (!allowed.has(token) || seen.has(token)) continue
    seen.add(token)
    result.push(token)
    if (result.length >= 24) break
  }
  return result
}

function tokenOverlap(a, b) {
  const aa = new Set(a)
  const bb = new Set(b)
  if (aa.size === 0 || bb.size === 0) return 0
  let intersection = 0
  for (const token of aa) if (bb.has(token)) intersection += 1
  return intersection / Math.max(aa.size, bb.size)
}

function stableStructuralHash(snapshot) {
  const roleLines = String(snapshot ?? '')
    .split('\n')
    .map((line) => {
      const indent = line.match(/^\s*/)?.[0].length ?? 0
      const trimmed = line.trim()
      if (!trimmed) return null
      const role = trimmed.split(/\s+/)[0]
      return `${Math.floor(indent / 2)}:${role}`
    })
    .filter(Boolean)
  return {
    hash: hashObject(roleLines),
    roleLineCount: roleLines.length,
  }
}

function nodeDescriptor(node, query, windowBox) {
  const role = roleName(safe('role', () => node.role, 'unknown'))
  const box = safe('boundingBox', () => node.boundingBox(), null)
  const name = safe('name', () => node.name, '')
  const description = safe('description', () => node.description, '')
  const overall = safe('overallDescription', () => node.overallDescription, '')
  const supportedActions = safe('supportedActions', () => node.supportedActions(), [])
  const ancestors = safe('ancestors', () => node.ancestors(), [])
  const ancestorRoles = ancestors
    .slice(0, 8)
    .map((ancestor) => roleName(safe('ancestorRole', () => ancestor.role, 'unknown')))
  const nameTokens = sanitizedTokens(name, query)
  const descriptionTokens = sanitizedTokens(`${description} ${overall}`, query)

  return {
    role,
    query,
    nameTokens,
    descriptionTokens,
    nameTokenCount: tokenize(name).length,
    descriptionTokenCount: tokenize(`${description} ${overall}`).length,
    ancestorRoles,
    classNameHash: sha256(safe('className', () => node.className, '')),
    localizedControlType: safe('localizedControlType', () => node.localizedControlType, ''),
    isEnabled: safe('isEnabled', () => node.isEnabled, null),
    supportedActions,
    box: box ? {
      left: round(box.left),
      top: round(box.top),
      right: round(box.right),
      bottom: round(box.bottom),
    } : null,
    posHint: posHint(box, windowBox),
  }
}

function candidateScore(candidate, descriptor) {
  const tokenScore = Math.max(
    tokenOverlap(candidate.nameTokens, descriptor.nameTokens),
    tokenOverlap(candidate.descriptionTokens, descriptor.descriptionTokens),
  )
  const roleScore = candidate.role === descriptor.role ? 1 : 0
  const actionScore = descriptor.supportedActions?.some((action) => candidate.supportedActions?.includes(action)) ? 1 : 0
  const posScore = candidate.posHint && descriptor.posHint
    ? 1 - Math.min(1, Math.hypot(candidate.posHint.xRatio - descriptor.posHint.xRatio, candidate.posHint.yRatio - descriptor.posHint.yRatio))
    : 0
  return round(roleScore * 3 + actionScore * 2 + tokenScore * 2 + posScore, 4)
}

function candidateFingerprint(candidate) {
  const box = candidate.box
  const boxKey = box
    ? [box.left, box.top, box.right, box.bottom].map((value) => Math.round(value)).join(',')
    : 'no-box'
  return JSON.stringify({
    role: candidate.role,
    box: boxKey,
    actions: candidate.supportedActions ?? [],
    nameTokens: candidate.nameTokens ?? [],
    descriptionTokens: candidate.descriptionTokens ?? [],
  })
}

function dedupeCandidates(candidates) {
  const seen = new Set()
  const unique = []
  for (const candidate of candidates) {
    const fingerprint = candidateFingerprint(candidate)
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    unique.push(candidate)
  }
  return unique
}

function hasAnyAction(node) {
  const actions = safe('supportedActions', () => node.supportedActions(), [])
  return actions.some((action) => ACTIONABLE_ACTIONS.has(action))
}

function normalizeActionable(node) {
  let current = node
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (hasAnyAction(current)) return current
    current = safe('parent', () => current.parent(), null)
  }
  return node
}

function searchWindow(window, query, threshold, maxNodes) {
  const nodes = window.scoredSearch(
    TraversalOrder.DepthFirst,
    maxNodes,
    true,
    query,
    threshold,
  )
  return nodes.map(normalizeActionable)
}

function resolveDescriptor(window, descriptor, threshold, maxNodes, windowBox) {
  const rawNodes = searchWindow(window, descriptor.query, threshold, maxNodes)
  const rawCandidates = rawNodes.map((node) => nodeDescriptor(node, descriptor.query, windowBox))
  const candidates = dedupeCandidates(rawCandidates)
  const plausible = candidates
    .map((candidate, index) => ({ index, candidate, score: candidateScore(candidate, descriptor) }))
    .filter(({ candidate }) => !descriptor.role || candidate.role === descriptor.role)
    .sort((a, b) => b.score - a.score)

  if (plausible.length === 0) {
    return { status: 'none', rawCandidateCount: rawCandidates.length, candidateCount: candidates.length, plausibleCount: 0, candidates }
  }
  if (plausible.length === 1 || plausible[0].score > plausible[1].score) {
    return {
      status: 'unique',
      rawCandidateCount: rawCandidates.length,
      candidateCount: candidates.length,
      plausibleCount: plausible.length,
      selectedIndex: plausible[0].index,
      selected: plausible[0].candidate,
      tieBreakScore: plausible[0].score,
      candidates,
    }
  }
  return {
    status: 'ambiguous',
    rawCandidateCount: rawCandidates.length,
    candidateCount: candidates.length,
    plausibleCount: plausible.length,
    tieBreakScore: plausible[0].score,
    candidates,
  }
}

function openOrAttachOutlook(opts) {
  let instance = null
  if (opts.openApp) {
    for (const candidate of opts.appCandidates) {
      if (!App.exists(candidate)) continue
      const app = App.exactName(candidate)
      instance = app.open(null, FocusPolicy.DoNotSteal, Visibility.Show, true)
      safe('enableAccessibility', () => instance.enableAccessibility())
      break
    }
  }

  let windows = []
  const candidatePids = instance?.pid ? [instance.pid] : pidsForAppCandidates(opts.appCandidates)
  if (!opts.windowScope && candidatePids.length > 0) {
    const pid = candidatePids[0]
    return { scope: appScope(pid), windowsSeen: 0, pidsSeen: candidatePids.length }
  }

  windows = instance ? safe('windows', () => instance.windows(), []) : []
  for (const pid of candidatePids) {
    if (windows.length > 0) break
    console.log(`[phase1] checking Outlook pid=${pid} (${processName(pid) || 'unknown'})`)
    windows = safe('Window.allForPid', () => Window.allForPid(pid), [])
  }

  if (windows.length === 0 && opts.scanAllWindows) {
    console.log('[phase1] scanning all visible windows')
    const wanted = opts.appCandidates.map((name) => name.toLowerCase())
    windows = safe('Window.all', () => Window.all(), [])
      .filter((window) => {
        const title = safe('title', () => window.title, '').toLowerCase()
        const proc = processName(safe('pid', () => window.pid, 0))
        return wanted.some((name) => title.includes(name.toLowerCase())) || proc.includes('outlook')
      })
  }

  if (opts.windowTitle) {
    const needle = opts.windowTitle.toLowerCase()
    windows = windows.filter((window) => safe('title', () => window.title, '').toLowerCase().includes(needle))
  }

  windows.sort((a, b) => boxArea(safe('box', () => b.boundingBox(), null)) - boxArea(safe('box', () => a.boundingBox(), null)))
  const window = windows[0]
  if (!window) {
    throw new Error('Could not find an Outlook window. Try opening Outlook first, pass --open, or retry with --scan-all-windows.')
  }
  if (opts.focusWindow) safe('window.focus', () => window.focus())
  return { instance, scope: windowScope(window), windowsSeen: windows.length, pidsSeen: candidatePids.length }
}

function windowContext(window, appName) {
  if (window.kind === 'app') {
    const pid = safe('pid', () => window.pid, 0)
    return {
      scopeKind: 'app',
      stableAppId: appName,
      pid,
      processName: processName(pid),
      windowBox: null,
      titleHash: null,
      titleTokenCount: 0,
      routeKeyHash: sha256(`${appName}:app:${pid}`),
      structuralHash: null,
      structuralRoleLineCount: null,
      structuralHashNote: 'Skipped for app scope because Outlook app-root snapshot/boundingBox can block.',
    }
  }

  const box = safe('windowBox', () => window.boundingBox(), null)
  const title = safe('title', () => window.title, '')
  const pid = safe('pid', () => window.pid, 0)
  const snapshot = safe('snapshot', () => window.snapshot(), '')
  const structural = stableStructuralHash(snapshot)
  const titleTokens = tokenize(title)
  return {
    stableAppId: appName,
    pid,
    processName: processName(pid),
    windowBox: box,
    titleHash: sha256(title),
    titleTokenCount: titleTokens.length,
    routeKeyHash: sha256(`${appName}:${titleTokens.join(' ')}`),
    structuralHash: structural.hash,
    structuralRoleLineCount: structural.roleLineCount,
  }
}

async function anthropicGround(window, concept) {
  if (typeof window.screenshot !== 'function') {
    return { skipped: true, reason: 'Anthropic grounding needs a window scope; rerun with --window-scope if safe.' }
  }

  const baseUrl = process.env.ANTHROPIC_BASE_URL
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!baseUrl || !apiKey) {
    return { skipped: true, reason: 'ANTHROPIC_BASE_URL or ANTHROPIC_API_KEY is unset' }
  }

  const screenshot = window.screenshot(true)
  screenshot.shrink(1600, 1200)
  const [width, height] = screenshot.dimensions
  const dataUrl = screenshot.base64DataUrl()
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/)
  if (!match) throw new Error('Screenshot did not produce a base64 data URL')
  const [, mediaType, data] = match

  const endpoint = `${baseUrl.replace(/\/+$/, '')}/v1/messages`
  const body = {
    model: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Find the center of this UI target in the screenshot: ${JSON.stringify(concept)}. The screenshot is ${width}x${height} pixels. Return only JSON like {"x":123,"y":456}. Do not explain.`,
        },
        {
          type: 'image',
          source: { type: 'base64', media_type: mediaType, data },
        },
      ],
    }],
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': process.env.ANTHROPIC_VERSION || '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Anthropic grounding failed (${response.status}): ${text.slice(0, 500)}`)
  }
  const payload = JSON.parse(text)
  const answer = payload.content?.map((part) => part.text ?? '').join('\n') ?? ''
  const jsonText = answer.match(/\{[\s\S]*\}/)?.[0]
  if (!jsonText) throw new Error(`Anthropic grounding returned no JSON: ${answer}`)
  const point = JSON.parse(jsonText)
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error(`Anthropic grounding returned invalid point: ${jsonText}`)
  }

  const [globalX, globalY] = screenshot.toGlobalDesktopCoordinates(
    Number(point.x),
    Number(point.y),
    ScreenshotCoordinateType.absolute(),
  )
  const hitWindow = safe('Window.fromPoint', () => Window.fromPoint(globalX, globalY), null)
  const samePid = hitWindow && safe('pid', () => hitWindow.pid, 0) === safe('pid', () => window.pid, -1)
  const node = AccessibilityNode.fromPoint(globalX, globalY)
  return {
    skipped: false,
    imagePoint: { x: round(point.x), y: round(point.y) },
    globalPoint: { x: round(globalX), y: round(globalY) },
    samePid,
    node: node ? normalizeActionable(node) : null,
  }
}

async function probeTarget(window, target, opts, windowBox) {
  const thresholdSweep = []
  for (const threshold of opts.thresholds) {
    const started = Date.now()
    let status = 'ok'
    let candidates = []
    try {
      candidates = searchWindow(window, target, threshold, opts.maxNodes)
    } catch (error) {
      status = `error: ${error.message}`
    }
    const rawCandidateDescriptors = candidates.map((node) => nodeDescriptor(node, target, windowBox))
    const uniqueCandidateDescriptors = dedupeCandidates(rawCandidateDescriptors)
    thresholdSweep.push({
      threshold,
      status,
      elapsedMs: Date.now() - started,
      rawCandidateCount: candidates.length,
      candidateCount: uniqueCandidateDescriptors.length,
      candidates: uniqueCandidateDescriptors.slice(0, 5),
    })
  }

  const acquireNodes = searchWindow(window, target, opts.resolveThreshold, opts.maxNodes)
  const acquireDescriptors = dedupeCandidates(acquireNodes.map((node) => nodeDescriptor(node, target, windowBox)))
  let acquiredDescriptor = null
  let grounding = null
  if (acquireDescriptors.length > 0) {
    acquiredDescriptor = acquireDescriptors[0]
  } else if (opts.groundOnMiss) {
    grounding = await anthropicGround(window, target)
    if (grounding.node) {
      acquiredDescriptor = nodeDescriptor(grounding.node, target, windowBox)
      grounding.node = nodeDescriptor(grounding.node, target, windowBox)
    }
  }

  const trials = []
  if (acquiredDescriptor) {
    for (let i = 0; i < opts.trials; i += 1) {
      if (i > 0 && opts.pauseMs > 0) await sleep(opts.pauseMs)
      const started = Date.now()
      let trial
      try {
        trial = resolveDescriptor(window, acquiredDescriptor, opts.resolveThreshold, opts.maxNodes, windowBox)
      } catch (error) {
        trial = { status: 'error', error: error.message }
      }
      trials.push({
        trial: i + 1,
        elapsedMs: Date.now() - started,
        ...trial,
      })
    }
  }

  const uniqueTrials = trials.filter((trial) => trial.status === 'unique').length
  const ambiguousTrials = trials.filter((trial) => trial.status === 'ambiguous').length
  const noneTrials = trials.filter((trial) => trial.status === 'none').length
  return {
    target,
    acquired: Boolean(acquiredDescriptor),
    acquiredVia: acquireNodes.length > 0 ? 'scoredSearch' : (grounding?.node ? 'anthropicGrounding' : null),
    rawAcquireCandidateCount: acquireNodes.length,
    acquireCandidateCount: acquireDescriptors.length,
    descriptor: acquiredDescriptor,
    thresholdSweep,
    trials,
    metrics: {
      trials: trials.length,
      uniqueTrials,
      ambiguousTrials,
      noneTrials,
      uniqueRate: trials.length ? round(uniqueTrials / trials.length, 4) : 0,
      wrongTargetAccepts: null,
      wrongTargetAcceptsNote: 'Not automatically knowable in Phase 1; manually inspect selected candidates if needed.',
    },
    grounding: grounding ? { ...grounding, node: grounding.node ?? null } : null,
  }
}

function summarize(report) {
  return report.targets.map((target) => ({
    target: target.target,
    acquired: target.acquired,
    via: target.acquiredVia ?? 'none',
    acquireCandidates: target.acquireCandidateCount,
    uniqueRate: target.metrics.uniqueRate,
    ambiguousTrials: target.metrics.ambiguousTrials,
    noneTrials: target.metrics.noneTrials,
  }))
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    printHelp()
    return
  }

  const startedAt = new Date()
  console.log(`[phase1] attaching to ${opts.app} (${opts.openApp ? 'open allowed' : 'no-open'}, ${opts.focusWindow ? 'focus allowed' : 'no-focus'})`)
  const { scope, windowsSeen, pidsSeen } = openOrAttachOutlook(opts)
  const context = windowContext(scope, opts.app)
  console.log(`[phase1] selected Outlook ${scope.kind} scope: pid=${context.pid}, process=${context.processName}, pidsSeen=${pidsSeen}, windowsSeen=${windowsSeen}`)
  if (context.structuralHash) {
    console.log(`[phase1] structural roles=${context.structuralRoleLineCount}, structuralHash=${context.structuralHash.slice(0, 12)}…`)
  } else {
    console.log(`[phase1] structural hash skipped: ${context.structuralHashNote}`)
  }

  const results = []
  for (const target of opts.targets) {
    console.log(`[phase1] probing target: ${target}`)
    results.push(await probeTarget(scope, target, opts, context.windowBox))
  }

  const report = {
    schemaVersion: 1,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    app: opts.app,
    config: {
      targets: opts.targets,
      thresholds: opts.thresholds,
      resolveThreshold: opts.resolveThreshold,
      maxNodes: opts.maxNodes,
      trials: opts.trials,
      pauseMs: opts.pauseMs,
      groundOnMiss: opts.groundOnMiss,
      llmProvider: opts.groundOnMiss ? 'anthropic-env' : 'disabled',
      anthropicBaseUrlConfigured: Boolean(process.env.ANTHROPIC_BASE_URL),
      anthropicApiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      anthropicModel: opts.groundOnMiss ? (process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest') : null,
    },
    context,
    targets: results,
    summary: summarize({ targets: results }),
    gate: {
      automatedPass: results.every((target) => target.acquired && target.metrics.uniqueRate === 1 && target.metrics.ambiguousTrials === 0),
      caveat: 'Automated pass excludes wrong-target visual confirmation; Phase 1 final gate still needs manual review for representative targets.',
    },
  }

  await mkdir(opts.outDir, { recursive: true })
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const outPath = join(opts.outDir, `outlook-${stamp}.json`)
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`)

  console.table(report.summary)
  console.log(`[phase1] wrote sanitized report: ${outPath}`)
  console.log(`[phase1] automatedPass=${report.gate.automatedPass} (${report.gate.caveat})`)
}

main().catch((error) => {
  console.error(`[phase1] failed: ${error.stack || error.message}`)
  process.exitCode = 1
})
