import { readTopInboxEmails } from './apps/outlook/read-emails.mjs'
import { GuiCache } from './core/gui-cache.mjs'

const DEFAULT_TARGETS = ['Search', 'Inbox']

const APP_CONFIGS = {
  outlook: {
    id: 'outlook',
    app: 'Microsoft Outlook',
    appCandidates: ['Microsoft Outlook', 'Outlook'],
    cacheDir: '.gui-cache/outlook',
    threshold: 0.35,
    maxNodes: 1000,
    openApp: true,
    focusApp: true,
    targets: DEFAULT_TARGETS,
  },
}

export class CachedSimulangAgent {
  constructor(defaults = {}) {
    this.defaults = defaults
  }

  findApp(name, options = {}) {
    const config = appConfig(name)
    const appOptions = {
      ...config,
      ...this.defaults,
      ...options,
      app: options.app ?? config.app,
      appCandidates: options.appCandidates ?? config.appCandidates,
      cacheDir: options.cacheDir ?? config.cacheDir,
      cacheMode: options.cacheMode ?? this.defaults.cacheMode ?? 'auto',
      threshold: options.threshold ?? this.defaults.threshold ?? config.threshold,
      maxNodes: options.maxNodes ?? this.defaults.maxNodes ?? config.maxNodes,
      targets: options.targets ?? config.targets,
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

  async act(appOrTask, taskOrOptions = {}, maybeOptions = {}) {
    const [app, task, options] = normalizeActArgs(this.currentApp, appOrTask, taskOrOptions, maybeOptions)
    if (!app?.options) throw new Error('gui.act requires an app returned by gui.findApp(...)')

    const intent = parseIntent(task, options)
    if (app.id === 'outlook' && intent.type === 'readTopEmails') {
      return runOutlookEmailAction(app, intent, options)
    }

    throw new Error(`Unsupported task for ${app.app}: ${intent.text}`)
  }
}

export function createCachedSimulang(defaults = {}) {
  return new CachedSimulangAgent(defaults)
}

const gui = createCachedSimulang()
export default gui

async function runOutlookEmailAction(app, intent, options) {
  const cache = GuiCache.open({
    ...app.options,
    ...options,
    app: options.app ?? app.options.app,
    appCandidates: options.appCandidates ?? app.options.appCandidates,
    cacheDir: options.cacheDir ?? app.options.cacheDir,
    cacheMode: options.cacheMode ?? app.options.cacheMode,
    threshold: options.threshold ?? app.options.threshold,
    maxNodes: options.maxNodes ?? app.options.maxNodes,
  })
  const targets = options.targets ?? app.options.targets ?? DEFAULT_TARGETS
  const results = []
  for (const target of targets) {
    results.push(await cache.observe({ target }))
  }

  const emailCheck = await readTopInboxEmails(cache, {
    emailCount: intent.emailCount,
    maxNodes: options.maxNodes ?? app.options.maxNodes,
    readDelayMs: options.readDelayMs ?? app.options.readDelayMs,
    bodyMaxChars: options.bodyMaxChars ?? app.options.bodyMaxChars,
  })

  return {
    success: results.every((result) => result.success) && emailCheck.success,
    app: app.app,
    appId: app.id,
    task: intent.text,
    intent: {
      type: intent.type,
      emailCount: intent.emailCount,
      fields: intent.fields,
    },
    cacheDir: app.options.cacheDir,
    cacheMode: app.options.cacheMode,
    threshold: app.options.threshold,
    maxNodes: app.options.maxNodes,
    scope: {
      kind: cache.scope.kind,
      pid: cache.scope.pid,
      pidsSeen: cache.pidsSeen,
      windowsSeen: cache.windowsSeen,
    },
    context: cache.context,
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
    emailCheck,
  }
}

function appConfig(name) {
  const key = normalizeAppName(name)
  const config = APP_CONFIGS[key]
  if (!config) throw new Error(`Unsupported app: ${name}`)
  return config
}

function normalizeActArgs(currentApp, appOrTask, taskOrOptions, maybeOptions) {
  if (appOrTask?.kind === 'cached-simulang-app') return [appOrTask, taskOrOptions, maybeOptions]
  return [currentApp, appOrTask, taskOrOptions]
}

function normalizeAppName(name) {
  const value = String(name ?? '').trim().toLowerCase()
  if (value === 'outlook' || value === 'microsoft outlook') return 'outlook'
  return value
}

function parseIntent(task, options) {
  if (task && typeof task === 'object') {
    const type = normalizeIntentType(task.type ?? task.intent)
    return {
      type,
      text: task.text ?? task.task ?? type,
      emailCount: task.count ?? task.emailCount ?? options.emailCount ?? 3,
      fields: task.fields ?? options.fields ?? ['subject', 'sender', 'content', 'sent'],
    }
  }

  const text = String(task ?? '').trim()
  const lower = text.toLowerCase()
  if (/\b(email|emails|mail|message|messages|inbox)\b/.test(lower)) {
    return {
      type: 'readTopEmails',
      text,
      emailCount: options.emailCount ?? emailCountFromText(lower) ?? 3,
      fields: options.fields ?? fieldsFromText(lower),
    }
  }

  throw new Error(`Unsupported task: ${text}`)
}

function normalizeIntentType(type) {
  const value = String(type ?? '').trim().toLowerCase()
  if (['readtopemails', 'checktopemails', 'reademails', 'checkemails'].includes(value)) return 'readTopEmails'
  throw new Error(`Unsupported intent type: ${type}`)
}

function emailCountFromText(text) {
  const match = text.match(/\b(?:first|top)\s+(\d+)\b/) ?? text.match(/\b(\d+)\s+(?:email|emails|mail|message|messages)\b/)
  return match ? Number(match[1]) : null
}

function fieldsFromText(text) {
  const fields = []
  if (/\bsubject\b/.test(text)) fields.push('subject')
  if (/\b(sender|from)\b/.test(text)) fields.push('sender')
  if (/\b(content|body)\b/.test(text)) fields.push('content')
  if (/\b(date|sent|time)\b/.test(text)) fields.push('sent')
  if (/\b(other info|metadata|details)\b/.test(text) && !fields.includes('sent')) fields.push('sent')
  return fields.length > 0 ? fields : ['subject', 'sender', 'content', 'sent']
}
