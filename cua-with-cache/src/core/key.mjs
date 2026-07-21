import { sha256, stableJson } from './util.mjs'

export function variableKeys(variables = {}) {
  return Object.keys(variables ?? {}).sort()
}

export function cacheKey({ target, query = null, match = null, stableAppId, routeKey, operationKind = null, operationId = null, parentScopeKey = null }) {
  return sha256(stableJson({
    target: normalizeTarget(target),
    ...(query ? { query: normalizeTarget(query) } : {}),
    ...(match ? { match } : {}),
    stableAppId,
    routeKey,
    ...(operationKind ? { operationKind } : {}),
    ...(operationId ? { operationId: normalizeTarget(operationId) } : {}),
    ...(parentScopeKey ? { parentScopeKey } : {}),
  }))
}

export function normalizeTarget(target) {
  return String(target ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}
