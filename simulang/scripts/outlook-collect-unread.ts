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
    STEAL_FOCUS,
    chord,
    createRunDir,
    createStepRunner,
    findApp,
    safeNodeInfo,
    getWindowsForPid,
    sleep,
} from './workflow-utils.ts'

const LIMIT = Number(process.env.LIMIT ?? 10)
const QUERY = process.env.OUTLOOK_SEARCH_QUERY ?? 'isread:no'
const RUN_DIR = createRunDir('outlook-collect-unread')
const OUT = join(RUN_DIR, 'emails.json')

const keyboard = new KeyboardController()
const clipboard = new Clipboard()
let outlookPid = 0
const step = createStepRunner(RUN_DIR, () => ({ pid: outlookPid, window: outlookWindow }))

function outlookWindow() {
    const windows = getWindowsForPid(outlookPid)
    if (!windows.length) throw new Error(`No visible windows for pid ${outlookPid}`)
    const match = windows.find((w) => /outlook|inbox|mail|search/i.test(w.title))
        ?? windows.find((w) => w.title.trim())
        ?? windows[0]
    return match.window
}

function allText(node: any, depth = 0): string[] {
    const parts = [node.name, node.value, node.description]
        .map((x) => (x ?? '').trim())
        .filter(Boolean)
    if (depth >= 3) return parts
    for (const child of node.children()) parts.push(...allText(child, depth + 1))
    return parts
}

function looksLikeMessageRow(text: string) {
    if (text.length < 25 || text.length > 900) return false
    if (/\b(new mail|reply all|forward|archive|delete|settings|calendar|people)\b/i.test(text)) return false
    return /@|\bunread\b|\b(today|yesterday|mon|tue|wed|thu|fri|sat|sun)\b|\b\d{1,2}:\d{2}/i.test(text)
}

function collectEmailCandidates() {
    const root = AccessibilityNode.fromPid(outlookPid)
    const rows: any[] = []
    const seen = new Set<string>()

    function walk(node: any, depth = 0, inMessageList = false) {
        let info: any
        try { info = safeNodeInfo(node) } catch { info = {} }
        const box = info.boundingBox ?? { left: 0, top: 0, right: 0, bottom: 0 }
        const actions: string[] = info.actions ?? []
        const nowInMessageList = inMessageList || /\bmessage list\b/i.test(info.overallDescription ?? '')

        const text = [...new Set(allText(node))].join(' | ').replace(/\s+/g, ' ').trim()
        const w = box.right - box.left
        const h = box.bottom - box.top

        if (nowInMessageList && actions.includes('AXPress') && w > 250 && h >= 18 && h <= 180 && looksLikeMessageRow(text)) {
            const signature = text.toLowerCase().replace(/\W+/g, ' ').slice(0, 180)
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
    STEAL_FOCUS ? 'open and focus Outlook' : 'open Outlook without stealing focus',
    async () => {
        const { exact_match, fuzzy_match } = findApp('Microsoft Outlook')
        const app = exact_match ?? fuzzy_match
        const inst = app.open(null, STEAL_FOCUS ? FocusPolicy.Steal : FocusPolicy.DoNotSteal, Visibility.Show, true)
        await sleep(2500)
        if (STEAL_FOCUS) inst.focus()
        inst.enableAccessibility()
        outlookPid = inst.pid
        await sleep(1000)
        return inst
    },
    async () => {
        if (!outlookPid) throw new Error('Outlook pid was 0/unknown')
        outlookWindow()
    },
)

await step(
    'search unread mail',
    async () => {
        const w = outlookWindow()
        const [search] = w.scoredSearch(
            TraversalOrder.BreadthFirst,
            2000,
            true,
            'search mail messages field',
            0.04,
        )

        const result = { usedSearchNode: Boolean(search), searchEcho: '', usedFallback: false, submittedWithReturn: false, stealFocus: STEAL_FOCUS }

        if (search) {
            if (STEAL_FOCUS) {
                search.focus()
                await sleep(200)
            }
            try {
                search.setValue(QUERY)
            } catch (err) {
                if (!STEAL_FOCUS) throw new Error(`AX setValue failed and clipboard fallback requires STEAL_FOCUS=1: ${err instanceof Error ? err.message : String(err)}`)
                clipboard.pasteText(QUERY)
            }
            try { result.searchEcho = [search.name, search.value, search.description].filter(Boolean).join(' | ') } catch { }
        } else {
            if (!STEAL_FOCUS) throw new Error('No AX search node found; keyboard fallback requires STEAL_FOCUS=1')
            result.usedFallback = true
            chord(keyboard, [Key.Meta, Key.Option], Key.F)
            await sleep(400)
            chord(keyboard, [Key.Meta], Key.A)
            clipboard.pasteText(QUERY)
        }

        if (STEAL_FOCUS) {
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

const serialized = emails.map((email, index) => ({
    index: index + 1,
    raw: email.raw,
    signature: email.signature,
    bounds: email.bounds,
    source: email.source,
}))
writeFileSync(OUT, JSON.stringify({ query: QUERY, limit: LIMIT, count: serialized.length, emails: serialized }, null, 2))
writeFileSync(join(RUN_DIR, 'result.json'), JSON.stringify({
    ok: true,
    app: 'Microsoft Outlook',
    goal: 'collect_unread_email_candidates',
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
