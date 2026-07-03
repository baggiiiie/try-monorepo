import {
  Button,
  Coordinate,
  Direction,
  MouseController,
  TraversalOrder,
} from '@simular-ai/simulang-js'

import { roleName } from '../../core/descriptor.mjs'
import { boxCenter, safe } from '../../core/util.mjs'

export const DEFAULT_EMAIL_COUNT = 3
export const DEFAULT_READ_DELAY_MS = 2500
export const DEFAULT_BODY_MAX_CHARS = 4000
const READ_POLL_MS = 250

const GROUP_HEADER_PATTERN = /^(Today|Yesterday|Last Week|Last Month|This Year),? Expanded$/i
const ZERO_WIDTH_PATTERN = /[\u034f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g
const URL_PATTERN = /https?:\/\/\S+/gi

export async function readTopInboxEmails(gui, {
  emailCount = DEFAULT_EMAIL_COUNT,
  maxNodes = 1000,
  readDelayMs = DEFAULT_READ_DELAY_MS,
  bodyMaxChars = DEFAULT_BODY_MAX_CHARS,
} = {}) {
  if (emailCount <= 0) return skippedEmailCheck()

  let table = findMessageTable(gui.scope, maxNodes)
  if (!table) {
    return {
      success: false,
      requested: emailCount,
      returned: 0,
      message: 'Could not find Outlook Message List table',
      emails: [],
    }
  }

  const initialCells = messageCells(table)
  const emails = []
  const count = Math.min(emailCount, initialCells.length)
  for (let index = 0; index < count; index += 1) {
    table = findMessageTable(gui.scope, maxNodes)
    const cells = table ? messageCells(table) : []
    const cell = cells[index]
    if (!cell) {
      emails.push({
        index: index + 1,
        success: false,
        message: 'Message row disappeared before selection',
      })
      continue
    }

    const row = parseRowSummary(nodeText(cell))
    const click = clickNodeCenter(cell)
    if (!click.success) {
      emails.push({
        index: index + 1,
        success: false,
        row,
        message: click.message,
      })
      continue
    }

    const refreshedTable = findMessageTable(gui.scope, maxNodes)
    const content = await readSelectedMessage(gui.scope, {
      maxNodes,
      tableBox: nodeBox(refreshedTable ?? table),
      bodyMaxChars,
      row,
      timeoutMs: readDelayMs,
    })

    emails.push({
      index: index + 1,
      success: content.success,
      row,
      selectedBy: click.method,
      clickPoint: click.point,
      content,
      message: content.success ? 'read from reading pane' : content.message,
    })
  }

  return {
    success: emails.length === emailCount && emails.every((email) => email.success),
    requested: emailCount,
    returned: emails.filter((email) => email.success).length,
    availableRows: initialCells.length,
    selectionMethod: 'mouse-click-row-interior',
    cacheStatus: 'LIVE_READ',
    readDelayMs,
    bodyMaxChars,
    message: `Read ${emails.filter((email) => email.success).length}/${emailCount} top inbox emails`,
    emails,
  }
}

function skippedEmailCheck() {
  return {
    success: true,
    requested: 0,
    returned: 0,
    availableRows: null,
    selectionMethod: null,
    message: 'Email reading skipped',
    emails: [],
  }
}

function findMessageTable(scope, maxNodes) {
  const window = findInboxWindow(scope, maxNodes)
  if (!window) return null

  let table = null
  walkNode(window, (node) => {
    if (table) return
    if (nodeRole(node) === 'table' && /\bMessage List\b/i.test(nodeFullText(node))) table = node
  })
  return table
}

function findInboxWindow(scope, maxNodes) {
  const matches = safe('scoredSearch:Inbox', () => scope.scoredSearch(
    TraversalOrder.DepthFirst,
    maxNodes,
    true,
    'Inbox',
    0.2,
  ), [])
  return matches.find((node) => nodeRole(node) === 'window') ?? matches.find((node) => nodeChildren(node).length > 0) ?? null
}

function messageCells(table) {
  return nodeChildren(table)
    .filter((row) => nodeRole(row) === 'row')
    .map((row) => nodeChildren(row).find((cell) => nodeRole(cell) === 'cell'))
    .filter(Boolean)
    .filter((cell) => {
      const text = nodeText(cell)
      const box = nodeBox(cell)
      if (!nodeActions(cell).includes('AXPress')) return false
      if (box && box.bottom - box.top < 45) return false
      return !GROUP_HEADER_PATTERN.test(text)
    })
}

function clickNodeCenter(node) {
  const box = nodeBox(node)
  if (!box) return { success: false, message: 'Cannot select message row without a bounding box' }

  const width = Math.max(1, box.right - box.left)
  const point = {
    x: Math.round(box.left + Math.min(Math.max(width * 0.25, 24), width - 24)),
    y: Math.round(boxCenter(box).y),
  }
  const mouse = new MouseController()
  mouse.moveMouse(point.x, point.y, Coordinate.Abs)
  mouse.button(Button.Left, Direction.Click)
  return { success: true, method: 'mouse-click-row-interior', point }
}

async function readSelectedMessage(scope, { maxNodes, tableBox, bodyMaxChars, row, timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  let latest = null

  do {
    await sleep(READ_POLL_MS)
    latest = readReadingPane(scope, { maxNodes, tableBox, bodyMaxChars })
    if (latest.success && readingPaneMatchesRow(latest, row)) {
      return {
        ...latest,
        verifiedAgainstSelectedRow: true,
      }
    }
  } while (Date.now() < deadline)

  return {
    ...(latest ?? { bodyText: '', bodyPreview: '', lines: [] }),
    success: false,
    verifiedAgainstSelectedRow: false,
    message: 'Reading pane did not verify against the selected message row before timeout',
  }
}

function readReadingPane(scope, { maxNodes, tableBox, bodyMaxChars }) {
  const window = findInboxWindow(scope, maxNodes)
  if (!window) {
    return { success: false, message: 'Could not find Outlook window after row selection' }
  }

  const leftLimit = tableBox ? tableBox.right + 15 : 650
  const entries = []
  walkNode(window, (node, depth) => {
    const box = nodeBox(node)
    if (!box || box.left < leftLimit || box.top < 240) return

    const role = nodeRole(node)
    if (!['text', 'heading', 'link', 'paragraph', 'generic', 'button'].includes(role)) return

    const text = nodeText(node)
    if (!isUsefulReadingPaneText(text)) return
    entries.push({ role, depth, top: box.top, text })
  })

  const uniqueEntries = dedupeEntries(entries)
  const lineTexts = uniqueEntries.map((entry) => entry.text)
  const subject = findFirstLine(lineTexts, (line) => !isChromeLine(line) && !isHeaderMetadataLine(line))
  const from = findHeaderValue(lineTexts, 'From:')
  const sent = findSentLine(lineTexts)
  const recipients = findHeaderValue(lineTexts, 'Recipients:')
  const bodyLines = uniqueEntries
    .filter((entry) => entry.top > 450)
    .filter((entry) => entry.role !== 'button')
    .map((entry) => entry.text)
    .filter((line) => !isChromeLine(line))
    .filter((line) => !isHeaderMetadataLine(line))
    .filter((line) => line !== subject)

  const bodyText = truncateText(bodyLines.join('\n'), bodyMaxChars)
  return {
    success: Boolean(subject || bodyText),
    message: subject || bodyText ? 'Reading pane content extracted' : 'No reading pane text found',
    subject,
    from,
    sent,
    recipients,
    bodyText,
    bodyPreview: truncateText(bodyText.replace(/\n+/g, ' '), 300),
    lines: bodyLines.slice(0, 80),
  }
}

function walkNode(root, visitor, depth = 0, state = { seen: new Set(), count: 0 }) {
  if (!root || depth > 14 || state.count > 5000) return
  state.count += 1
  const key = `${depth}:${nodeRole(root)}:${boxKey(nodeBox(root))}:${nodeFullText(root).slice(0, 100)}`
  if (state.seen.has(key)) return
  state.seen.add(key)

  visitor(root, depth)
  for (const child of nodeChildren(root)) walkNode(child, visitor, depth + 1, state)
}

function nodeRole(node) {
  return roleName(safe('role', () => node.role, 'unknown'))
}

function nodeChildren(node) {
  const children = safe('children', () => node.children(), [])
  return Array.isArray(children) ? children : []
}

function nodeActions(node) {
  const actions = safe('supportedActions', () => node.supportedActions(), [])
  return Array.isArray(actions) ? actions : []
}

function nodeBox(node) {
  if (!node) return null
  const box = safe('boundingBox', () => node.boundingBox(), null)
  return box && typeof box === 'object' ? box : null
}

function nodeText(node) {
  return cleanText([
    safe('name', () => node.name, ''),
    safe('description', () => node.description, ''),
    safe('value', () => node.value, ''),
  ].filter(Boolean).join(' | '))
}

function nodeFullText(node) {
  return cleanText([
    safe('name', () => node.name, ''),
    safe('description', () => node.description, ''),
    safe('value', () => node.value, ''),
    safe('overallDescription', () => node.overallDescription, ''),
  ].filter(Boolean).join(' | '))
}

function parseRowSummary(text) {
  const parts = text.split(',').map((part) => part.trim()).filter(Boolean)
  const unread = /^Unread$/i.test(parts[0] ?? '')
  return {
    unread,
    preview: text,
  }
}

function cleanText(value) {
  return String(value ?? '')
    .replace(ZERO_WIDTH_PATTERN, '')
    .replace(URL_PATTERN, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
}

function readingPaneMatchesRow(content, row) {
  const rowText = matchText(row?.preview)
  if (!rowText) return false

  const subject = matchText(content.subject)
  if (subject.length >= 8 && rowText.includes(subject)) return true

  for (const line of content.lines ?? []) {
    const normalized = matchText(line)
    if (normalized.length >= 16 && rowText.includes(normalized.slice(0, 80))) return true
  }

  return false
}

function matchText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\[url\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isUsefulReadingPaneText(text) {
  if (!text || text === '|') return false
  if (/^(unknown|group|image|button|splitter|toolbar|scrollbar|valueindicator)$/i.test(text)) return false
  return true
}

function dedupeEntries(entries) {
  const seen = new Set()
  const result = []
  for (const entry of entries) {
    const text = normalizeReadingPaneLine(entry.text)
    const key = `${entry.role}:${text}`
    if (!text || seen.has(key)) continue
    seen.add(key)
    result.push({ ...entry, text })
  }
  return result
}

function normalizeReadingPaneLine(text) {
  return collapseDuplicatePipeParts(cleanText(text)
    .replace(/^messageHeaderFromContent \|\s*/i, '')
    .replace(/^messageHeaderRecipientsContent \|\s*/i, '')
    .replace(/^Sent on:\s*/i, ''))
}

function collapseDuplicatePipeParts(text) {
  const parts = text.split('|').map((part) => part.trim()).filter(Boolean)
  if (parts.length <= 1) return text
  const unique = []
  for (const part of parts) {
    if (!unique.includes(part)) unique.push(part)
  }
  return unique.length === 1 ? unique[0] : unique.join(' | ')
}

function isChromeLine(line) {
  return /^(Summary by Copilot|Message header|Message Header Details|Infobar View|Reply|Reply all|Forward|React|Summarize this conversation|Download external images|Go to Settings|Show Participants)$/i.test(line)
    || /^Retention:/i.test(line)
    || /^To protect your privacy,/i.test(line)
    || /^External Message$/i.test(line)
    || /^Be cautious with links and attachments\.?$/i.test(line)
    || /^Report Suspicious/i.test(line)
}

function isHeaderMetadataLine(line) {
  return /^From:/i.test(line)
    || /^Recipients:/i.test(line)
    || /^To:$/i.test(line)
    || /^(Today|Yesterday) at \d/i.test(line)
    || /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/i.test(line)
    || /^Dai, Yingchao,/i.test(line)
}

function findFirstLine(lines, predicate) {
  return lines.find(predicate) ?? null
}

function findHeaderValue(lines, label) {
  const line = lines.find((candidate) => candidate.toLowerCase().startsWith(label.toLowerCase()))
  return line ? line.slice(label.length).trim() : null
}

function findSentLine(lines) {
  return lines.find((line) => /^(Today|Yesterday) at \d/i.test(line))
    ?? lines.find((line) => /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/i.test(line))
    ?? null
}

function truncateText(text, maxChars) {
  if (!maxChars || text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`
}

function boxKey(box) {
  return box ? [box.left, box.top, box.right, box.bottom].map((value) => Math.round(value)).join(',') : 'no-box'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
