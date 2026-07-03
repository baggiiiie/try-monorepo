import { GuiCache } from './core/gui-cache.mjs'

export class CachedSimulangAgent {
  constructor(config = {}) {
    this.defaults = config.defaults ?? {}
    this.apps = normalizeApps(config.apps ?? {})
    this.actions = [...(config.actions ?? [])]
    this.currentApp = null
  }

  findApp(name, options = {}) {
    const config = this.appConfig(name)
    const appOptions = {
      ...config,
      ...this.defaults,
      ...options,
      app: options.app ?? config.app,
      appCandidates: options.appCandidates ?? config.appCandidates,
      cacheDir: options.cacheDir ?? config.cacheDir,
      cacheMode: options.cacheMode ?? this.defaults.cacheMode ?? config.cacheMode ?? 'auto',
      threshold: options.threshold ?? this.defaults.threshold ?? config.threshold ?? 0.35,
      maxNodes: options.maxNodes ?? this.defaults.maxNodes ?? config.maxNodes ?? 4000,
    }

    const app = {
      kind: 'cached-simulang-app',
      id: config.id,
      requestedName: name,
      app: appOptions.app,
      options: appOptions,
    }
    this.currentApp = app
    return app
  }

  registerAction(action) {
    if (typeof action?.match !== 'function' || typeof action?.run !== 'function') {
      throw new Error('registerAction requires { match, run } functions')
    }
    this.actions.push(action)
    return this
  }

  async act(appOrTask, taskOrOptions = {}, maybeOptions = {}) {
    const [app, task, options] = normalizeActArgs(this.currentApp, appOrTask, taskOrOptions, maybeOptions)
    if (!app?.options) throw new Error('gui.act requires an app returned by gui.findApp(...)')

    for (const action of this.actions) {
      const intent = action.match({ agent: this, app, task, options })
      if (!intent) continue
      return action.run({ agent: this, app, task, options, intent })
    }

    throw new Error(`Unsupported task for ${app.app}: ${taskText(task)}`)
  }

  openCache(app = this.currentApp, options = {}) {
    if (!app?.options) throw new Error('openCache requires an app returned by gui.findApp(...)')
    return GuiCache.open({
      ...app.options,
      ...options,
      app: options.app ?? app.options.app,
      appCandidates: options.appCandidates ?? app.options.appCandidates,
      cacheDir: options.cacheDir ?? app.options.cacheDir,
      cacheMode: options.cacheMode ?? app.options.cacheMode,
      threshold: options.threshold ?? app.options.threshold,
      maxNodes: options.maxNodes ?? app.options.maxNodes,
      logCache: options.logCache ?? app.options.logCache ?? true,
    })
  }

  appConfig(name) {
    const key = normalizeAppName(name)
    return this.apps[key] ?? fallbackAppConfig(name, key)
  }
}

export function createCachedSimulang(config = {}) {
  if (isAgentConfig(config)) return new CachedSimulangAgent(config)
  return new CachedSimulangAgent({ defaults: config })
}

export function summarizeCacheResult(result) {
  return {
    target: result.target,
    success: result.success,
    cacheStatus: result.cacheStatus,
    cacheHit: result.cacheStatus === 'HIT',
    cacheKey: result.key ?? null,
    cachePath: result.cachePath ?? null,
    matchStatus: result.match.status,
    candidates: result.match.candidateCount,
    role: result.descriptor?.role ?? result.match.selected?.role ?? null,
    message: result.message,
  }
}

const gui = createCachedSimulang()
export default gui

function normalizeApps(apps) {
  if (Array.isArray(apps)) {
    return Object.fromEntries(apps.map((app) => [normalizeAppName(app.id ?? app.app), normalizeAppConfig(app)]))
  }
  return Object.fromEntries(
    Object.entries(apps).map(([key, app]) => [normalizeAppName(key), normalizeAppConfig({ id: key, ...app })]),
  )
}

function normalizeAppConfig(config) {
  const id = normalizeAppName(config.id ?? config.app)
  const app = config.app ?? config.id
  return {
    ...config,
    id,
    app,
    appCandidates: config.appCandidates ?? [app],
    cacheDir: config.cacheDir ?? `.gui-cache/${id}`,
  }
}

function fallbackAppConfig(name, id) {
  const app = String(name ?? '').trim()
  return {
    id,
    app,
    appCandidates: [app],
    cacheDir: `.gui-cache/${id}`,
  }
}

function normalizeActArgs(currentApp, appOrTask, taskOrOptions, maybeOptions) {
  if (appOrTask?.kind === 'cached-simulang-app') return [appOrTask, taskOrOptions, maybeOptions]
  return [currentApp, appOrTask, taskOrOptions]
}

function normalizeAppName(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function isAgentConfig(config) {
  return Boolean(config?.apps || config?.actions || config?.defaults)
}

function taskText(task) {
  if (typeof task === 'string') return task
  if (task && typeof task === 'object') return task.text ?? task.task ?? task.type ?? JSON.stringify(task)
  return String(task ?? '')
}
