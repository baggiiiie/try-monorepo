// Run: simulang run outlook-unread-experiment.mts
//
// Lightweight experiment: a self-debugging Outlook workflow.
// The idea is not to be perfect; it is to fail at the step whose
// postcondition is violated, dump diagnostics, and let the agent patch it.

import { writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'
import {
  AccessibilityNode,
  Clipboard,
  Direction,
  FocusPolicy,
  Key,
  KeyboardController,
  TraversalOrder,
  Visibility,
} from '@simular-ai/simulang-js'
import {
  RISK_LEVELS,
  createRunDir,
  createSafetyPolicy,
  createStepRunner,
  findApp,
  latestWindowForPid,
  sleep,
} from './workflow-utils.mts'

const LIMIT = Number(process.env.LIMIT ?? 10)
const QUERY = process.env.OUTLOOK_SEARCH_QUERY ?? 'isread:no'
const POLICY = createSafetyPolicy()
const RUN_DIR = createRunDir('outlook')
const OUT = join(RUN_DIR, 'emails.json')

const keyboard = new KeyboardController()
const clipboard = new Clipboard()
let outlookPid = 0
const step = createStepRunner(RUN_DIR, () => ({ pid: outlookPid, latestWindow: latestOutlookWindow }))

function chord(modifiers, key) {
  for (const m of modifiers) keyboard.key(m, Direction.Press)
  keyboard.key(key, Direction.Click)
  for (const m of modifiers.slice().reverse()) keyboard.key(m, Direction.Release)
}

function cmd(key) {
  chord([Key.Meta], key)
}

function latestOutlookWindow() {
  // Important: do not rank windows by calling snapshot() here. Outlook can be
  // temporarily busy after a search, and a full AX snapshot can block for a
  // long time. Pick a plausible visible/titled window cheaply instead.
  return latestWindowForPid(outlookPid, /outlook|inbox|mail/i)
}

function allText(node, depth = 0) {
  const parts = [node.name, node.value, node.description]
    .map((x) => (x ?? '').trim())
    .filter(Boolean)
  if (depth >= 3) return parts
  for (const child of node.children()) parts.push(...allText(child, depth + 1))
  return parts
}

function looksLikeMessageRow(text) {
  if (text.length < 25 || text.length > 900) return false
  if (/\b(new mail|reply all|forward|archive|delete|settings|calendar|people)\b/i.test(text)) return false
  return /@|\bunread\b|\b(today|yesterday|mon|tue|wed|thu|fri|sat|sun)\b|\b\d{1,2}:\d{2}/i.test(text)
}

function collectEmailCandidates() {
  const root = AccessibilityNode.fromPid(outlookPid)
  const rows = []
  const seen = new Set()

  function walk(node, depth = 0) {
    let box
    try { box = node.boundingBox() } catch { box = { left: 0, top: 0, right: 0, bottom: 0 } }

    const text = [...new Set(allText(node))].join(' | ').replace(/\s+/g, ' ').trim()
    const h = box.bottom - box.top
    const w = box.right - box.left

    if (w > 250 && h >= 18 && h <= 180 && looksLikeMessageRow(text)) {
      const sig = text.toLowerCase().replace(/\W+/g, ' ').slice(0, 180)
      if (!seen.has(sig)) {
        seen.add(sig)
        rows.push({ raw: text, bounds: box, source: 'simulang' })
      }
    }

    // Outlook's message list can be deeper than the sidebar. Keep this bounded
    // so failed experiments still return quickly.
    if (depth < 14) for (const child of node.children()) walk(child, depth + 1)
  }

  walk(root)
  return rows.sort((a, b) => a.bounds.top - b.bounds.top).slice(0, LIMIT)
}

function askPiToTriageEmails(emails) {
  const inputJson = JSON.stringify({ emails: emails.map((email, i) => ({ index: i + 1, raw: email.raw })) }, null, 2)
  const message = `You are triaging unread Outlook emails for the user.

Classify each email into exactly one bucket:
- archive_now: routine notifications, FYI-only, automated status, duplicate/low-value updates that likely do not need attention.
- needs_attention: direct asks, meetings/invites that need a response, important human messages, blockers, security/incident/customer issues, or anything the user should read.
- unsure: not enough information or borderline.

Use the submit_email_triage tool as your final answer. Classify every input index exactly once.
Use short reasons. Do not quote full email content unless necessary.

Input emails:
${inputJson}`

  // JSON event stream mode gives us machine-readable Pi events. The tiny
  // extension supplies a typed final-output tool, so we read result.details
  // instead of scraping JSON out of assistant prose.
  const raw = execFileSync('pi', [
    '--mode', 'json',
    '--no-session',
    '--no-builtin-tools',
    '--no-context-files',
    '--no-skills',
    '--no-prompt-templates',
    '--no-extensions',
    '-e', join(process.cwd(), '.pi/extensions/email-triage-output.ts'),
    '--approve',
    message,
  ], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })

  writeFileSync(join(RUN_DIR, 'pi-triage.events.jsonl'), raw)

  let triage = null
  const events = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let event
    try { event = JSON.parse(line) } catch { continue }
    events.push(event)
    if (event.type === 'tool_execution_end' && event.toolName === 'submit_email_triage' && !event.isError) {
      triage = event.result?.details
    }
  }

  if (!triage) {
    const lastError = [...events].reverse().find((e) => e.type === 'tool_execution_end' && e.isError)
    throw new Error(`Pi did not submit structured triage${lastError ? `: ${JSON.stringify(lastError.result)}` : ''}`)
  }

  writeFileSync(join(RUN_DIR, 'pi-triage.json'), JSON.stringify(triage, null, 2))
  return triage
}

