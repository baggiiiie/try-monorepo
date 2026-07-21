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
    actions: ['AXPress'],
    where: (view) => view.frame?.h >= 45 && !GROUP_HEADER.test(rowText(view)),
    identity: (view) => rowText(view), limit: count, require: count,
  })
  if (!rows.success) return failure(rows.message)
  const emails = []
  for (const row of rows.items) {
    const rowLive = await gui.extract(row, { project: parseRow, validate: hasRowIdentity })
    if (!rowLive.success) return failure('Could not retain a live identity for the message row')
    const before = await gui.extract('Reading Pane', { project: parseMail })
    const action = await gui.act(row, { action: 'press', deliveryMode: 'background' })
    if (!action.success) return failure(action.message, { actionRequested: action.actionRequested, actionOutcome: action.actionOutcome, safeToRetry: false })
    const pane = await gui.waitFor('Reading Pane', { timeoutMs: 3000, project: parseMail, validate: (mail) => validMail(mail) && corresponds(mail, rowLive.data) && mailKey(mail) !== mailKey(before.data), until: (mail) => validMail(mail) && corresponds(mail, rowLive.data) && mailKey(mail) !== mailKey(before.data) })
    if (!pane.success) return failure('Selected a row once, but could not verify a changed reading pane corresponding to that row', { actionRequested: true, actionOutcome: action.actionOutcome, safeToRetry: false })
    emails.push(pane.data)
  }
  return { success: true, emails, actionRequested: emails.length > 0, safeToRetry: false }
}

function parseMail(view) {
  const lines = flatten(view).flatMap((v) => [v.label, v.value, v.help]).filter(Boolean).flatMap((x) => x.split('\n')).map((x) => x.trim()).filter(Boolean)
  return { sender: lines[0] ?? null, subject: lines[1] ?? null, body: lines.slice(2).join('\n') || null }
}
function rowText(view) { return flatten(view).flatMap((v) => [v.label, v.value, v.help]).filter(Boolean).join(', ') }
function parseRow(view) { const lines = flatten(view).flatMap((v) => [v.label, v.value, v.help]).filter(Boolean).flatMap((x) => x.split('\n')).map((x) => x.trim()).filter(Boolean); return { sender: lines[0] ?? null, subject: lines[1] ?? null, preview: lines[2] ?? null } }
function flatten(view) { return [view, ...(view.children ?? []).flatMap(flatten)] }
function hasRowIdentity(row) { return Boolean(row.sender || row.subject || row.preview) }
function corresponds(mail, row) { const hay = `${mail.sender} ${mail.subject} ${mail.body}`.toLowerCase(); return [row.sender, row.subject, row.preview].filter((x) => x && x.length > 2).some((x) => hay.includes(x.toLowerCase())) }
function mailKey(mail = {}) { return `${mail.sender ?? ''}\0${mail.subject ?? ''}\0${mail.body ?? ''}` }
function validMail(mail) { return Boolean(mail?.sender && mail?.subject && mail?.body) }
function failure(message, details = {}) { return { success: false, emails: [], failureKind: 'workflow', actionRequested: false, safeToRetry: !details.actionRequested, message, ...details } }
