import { readTopInboxEmails } from './apps/outlook/read-emails.mjs'
import { createPiGrounder, openApp } from '../src/index.mjs'

const EMAIL_COUNT = 3
const grounder = process.env.GUI_CACHE_MODEL_ID ? createPiGrounder({
  providerId: process.env.GUI_CACHE_MODEL_PROVIDER ?? 'openai',
  modelId: process.env.GUI_CACHE_MODEL_ID,
}) : null

try {
  const gui = openApp('outlook', {
    app: 'Microsoft Outlook',
    appCandidates: ['Microsoft Outlook', 'Outlook'],
    maxNodes: 1000,
    grounder,
  })
  const triage = await readTopInboxEmails(gui, { count: EMAIL_COUNT })
  const report = {
    success: triage.success,
    app: gui.appName,
    triage,
  }

  console.log(JSON.stringify(report, null, 2))
  if (!report.success) process.exitCode = 1
} catch (error) {
  console.error(`[check-outlook] failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
