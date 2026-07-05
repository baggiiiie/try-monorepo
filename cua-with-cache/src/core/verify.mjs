import { roleName, searchScope } from './descriptor.mjs'
import { safe } from './util.mjs'

const PREDICATE_KEYS = new Set([
  'role',
  'enabled',
  'textPresent',
  'valueContainsVar',
  'threshold',
  'maxNodes',
])
const ASSERTION_KEYS = new Set(['role', 'enabled', 'textPresent', 'valueContainsVar'])

export function predicateValidationError(predicate) {
  if (predicate == null) return null
  if (typeof predicate !== 'object' || Array.isArray(predicate)) return 'must be an object'
  const keys = Object.keys(predicate)
  const unknown = keys.filter((key) => !PREDICATE_KEYS.has(key))
  if (unknown.length > 0) return `contains unsupported keys: ${unknown.join(', ')}`
  if (!keys.some((key) => ASSERTION_KEYS.has(key))) return 'must contain at least one assertion'
  for (const key of ['role', 'textPresent', 'valueContainsVar']) {
    if (key in predicate && (typeof predicate[key] !== 'string' || !predicate[key].trim())) {
      return `${key} must be a non-empty string`
    }
  }
  if ('enabled' in predicate && typeof predicate.enabled !== 'boolean') {
    return 'enabled must be a boolean'
  }
  if ((predicate.threshold != null || predicate.maxNodes != null) && !predicate.textPresent) {
    return 'threshold and maxNodes require textPresent'
  }
  if (predicate.threshold != null
    && (!Number.isFinite(predicate.threshold) || predicate.threshold < 0 || predicate.threshold > 1)) {
    return 'threshold must be a number between 0 and 1'
  }
  if (predicate.maxNodes != null
    && (!Number.isInteger(predicate.maxNodes) || predicate.maxNodes <= 0)) {
    return 'maxNodes must be a positive integer'
  }
  return null
}

export function isOutcomePredicate(predicate) {
  return Boolean(predicate?.textPresent?.trim() || predicate?.valueContainsVar?.trim())
}

export function verifyPredicate(scope, node, predicate, variables = {}) {
  if (!predicate) return true
  if (predicateValidationError(predicate)) return false

  if (predicate.role) {
    const role = roleName(safe('role', () => node.role, 'unknown'))
    if (role !== predicate.role) return false
  }

  if (predicate.enabled != null) {
    const enabled = safe('isEnabled', () => node.isEnabled, null)
    if (enabled !== predicate.enabled) return false
  }

  if (predicate.textPresent) {
    const matches = searchScope(scope, predicate.textPresent, {
      threshold: predicate.threshold ?? 0.2,
      maxNodes: predicate.maxNodes ?? 2000,
    })
    if (matches.length === 0) return false
  }

  if (predicate.valueContainsVar) {
    const value = safe('value', () => node.value, '')
    const expected = variables[predicate.valueContainsVar]
    if (expected == null || !String(value).includes(String(expected))) return false
  }

  return true
}
