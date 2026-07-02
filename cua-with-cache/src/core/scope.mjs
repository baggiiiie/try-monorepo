import {
  AccessibilityNode,
  App,
  FocusPolicy,
  Visibility,
  Window,
} from '@simular-ai/simulang-js'

import { boxArea, hashObject, pidsForAppCandidates, processName, safe, sha256 } from './util.mjs'

export function createAppScope(pid, { appName = 'app' } = {}) {
  const root = AccessibilityNode.fromPid(pid)
  return {
    kind: 'app',
    appName,
    pid,
    title: '',
    scoredSearch: (...args) => root.scoredSearch(...args),
  }
}

export function createWindowScope(window, { appName = 'app' } = {}) {
  return {
    kind: 'window',
    appName,
    pid: safe('pid', () => window.pid, 0),
    title: safe('title', () => window.title, ''),
    boundingBox: () => window.boundingBox(),
    snapshot: () => window.snapshot(),
    scoredSearch: (...args) => window.scoredSearch(...args),
    screenshot: (...args) => window.screenshot(...args),
  }
}

export function openScope({
  app = 'Microsoft Outlook',
  appCandidates = [app],
  openApp = false,
  windowScope = false,
  scanAllWindows = false,
  focusWindow = false,
  windowTitle = null,
} = {}) {
  let instance = null
  if (openApp) {
    for (const candidate of appCandidates) {
      if (!App.exists(candidate)) continue
      instance = App.exactName(candidate).open(null, FocusPolicy.DoNotSteal, Visibility.Show, true)
      safe('enableAccessibility', () => instance.enableAccessibility())
      break
    }
  }

  const candidatePids = instance?.pid ? [instance.pid] : pidsForAppCandidates(appCandidates)
  if (!windowScope && candidatePids.length > 0) {
    return {
      scope: createAppScope(candidatePids[0], { appName: app }),
      context: scopeContext({ kind: 'app', pid: candidatePids[0], appName: app }, app),
      pidsSeen: candidatePids.length,
      windowsSeen: 0,
    }
  }

  let windows = instance ? safe('windows', () => instance.windows(), []) : []
  for (const pid of candidatePids) {
    if (windows.length > 0) break
    windows = safe('Window.allForPid', () => Window.allForPid(pid), [])
  }

  if (windows.length === 0 && scanAllWindows) {
    const wanted = appCandidates.map((name) => name.toLowerCase())
    windows = safe('Window.all', () => Window.all(), [])
      .filter((window) => {
        const title = safe('title', () => window.title, '').toLowerCase()
        const proc = processName(safe('pid', () => window.pid, 0))
        return wanted.some((name) => title.includes(name)) || wanted.some((name) => proc.includes(name))
      })
  }

  if (windowTitle) {
    const needle = windowTitle.toLowerCase()
    windows = windows.filter((window) => safe('title', () => window.title, '').toLowerCase().includes(needle))
  }

  windows.sort((a, b) => boxArea(safe('box', () => b.boundingBox(), null)) - boxArea(safe('box', () => a.boundingBox(), null)))
  const window = windows[0]
  if (!window) throw new Error(`Could not find a visible window or app root for ${app}`)
  if (focusWindow) safe('window.focus', () => window.focus())

  const scope = createWindowScope(window, { appName: app })
  return {
    scope,
    context: scopeContext(scope, app),
    pidsSeen: candidatePids.length,
    windowsSeen: windows.length,
  }
}

export function scopeContext(scope, appName) {
  if (scope.kind === 'app') {
    return {
      stableAppId: appName,
      routeKey: 'app-root',
      contextCheck: {
        scopeKind: 'app',
        pid: scope.pid,
        processName: processName(scope.pid),
        structuralHash: null,
        structuralHashNote: 'Skipped for app scope because app-root snapshot/boundingBox can block in Outlook.',
      },
      containerBox: null,
    }
  }

  const title = safe('title', () => scope.title, '')
  const box = safe('windowBox', () => scope.boundingBox(), null)
  const snapshot = safe('snapshot', () => scope.snapshot(), '')
  const structuralHash = stableStructuralHash(snapshot)
  return {
    stableAppId: appName,
    routeKey: `window:${sha256(title)}`,
    contextCheck: {
      scopeKind: 'window',
      pid: scope.pid,
      processName: processName(scope.pid),
      titleHash: sha256(title),
      structuralHash,
    },
    containerBox: box,
  }
}

function stableStructuralHash(snapshot) {
  const roleLines = String(snapshot ?? '')
    .split('\n')
    .map((line) => {
      const indent = line.match(/^\s*/)?.[0].length ?? 0
      const trimmed = line.trim()
      if (!trimmed) return null
      const role = trimmed.split(/\s+/)[0]
      return `${Math.floor(indent / 2)}:${role}`
    })
    .filter(Boolean)
  return hashObject(roleLines)
}
