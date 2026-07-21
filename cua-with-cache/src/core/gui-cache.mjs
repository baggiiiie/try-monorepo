import { resolve } from 'node:path'

import { isAction, performAction } from './actions.mjs'
import { nodeDescriptor, resolveDescriptor, resolveTarget } from './descriptor.mjs'
import { cacheKey, normalizeTarget } from './key.mjs'
import { openScope, scopeContext } from './scope.mjs'
import { JsonCacheStorage } from './storage.mjs'
import { isOutcomePredicate, predicateValidationError, verifyPredicate } from './verify.mjs'

export class GuiCache {
  static open(options = {}) {
    const { scope, context, pidsSeen, windowsSeen } = openScope(options)
    return new GuiCache({
      scope,
      context,
      pidsSeen,
      windowsSeen,
      cacheDir: options.cacheDir ?? '.gui-cache',
      cacheMode: options.cacheMode ?? 'auto',
      threshold: options.threshold ?? 0.35,
      maxNodes: options.maxNodes ?? 4000,
      minScore: options.minScore ?? 1.5,
      minScoreGap: options.minScoreGap ?? 0.25,
      highRiskMinScoreGap: options.highRiskMinScoreGap ?? 0.75,
      highRiskMinScore: options.highRiskMinScore ?? 2.5,
      highRiskCachedMinScore: options.highRiskCachedMinScore ?? 5,
      routeKey: options.routeKey ?? null,
      logCache: options.logCache ?? false,
    })
  }

  constructor({
    scope,
    context,
    pidsSeen,
    windowsSeen,
    cacheDir,
    cacheMode,
    threshold,
    maxNodes,
    minScore = 1.5,
    minScoreGap = 0.25,
    highRiskMinScoreGap = 0.75,
    highRiskMinScore = 2.5,
    highRiskCachedMinScore = 5,
    routeKey = null,
    logCache,
  }) {
    this.scope = scope
    this.context = context
    this.defaultRouteKey = context.routeKey
    this.pidsSeen = pidsSeen
    this.windowsSeen = windowsSeen
    this.threshold = threshold
    this.maxNodes = maxNodes
    this.minScore = minScore
    this.minScoreGap = minScoreGap
    this.highRiskMinScoreGap = highRiskMinScoreGap
    this.highRiskMinScore = highRiskMinScore
    this.highRiskCachedMinScore = highRiskCachedMinScore
    this.routeKeyOverride = routeKey == null ? null : normalizeRouteKey(routeKey)
    this.logCache = logCache
    this.cacheDirLogged = false
    this.storage = new JsonCacheStorage({ cacheDir, cacheMode })
  }

  async observe(target, options = {}) {
    const {
      timeoutMs = 0,
      pollMs = 100,
      ...observeOptions
    } = options
    const deadline = Date.now() + Math.max(0, timeoutMs)
    let report
    do {
      report = await this.act(target, { ...observeOptions, action: 'observe' })
      if (report.success || Date.now() >= deadline) return report
      await sleep(Math.max(0, pollMs))
    } while (Date.now() < deadline)
    return report
  }

  async act(target, options = {}) {
    const normalized = normalizeSpec(toSpec(target, options))
    const context = this.refreshContext()
    const key = cacheKey({
      target: normalized.target,
      stableAppId: context.stableAppId,
      routeKey: context.routeKey,
    })

    const verificationError = verificationSpecError(normalized)
    if (verificationError) {
      return this.cacheResult(refused(
        normalized,
        emptyMatch(),
        verificationError,
      ), key)
    }

    const entry = await this.storage.read(key)
    let grounded
    if (isUsableEntry(entry) && entryMatchesContext(entry, this.context)) {
      grounded = await this.tryCachedEntry(entry, normalized)
      if (grounded.cacheStatus === 'REFUSED') {
        grounded = await this.resolveAndStore(normalized, key, 'HEALED')
      }
    } else {
      grounded = await this.resolveAndStore(normalized, key, entry ? 'HEALED' : 'MISS')
    }

    if (grounded.cacheStatus === 'REFUSED') return this.cacheResult(grounded, key)
    return this.cacheResult(await this.executeOnce(grounded, normalized), key)
  }

