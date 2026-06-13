// Run: simulang run outlook-collect-unread.mts
//
// Observe-only helper for Pi skills: open Outlook, search unread mail, collect
// candidate message-list rows, and write emails.json + result.json. This script
// does not classify, ask for approval, or archive anything.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
    safeNodeInfo,
    sleep,
} from './workflow-utils.ts'

const LIMIT = Number(process.env.LIMIT ?? 10)
const QUERY = process.env.OUTLOOK_SEARCH_QUERY ?? 'isread:no'
const POLICY = createSafetyPolicy()
const RUN_DIR = createRunDir('outlook-collect-unread')
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
    return latestWindowForPid(outlookPid, /outlook|inbox|mail|search/i)
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

function emailForJson(email, index) {
    return {
        index: index + 1,
        raw: email.raw,
        signature: email.signature,
        bounds: email.bounds,
        source: email.source,
    }
}

function collectEmailCandidates() {
    const root = AccessibilityNode.fromPid(outlookPid)
    const rows = []
    const seen = new Set()

    function walk(node, depth = 0, inMessageList = false) {
        let box
        try { box = node.boundingBox() } catch { box = { left: 0, top: 0, right: 0, bottom: 0 } }

        let info
        try { info = safeNodeInfo(node) } catch { info = {} }
        const nodeSummary = nodeText(info)
        const nowInMessageList = inMessageList || /\bmessage list\b/i.test(nodeSummary)
        const actions = info.actions ?? []

        const text = [...new Set(allText(node))].join(' | ').replace(/\s+/g, ' ').trim()
        const h = box.bottom - box.top
        const w = box.right - box.left

        if (nowInMessageList && actions.includes('AXPress') && w > 250 && h >= 18 && h <= 180 && looksLikeMessageRow(text)) {
            const signature = emailSignature(text)
            if (!seen.has(signature)) {
                seen.add(signature)
                rows.push({ raw: text, signature, bounds: box, source: 'simulang-message-list' })
            }
        }

        if (depth < 16) for (const child of node.children()) walk(child, depth + 1, nowInMessageList)
    }

    walk(root)
    return rows.sort((a, b) => a.bounds.top - b.bounds.top).slice(0, LIMIT)
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
        latestOutlookWindow()
    },
)

await step(
    'search unread mail',
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
            try { result.searchEcho = [search.name, search.value, search.description].filter(Boolean).join(' | ') } catch { }
        } else {
            if (!POLICY.stealFocus) throw new Error('No AX search node found; keyboard fallback requires STEAL_FOCUS=1')
            result.usedFallback = true
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
        return result
    },
    async (result) => {
        if (!result.usedSearchNode && !result.usedFallback) throw new Error('Neither AX search node nor keyboard fallback was used')
    },
)

const emails = await step(
    `collect up to ${LIMIT} unread email rows`,
    async () => collectEmailCandidates(),
    async (rows) => {
        if (!Array.isArray(rows)) throw new Error('collector did not return an array')
        if (rows.length === 0) throw new Error('collector found 0 unread email rows after search')
    },
)

const serialized = emails.map(emailForJson)
writeFileSync(OUT, JSON.stringify({ query: QUERY, limit: LIMIT, count: serialized.length, emails: serialized }, null, 2))
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
        signals: { query: QUERY, limit: LIMIT, count: serialized.length },
    },
}, null, 2))

console.log(`\nWrote ${serialized.length} candidates → ${OUT}`)
for (const email of serialized) console.log(`\n#${email.index}\n${email.raw}`)

try { instance.disableAccessibility() } catch { }
