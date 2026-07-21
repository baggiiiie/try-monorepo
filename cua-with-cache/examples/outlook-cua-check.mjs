import { openCuaApp } from '../src/index.mjs'
import { readTopInboxEmailsCua } from './apps/outlook/read-emails-cua.mjs'

try {
  const gui = await openCuaApp('Outlook', { bundleId: 'com.microsoft.Outlook', windowTitle: 'Inbox' })
  const triage = await readTopInboxEmailsCua(gui, { count: 3 })
  console.log(JSON.stringify({ success: triage.success, driver: 'cua-driver', triage }, null, 2))
  if (!triage.success) process.exitCode = 1
} catch (error) {
  const environment = ['background_unavailable', 'desktop_scope_disabled'].includes(error.code) || /recursive|screenshot|desktop scope/i.test(error.message)
  console.log(JSON.stringify({ success: false, failureKind: environment ? 'environment' : 'workflow', actionRequested: false, safeToRetry: true, error: error.message }))
  process.exitCode = 1
}
