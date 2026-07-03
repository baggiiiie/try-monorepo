import { roleName, safe } from '../../src/index.mjs'

// Generic accessibility-tree helpers shared by the example app capabilities.
// These are app-agnostic wrappers over simulang's AccessibilityNode; anything
// Outlook/Teams-specific (text cleaning, row parsing) stays in the app files.

export function nodeRole(node) {
  return roleName(safe('role', () => node.role, 'unknown'))
}

export function nodeChildren(node) {
  const children = safe('children', () => node.children(), [])
  return Array.isArray(children) ? children : []
}

export function nodeActions(node) {
  const actions = safe('supportedActions', () => node.supportedActions(), [])
  return Array.isArray(actions) ? actions : []
}

export function nodeBox(node) {
  if (!node) return null
  const box = safe('boundingBox', () => node.boundingBox(), null)
  return box && typeof box === 'object' ? box : null
}

export function boxKey(box) {
  return box ? [box.left, box.top, box.right, box.bottom].map((value) => Math.round(value)).join(',') : 'no-box'
}

// Join a node's text-bearing fields (name | description | value, plus
// overallDescription when `full`). Pass `clean` to normalize/redact per app.
export function nodeText(node, { full = false, clean = (value) => value } = {}) {
  const parts = [
    safe('name', () => node.name, ''),
    safe('description', () => node.description, ''),
    safe('value', () => node.value, ''),
  ]
  if (full) parts.push(safe('overallDescription', () => node.overallDescription, ''))
  return clean(parts.filter(Boolean).join(' | '))
}

// Depth-first walk with cycle/size guards. `keyText(node)` supplies the text
// used in the per-node dedupe key (app-specific cleaning lives in the caller).
export function walkNode(root, visitor, { maxDepth = 12, maxNodes = 4000, keyText = () => '' } = {}) {
  const state = { seen: new Set(), count: 0 }
  const walk = (node, depth) => {
    if (!node || depth > maxDepth || state.count > maxNodes) return
    state.count += 1
    const key = `${depth}:${nodeRole(node)}:${boxKey(nodeBox(node))}:${String(keyText(node)).slice(0, 100)}`
    if (state.seen.has(key)) return
    state.seen.add(key)
    visitor(node, depth)
    for (const child of nodeChildren(node)) walk(child, depth + 1)
  }
  walk(root, 0)
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