function printTriageList(triage) {
  console.log('\n── Pi triage ──')
  console.log(triage.summary ?? '')

  for (const bucket of ['archive_now', 'needs_attention', 'unsure']) {
    console.log(`\n${bucket}:`)
    const items = triage[bucket] ?? []
    if (!items.length) {
      console.log('  (none)')
      continue
    }
    for (const item of items) console.log(`  #${item.index}: ${item.reason}`)
  }
}

async function askApproval(triage) {
  const archiveItems = triage.archive_now ?? []
  if (!archiveItems.length) return { approved: false, note: 'No archive_now items to approve.' }
  if (!input.isTTY) return { approved: false, note: 'No TTY available for approval.' }

  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question(`\nApprove archive_now list (${archiveItems.map((x) => `#${x.index}`).join(', ')})? This records approval only; it does not archive yet. [y/N] `)
    return { approved: /^y(es)?$/i.test(answer.trim()), approvedIndexes: archiveItems.map((x) => x.index) }
  } finally {
    rl.close()
  }
}

const instance = await step(
  POLICY.stealFocus ? 'open and focus Outlook' : 'open Outlook without stealing focus',
  async () => {
    const app = findApp(['Microsoft Outlook'], 'Outlook')
    const inst = app.open(null, POLICY.stealFocus ? FocusPolicy.Steal : FocusPolicy.DoNotSteal, Visibility.Show, true)
    await sleep(2500)
    if (POLICY.stealFocus) inst.focus()
    inst.enableAccessibility()
    outlookPid = inst.pid
    await sleep(1000)
    return inst
  },
  async () => {
    if (!outlookPid) throw new Error('Outlook pid was 0/unknown')
    latestOutlookWindow() // asserts visible window exists
  },
)

