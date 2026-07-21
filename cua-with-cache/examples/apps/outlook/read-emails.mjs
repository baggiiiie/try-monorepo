const GROUP_HEADER = /^(Today|Yesterday|Last Week|Last Month|This Year),? Expanded$/i

// Outlook interpretation stays here; traversal, stale-node recovery, physical
// input, serialization, and polling are all provided by the public cache API.
export async function readTopInboxEmails(gui, { count = 3, timeoutMs = 2500, pollMs = 250 } = {}) {
  const inbox = await gui.observe('Inbox window', {
    query: 'Inbox',
    match: { role: 'window' },
    timeoutMs,
    pollMs,
  })
  if (!inbox.success) return failed(count, inbox.message)

  const table = await gui.observe('Message List', {
    within: inbox,
    match: { role: 'table' },
    timeoutMs,
    pollMs,
  })
  if (!table.success) return failed(count, table.message)

  const messages = await gui.observeMany('inbox-message', {
    within: table,
    role: 'cell',
    actions: ['AXPress'],
    minHeight: 45,
    where: (row) => !GROUP_HEADER.test(row.text),
    limit: count,
    require: count,
    identity: (row) => row.text,
    timeoutMs,
    pollMs,
  })
  if (!messages.success) return failed(count, messages.message)
  const tableBox = table.descriptor?.box ?? null
  const readPane = (view) => parsePane(view, tableBox)
  const extractPane = { project: readPane, maxDepth: 14, maxNodes: 5000 }

  const emails = []
  for (const [index, message] of messages.items.entries()) {
    const row = message.view.text
    const rowData = parseRow(row)
    const action = await gui.act(message, {
      action: 'activate',
      strategies: ['accessibility', 'click'],
      click: { xRatio: 0.25, yRatio: 0.5, inset: 12 },
      timeoutMs,
      pollMs,
    })
    if (!action.success) {
      emails.push({ index: index + 1, success: false, row, message: action.message })
      continue
    }
    const content = await gui.waitFor(inbox, {
      ...extractPane,
      project: (view) => {
        const live = parsePane(view, tableBox)
        return { ...rowData, ...removeEmpty(live), correspondsToRow: matchesRow(live, row) }
      },
      validate: (data) => Boolean(data.sender && data.subject && data.body && data.correspondsToRow),
      timeoutMs,
      pollMs,
    })
    emails.push({ index: index + 1, row, ...content.data, success: content.success, message: content.message })
  }
  const returned = emails.filter((email) => email.success).length
  return {
    success: returned === count,
    requested: count,
    returned,
    available: messages.available,
    cacheStatus: 'LIVE_READ',
    message: `Read ${returned}/${count} top inbox emails`,
    emails,
  }
}

function parsePane(root, tableBox) {
  const left = tableBox?.right ?? 650
  const nodes = flatten(root).filter(({ role, text, box }) => box
    && box.left >= left + 15
    && box.top >= 180
    && text
    && ['text', 'heading', 'link', 'paragraph', 'generic', 'group'].includes(role))
  const lines = [...new Set(nodes.map(({ text }) => text))].filter((line) => !chrome(line))
  const subject = lines.find((line) => !header(line)) ?? null
  const from = valueAfter(lines, 'From:')
  const sent = lines.find((line) => /^(Sent on: )?(Today|Yesterday) at \d/i.test(line))?.replace(/^Sent on:\s*/i, '') ?? null
  const body = [...new Set(nodes
    .filter(({ box }) => box.top > 450)
    .map(({ text }) => text)
    .filter((line) => line !== subject && !header(line) && !chrome(line)))]
    .join('\n')
    .slice(0, 4000)
  return { subject, sender: from, from, sent, body, bodyPreview: body.replace(/\n+/g, ' ').slice(0, 300), lines: lines.slice(0, 80) }
}

function flatten(node, result = []) {
  if (!node) return result
  result.push(node)
  for (const child of node.children) flatten(child, result)
  return result
}

function matchesRow(content, row) {
  const haystack = normalize(row)
  const values = [content.subject, content.sender, ...(content.lines ?? [])]
    .map(normalize)
    .filter((value) => value.length >= 8)
  return values.some((value) => haystack.includes(value) || value.includes(haystack.slice(0, 80)))
}

function parseRow(row) {
  const parts = String(row).split(',').map((part) => part.trim()).filter(Boolean)
  const sentIndex = parts.findIndex((part) => /^(?:\d{1,2}:\d{2}|Today|Yesterday)/i.test(part))
  const start = /^\d+ unread messages$/i.test(parts[0] ?? '') ? 2 : 1
  return {
    sender: parts[start] || null,
    from: parts[start] || null,
    subject: sentIndex > start + 1 ? parts.slice(start + 1, sentIndex).join(', ') : parts[start + 1] || null,
    sent: sentIndex >= 0 ? parts[sentIndex] : null,
  }
}

function removeEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item != null && item !== ''))
}

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function header(line) {
  return /^(From:|Recipients:|Sent on:|To:$|Cc:$|Today at \d|Yesterday at \d)/i.test(line)
}

function chrome(line) {
  return /^(Summary by Copilot|Message header|Reply|Reply all|Forward|React|Show Participants)$/i.test(line)
}

function valueAfter(lines, label) {
  const line = lines.find((candidate) => candidate.toLowerCase().startsWith(label.toLowerCase()))
  return line ? line.slice(label.length).trim() : null
}

function failed(requested, message) {
  return { success: false, requested, returned: 0, message, emails: [] }
}
