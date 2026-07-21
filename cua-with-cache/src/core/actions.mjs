import { Button, Coordinate, Direction, MouseController } from '@simular-ai/simulang-js'

export function performAction(node, spec) {
  const action = spec.action ?? 'observe'
  if (action === 'observe') return
  if (action === 'activate') return withFallback(node, spec, () => node.activate())
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

function withFallback(node, spec, accessibility) {
  const strategies = spec.strategies ?? ['accessibility']
  if (strategies.includes('accessibility')) {
    try {
      return accessibility()
    } catch (error) {
      if (!strategies.includes('click') || !isUnsupportedAction(error)) throw error
    }
  }
  if (!strategies.includes('click')) throw new Error('No usable action strategy')
  const box = node.boundingBox()
  if (!box) throw new Error('Target has no bounding box for click fallback')
  const { xRatio = 0.5, yRatio = 0.5, inset = 1 } = spec.click ?? {}
  const left = box.left + inset
  const top = box.top + inset
  const width = Math.max(0, box.right - box.left - inset * 2)
  const height = Math.max(0, box.bottom - box.top - inset * 2)
  const mouse = spec.mouseController ?? new MouseController()
  mouse.moveMouse(Math.round(left + width * clamp(xRatio)), Math.round(top + height * clamp(yRatio)), Coordinate.Abs)
  return mouse.button(Button.Left, Direction.Click)
}

function isUnsupportedAction(error) {
  const code = error?.code ?? error?.cause?.code
  if (Number(code) === -25205 || String(code).toLowerCase() === 'attributeunsupported') return true
  const message = [error?.name, error?.message, error?.cause?.message].filter(Boolean).join(' ')
  return /AXError[^\n]*AttributeUnsupported|AttributeUnsupported|(?:AX|accessibility)\s*(?:error)?[^\n]*-25205/i.test(message)
}

function clamp(value) {
  return Math.max(0, Math.min(1, Number(value)))
}

export function isAction(spec) {
  return (spec.action ?? 'observe') !== 'observe'
}
