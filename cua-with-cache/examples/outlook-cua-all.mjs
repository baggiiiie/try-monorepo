import { CachedCua } from '../src/index.mjs'

const model = process.env.GUI_CACHE_MODEL_PROVIDER && process.env.GUI_CACHE_MODEL_ID
  ? `${process.env.GUI_CACHE_MODEL_PROVIDER}/${process.env.GUI_CACHE_MODEL_ID}`
  : undefined
const maxItems = Number.parseInt(process.env.OUTLOOK_MAX_EMAILS ?? '1000', 10)
const cua = new CachedCua({ piDir: process.env.PI_DIR, model })
await cua.init()

try {
  const outlook = await cua.openApp('Outlook', { bundleId: 'com.microsoft.Outlook', windowTitle: 'Inbox' })
  const result = await outlook.collect({
    startInstruction: 'Click the first individual email row in the Inbox message list, even if it is already open, so keyboard focus is on that row.',
    nextKey: 'down',
    nextDeliveryMode: 'foreground',
    extractionInstruction: 'Read the sender, subject, and body from the currently open email in the Reading Pane.',
    schema: {
      type: 'object',
      properties: {
        sender: { type: 'string' },
        subject: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['sender', 'subject', 'body'],
    },
    maxItems,
  })
  console.log(JSON.stringify(result, null, 2))
  if (!result.success) process.exitCode = 1
} catch (error) {
  console.log(JSON.stringify({ success: false, complete: false, data: [], error: error.message }))
  process.exitCode = 1
}
