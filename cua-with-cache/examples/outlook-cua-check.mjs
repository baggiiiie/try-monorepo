import { CachedCua } from '../src/index.mjs'

const model = process.env.GUI_CACHE_MODEL_PROVIDER && process.env.GUI_CACHE_MODEL_ID
  ? `${process.env.GUI_CACHE_MODEL_PROVIDER}/${process.env.GUI_CACHE_MODEL_ID}`
  : undefined
const cua = new CachedCua({ piDir: process.env.PI_DIR, model })
await cua.init()

try {
  const outlook = await cua.openApp('Outlook', { bundleId: 'com.microsoft.Outlook', windowTitle: 'Inbox' })
  const result = await outlook.agent().execute({
    instruction: 'Read the top three individual messages in the Outlook Inbox. Open each message in order and extract its sender, subject, and body from the Reading Pane.',
    schema: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          sender: { type: 'string' },
          subject: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['sender', 'subject', 'body'],
      },
    },
  })
  console.log(JSON.stringify(result, null, 2))
  if (!result.success) process.exitCode = 1
} catch (error) {
  const environment = ['background_unavailable', 'desktop_scope_disabled'].includes(error.code) || /recursive|screenshot|desktop scope/i.test(error.message)
  console.log(JSON.stringify({ success: false, failureKind: environment ? 'environment' : 'workflow', actionRequested: null, safeToRetry: false, error: error.message }))
  process.exitCode = 1
}
