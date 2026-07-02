import { performAction } from './actions.mjs'
import { nodeDescriptor, resolveDescriptor, resolveTarget } from './descriptor.mjs'
import { cacheKey, normalizeTarget, variableKeys } from './key.mjs'
import { openScope } from './scope.mjs'
import { JsonCacheStorage } from './storage.mjs'
import { verifyPredicate } from './verify.mjs'

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
    })
  }

  constructor({ scope, context, pidsSeen, windowsSeen, cacheDir, cacheMode, threshold, maxNodes }) {
    this.scope = scope
    this.context = context
    this.pidsSeen = pidsSeen
    this.windowsSeen = windowsSeen
    this.threshold = threshold
    this.maxNodes = maxNodes
    this.storage = new JsonCacheStorage({ cacheDir, cacheMode })
  }

  async observe(spec) {
    return this.act({ ...spec, action: 'observe' })
  }

  async act(spec) {
    const normalized = normalizeSpec(spec)
    const keys = variableKeys(normalized.variables)
    const key = cacheKey({
      target: normalized.target,
      action: normalized.action,
      stableAppId: this.context.stableAppId,
      routeKey: this.context.routeKey,
      variableKeys: keys,
    })

    const entry = await this.storage.read(key)
    if (entry) {
      const hit = await this.tryCachedEntry(entry, normalized)
      if (hit.cacheStatus !== 'REFUSED') return { ...hit, key }

      const healed = await this.resolveAndStore(normalized, key, 'HEALED')
      if (healed.cacheStatus !== 'REFUSED') return { ...healed, key }
      return { ...hit, key }
    }

    return { ...(await this.resolveAndStore(normalized, key, 'MISS')), key }
  }

  async tryCachedEntry(entry, spec) {
    const match = resolveDescriptor(this.scope, entry.descriptor, this.resolveOptions())
    if (match.status !== 'unique') {
      return refused(spec, match, `cached descriptor resolved as ${match.status}`)
    }

    if (!verifyPredicate(this.scope, match.selectedNode, entry.verify?.pre, spec.variables)) {
      return refused(spec, match, 'pre-verification failed')
    }

    performAction(match.selectedNode, spec)

    if (!verifyPredicate(this.scope, match.selectedNode, entry.verify?.post, spec.variables)) {
      return refused(spec, match, 'post-verification failed')
    }

    return result('HIT', spec, match, entry.descriptor)
  }

  async resolveAndStore(spec, key, cacheStatus) {
    const match = resolveTarget(this.scope, spec.target, this.resolveOptions())
    if (match.status !== 'unique') {
      return refused(spec, match, `target resolved as ${match.status}`)
    }

    if (!verifyPredicate(this.scope, match.selectedNode, spec.verify?.pre, spec.variables)) {
      return refused(spec, match, 'pre-verification failed')
    }

    performAction(match.selectedNode, spec)

    if (!verifyPredicate(this.scope, match.selectedNode, spec.verify?.post, spec.variables)) {
      return refused(spec, match, 'post-verification failed')
    }

    const descriptor = nodeDescriptor(match.selectedNode, normalizeTarget(spec.target), this.context.containerBox)
    await this.storage.write(key, {
      version: 1,
      target: spec.target,
      action: { type: spec.action, valueVar: spec.valueVar ?? null },
      stableAppId: this.context.stableAppId,
      routeKey: this.context.routeKey,
      variableKeys: variableKeys(spec.variables),
      contextCheck: this.context.contextCheck,
      descriptor,
      verify: spec.verify ?? null,
    })

    return result(cacheStatus, spec, match, descriptor)
  }

  resolveOptions() {
    return {
      threshold: this.threshold,
      maxNodes: this.maxNodes,
      containerBox: this.context.containerBox,
    }
  }
}

function normalizeSpec(spec) {
  if (!spec?.target) throw new Error('act/observe requires a target')
  return {
    ...spec,
    target: normalizeTarget(spec.target),
    action: spec.action ?? 'observe',
    variables: spec.variables ?? {},
  }
}

function result(cacheStatus, spec, match, descriptor) {
  return {
    success: true,
    cacheStatus,
    target: spec.target,
    action: spec.action,
    descriptor,
    match: publicMatch(match),
    message: `${cacheStatus}: ${spec.target}`,
  }
}

function refused(spec, match, message) {
  return {
    success: false,
    cacheStatus: 'REFUSED',
    target: spec.target,
    action: spec.action,
    descriptor: null,
    match: publicMatch(match),
    message,
  }
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
  }
}
