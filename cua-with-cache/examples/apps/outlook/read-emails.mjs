import {
  Button,
  Coordinate,
  Direction,
  MouseController,
  TraversalOrder,
  ariaRoleToString,
} from '@simular-ai/simulang-js'

const GROUP_HEADER = /^(Today|Yesterday|Last Week|Last Month|This Year),? Expanded$/i

export async function readTopInboxEmails(gui, {
  count = 3,
  timeoutMs = 2500,
  pollMs = 250,
  maxNodes = 1000,
} = {}) {
  const config = { timeoutMs, pollMs, maxNodes }
  const initialTable = await waitForMessageTable(gui.scope, config)
  if (!initialTable) return failedTriage(count, 'Could not find Outlook Message List table')

  const available = messageCells(initialTable).length
  const emails = []
  for (let index = 0; index < Math.min(count, available); index += 1) {
    // Every accessibility-tree rebuild invalidates node references, so locate
    // the live table and row again immediately before each interaction.
    const table = findMessageTable(gui.scope, maxNodes)
    const cell = table && messageCells(table)[index]
    if (!cell) {
      emails.push({ index: index + 1, success: false, message: 'Message row disappeared' })
      continue
    }

    const row = nodeText(cell)
    const tableBox = nodeBox(table)
    try {
      selectMessage(cell)
    } catch (error) {
      emails.push({ index: index + 1, success: false, row, message: `Could not select row: ${error.message}` })
      continue
    }

    const content = await waitForReadingPane(gui.scope, { row, tableBox, ...config })
    emails.push({
      index: index + 1,
      success: content.success,
      row,
      content,
      message: content.message,
    })
  }

  const returned = emails.filter((email) => email.success).length
  return {
    success: emails.length === count && returned === count,
    requested: count,
    returned,
    available,
    cacheStatus: 'LIVE_READ',
    message: `Read ${returned}/${count} top inbox emails`,
    emails,
  }
}

async function waitForReadingPane(scope, { row, tableBox, timeoutMs, pollMs, maxNodes }) {
  const deadline = Date.now() + timeoutMs
  let content = null
  const summary = parseRow(row)
  do {
    await sleep(pollMs)
    const live = readReadingPane(scope, tableBox, maxNodes)
    content = {
      ...live,
      subject: live.subject ?? summary.subject,
      from: live.from ?? summary.from,
      sent: live.sent ?? summary.sent,
    }
    content.success = Boolean(content.subject && content.from && content.body)
    if (content.success && contentMatchesRow(content, row)) {
      return { ...content, verifiedAgainstSelectedRow: true }
    }
  } while (Date.now() < deadline)

  return {
    ...(content ?? {}),
    success: false,
    verifiedAgainstSelectedRow: false,
    message: 'Reading pane did not match the selected row before timeout',
  }
}

async function waitForMessageTable(scope, { timeoutMs, pollMs, maxNodes }) {
  const deadline = Date.now() + timeoutMs
  do {
    const table = findMessageTable(scope, maxNodes)
    if (table) return table
    await sleep(pollMs)
  } while (Date.now() < deadline)
  return null
}

function findMessageTable(scope, maxNodes) {
  const window = findInboxWindow(scope, maxNodes)
  if (!window) return null

  let table = null
  walk(window, (node) => {
    if (!table && role(node) === 'table' && /\bMessage List\b/i.test(fullText(node))) table = node
  })
  return table
}

function findInboxWindow(scope, maxNodes) {
  const matches = safe(() => scope.scoredSearch(
    TraversalOrder.DepthFirst,
    maxNodes,
    true,
    'Inbox',
    0.2,
  ), [])
  return matches.find((node) => role(node) === 'window')
    ?? matches.find((node) => children(node).length > 0)
}

function selectMessage(cell) {
  try {
    cell.activate()
    return
  } catch {
    // Outlook advertises AXPress for message cells but currently rejects the
    // AX action, so use a live row-relative click rather than cached geometry.
  }

  const box = nodeBox(cell)
  if (!box) throw new Error('Message row has no bounding box')
  const width = Math.max(1, box.right - box.left)
  const x = Math.round(box.left + Math.min(Math.max(width * 0.25, 24), width - 24))
  const y = Math.round((box.top + box.bottom) / 2)
  const mouse = new MouseController()
  mouse.moveMouse(x, y, Coordinate.Abs)
  mouse.button(Button.Left, Direction.Click)
}

function messageCells(table) {
  return children(table)
    .filter((node) => role(node) === 'row')
    .map((row) => children(row).find((node) => role(node) === 'cell'))
    .filter(Boolean)
    .filter((cell) => {
      const box = nodeBox(cell)
      const actions = safe(() => cell.supportedActions(), [])
      return actions.includes('AXPress')
        && (!box || box.bottom - box.top >= 45)
        && !GROUP_HEADER.test(nodeText(cell))
    })
}