await step(
  'focus Outlook search and submit unread query',
  async () => {
    const w = latestOutlookWindow()
    const [search] = w.scoredSearch(
      TraversalOrder.BreadthFirst,
      2000,
      true,
      'search mail messages field',
      0.04,
    )

    const result = { usedSearchNode: Boolean(search), searchEcho: '', usedFallback: false, submittedWithReturn: false, stealFocus: POLICY.stealFocus }

    if (search) {
      if (POLICY.stealFocus) {
        search.focus()
        await sleep(200)
      }
      try {
        search.setValue(QUERY)
      } catch (err) {
        if (!POLICY.stealFocus) throw new Error(`AX setValue failed and clipboard fallback requires STEAL_FOCUS=1: ${err?.message ?? err}`)
        clipboard.pasteText(QUERY)
      }

      // Lightweight postcondition for the "set query" part. Avoid a full
      // Outlook window snapshot here; that is what was hanging after Return.
      try {
        result.searchEcho = [search.name, search.value, search.description].filter(Boolean).join(' | ')
      } catch {}
    } else {
      if (!POLICY.stealFocus) throw new Error('No AX search node found; keyboard fallback requires STEAL_FOCUS=1')
      result.usedFallback = true
      // Fallback shortcut for Outlook on macOS.
      chord([Key.Meta, Key.Option], Key.F)
      await sleep(400)
      cmd(Key.A)
      clipboard.pasteText(QUERY)
    }

    if (POLICY.stealFocus) {
      keyboard.key(Key.Return, Direction.Click)
      result.submittedWithReturn = true
    } else {
      console.log('set search value without stealing focus; relying on Outlook live search/update')
    }
    writeFileSync(join(RUN_DIR, 'search-step.json'), JSON.stringify(result, null, 2))
    await sleep(3000)
    console.log('submitted search; skipping full AX snapshot in this step')
    return result
  },
  async (result) => {
    if (!result.usedSearchNode && !result.usedFallback) {
      throw new Error('Neither AX search node nor keyboard fallback was used')
    }
    if (result.searchEcho && !result.searchEcho.toLowerCase().includes(QUERY.toLowerCase())) {
      console.warn(`Search node did not echo query; continuing anyway. echo=${JSON.stringify(result.searchEcho)}`)
    }
  },
)

const emails = await step(
  `collect up to ${LIMIT} candidate unread email rows`,
  async () => collectEmailCandidates(),
  async (rows) => {
    if (!Array.isArray(rows)) throw new Error('collector did not return an array')
    if (rows.length === 0) throw new Error('collector found 0 unread email rows after search')
  },
)

writeFileSync(OUT, JSON.stringify({ query: QUERY, limit: LIMIT, count: emails.length, emails }, null, 2))
writeFileSync(join(RUN_DIR, 'result.json'), JSON.stringify({
  ok: true,
  app: 'Microsoft Outlook',
  goal: 'collect_unread_email_candidates',
  mode: POLICY.mode,
  riskLevel: RISK_LEVELS.ObserveOnly,
  phase: 'verify',
  artifactsDir: RUN_DIR,
  outputs: { emails: OUT },
  verification: {
    ok: true,
    reason: 'candidate_rows_found',
    signals: { query: QUERY, limit: LIMIT, count: emails.length },
  },
}, null, 2))
console.log(`\nWrote ${emails.length} candidates → ${OUT}`)
for (const [i, email] of emails.entries()) console.log(`\n#${i + 1}\n${email.raw}`)

if (process.env.TRIAGE_WITH_PI !== '0') {
  try {
    console.log('\nAsking pi to triage these emails…')
    const triage = askPiToTriageEmails(emails)
    printTriageList(triage)
    const approval = await askApproval(triage)
    writeFileSync(join(RUN_DIR, 'approval.json'), JSON.stringify(approval, null, 2))
    console.log(`\nApproval saved → ${join(RUN_DIR, 'approval.json')}`)
    if (approval.note) console.log(approval.note)
  } catch (err) {
    writeFileSync(join(RUN_DIR, 'pi-triage-error.txt'), err?.stack ?? String(err))
    console.error(`\nPi triage failed; details saved → ${join(RUN_DIR, 'pi-triage-error.txt')}`)
    console.error(err?.message ?? err)
  }
}

try { instance.disableAccessibility() } catch {}