  cacheResult(result, key) {
    const withCacheInfo = {
      ...result,
      key,
      cachePath: resolve(this.storage.pathForKey(key)),
    }
    // The live simulang node is carried non-enumerably so callers can read
    // from it directly (walk children, screenshot, read text) without a
    // second search, while JSON.stringify(report) stays clean.
    attachNode(withCacheInfo, result.node ?? null)
    this.logCacheResult(withCacheInfo)
    return withCacheInfo
  }

  logCacheResult(result) {
    if (!this.logCache) return
    if (!this.cacheDirLogged) {
      console.error(`[cache] dir: ${resolve(this.storage.cacheDir)}`)
      this.cacheDirLogged = true
    }
    console.error(`[cache] ${result.target}: ${cacheStatusLabel(result.cacheStatus)}`)
    console.error(`[cache]   path: ${result.cachePath}`)
  }

  async tryCachedEntry(entry, spec) {
    const match = resolveDescriptor(this.scope, entry.descriptor, this.resolveOptions(spec, { cached: true }))
    if (match.status !== 'unique') {
      return refused(spec, match, `cached descriptor resolved as ${match.status}`)
    }

    if (!verifyPredicate(this.scope, match.selectedNode, spec.verify?.pre, spec.variables)) {
      return refused(spec, match, 'pre-verification failed')
    }

    return result('HIT', spec, match, entry.descriptor)
  }

  async resolveAndStore(spec, key, cacheStatus) {
    const match = resolveTarget(this.scope, spec.target, this.resolveOptions(spec))
    if (match.status !== 'unique') {
      return refused(spec, match, `target resolved as ${match.status}`)
    }

    if (!verifyPredicate(this.scope, match.selectedNode, spec.verify?.pre, spec.variables)) {
      return refused(spec, match, 'pre-verification failed')
    }

    const descriptor = nodeDescriptor(match.selectedNode, normalizeTarget(spec.target), this.context.containerBox)
    await this.storage.write(key, {
      version: 2,
      target: spec.target,
      stableAppId: this.context.stableAppId,
      routeKey: this.context.routeKey,
      contextCheck: this.context.contextCheck,
      descriptor,
    })

    return result(cacheStatus, spec, match, descriptor)
  }

  async executeOnce(grounded, spec) {
    await performAction(grounded.node, spec)
    const actionPerformed = isAction(spec)
    if (!verifyPredicate(this.scope, grounded.node, spec.verify?.post, spec.variables)) {
      return refused(
        spec,
        grounded.matchInternal,
        `post-verification failed${actionPerformed ? '; action was not retried' : ''}`,
        { actionPerformed, descriptor: grounded.descriptor },
      )
    }
    return attachNode({
      ...grounded,
      actionPerformed,
    }, grounded.node, grounded.matchInternal)
  }

  setRoute(routeKey) {
    this.routeKeyOverride = routeKey == null ? null : normalizeRouteKey(routeKey)
    return this
  }

  refreshContext() {
    if (this.scope?.kind) {
      this.context = scopeContext(this.scope, this.context.stableAppId)
    } else {
      this.context = { ...this.context, routeKey: this.defaultRouteKey }
    }
    if (this.routeKeyOverride) {
      this.context = { ...this.context, routeKey: this.routeKeyOverride }
    }
    return this.context
  }

  resolveOptions(spec, { cached = false } = {}) {
    const highRisk = spec.risk === 'high'
    return {
      threshold: this.threshold,
      maxNodes: this.maxNodes,
      containerBox: this.context.containerBox,
      minScore: highRisk
        ? (cached ? this.highRiskCachedMinScore : this.highRiskMinScore)
        : this.minScore,
      minScoreGap: highRisk ? this.highRiskMinScoreGap : this.minScoreGap,
      // A descriptor can otherwise score as "unique" from role, geometry,
      // and supported actions alone even when it no longer represents the
      // requested concept (for example, an "Inbox" cache entry resolving to
      // Outlook's title bar). Never accept a grounding with no target text.
      requireTokenMatch: true,
    }
  }
}

