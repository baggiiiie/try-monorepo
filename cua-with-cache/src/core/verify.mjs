import { roleName, searchScope } from './descriptor.mjs'
import { safe } from './util.mjs'

export function verifyPredicate(scope, node, predicate, variables = {}) {
  if (!predicate) return true

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
