// Run: simulang run teams-calendar.mts
//
// Opens Microsoft Teams, finds the "Calendar" button in the Teams UI,
// and presses it.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AccessibilityNode,
  FocusPolicy,
  Key,
  KeyboardController,
  TraversalOrder,
  Visibility,
  Window,
} from '@simular-ai/simulang-js'
import {
  RISK_LEVELS,
  chord,
  createRunDir,
  createSafetyPolicy,
  createStepRunner,
  findApp,
  latestWindowForPid,
  nodeText,
  runStrategies,
  safeNodeInfo,
  sleep,
} from './workflow-utils.mts'

const RUN_DIR = createRunDir('teams-calendar')
const POLICY = createSafetyPolicy()
let teamsPid = 0
const keyboard = new KeyboardController()
const step = createStepRunner(RUN_DIR, () => ({ pid: teamsPid, latestWindow: latestTeamsWindow }))

function teamsApp() {
  return findApp(['Microsoft Teams', 'Microsoft Teams classic', 'Microsoft Teams (work or school)'], 'Teams')
}

function latestTeamsWindow() {
  return latestWindowForPid(teamsPid, /teams|calendar|chat|activity/i)
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

async function verifyCalendarNavSelected(strategy) {
  const attempts = []
  const deadline = Date.now() + 8000

  while (Date.now() < deadline) {
    const signals = collectVerificationSignals()
    attempts.push(signals)

    if (signals.inferredCalendarNavSelected) {
      const reason = signals.explicitSelectedNav ? 'explicit_selected_nav' : 'calendar_nav_plus_page_signals'
      const result = { ok: true, reason, strategy, signals, attempts }
      writeFileSync(join(RUN_DIR, 'calendar-verification.json'), JSON.stringify(result, null, 2))
      console.log(`Calendar verification passed via ${reason}.`)
      return result
    }

    await sleep(500)
  }

  const last = attempts.at(-1)
  const reason = !last?.calendarNavFound
    ? 'calendar_nav_not_found'
    : !last?.calendarPageVisible
      ? 'calendar_nav_found_but_page_signals_missing'
      : 'verification_timeout'
  const result = { ok: false, reason, strategy, signals: last, attempts }
  writeFileSync(join(RUN_DIR, 'calendar-verification.json'), JSON.stringify(result, null, 2))
  return result
}

async function clickCalendarByAxSearch() {
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
    const info = safeNodeInfo(node)
    const text = nodeText(info)
    const box = info.boundingBox
    return /\bCalendar\s*\(⌘\s*4\)/i.test(text) && box && box.left <= 120 && box.right <= 140
  })

  if (!calendar) throw new Error('calendar_nav_button_not_found')

  const selectedCandidate = safeNodeInfo(calendar)
  if (POLICY.stealFocus) try { calendar.focus() } catch {}
  await sleep(150)
  calendar.activate()
  await sleep(2000)
  return { candidateCount: candidates.length, selectedCandidate }
}

async function pressTeamsCalendarShortcut() {
  if (!POLICY.stealFocus) throw new Error('cmd_4_shortcut_requires_STEAL_FOCUS')
  latestTeamsWindow()
  chord(keyboard, [Key.Meta], Key.Num4)
  await sleep(2500)
  return { shortcut: 'Cmd+4' }
}

const instance = await step(
  POLICY.stealFocus ? 'open and focus Teams' : 'open Teams without stealing focus',
  async () => {
    const app = teamsApp()
    const inst = app.open(null, POLICY.stealFocus ? FocusPolicy.Steal : FocusPolicy.DoNotSteal, Visibility.Show, true)
    await sleep(3500)
    if (POLICY.stealFocus) inst.focus()
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
  'navigate to Calendar',
  async () => runStrategies({
    app: 'Microsoft Teams',
    goal: 'open_calendar',
    runDir: RUN_DIR,
    policy: POLICY,
    riskLevel: RISK_LEVELS.ReversibleNavigation,
    strategies: [
      { name: 'already-on-calendar', run: async () => ({ noop: true }) },
      { name: 'ax-search-click-calendar-nav', run: clickCalendarByAxSearch },
      { name: 'cmd-4-calendar-shortcut', run: pressTeamsCalendarShortcut },
    ],
    verify: ({ strategy }) => verifyCalendarNavSelected(strategy),
    suggestedNextSteps: [
      'inspect result.json and calendar-verification.json',
      'inspect calendar-candidates.json for renamed Calendar/Schedule/Meetings nav items',
      'inspect screen.png if diagnostics were captured',
      'update or add a strategy if Teams changed its left-rail navigation',
      'rerun with STEAL_FOCUS=1 only if the keyboard shortcut fallback is needed',
    ],
  }),
  async (result) => {
    const titles = Window.allForPid(teamsPid).map((w) => w.title)
    writeFileSync(join(RUN_DIR, 'windows-after-click.json'), JSON.stringify(titles, null, 2))
    if (!result.ok) throw new Error(result.reason ?? 'open_calendar_failed')
  },
)

try { instance.disableAccessibility() } catch {}

console.log(`\nDone. Artifacts saved in ${RUN_DIR}`)
