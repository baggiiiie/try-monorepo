import { GuiCache } from '../index.mjs'

export const DEFAULT_OUTLOOK_TARGETS = ['Search', 'Inbox']

export async function runOutlookCheck({
  targets = DEFAULT_OUTLOOK_TARGETS,
  app = 'Microsoft Outlook',
  cacheDir = '.gui-cache/outlook',
  cacheMode = 'auto',
  threshold = 0.35,
  maxNodes = 1000,
  openApp = false,
  windowScope = false,
  scanAllWindows = false,
  focusWindow = false,
} = {}) {
  const gui = GuiCache.open({
    app,
    appCandidates: [app, 'Outlook'],
    cacheDir,
    cacheMode,
    threshold,
    maxNodes,
    openApp,
    windowScope,
    scanAllWindows,
    focusWindow,
  })

  const results = []
  for (const target of targets) {
    results.push(await gui.observe({ target }))
  }

  return {
    app,
    cacheDir,
    cacheMode,
    threshold,
    maxNodes,
    scope: {
      kind: gui.scope.kind,
      pid: gui.scope.pid,
      pidsSeen: gui.pidsSeen,
      windowsSeen: gui.windowsSeen,
    },
    context: gui.context,
    results,
    summary: results.map((result) => ({
      target: result.target,
      success: result.success,
      cacheStatus: result.cacheStatus,
      matchStatus: result.match.status,
      candidates: result.match.candidateCount,
      role: result.descriptor?.role ?? result.match.selected?.role ?? null,
      message: result.message,
    })),
  }
}
