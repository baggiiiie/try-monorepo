// Run with an approved-actions file:
//   EXECUTE=1 STEAL_FOCUS=1 APPROVED_ACTIONS_FILE=.runs/.../approved-actions.json simulang run outlook-archive-approved.mts
//
// Or let this helper build the approved-actions plan from collector output:
//   EXECUTE=1 STEAL_FOCUS=1 SOURCE_EMAILS_FILE=.runs/.../emails.json APPROVED_INDEXES=5,6 simulang run outlook-archive-approved.mts
//
// State-changing helper for Pi skills: archive exactly the approved Outlook
// messages. This script does not decide what should be archived; it only
// executes explicit approved targets and verifies that each target disappears
// from the unread message list.

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
    AccessibilityNode,
    Button,
    Coordinate,
    Direction,
    FocusPolicy,
    MouseController,
    Visibility,
} from '@simular-ai/simulang-js'
import {
    STEAL_FOCUS,
    createRunDir,
    createStepRunner,
    findApp,
    latestWindowForPid,
    nodeText,
    safeNodeInfo,
    sleep,
} from './workflow-utils.ts'

const APPROVED_ACTIONS_FILE = process.env.APPROVED_ACTIONS_FILE
const SOURCE_EMAILS_FILE = process.env.SOURCE_EMAILS_FILE
const APPROVED_INDEXES = process.env.APPROVED_INDEXES
const RUN_DIR = createRunDir('outlook-archive-approved')

const mouse = new MouseController()
let outlookPid = 0
const step = createStepRunner(RUN_DIR, () => ({ pid: outlookPid, latestWindow: latestOutlookWindow }))

function latestOutlookWindow() {
    return latestWindowForPid(outlookPid, /outlook|inbox|mail|search/i)
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

function emailSignature(raw: string) {
    return raw.toLowerCase().replace(/\W+/g, ' ').slice(0, 180)
}

function collectEmailCandidates(limit = 100) {
    const root = AccessibilityNode.fromPid(outlookPid)
    const rows: any[] = []
    const seen = new Set<string>()

    function walk(node: any, depth = 0, inMessageList = false) {
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
                rows.push({ raw: text, signature, bounds: box, source: 'simulang-message-list', node })
            }
        }

        if (depth < 16) for (const child of node.children()) walk(child, depth + 1, nowInMessageList)
    }

    walk(root)
    return rows.sort((a, b) => a.bounds.top - b.bounds.top).slice(0, limit)
}

function parseApprovedIndexes(value?: string) {
    if (!value) return []
    return value
        .split(',')
        .map((x) => Number(x.trim()))
        .filter((x) => Number.isInteger(x) && x > 0)
}

function normalizeArchiveActions(doc: any, path: string) {
    const actions = doc.actions ?? []
    const archiveActions = actions
        .filter((action) => action.action === 'archive_email')
        .map((action, i) => {
            const raw = action.target?.raw ?? action.raw
            const signature = action.target?.signature ?? action.evidence?.signature ?? action.signature ?? (raw ? emailSignature(raw) : null)
            return {
                approvalIndex: i + 1,
                index: action.target?.index ?? action.index,
                reason: action.reason ?? action.evidence?.triageReason ?? '',
                raw,
                signature,
            }
        })
        .filter((action) => action.signature)

    if (!archiveActions.length) throw new Error(`No archive_email actions found in ${path}`)
    return { path, doc, actions: archiveActions }
}

function buildApprovedActionsFromIndexes() {
    if (!SOURCE_EMAILS_FILE) throw new Error('SOURCE_EMAILS_FILE is required when APPROVED_ACTIONS_FILE is not set')
    const approvedIndexes = parseApprovedIndexes(APPROVED_INDEXES)
    if (!approvedIndexes.length) throw new Error('APPROVED_INDEXES is required when APPROVED_ACTIONS_FILE is not set')

    const sourcePath = resolve(SOURCE_EMAILS_FILE)
    const source = JSON.parse(readFileSync(sourcePath, 'utf8'))
    const byIndex = new Map<number, any>((source.emails ?? []).map((email: any) => [email.index, email]))
    const missing = approvedIndexes.filter((index) => !byIndex.has(index))
    if (missing.length) throw new Error(`Approved indexes not found in SOURCE_EMAILS_FILE: ${missing.join(', ')}`)

    const doc = {
        approvedBy: 'user',
        approvedAt: new Date().toISOString(),
        sourceEmailsFile: sourcePath,
        approvedIndexes,
        actions: approvedIndexes.map((index) => {
            const email: any = byIndex.get(index)
            return {
                action: 'archive_email',
                reason: `User approved archiving email #${index}.`,
                target: {
                    index,
                    signature: email.signature ?? emailSignature(email.raw),
                    raw: email.raw,
                },
            }
        }),
    }

    const generatedPath = join(RUN_DIR, 'approved-actions.generated.json')
    writeFileSync(generatedPath, JSON.stringify(doc, null, 2))
    return normalizeArchiveActions(doc, generatedPath)
}

