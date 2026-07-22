import { resolve } from 'node:path'

import { isAction, performAction } from './actions.mjs'
import { durableIdentityTokens, nodeDescriptor, resolveDescriptor, resolveTarget, searchScope } from './descriptor.mjs'
import { cacheKey, normalizeTarget } from './key.mjs'
import { nodeView, nodeViewFingerprint } from './node-view.mjs'
import { selectModelCandidate } from './pi-grounder.mjs'
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
      mouseController: options.mouseController ?? null,
      grounder: options.grounder ?? null,
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
    mouseController = null,
    grounder = null,
  }) {
    this.scope = scope
    this.appName = scope.appName ?? context.stableAppId
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
    this.mouseController = mouseController
    this.grounder = grounder
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
      if (report.success || report.modelAttempted || Date.now() >= deadline) return report
      await sleep(Math.max(0, pollMs))
    } while (Date.now() < deadline)
    return report
  }

  async observeMany(id, options = {}) {
    if (!options.within) throw new Error('observeMany requires within')
    const { timeoutMs = 0, pollMs = 100 } = options
    const deadline = Date.now() + Math.max(0, timeoutMs)
    let report
    do {
      report = await this.observeManyOnce(id, options)
      if (report.success || Date.now() >= deadline) return report
      await sleep(Math.max(0, pollMs))
    } while (true)
  }

  async observeManyOnce(id, options) {
    const parent = await this.resolveReference(options.within)
    if (!parent.success) return { success: false, id, available: 0, items: [], message: parent.message }
    let candidates
    try {
      candidates = descendants(parent.node, options.maxNodes ?? this.maxNodes)
        .filter((node) => collectionMatch(nodeView(node, { maxDepth: 0, maxNodes: 1 }), options))
    } catch (error) {
      return { success: false, id, available: 0, items: [], message: `Could not read collection: ${error.message}` }
    }
    const available = candidates.length
    const selected = candidates.slice(0, options.limit ?? available)
    const identity = options.identity ?? 'position'
    const allKeys = candidates.map((node, index) => identity === 'position'
      ? index
      : identity(nodeView(node, { maxDepth: 1, maxNodes: 30 }), index))
    if (identity !== 'position' && (allKeys.some((key) => typeof key !== 'string' || !key.trim()) || new Set(allKeys).size !== allKeys.length)) {
      return { success: false, id, available, items: [], message: 'Collection identities must be non-empty strings and unique across all candidates' }
    }
    const keys = allKeys.slice(0, selected.length)
    const parentLocator = parent.locator
    const items = selected.map((node, index) => attachLocator({
      success: true,
      target: `${id}[${String(keys[index])}]`,
      index,
      identity: keys[index],
      view: nodeView(node, { maxDepth: options.maxDepth ?? 2, maxNodes: options.itemMaxNodes ?? 100 }),
    }, {
      kind: 'collection-item', id, parent: parentLocator, options: collectionLocatorOptions(options),
      identity: identity === 'position' ? { type: 'position', value: index } : { type: 'key', value: keys[index], callback: identity },
    }))
    const require = options.require ?? 0
    return { success: items.length >= require, id, available, items, message: `Observed ${items.length}/${available} items` }
  }

  async extract(target, { project = (view) => view, validate, maxDepth = 6, maxNodes = 500 } = {}) {
    const resolved = await this.resolveReference(target)
    if (!resolved.success) return { success: false, data: null, fingerprint: null, message: resolved.message }
    const view = nodeView(resolved.node, { maxDepth, maxNodes })
    let data
    try {
      data = project(view)
      const valid = validate ? await validate(data, view) : true
      return { success: valid !== false, data, fingerprint: nodeViewFingerprint(view), message: valid === false ? 'Validation failed' : 'Extracted live data' }
    } catch (error) {
      return { success: false, data: null, fingerprint: nodeViewFingerprint(view), message: error.message }
    }
  }

  async waitFor(target, options = {}) {
    const { timeoutMs = 2000, pollMs = 100, until = (_data, report) => report.success, ...extractOptions } = options
    const deadline = Date.now() + Math.max(0, timeoutMs)
    let report
    do {
      report = await this.extract(target, extractOptions)
      if (report.success && await until(report.data, report)) return report
      if (Date.now() >= deadline) break
      await sleep(pollMs)
    } while (true)
    return { ...report, success: false, message: 'waitFor timed out' }
  }

  async waitForChange(target, options = {}) {
    if (!options.from) throw new Error('waitForChange requires an explicit from extraction or fingerprint')
    const baseline = typeof options.from === 'string' ? options.from : options.from.fingerprint
    if (!baseline) throw new Error('waitForChange baseline has no fingerprint')
    const { from, until, ...rest } = options
    return this.waitFor(target, {
      ...rest,
      until: async (data, report) => report.fingerprint !== baseline && (!until || await until(data, report)),
    })
  }

  async resolveReference(reference, options = {}) {
    const timeoutMs = options.timeoutMs ?? 0
    const pollMs = options.pollMs ?? 100
    const deadline = Date.now() + Math.max(0, timeoutMs)
    let report
    do {
      report = await this.resolveReferenceOnce(reference)
      if (report.success || Date.now() >= deadline) return report
      await sleep(Math.max(0, pollMs))
    } while (true)
  }

  async resolveReferenceOnce(reference) {
    const locator = reference?.locator
    if (!locator) {
      const observed = await this.observe(reference)
      return attachLocator(observed, rootLocator(observed))
    }
    if (locator.kind === 'root') return attachLocator(await this.observe(locator.target, locator.options), locator)
    if (locator.kind === 'scoped') {
      const parentReport = await this.resolveReferenceOnce(attachLocator({}, locator.parent))
      if (!parentReport.success) return parentReport
      const parent = attachLocator(attachNode({ success: true, target: 'scope' }, parentReport.node), locator.parent)
      return attachLocator(await this.observe(locator.target, { ...locator.options, within: parent }), locator)
    }
    const parentReport = await this.resolveReferenceOnce(attachLocator({}, locator.parent))
    if (!parentReport.success) return parentReport
    let nodes
    try { nodes = descendants(parentReport.node, locator.options.maxNodes ?? this.maxNodes)
      .filter((node) => collectionMatch(nodeView(node, { maxDepth: 0, maxNodes: 1 }), locator.options))
    } catch (error) {
      return { success: false, node: null, locator, message: `Could not read collection: ${error.message}` }
    }
    let matches
    if (locator.identity.type === 'position') matches = nodes.slice(locator.identity.value, locator.identity.value + 1)
    else matches = nodes.filter((node, index) => locator.identity.callback(nodeView(node, { maxDepth: 1, maxNodes: 30 }), index) === locator.identity.value)
    if (matches.length !== 1) return { success: false, node: null, locator, message: `Collection identity resolved ${matches.length} items` }
    return attachLocator(attachNode({ success: true, target: reference.target, message: 'Collection item re-resolved' }, matches[0]), locator)
  }

  async resolveLocator(locator) {
    const report = await this.resolveReference(attachLocator({}, locator))
    return report
  }

  async act(target, options = {}) {
    if (typeof options === 'string') options = { action: options }
    if (target?.locator) {
      const grounded = await this.resolveReference(target, options)
      if (!grounded.success) return grounded
      const spec = normalizeSpec({ target: target.target, ...options, mouseController: options.mouseController ?? this.mouseController })
      const verificationError = verificationSpecError(spec)
      if (verificationError) return attachLocator(refused(spec, emptyMatch(), verificationError), grounded.locator ?? target.locator)
      if (!verifyPredicate(this.scope, grounded.node, spec.verify?.pre, spec.variables)) {
        return attachLocator(refused(spec, emptyMatch(), 'pre-verification failed'), grounded.locator ?? target.locator)
      }
      const report = await this.executeOnce(attachNode({ ...grounded, cacheStatus: 'LIVE', descriptor: grounded.descriptor ?? null, match: grounded.match ?? emptyMatch() }, grounded.node, emptyMatch()), spec)
      return attachLocator(report, grounded.locator ?? target.locator)
    }
    const normalized = normalizeSpec({ ...toSpec(target, options), mouseController: options.mouseController ?? this.mouseController })
    const context = this.refreshContext()
    let operationScope = this.scope
    let parentScopeKey = null
    let parentLocator = null
    if (normalized.within) {
      const parent = await this.resolveReference(normalized.within)
      if (!parent.success) return parent
      operationScope = parent.node
      parentLocator = parent.locator
      parentScopeKey = locatorKey(parentLocator)
    }
    const key = cacheKey({
      target: normalized.target,
      stableAppId: context.stableAppId,
      routeKey: context.routeKey,
      operationKind: 'observe',
      operationId: normalized.id ?? normalized.target,
      parentScopeKey,
      query: normalized.query,
      match: serializableMatch(normalized.match ?? normalized),
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
      grounded = await this.tryCachedEntry(entry, normalized, operationScope)
      if (grounded.healable === true) {
        grounded = await this.resolveAndStore(normalized, key, 'HEALED', operationScope)
      }
    } else {
      grounded = await this.resolveAndStore(normalized, key, entry ? 'HEALED' : 'MISS', operationScope)
    }

    if (grounded.cacheStatus === 'REFUSED') return this.cacheResult(grounded, key)
    if (!singleMatch(nodeView(grounded.node, { maxDepth: 0, maxNodes: 1 }), normalized.match ?? normalized)) {
      return this.cacheResult(refused(normalized, grounded.matchInternal, 'match constraints failed'), key)
    }
    if (grounded.descriptor?.groundedBy === 'model') {
      const current = nodeDescriptor(grounded.node, grounded.descriptor.query, operationScope === this.scope
        ? this.context.containerBox
        : safeBoundingBox(operationScope) ?? this.context.containerBox)
      if (!sameReplayIdentity(grounded.descriptor, current)) {
        return this.cacheResult(markModelAttempted(refused(normalized, grounded.matchInternal, 'model-selected target changed before dispatch')), key)
      }
    }
    const report = this.cacheResult(await this.executeOnce(grounded, normalized), key)
    return attachLocator(report, parentLocator
      ? { kind: 'scoped', target: normalized.target, options: locatorOptions(normalized), parent: parentLocator }
      : { kind: 'root', target: normalized.target, options: locatorOptions(normalized) })
  }

  cacheResult(result, key) {
    const withCacheInfo = {
      ...result,
      key,
      cachePath: resolve(this.storage.pathForKey(key)),
    }
    if (result.modelAttempted) markModelAttempted(withCacheInfo)
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

  async tryCachedEntry(entry, spec, scope = this.scope) {
    const match = resolveDescriptor(scope, entry.descriptor, this.resolveOptions(spec, { cached: true }))
    if (match.status !== 'unique') {
      return markHealable(refused(spec, match, `cached descriptor resolved as ${match.status}`))
    }

    if (!verifyPredicate(this.scope, match.selectedNode, spec.verify?.pre, spec.variables)) {
      return refused(spec, match, 'pre-verification failed')
    }

    return result('HIT', spec, match, entry.descriptor)
  }

  async resolveAndStore(spec, key, cacheStatus, scope = this.scope) {
    let match
    if (this.grounder) {
      try {
        match = await this.resolveWithGrounder(spec, cacheStatus, scope)
      } catch (error) {
        return markModelAttempted(refused(spec, emptyMatch(), `model grounding failed: ${error.message}`))
      }
    } else {
      match = resolveTarget(scope, spec.query ?? spec.target, this.resolveOptions(spec))
    }
    if (match.status !== 'unique') {
      const report = refused(spec, match, `target resolved as ${match.status}`)
      return match.modelAttempted ? markModelAttempted(report) : report
    }

    if (!verifyPredicate(this.scope, match.selectedNode, spec.verify?.pre, spec.variables)) {
      const report = refused(spec, match, 'pre-verification failed')
      return match.modelAttempted ? markModelAttempted(report) : report
    }

    const containerBox = scope === this.scope
      ? this.context.containerBox
      : safeBoundingBox(scope) ?? this.context.containerBox
    let descriptor = nodeDescriptor(match.selectedNode, normalizeTarget(spec.query ?? spec.target), containerBox)
    if (this.grounder) {
      descriptor = modelReplayDescriptor(match.selectedDescriptor)
      if (!descriptor || !sameReplayIdentity(descriptor, nodeDescriptor(match.selectedNode, descriptor.query, containerBox))) {
        return markModelAttempted(refused(spec, match, 'model-selected target has no stable durable replay identity'))
      }
    }
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

  async resolveWithGrounder(spec, cacheStatus, scope) {
    const query = spec.query ?? spec.target
    const nodes = searchScope(scope, query, {
      threshold: spec.groundingThreshold ?? 0,
      maxNodes: this.maxNodes,
    }).filter((node) => singleMatch(nodeView(node, { maxDepth: 0, maxNodes: 1 }), spec.match ?? spec))
    const containerBox = scope === this.scope
      ? this.context.containerBox
      : safeBoundingBox(scope) ?? this.context.containerBox
    const candidates = nodes.map((node, id) => ({
      id,
      node,
      view: structuralView(nodeView(node, { maxDepth: 0, maxNodes: 1 })),
      descriptor: nodeDescriptor(node, normalizeTarget(query), containerBox),
    }))
    const choice = await selectModelCandidate(this.grounder, {
      target: spec.target,
      action: spec.action,
      app: this.context.stableAppId,
      scope: this.context.routeKey,
      reason: cacheStatus === 'MISS' ? 'cache-miss' : 'stale-cache',
    }, candidates)
    if (!choice) return { status: 'none', candidates: [], candidateCount: 0, modelAttempted: candidates.length > 0 }
    return {
      status: 'unique',
      rawCandidateCount: candidates.length,
      candidateCount: candidates.length,
      plausibleCount: candidates.length,
      selectedNode: choice.selected.node,
      selectedDescriptor: choice.selected.descriptor,
      selectedIndex: choice.selected.id,
      candidates: candidates.map((candidate) => candidate.descriptor),
      modelConfidence: choice.proposal.confidence,
      modelAttempted: true,
    }
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
    const match = spec.match ?? spec
    return {
      threshold: this.threshold,
      maxNodes: this.maxNodes,
      containerBox: this.context.containerBox,
      role: match.role ?? null,
      actions: match.actions ?? null,
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

function attachLocator(obj, locator) {
  Object.defineProperty(obj, 'locator', { value: locator, enumerable: false, configurable: true })
  return obj
}

function rootLocator(report) {
  return report?.locator ?? { kind: 'root', target: report.target, options: {} }
}

function locatorKey(locator) {
  if (!locator) return null
  if (locator.kind === 'root') return `root:${normalizeTarget(locator.target)}:${JSON.stringify(serializableLocatorOptions(locator.options))}`
  if (locator.kind === 'scoped') return `${locatorKey(locator.parent)}/scoped:${normalizeTarget(locator.target)}:${JSON.stringify(serializableLocatorOptions(locator.options))}`
  const identity = `${locator.identity?.type}:${JSON.stringify(locator.identity?.value)}`
  return `${locatorKey(locator.parent)}/collection:${normalizeTarget(locator.id)}:${JSON.stringify(serializableLocatorOptions(locator.options))}:${identity}`
}

function serializableMatch(options = {}) {
  const result = {}
  for (const key of ['role', 'enabled', 'actions', 'minHeight', 'minWidth']) {
    if (options[key] != null) result[key] = options[key]
  }
  return Object.keys(result).length ? result : null
}

function serializableLocatorOptions(options = {}) {
  return { query: options.query ? normalizeTarget(options.query) : null, match: serializableMatch(options.match ?? options) }
}

function safeBoundingBox(node) {
  try { return node?.boundingBox?.() ?? null } catch { return null }
}

function locatorOptions(spec) {
  const { timeoutMs, pollMs, within, action, variables, mouseController, ...options } = spec
  return options
}

function collectionLocatorOptions(options) {
  const { within, identity, limit, require, where, timeoutMs, pollMs, ...structural } = options
  return { ...structural, where }
}

function descendants(root, maxNodes) {
  const found = []
  const queue = [...safeChildren(root)]
  while (queue.length && found.length < maxNodes) {
    const node = queue.shift()
    found.push(node)
    queue.push(...safeChildren(node))
  }
  return found
}

function safeChildren(node) {
  const children = node?.children?.() ?? []
  if (!Array.isArray(children)) throw new Error('children() did not return an array')
  return children
}

function collectionMatch(view, options) {
  if (!view) return false
  if (options.role && view.role !== options.role) return false
  if (options.actions && !options.actions.every((action) => view.actions.includes(action))) return false
  if (options.minHeight && (!view.box || view.box.bottom - view.box.top < options.minHeight)) return false
  if (options.minWidth && (!view.box || view.box.right - view.box.left < options.minWidth)) return false
  return options.where ? Boolean(options.where(view)) : true
}

function singleMatch(view, options) {
  if (options.role && view.role !== options.role) return false
  if (options.enabled != null && view.enabled !== options.enabled) return false
  if (options.actions && !options.actions.every((action) => view.actions.includes(action))) return false
  if (typeof options === 'function') return Boolean(options(view))
  if (typeof options.where === 'function') return Boolean(options.where(view))
  return true
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

function markHealable(report) {
  Object.defineProperty(report, 'healable', { value: true, enumerable: false })
  return report
}

function markModelAttempted(report) {
  Object.defineProperty(report, 'modelAttempted', { value: true, enumerable: false })
  return report
}

function modelReplayDescriptor(descriptor) {
  const identity = durableIdentityTokens(descriptor?.directTokens)
  if (!identity.length) return null
  return { ...descriptor, query: identity.join(' '), groundedBy: 'model' }
}

function sameReplayIdentity(expected, actual) {
  if (expected.role !== actual.role || expected.classNameHash !== actual.classNameHash) return false
  const current = new Set(actual.directTokens ?? [])
  const identity = durableIdentityTokens(expected.directTokens)
  return identity.length > 0 && identity.every((token) => current.has(token))
}

function structuralView(view) {
  return Object.fromEntries(['role', 'enabled', 'actions', 'box'].filter((key) => view?.[key] != null).map((key) => [key, view[key]]))
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
