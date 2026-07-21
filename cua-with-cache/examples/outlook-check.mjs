import { readTopInboxEmails } from './apps/outlook/read-emails.mjs'
import { openApp, summarizeResult } from '../src/index.mjs'

const EMAIL_COUNT = 3

try {
  const gui = openApp('outlook', {
    app: 'Microsoft Outlook',
    appCandidates: ['Microsoft Outlook', 'Outlook'],
    maxNodes: 1000,
  })
  const search = await gui.observe('Search', { timeoutMs: 2500 })
  const triage = search.success
    ? await readTopInboxEmails(gui, { count: EMAIL_COUNT })
    : { success: false, requested: EMAIL_COUNT, returned: 0, message: search.message, emails: [] }
  const report = {
    success: search.success && triage.success,
    app: gui.scope.appName,
    grounded: [summarizeResult(search)],
    triage,
  }

  console.log(JSON.stringify(report, null, 2))
  if (!report.success) process.exitCode = 1
} catch (error) {
  console.error(`[check-outlook] failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
