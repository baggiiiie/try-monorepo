export function performAction(node, spec) {
  const action = spec.action ?? 'observe'
  if (action === 'observe') return
  if (action === 'activate') return node.activate()
  if (action === 'focus') return node.focus()
  if (action === 'toggle') return node.toggle()
  if (action === 'select') return node.select()
  if (action === 'expandCollapse') return node.expandCollapse()
  if (action === 'scrollIntoView') return node.scrollIntoView()
  if (action === 'setValue') {
    const value = spec.variables?.[spec.valueVar]
    if (value == null) throw new Error(`Missing variable value for ${spec.valueVar}`)
    return node.setValue(String(value))
  }
  throw new Error(`Unsupported action: ${action}`)
}

export function isAction(spec) {
  return (spec.action ?? 'observe') !== 'observe'
}