function toSpec(target, options = {}) {
  if (target && typeof target === 'object') return { ...target, ...options }
  return { target, ...options }
}

function attachNode(obj, node, matchInternal = null) {
  Object.defineProperty(obj, 'node', { value: node ?? null, enumerable: false, configurable: true })
  if (matchInternal) {
    Object.defineProperty(obj, 'matchInternal', {
      value: matchInternal,
      enumerable: false,
      configurable: true,
    })
  }
  return obj
}

function normalizeSpec(spec) {
  if (!spec?.target) throw new Error('act/observe requires a target')
  return {
    ...spec,
    target: normalizeTarget(spec.target),
    action: spec.action ?? 'observe',
    risk: spec.risk ?? 'normal',
    variables: spec.variables ?? {},
  }
}

function result(cacheStatus, spec, match, descriptor) {
  return attachNode({
    success: true,
    cacheStatus,
    target: spec.target,
    action: spec.action,
    descriptor,
    match: publicMatch(match),
    actionPerformed: false,
    message: `${cacheStatus}: ${spec.target}`,
  }, match.selectedNode, match)
}

function refused(spec, match, message, { actionPerformed = false, descriptor = null } = {}) {
  return attachNode({
    success: false,
    cacheStatus: 'REFUSED',
    target: spec.target,
    action: spec.action,
    descriptor,
    match: publicMatch(match),
    actionPerformed,
    message,
  }, match.selectedNode ?? null, match)
}

function cacheStatusLabel(status) {
  if (status === 'HIT') return 'HIT'
  if (status === 'MISS') return 'MISS (not hit; resolved live and stored)'
  if (status === 'HEALED') return 'HEALED (not hit; stale cache refreshed)'
  if (status === 'REFUSED') return 'REFUSED (not hit; cache entry was not safe to use)'
  return `${status ?? 'UNKNOWN'} (not hit)`
}

function publicMatch(match) {
  return {
    status: match.status,
    rawCandidateCount: match.rawCandidateCount ?? 0,
    candidateCount: match.candidateCount ?? 0,
    plausibleCount: match.plausibleCount ?? 0,
    selected: match.selectedDescriptor ?? null,
    candidates: match.candidates ?? [],
    tieBreakScore: match.tieBreakScore ?? null,
    scoreGap: match.scoreGap ?? null,
  }
}

function emptyMatch() {
  return { status: 'none', candidates: [] }
}

function verificationSpecError(spec) {
  for (const phase of ['pre', 'post']) {
    const predicate = spec.verify?.[phase]
    const error = predicateValidationError(predicate)
    if (error) return `invalid ${phase}-verification: ${error}`
  }
  if (spec.risk !== 'high' || !isAction(spec)) return null
  if (!spec.verify?.pre || !spec.verify?.post) {
    return 'high-risk actions require explicit pre- and post-verification'
  }
  if (!isOutcomePredicate(spec.verify.post)) {
    return 'high-risk post-verification must assert an outcome'
  }
  return null
}

function isUsableEntry(entry) {
  return Boolean(
    entry
    && (entry.version === 1 || entry.version === 2)
    && entry.descriptor
    && typeof entry.descriptor.query === 'string',
  )
}

export function contextMatches(cached, current) {
  if (!cached || !current || cached.scopeKind !== current.scopeKind) return false
  for (const key of ['processName', 'titleHash', 'structuralHash']) {
    if (cached[key] && current[key] && cached[key] !== current[key]) return false
  }
  return true
}

function entryMatchesContext(entry, context) {
  return entry.stableAppId === context.stableAppId
    && entry.routeKey === context.routeKey
    && contextMatches(entry.contextCheck, context.contextCheck)
}

function normalizeRouteKey(routeKey) {
  const normalized = String(routeKey).trim()
  if (!normalized) throw new Error('routeKey must not be empty')
  return normalized
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
