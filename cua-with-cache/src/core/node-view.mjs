import { roleName } from './descriptor.mjs'
import { hashObject, safe } from './util.mjs'

export function nodeView(node, { maxDepth = 6, maxNodes = 500 } = {}) {
  const state = { count: 0, maxNodes: Math.max(1, maxNodes) }
  return serialize(node, 0, Math.max(0, maxDepth), state)
}

export function nodeViewFingerprint(view) {
  return hashObject(view)
}

function serialize(node, depth, maxDepth, state) {
  if (!node || state.count >= state.maxNodes) return null
  state.count += 1
  const box = safe('boundingBox', () => node.boundingBox(), null)
  const name = safe('name', () => node.name, '')
  const description = safe('description', () => node.description, '')
  const value = safe('value', () => node.value, null)
  const view = {
    role: roleName(safe('role', () => node.role, 'unknown')),
    name: text(name),
    description: text(description),
    value: jsonValue(value),
    text: text([name, description, value].filter(Boolean).join(' | ')),
    aggregateText: text(safe('overallDescription', () => node.overallDescription, '')),
    enabled: safe('isEnabled', () => node.isEnabled, null),
    actions: safe('supportedActions', () => node.supportedActions(), []).map(String),
    box: box ? {
      left: number(box.left), top: number(box.top), right: number(box.right), bottom: number(box.bottom),
    } : null,
    children: [],
  }
  if (depth < maxDepth && state.count < state.maxNodes) {
    const children = safe('children', () => node.children(), [])
    for (const child of Array.isArray(children) ? children : []) {
      const childView = serialize(child, depth + 1, maxDepth, state)
      if (childView) view.children.push(childView)
      if (state.count >= state.maxNodes) break
    }
  }
  return view
}

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 8000)
}

function jsonValue(value) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value
  return text(value)
}

function number(value) {
  return Number.isFinite(value) ? value : 0
}
