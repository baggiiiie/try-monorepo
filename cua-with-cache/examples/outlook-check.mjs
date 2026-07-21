import { readTopInboxEmails } from './apps/outlook/read-emails.mjs'
import { openApp } from '../src/index.mjs'

const EMAIL_COUNT = 3

try {
  const gui = openApp('outlook', {
    app: 'Microsoft Outlook',
    appCandidates: ['Microsoft Outlook', 'Outlook'],
    maxNodes: 1000,
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
