import { sha256, stableJson } from './util.mjs'

export function variableKeys(variables = {}) {
  return Object.keys(variables ?? {}).sort()
}

export function cacheKey({ target, action, stableAppId, routeKey, variableKeys: keys = [] }) {
  return sha256(stableJson({
    target: normalizeTarget(target),
    action,
    stableAppId,
    routeKey,
    variableKeys: [...keys].sort(),
  }))
}

export function normalizeTarget(target) {
  return String(target ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}
