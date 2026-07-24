import { CachedCua } from '../src/index.mjs'

const model = process.env.GUI_CACHE_MODEL_PROVIDER && process.env.GUI_CACHE_MODEL_ID
  ? `${process.env.GUI_CACHE_MODEL_PROVIDER}/${process.env.GUI_CACHE_MODEL_ID}`
  : undefined
const maxItems = Number.parseInt(process.env.OUTLOOK_MAX_EMAILS ?? '1000', 10)
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

  while (emails.length < maxItems) {
    const moved = await cua.pressKey({ scope: outlook, key: 'down', deliveryMode: 'foreground' })
    if (!moved.success) throw new Error(moved.message)
    const next = await waitForDifferentEmail(cua, outlook, emailSchema, emails.at(-1))
    if (!next) {
      console.log(JSON.stringify({ success: false, complete: false, data: emails, message: 'The Reading Pane stopped changing; the runtime cannot yet prove that this is the end of Inbox.' }, null, 2))
      process.exitCode = 1
      break
    }
    emails.push(next)
  }

  if (!process.exitCode) {
    console.log(JSON.stringify({ success: false, complete: false, truncated: true, data: emails, message: `Reached OUTLOOK_MAX_EMAILS (${maxItems}) before proving the end of Inbox.` }, null, 2))
    process.exitCode = 1
  }
} catch (error) {
  console.log(JSON.stringify({ success: false, complete: false, data: [], error: error.message }))
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
