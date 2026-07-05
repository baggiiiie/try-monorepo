import { openApp, summarizeResult } from '../src/index.mjs'

const OUTLOOK_APP = {
  app: 'Microsoft Outlook',
  appCandidates: ['Microsoft Outlook', 'Outlook'],
  cacheDir: '.gui-cache/outlook',
  threshold: 0.35,
  maxNodes: 1000,
}

const OUTLOOK_TARGETS = ['Search', 'Inbox']

try {
  const gui = openApp('outlook', OUTLOOK_APP)

  const grounded = []
  for (const target of OUTLOOK_TARGETS) {
    grounded.push(await gui.observe(target))
  }

  const report = {
    success: grounded.every((result) => result.success),
    app: gui.scope.appName,
    grounded: grounded.map(summarizeResult),
  }

  console.log(JSON.stringify(report, null, 2))
  if (!report.success) process.exitCode = 1
} catch (error) {
  console.error(`[check-outlook] failed: ${error.stack || error.message}`)
  process.exitCode = 1
}
