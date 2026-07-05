import { sha256, stableJson } from './util.mjs'

export function variableKeys(variables = {}) {
  return Object.keys(variables ?? {}).sort()
}

export function cacheKey({ target, stableAppId, routeKey }) {
  return sha256(stableJson({
    target: normalizeTarget(target),
    stableAppId,
    routeKey,
  }))
}

export function normalizeTarget(target) {
  return String(target ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}
