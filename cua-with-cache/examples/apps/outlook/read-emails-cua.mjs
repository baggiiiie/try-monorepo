const GROUP_HEADER = /^(Today|Yesterday|Last Week|Last Month|This Year),? Expanded$/i

export async function readTopInboxEmailsCua(gui, { count = 3 } = {}) {
  const state = await gui.snapshot()
  const menuCount = state.elements.filter((e) => /menu/i.test(e.role)).length
  const listLike = state.elements.filter((e) => /list|table|outline/i.test(e.role) || /message list/i.test(e.label))
  if (!listLike.length && (state.truncated || menuCount > state.elements.length * .5)) {
    return failure(`Outlook AX snapshot is trapped in its recursive menu tree (${state.elements.length} elements, ${menuCount} menu roles); Message List is unavailable. The current CUA cache backend has no screenshot/pixel grounding fallback.`, { failureKind: 'environment' })
  }
  const list = await gui.observe('Message List', { query: 'Message List', role: 'AXTable' })
  if (!list.success) return failure(`Message List was not uniquely available in the live AX snapshot (${list.message}); no pixel fallback was attempted.`)
  const rows = await gui.observeMany('message rows', {
    within: list,
    role: 'AXCell',
    where: (view) => view.frame?.h >= 45 && !GROUP_HEADER.test(rowText(view)) && !THREAD_SUMMARY.test(rowText(view)),
    identity: 'position', limit: count, require: count,
  })
  if (!rows.success) return failure(rows.message)
  const emails = []
  let actionRequested = false
  for (const row of rows.items) {
    const rowLive = await gui.extract(row, { project: parseRow, validate: hasRowIdentity })
    if (!rowLive.success) return failure('Could not retain a live identity for the message row')
    const readSelectedMail = (view) => parseMail(view, rowLive.data)
    const before = await gui.extract('Reading Pane', { project: readSelectedMail })
    if (before.success && validMail(before.data) && corresponds(before.data, rowLive.data)) {
      emails.push(before.data)
      continue
    }
    const action = await gui.act(row, { action: 'press', addressing: 'pixel', deliveryMode: 'foreground' })
    actionRequested ||= action.actionRequested
    if (!action.success) return failure(action.message, { actionRequested: action.actionRequested, actionOutcome: action.actionOutcome, safeToRetry: false, error: action.error })
    const pane = await gui.waitFor('Reading Pane', { timeoutMs: 3000, project: readSelectedMail, validate: (mail) => validMail(mail) && corresponds(mail, rowLive.data) && mailKey(mail) !== mailKey(before.data), until: (mail) => validMail(mail) && corresponds(mail, rowLive.data) && mailKey(mail) !== mailKey(before.data) })
    if (!pane.success) return failure('Selected a row once, but could not verify a changed reading pane corresponding to that row', { actionRequested: true, actionOutcome: action.actionOutcome, safeToRetry: false })
    emails.push(pane.data)
  }
  return { success: true, emails, actionRequested, safeToRetry: false }
}

function parseMail(view, row = {}) {
  const lines = [...new Set(flatten(view).slice(1).flatMap((v) => [v.label, v.value, v.help]).filter(Boolean).flatMap((x) => x.split('\n')).map((x) => x.trim()).filter(Boolean))]
  const text = lines.join('\n')
  return {
    sender: row.sender ?? null,
    subject: row.subject ?? null,
    body: text.slice(0, 4000) || null,
  }
}
function rowText(view) { return flatten(view).flatMap((v) => [v.label, v.value, v.help]).filter(Boolean).join(', ') }
function parseRow(view) {
  const parts = rowText(view).split(',').map((part) => part.trim()).filter(Boolean)
  const sentIndex = parts.findIndex((part) => /^(?:\d{1,2}:\d{2}|Today|Yesterday|\d{1,2}\/\d{1,2}\/\d{2,4})/i.test(part))
  let start = 0
  while (/^(?:Unread|\d+ (?:unread )?messages?)$/i.test(parts[start] ?? '')) start += 1
  const header = parts.slice(start, sentIndex < 0 ? undefined : sentIndex)
  const subjectStart = Math.max(1,
    header.findIndex((part) => /^\[/.test(part)),
    header.findIndex((part, index) => index > 0 && /^\+\d+ others?$/i.test(header[index - 1])),
    Math.min(2, header.length - 1),
  )
  return {
    sender: header.slice(0, subjectStart).join(', ') || null,
    subject: header.slice(subjectStart).join(', ') || null,
    preview: sentIndex >= 0 ? parts.slice(sentIndex + 1).join(', ') || null : parts[start + 2] ?? null,
  }
}
function flatten(view) { return [view, ...(view.children ?? []).flatMap(flatten)] }
function hasRowIdentity(row) { return Boolean(row.sender || row.subject || row.preview) }
function corresponds(mail, row) {
  const preview = normalize(row.preview)
  if (preview.length >= 24) return normalize(mail.body).includes(preview.slice(0, 64))
  const paneTokens = new Set(contentTokens(mail.body))
  const identityTokens = contentTokens(`${row.sender ?? ''} ${row.subject ?? ''}`)
  return identityTokens.filter((token) => paneTokens.has(token)).length >= Math.min(2, identityTokens.length)
}
function contentTokens(value) { return [...new Set(normalize(value).split(' ').filter((token) => token.length >= 4 && !COMMON_TOKENS.has(token)))] }
function normalize(value) { return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() }
function mailKey(mail = {}) { return `${mail.sender ?? ''}\0${mail.subject ?? ''}\0${mail.body ?? ''}` }
function validMail(mail) { return Boolean(mail?.sender && mail?.subject && mail?.body) }
function failure(message, details = {}) { return { success: false, emails: [], failureKind: 'workflow', actionRequested: false, safeToRetry: !details.actionRequested, message, ...details } }

const COMMON_TOKENS = new Set(['message', 'messages', 'unread', 'others', 'today', 'yesterday'])
const THREAD_SUMMARY = /(?:^|,)\s*(?:Expanded|Collapsed)\s*(?:,|$)/i
