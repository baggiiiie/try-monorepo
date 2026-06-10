// Run: simulang run teams-calendar.mts
//
// Opens Microsoft Teams, finds the "Calendar" button in the Teams UI,
// and presses it.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AccessibilityNode,
  App,
  FocusPolicy,
  Screen,
  System,
  TraversalOrder,
  Visibility,
  Window,
  screenshotFull,
} from '@simular-ai/simulang-js'

const RUN_DIR = join(process.cwd(), '.runs', `teams-calendar-${new Date().toISOString().replace(/[:.]/g, '-')}`)
mkdirSync(RUN_DIR, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let teamsPid = 0
let stepIndex = 0

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function teamsApp() {
  for (const name of ['Microsoft Teams', 'Microsoft Teams classic', 'Microsoft Teams (work or school)']) {
    if (App.exists(name)) return App.exactName(name)
  }
  return System.fuzzySearch('Teams')
}

function latestTeamsWindow() {
  const windows = Window.allForPid(teamsPid)
  if (!windows.length) throw new Error(`No visible Teams windows for pid ${teamsPid}`)

  return windows.find((w) => /teams|calendar|chat|activity/i.test(w.title))
    ?? windows.find((w) => w.title.trim())
    ?? windows[0]
}

function dumpDiagnostics(label, err) {
  const dir = join(RUN_DIR, label)
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

  console.error(`Diagnostics saved to ${dir}`)
}

async function step(name, action, verify) {
  const id = `${String(++stepIndex).padStart(2, '0')}-${slug(name)}`
  console.log(`\n▶ ${id}`)
  try {
    const result = await action()
    if (verify) await verify(result)
    console.log(`✓ ${id}`)
    return result
  } catch (err) {
    console.error(`✗ ${id}: ${err?.message ?? err}`)
    dumpDiagnostics(id, err)
    throw err
  }
}

function safeNodeInfo(node) {
  const info = {}
  for (const key of ['role', 'className', 'localizedControlType', 'name', 'value', 'description', 'helpText', 'overallDescription', 'isEnabled']) {
    try { info[key] = node[key] } catch { info[key] = null }
  }
  try { info.boundingBox = node.boundingBox() } catch { info.boundingBox = null }
  try { info.actions = node.supportedActions() } catch { info.actions = [] }
  return info
}

function nodeText(info) {
  return [info.name, info.value, info.description, info.helpText, info.overallDescription]
    .filter(Boolean)
    .join(' ')
}

function collectVerificationSignals() {
  const titles = Window.allForPid(teamsPid).map((w) => w.title)
  const root = AccessibilityNode.fromPid(teamsPid)
  const matchingNodes = []
  let calendarNav = null
  let visited = 0

  function walk(node, depth = 0) {
    if (visited++ > 8000 || depth > 28) return

    let info
    try { info = safeNodeInfo(node) } catch { return }
    const text = nodeText(info)
    const isCalendarNav = /\bCalendar\s*\(⌘\s*4\)/i.test(text)
    const isCalendarSignal = /Calendar \| Microsoft Teams|Calendar - .* - Outlook|outlook\.office\.com\/hosted\/calendar|selected date|work week selected|change the view of your calendar|new meeting|meet now|today/i.test(text)

    if (isCalendarNav || isCalendarSignal) {
      matchingNodes.push({ depth, isCalendarNav, isCalendarSignal, ...info })
    }

    if (isCalendarNav) {
      const box = info.boundingBox
      const looksLikeLeftRail = box && box.left <= 120 && box.right <= 140
      const looksLikeToggle = /toggle|checkbox/i.test([info.className, info.localizedControlType, info.overallDescription].filter(Boolean).join(' '))
      if (!calendarNav || (looksLikeLeftRail && looksLikeToggle)) calendarNav = { depth, ...info }
    }

    let children = []
    try { children = node.children() } catch {}
    for (const child of children) walk(child, depth + 1)
  }

  walk(root)

  const navText = calendarNav ? nodeText(calendarNav) : ''
  const explicitSelectedNav = /\b(selected|current|active|checked|on)\b/i.test(navText)
  const calendarWindowTitle = titles.some((title) => /^Calendar \| Microsoft Teams/i.test(title))
  const calendarPageSignalCount = matchingNodes.filter((node) => node.isCalendarSignal).length
  const calendarPageVisible = calendarWindowTitle || calendarPageSignalCount > 0

  return {
    titles,
    visited,
    calendarNavFound: Boolean(calendarNav),
    explicitSelectedNav,
    calendarWindowTitle,
    calendarPageSignalCount,
    calendarPageVisible,
    // Teams on macOS exposes its left-rail apps as AXToggleButton/checkboxes,
    // but in this build it does not expose a useful AXValue for checked state.
    // So: explicit selected text is ideal; otherwise infer Calendar nav selection
    // from the exact Calendar nav item still existing plus Calendar route/page UI.
    inferredCalendarNavSelected: Boolean(calendarNav) && (explicitSelectedNav || calendarPageVisible),
    calendarNav,
    samples: matchingNodes.slice(0, 30),
  }
}

async function verifyCalendarNavSelected() {
  const attempts = []
  const deadline = Date.now() + 8000

  while (Date.now() < deadline) {
    const signals = collectVerificationSignals()
    attempts.push(signals)

    if (signals.inferredCalendarNavSelected) {
      writeFileSync(join(RUN_DIR, 'calendar-verification.json'), JSON.stringify({ attempts }, null, 2))
      const reason = signals.explicitSelectedNav ? 'explicit selected/current text on nav item' : 'Calendar nav item + Calendar page/route signals'
      console.log(`Calendar verification passed via ${reason}.`)
      return
    }

    await sleep(500)
  }

  writeFileSync(join(RUN_DIR, 'calendar-verification.json'), JSON.stringify({ attempts }, null, 2))
  const last = attempts.at(-1)
  throw new Error(
    `Clicked Calendar, but could not verify selected Calendar nav state. `
    + `navFound=${last?.calendarNavFound}, title=${JSON.stringify(last?.titles)}, `
    + `pageSignals=${last?.calendarPageSignalCount}`,
  )
}

const instance = await step(
  'open and focus Teams',
  async () => {
    const app = teamsApp()
    const inst = app.open(null, FocusPolicy.Steal, Visibility.Show, true)
    await sleep(3500)
    inst.focus()
    inst.enableAccessibility()
    teamsPid = inst.pid
    await sleep(1500)
    return inst
  },
  async () => {
    if (!teamsPid) throw new Error('Teams pid was 0/unknown')
    latestTeamsWindow()
  },
)

await step(
  'click Calendar button',
  async () => {
    const w = latestTeamsWindow()
    const candidates = w.scoredSearch(
      TraversalOrder.BreadthFirst,
      4000,
      true,
      'Calendar button meetings schedule Teams left rail',
      0.04,
    )

    const candidateDescriptions = candidates.slice(0, 12).map((node, index) => ({
      index,
      ...safeNodeInfo(node),
    }))
    writeFileSync(join(RUN_DIR, 'calendar-candidates.json'), JSON.stringify(candidateDescriptions, null, 2))

    const calendar = candidates.find((node) => {
      const text = [node.name, node.value, node.description].filter(Boolean).join(' ')
      return /\bcalendar\b/i.test(text)
    }) ?? candidates[0]

    if (!calendar) throw new Error('Could not find the Calendar button')

    try { calendar.focus() } catch {}
    await sleep(150)
    calendar.activate()
    await sleep(2000)
    return calendar
  },
  async () => {
    const titles = Window.allForPid(teamsPid).map((w) => w.title)
    writeFileSync(join(RUN_DIR, 'windows-after-click.json'), JSON.stringify(titles, null, 2))
    await verifyCalendarNavSelected()
  },
)

try { instance.disableAccessibility() } catch {}

console.log(`\nDone. Artifacts saved in ${RUN_DIR}`)
