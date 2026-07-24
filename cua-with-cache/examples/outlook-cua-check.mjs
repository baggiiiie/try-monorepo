import { CachedCua } from '../src/index.mjs'

const model = process.env.GUI_CACHE_MODEL_PROVIDER && process.env.GUI_CACHE_MODEL_ID
  ? `${process.env.GUI_CACHE_MODEL_PROVIDER}/${process.env.GUI_CACHE_MODEL_ID}`
  : undefined
const cua = new CachedCua({ piDir: process.env.PI_DIR, model })
const emailSchema = {
  type: 'object',
  properties: {
    sender: { type: 'string' },
    subject: { type: 'string' },
    body: { type: 'string' },
  },
  required: ['sender', 'subject', 'body'],
}

try {
  const outlook = await cua.openApp('Outlook', { bundleId: 'com.microsoft.Outlook', windowTitle: 'Inbox' })
  const emails = []

  const opened = await cua.act('Click the topmost individual email row in the Inbox message list, ignoring date-group and conversation headers, even if it is already open, so keyboard focus is on that row.', { scope: outlook })
  if (!opened.success) throw new Error(opened.message)
  if (!opened.actionPerformed) throw new Error('Could not establish keyboard focus on the top Inbox row')

  const first = await cua.extract('Read the sender, subject, and body from the currently open email in the Reading Pane.', { scope: outlook, schema: emailSchema })
  if (!first.success) throw new Error(first.message)
  emails.push(first.data)

  while (emails.length < 3) {
    const moved = await cua.pressKey({ scope: outlook, key: 'down', deliveryMode: 'foreground' })
    if (!moved.success) throw new Error(moved.message)
    const next = await waitForDifferentEmail(cua, outlook, emailSchema, emails.at(-1))
    if (!next) throw new Error('the Reading Pane did not change after moving to the next Inbox email')
    emails.push(next)
  }

  console.log(JSON.stringify({ success: true, data: emails }, null, 2))
} catch (error) {
  const environment = ['background_unavailable', 'desktop_scope_disabled'].includes(error.code) || /recursive|screenshot|desktop scope/i.test(error.message)
  console.log(JSON.stringify({ success: false, failureKind: environment ? 'environment' : 'workflow', actionRequested: null, safeToRetry: false, error: error.message }))
  process.exitCode = 1
}

async function waitForDifferentEmail(cua, scope, schema, previous, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  do {
    const result = await cua.extract('Read the sender, subject, and body from the currently open email in the Reading Pane.', { scope, schema })
    if (result.success && JSON.stringify(result.data) !== JSON.stringify(previous)) return result.data
    await new Promise((resolve) => setTimeout(resolve, 150))
  } while (Date.now() <= deadline)
  return null
}
