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
  nodeText,
  recordProposedAction,
  safeNodeInfo,
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

function emailSignature(raw) {
  return raw.toLowerCase().replace(/\W+/g, ' ').slice(0, 180)
}

function emailForJson(email) {
  return { raw: email.raw, bounds: email.bounds, source: email.source }
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
        rows.push({ raw: text, bounds: box, source: 'simulang', node })
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

  if (process.env.APPROVED_ARCHIVE_INDEXES) {
    const approvedIndexes = process.env.APPROVED_ARCHIVE_INDEXES
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isInteger(x) && x > 0)
    return { approved: approvedIndexes.length > 0, approvedIndexes, source: 'APPROVED_ARCHIVE_INDEXES' }
  }

  if (process.env.APPROVE_ARCHIVE === '1') {
    return { approved: true, approvedIndexes: archiveItems.map((x) => x.index), source: 'APPROVE_ARCHIVE' }
  }

  if (!input.isTTY) return { approved: false, note: 'No TTY available for approval; wrote proposal but will not archive. To approve explicitly, rerun with APPROVED_ARCHIVE_INDEXES=1,3 or APPROVE_ARCHIVE=1.' }

  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question(`\nApprove archiving archive_now list (${archiveItems.map((x) => `#${x.index}`).join(', ')})? This will move approved emails out of the unread list. [y/N] `)
    return { approved: /^y(es)?$/i.test(answer.trim()), approvedIndexes: archiveItems.map((x) => x.index) }
  } finally {
    rl.close()
  }
}

function buildArchiveTargets(emails, triage, approvedIndexes = null) {
  const byIndex = new Map(emails.map((email, i) => [i + 1, email]))
  const archiveItems = triage.archive_now ?? []
  const allowed = approvedIndexes ? new Set(approvedIndexes) : null

  return archiveItems
    .filter((item) => !allowed || allowed.has(item.index))
    .map((item) => {
      const email = byIndex.get(item.index)
      if (!email) return null
      return {
        index: item.index,
        reason: item.reason,
        signature: emailSignature(email.raw),
        email,
      }
    })
    .filter(Boolean)
}

function writeArchiveProposal(emails, triage) {
  const targets = buildArchiveTargets(emails, triage)
  if (!targets.length) {
    writeFileSync(join(RUN_DIR, 'proposed-actions.json'), JSON.stringify({
      proposalId: new Date().toISOString().replace(/[:.]/g, '-'),
      mode: 'dry_run',
      actions: [],
      note: 'No archive_now targets proposed.',
    }, null, 2))
    return targets
  }

  for (const target of targets) {
    recordProposedAction(RUN_DIR, {
      action: 'archive_email',
      riskLevel: RISK_LEVELS.StateChanging,
      target: {
        index: target.index,
        raw: target.email.raw,
        bounds: target.email.bounds,
      },
      evidence: {
        triageReason: target.reason,
        signature: target.signature,
      },
      reason: 'Pi classified this unread email as archive_now.',
    })
  }
  return targets
}

function findArchiveButton() {
  const w = latestOutlookWindow()
  const candidates = w.scoredSearch(
    TraversalOrder.BreadthFirst,
    2500,
    true,
    'Archive button move selected email message to archive',
    0.04,
  )

  const candidateDescriptions = candidates.slice(0, 12).map((node, index) => ({ index, ...safeNodeInfo(node) }))
  writeFileSync(join(RUN_DIR, 'archive-button-candidates.json'), JSON.stringify(candidateDescriptions, null, 2))

  return candidates.find((node) => {
    const info = safeNodeInfo(node)
    const text = nodeText(info)
    const box = info.boundingBox
    return /\barchive\b/i.test(text)
      && /button/i.test([info.localizedControlType, info.overallDescription].filter(Boolean).join(' '))
      && (!box || box.top < 260)
  })
}

function findEmailBySignature(signature) {
  return collectEmailCandidates().find((email) => emailSignature(email.raw) === signature)
}

