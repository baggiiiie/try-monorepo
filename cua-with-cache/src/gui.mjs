import { GuiCache } from './core/gui-cache.mjs'

// Stagehand-style entry point for the GUI cache layer.
//
//   const gui = openApp('outlook', { app: 'Microsoft Outlook', ... })
//   await gui.observe('Search')                 // cache the grounding, don't act
//   await gui.act('Inbox', { action: 'activate' }) // cached grounding + action
//
// `observe`/`act` return a report plus a non-enumerable `.node` (the live
// simulang AccessibilityNode) so callers can read app data directly from the
// grounded element without a second search. See GuiCache for the deep
// grounding / replay / self-heal logic.
export function openApp(name, config = {}) {
  const app = config.app ?? String(name)
  return GuiCache.open({
    ...config,
    app,
    appCandidates: config.appCandidates ?? [app],
    cacheDir: config.cacheDir ?? `.gui-cache/${slug(name)}`,
    cacheMode: config.cacheMode ?? 'auto',
    threshold: config.threshold ?? 0.35,
    maxNodes: config.maxNodes ?? 4000,
    logCache: config.logCache ?? true,
    openApp: config.openApp ?? true,
    focusApp: config.focusApp ?? true,
  })
}

// Compact, JSON-friendly view of an observe/act report for logging.
export function summarizeResult(result) {
  return {
    target: result.target,
    action: result.action,
    success: result.success,
    cacheStatus: result.cacheStatus,
    cacheHit: result.cacheStatus === 'HIT',
    cacheKey: result.key ?? null,
    cachePath: result.cachePath ?? null,
    matchStatus: result.match?.status ?? null,
    candidates: result.match?.candidateCount ?? 0,
    role: result.descriptor?.role ?? result.match?.selected?.role ?? null,
    message: result.message,
  }
}

export { GuiCache }

function slug(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