function loadApprovedActions() {
    if (!APPROVED_ACTIONS_FILE) return buildApprovedActionsFromIndexes()

    const path = resolve(APPROVED_ACTIONS_FILE)
    const doc = JSON.parse(readFileSync(path, 'utf8'))
    return normalizeArchiveActions(doc, path)
}

function findEmailBySignature(signature: string) {
    const rows = collectEmailCandidates()
    return rows.find((email) => email.signature === signature)
        ?? rows.find((email) => email.raw.toLowerCase().includes(signature.slice(0, 80)))
}

function clickEmailRow(email: any) {
    try {
        email.node.activate()
        return { method: 'AX activate' }
    } catch (err) {
        if (!STEAL_FOCUS) throw err
        const box = email.bounds
        const x = Math.round((box.left + box.right) / 2)
        const y = Math.round((box.top + box.bottom) / 2)
        mouse.moveMouse(x, y, Coordinate.Abs)
        mouse.button(Button.Left, Direction.Click)
        return { method: 'mouse click', x, y, activateError: err instanceof Error ? err.message : String(err) }
    }
}

function findArchiveButton() {
    const root = AccessibilityNode.fromPid(outlookPid)
    const matches: any[] = []
    let found: any = null
    let visited = 0

    function walk(node: any, depth = 0) {
        if (found || visited++ > 8000 || depth > 18) return

        let info
        try { info = safeNodeInfo(node) } catch { return }
        const text = nodeText(info)
        const box = info.boundingBox
        const isButton = /button/i.test([info.localizedControlType, info.overallDescription].filter(Boolean).join(' '))
        const isArchive = /\barchive\b/i.test(text)
        const isToolbarish = !box || box.top < 280

        if (isArchive || /move|delete|toolbar/i.test(text)) matches.push({ depth, ...info })
        if (isArchive && isButton && isToolbarish) {
            found = node
            return
        }

        let children: any[] = []
        try { children = node.children() } catch { }
        for (const child of children) walk(child, depth + 1)
    }

    walk(root)
    writeFileSync(join(RUN_DIR, 'archive-button-candidates.json'), JSON.stringify(matches.slice(0, 30), null, 2))
    return found
}

const approval = loadApprovedActions()

const instance = await step(
    STEAL_FOCUS ? 'open and focus Outlook' : 'open Outlook without stealing focus',
    async () => {
        const app = findApp(['Microsoft Outlook'], 'Outlook')
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
        latestOutlookWindow()
    },
)

const archiveResult = await step(
    'archive approved emails',
    async () => {
        const result: any = { approvedActionsFile: approval.path, attempted: approval.actions.length, archived: 0, verifiedGone: 0, failures: [], selections: [] }

        for (const action of approval.actions.slice().sort((a, b) => (b.index ?? 0) - (a.index ?? 0))) {
            console.log(`Archiving approved email${action.index ? ` #${action.index}` : ''}: ${action.reason}`)
            try {
                const email = findEmailBySignature(action.signature)
                if (!email) throw new Error('approved_email_not_found_in_current_unread_list')

                const selection = clickEmailRow(email)
                result.selections.push({ index: action.index, ...selection })
                await sleep(1200)

                const archiveButton = findArchiveButton()
                if (!archiveButton) throw new Error('archive_button_not_found')

                archiveButton.activate()
                await sleep(1500)
                result.archived++

                const stillPresent = Boolean(findEmailBySignature(action.signature))
                if (stillPresent) throw new Error('archive_verification_failed_email_still_visible')
                result.verifiedGone++
            } catch (err) {
                result.failures.push({ index: action.index, error: err instanceof Error ? err.message : String(err), raw: action.raw })
            }
        }

        writeFileSync(join(RUN_DIR, 'archive-result.json'), JSON.stringify(result, null, 2))
        if (result.failures.length) throw new Error(`Failed to archive ${result.failures.length}/${approval.actions.length} approved emails`)
        return result
    },
    async (result) => {
        if (result.archived !== result.attempted) throw new Error(`Archived ${result.archived}/${result.attempted} approved emails`)
    },
)

writeFileSync(join(RUN_DIR, 'result.json'), JSON.stringify({
    ok: true,
    app: 'Microsoft Outlook',
    goal: 'archive_approved_unread_emails',
    phase: 'complete',
    artifactsDir: RUN_DIR,
    inputs: { approvedActionsFile: approval.path },
    outputs: { archiveResult: join(RUN_DIR, 'archive-result.json') },
    verification: {
        ok: true,
        reason: 'approved_targets_archived_and_verified_gone',
        signals: archiveResult,
    },
}, null, 2))

try { instance.disableAccessibility() } catch { }
console.log(`\nDone. Artifacts saved in ${RUN_DIR}`)