async function archiveApprovedEmails(emails, triage, approval) {
  const proposalTargets = buildArchiveTargets(emails, triage)
  if (!proposalTargets.length) {
    const result = { approved: false, attempted: 0, archived: 0, note: 'No archive_now targets.' }
    writeFileSync(join(RUN_DIR, 'archive-result.json'), JSON.stringify(result, null, 2))
    return result
  }
  if (!approval.approved) {
    const result = { approved: false, attempted: 0, archived: 0, proposed: proposalTargets.length, note: approval.note ?? 'Archive not approved.' }
    writeFileSync(join(RUN_DIR, 'archive-result.json'), JSON.stringify(result, null, 2))
    return result
  }

  const targets = buildArchiveTargets(emails, triage, approval.approvedIndexes)
  const result = { approved: true, attempted: targets.length, archived: 0, verifiedGone: 0, failures: [] }

  for (const target of targets.slice().sort((a, b) => b.index - a.index)) {
    console.log(`Archiving approved email #${target.index}: ${target.reason}`)

    try {
      const currentEmail = findEmailBySignature(target.signature) ?? target.email
      currentEmail.node.activate()
      await sleep(800)

      const archiveButton = findArchiveButton()
      if (!archiveButton) throw new Error('archive_button_not_found')

      archiveButton.activate()
      await sleep(1500)
      result.archived++

      const remaining = collectEmailCandidates()
      const stillPresent = remaining.some((email) => emailSignature(email.raw) === target.signature)
      if (stillPresent) throw new Error('archive_verification_failed_email_still_visible')
      result.verifiedGone++
    } catch (err) {
      result.failures.push({ index: target.index, error: err?.message ?? String(err), raw: target.email.raw })
    }
  }

  writeFileSync(join(RUN_DIR, 'archive-result.json'), JSON.stringify(result, null, 2))
  if (result.failures.length) throw new Error(`Failed to archive ${result.failures.length}/${targets.length} approved emails`)
  return result
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

writeFileSync(OUT, JSON.stringify({ query: QUERY, limit: LIMIT, count: emails.length, emails: emails.map(emailForJson) }, null, 2))
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
    writeArchiveProposal(emails, triage)
    console.log(`\nArchive proposal saved → ${join(RUN_DIR, 'proposed-actions.json')}`)

    const approval = await askApproval(triage)
    writeFileSync(join(RUN_DIR, 'approval.json'), JSON.stringify(approval, null, 2))
    console.log(`\nApproval saved → ${join(RUN_DIR, 'approval.json')}`)
    if (approval.note) console.log(approval.note)

    const archiveResult = await step(
      'archive approved emails',
      async () => archiveApprovedEmails(emails, triage, approval),
      async (result) => {
        if (approval.approved && result.archived !== result.attempted) {
          throw new Error(`Archived ${result.archived}/${result.attempted} approved emails`)
        }
      },
    )

    writeFileSync(join(RUN_DIR, 'result.json'), JSON.stringify({
      ok: true,
      app: 'Microsoft Outlook',
      goal: 'triage_unread_emails_and_archive_approved',
      mode: approval.approved ? 'execute-with-user-approval' : POLICY.mode,
      riskLevel: approval.approved ? RISK_LEVELS.StateChanging : RISK_LEVELS.ObserveOnly,
      phase: 'complete',
      artifactsDir: RUN_DIR,
      outputs: {
        emails: OUT,
        triage: join(RUN_DIR, 'pi-triage.json'),
        proposal: join(RUN_DIR, 'proposed-actions.json'),
        approval: join(RUN_DIR, 'approval.json'),
        archiveResult: join(RUN_DIR, 'archive-result.json'),
      },
      verification: {
        ok: true,
        reason: approval.approved ? 'approved_archive_attempted' : 'triage_completed_without_archive_approval',
        signals: {
          candidateCount: emails.length,
          archiveNowCount: triage.archive_now?.length ?? 0,
          needsAttentionCount: triage.needs_attention?.length ?? 0,
          unsureCount: triage.unsure?.length ?? 0,
          approval,
          archiveResult,
        },
      },
    }, null, 2))
  } catch (err) {
    writeFileSync(join(RUN_DIR, 'pi-triage-error.txt'), err?.stack ?? String(err))
    console.error(`\nPi triage failed; details saved → ${join(RUN_DIR, 'pi-triage-error.txt')}`)
    console.error(err?.message ?? err)
  }
}

try { instance.disableAccessibility() } catch {}