function readReadingPane(scope, tableBox, maxNodes) {
  const table = findMessageTable(scope, maxNodes)
  if (!table) return { success: false, message: 'Message List disappeared' }

  const root = findInboxWindow(scope, maxNodes)
  if (!root) return { success: false, message: 'Outlook Inbox window disappeared' }
  const left = tableBox?.right ?? nodeBox(table)?.right ?? 650
  const entries = []
  walk(root, (node) => {
    const box = nodeBox(node)
    const nodeRole = role(node)
    if (!box || box.left < left + 15 || box.top < 180) return
    if (!['text', 'heading', 'link', 'paragraph', 'generic', 'group'].includes(nodeRole)) return
    const text = nodeText(node)
    if (text) entries.push({ top: box.top, text })
  })

  const lines = [...new Set(entries.map(({ text }) => text))]
    .filter((line) => !isOutlookChrome(line))
  const subject = lines.find((line) => !isHeader(line)) ?? null
  const from = headerValue(lines, 'From:')
  const sentLine = lines.find((line) => /^(Sent on: )?(Today|Yesterday) at \d/i.test(line))
  const sent = sentLine?.replace(/^Sent on:\s*/i, '') ?? null
  const bodyLines = entries
    .filter(({ top }) => top > 450)
    .map(({ text }) => text)
    .filter((line) => line !== subject && !isHeader(line) && !isOutlookChrome(line))
  const body = [...new Set(bodyLines)].join('\n').slice(0, 4000)

  return {
    success: Boolean(subject || body),
    subject,
    from,
    sent,
    body,
    bodyPreview: body.replace(/\n+/g, ' ').slice(0, 300),
    lines: lines.slice(0, 80),
    message: subject || body ? 'Reading pane content extracted' : 'No reading pane content found',
  }
}

function contentMatchesRow(content, row) {
  const rowText = matchText(row)
  const subject = matchText(content.subject)
  if (subject.length >= 8 && rowText.includes(subject)) return true
  return content.lines?.some((line) => {
    const text = matchText(line)
    return text.length >= 16 && rowText.includes(text.slice(0, 80))
  }) ?? false
}

function parseRow(row) {
  const parts = String(row).split(',').map((part) => part.trim()).filter(Boolean)
  const sentIndex = parts.findIndex((part) => /^\d{1,2}:\d{2}$/.test(part))
  const prefixLength = /^\d+ unread messages$/i.test(parts[0] ?? '') ? 2 : 1
  if (sentIndex <= prefixLength + 1) return { from: null, subject: null, sent: null }
  return {
    from: parts[prefixLength] ?? null,
    subject: parts.slice(prefixLength + 1, sentIndex).join(', ') || null,
    sent: parts[sentIndex] ?? null,
  }
}

function walk(root, visit, depth = 0, state = { count: 0 }) {
  if (!root || depth > 14 || state.count >= 5000) return
  state.count += 1
  visit(root)
  for (const child of children(root)) walk(child, visit, depth + 1, state)
}

function role(node) {
  return safe(() => ariaRoleToString(node.role), 'unknown')
}

function children(node) {
  const value = safe(() => node.children(), [])
  return Array.isArray(value) ? value : []
}

function nodeBox(node) {
  return safe(() => node?.boundingBox(), null)
}

function nodeText(node) {
  return clean([node?.name, node?.description, node?.value].filter(Boolean).join(' | '))
}

function fullText(node) {
  return clean([node?.name, node?.description, node?.value, node?.overallDescription].filter(Boolean).join(' | '))
}

function clean(value) {
  const text = String(value ?? '')
    .replace(/[\u034f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
  const parts = text.split('|').map((part) => part.trim()).filter(Boolean)
  return [...new Set(parts)].join(' | ')
}

function matchText(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function isHeader(line) {
  return /^(From:|Recipients:|Sent on:|To:$|Cc:$|Today at \d|Yesterday at \d)/i.test(line)
}

function isOutlookChrome(line) {
  return /^(Summary by Copilot|Message header|Reply|Reply all|Forward|React|Show Participants)$/i.test(line)
    || /^(Retention:|To protect your privacy,|External Message)/i.test(line)
}

function headerValue(lines, label) {
  const line = lines.find((candidate) => candidate.toLowerCase().startsWith(label.toLowerCase()))
  return line ? line.slice(label.length).trim() : null
}

function failedTriage(requested, message) {
  return { success: false, requested, returned: 0, message, emails: [] }
}

function safe(fn, fallback) {
  try {
    const value = fn()
    return value == null ? fallback : value
  } catch {
    return fallback
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
