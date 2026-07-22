import { cacheKey } from '../core/key.mjs'
import { durableIdentityTokens, sanitizedTokens } from '../core/descriptor.mjs'
import { selectModelCandidate } from '../core/pi-grounder.mjs'
import { JsonCacheStorage } from '../core/storage.mjs'
import { CuaDriverCli } from './driver.mjs'

export async function openCuaApp(name, config = {}) {
  const driver = config.driver ?? new CuaDriverCli(config.driverOptions)
  const launched = await driver.call('launch_app', config.bundleId
    ? { bundle_id: config.bundleId, ...(config.launch ?? {}) }
    : { name: config.name ?? String(name), ...(config.launch ?? {}) })
  const data = unwrap(launched)
  const window = selectCuaWindow(data.windows ?? [], config.windowTitle ?? name)
  if (!window) throw new Error(`Cua Driver launched ${name}, but returned no visible titled window`)
  return new CuaGuiCache({ ...config, name, driver, pid: data.pid, window })
}

export function selectCuaWindow(windows, titleHint = '') {
  const hint = norm(titleHint)
  return windows.filter((w) => visible(w) && String(w.title ?? w.name ?? '').trim()).sort((a, b) => {
    const am = norm(a.title ?? a.name).includes(hint) ? 1 : 0
    const bm = norm(b.title ?? b.name).includes(hint) ? 1 : 0
    return bm - am || area(bounds(b)) - area(bounds(a)) || Number(a.window_id ?? a.id) - Number(b.window_id ?? b.id)
  })[0] ?? null
}

export class CuaGuiCache {
  constructor({ name, bundleId, driver, pid, window, cacheDir, cacheMode = 'auto', minScore = 3, minScoreGap = .75, maxElements = 4000, maxDepth = 25, grounder = null, groundingMaxCandidates = 200 }) {
    this.name = name
    this.bundleId = bundleId ?? null
    this.driver = driver
    this.pid = pid
    this.window = window
    this.windowId = window.window_id ?? window.id
    this.storage = new JsonCacheStorage({ cacheDir: cacheDir ?? `.gui-cache/cua-${slug(name)}`, cacheMode })
    this.minScore = minScore
    this.minScoreGap = minScoreGap
    this.maxElements = maxElements
    this.maxDepth = maxDepth
    this.grounder = grounder
    this.groundingMaxCandidates = groundingMaxCandidates
  }

  async snapshot({ includeScreenshot = false } = {}) {
    const raw = await this.driver.call('get_window_state', { pid: this.pid, window_id: this.windowId, include_screenshot: includeScreenshot, max_elements: this.maxElements, max_depth: this.maxDepth })
    const data = unwrap(raw)
    const source = data.elements ?? data.structuredContent?.elements ?? raw.structuredContent?.elements ?? []
    return {
      elements: source.map(normalizeElement),
      truncated: Boolean(data.truncated || source.length >= this.maxElements),
      screenshotWidth: Number(data.screenshot_width ?? 0) || null,
      screenshotHeight: Number(data.screenshot_height ?? 0) || null,
    }
  }

  key(concept, options = {}) {
    return cacheKey({ target: concept, query: options.query, match: serializableMatch(options), stableAppId: this.bundleId ?? norm(this.name), routeKey: `window:${norm(this.window.title ?? this.window.name)}`, parentScopeKey: locatorOf(options.within)?.scopeKey ?? options.within?.key ?? null })
  }

  async observe(concept, options = {}) {
    const key = this.key(concept, options)
    const cached = await this.storage.read(key)
    const snap = await this.snapshot()
    const parent = options.within ? resolveLocator(locatorOf(options.within), snap, this) : null
    if (options.within && !parent?.success) return report(false, concept, key, 'REFUSED', { status: 'parent-miss' }, null, parent?.message)
    const pool = parent ? snap.elements.filter((e) => descendant(e, parent.element, snap.elements)) : snap.elements
    let match = cached ? resolve(pool, cached.descriptor, { ...options, requireIdentity: true }, this) : null
    let cacheStatus = cached && match?.status === 'unique' ? 'HIT' : cached ? 'HEALED' : 'MISS'
    if (!match || match.status !== 'unique') {
      try {
        match = this.grounder
          ? await this.resolveWithGrounder(concept, options, cacheStatus, pool, snap)
          : resolve(pool, seedDescriptor(concept, options), { ...options, requireIdentity: true }, this)
      } catch (error) {
        return report(false, concept, key, 'REFUSED', { status: 'model-error' }, null, `model grounding failed: ${error.message}`)
      }
    }
    if (match.status !== 'unique') return report(false, concept, key, cacheStatus === 'MISS' ? 'REFUSED' : cacheStatus, match, null, `grounding ${match.status}`)
    const descriptor = cacheStatus === 'HIT' ? cached.descriptor : {
      ...descriptorFor(match.element, concept, options, snap.elements),
      ...(this.grounder ? { groundedBy: 'model' } : {}),
    }
    if (this.grounder && cacheStatus !== 'HIT' && !descriptorIdentity(descriptor)) {
      return report(false, concept, key, 'REFUSED', match, null, 'model-selected target has no durable replay identity')
    }
    if (cacheStatus !== 'HIT') await this.storage.write(key, { version: 1, descriptor })
    const out = report(true, concept, key, cacheStatus, match, descriptor)
    attachLocator(out, { kind: parent ? 'scoped' : 'root', descriptor, query: options.query ?? concept, match: serializableMatch(options), parent: locatorOf(options.within) ?? null, scopeKey: key })
    return out
  }

  async resolveWithGrounder(concept, options, cacheStatus, pool, snap) {
    const seed = seedDescriptor(concept, options)
    const ranked = pool.filter((element) => structural(element, options))
      .map((element) => ({ element, score: score(element, seed, snap.elements) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, this.groundingMaxCandidates)
    const candidates = ranked.map(({ element }, id) => ({
      id,
      element,
      view: { role: element.role, actions: element.actions, frame: element.frame },
      descriptor: descriptorFor(element, concept, options, snap.elements),
    }))
    const choice = await selectModelCandidate(this.grounder, {
      target: concept,
      action: options.action ?? 'observe',
      app: this.bundleId ?? this.name,
      scope: 'window',
      reason: cacheStatus === 'MISS' ? 'cache-miss' : 'stale-cache',
    }, candidates)
    if (!choice) return { status: 'miss', candidateCount: 0, score: 0, scoreGap: 0 }
    return {
      status: 'unique',
      candidateCount: candidates.length,
      score: ranked[choice.selected.id]?.score ?? 0,
      scoreGap: null,
      modelConfidence: choice.proposal.confidence,
      element: choice.selected.element,
    }
  }

  async observeMany(concept, options = {}) {
    const snap = await this.snapshot()
    const parent = options.within ? resolveLocator(locatorOf(options.within), snap, this) : null
    if (options.within && !parent?.success) return { success: false, items: [], message: parent?.message ?? 'invalid parent locator' }
    let candidates = snap.elements.filter((e) => (!parent || descendant(e, parent.element, snap.elements)) && structural(e, options))
    if (options.where) candidates = candidates.filter((e) => options.where(subtree(e, snap.elements)))
    const identities = candidates.map((e, i) => options.identity === 'position' || !options.identity ? String(i) : String(options.identity(subtree(e, snap.elements), i) ?? '').trim())
    if (identities.some((x) => !x) || new Set(identities).size !== identities.length) return { success: false, items: [], message: 'collection identities must be non-empty and unique across all candidates' }
    if (options.require != null && candidates.length < options.require) return { success: false, items: [], message: `required ${options.require} items, found ${candidates.length}` }
    const key = this.key(concept, options)
    const selectorKey = cacheKey({ target: concept, query: concept, match: serializableMatch(options), stableAppId: this.bundleId ?? norm(this.name), routeKey: key, parentScopeKey: locatorOf(options.within)?.scopeKey })
    return { success: true, concept, key, items: candidates.slice(0, options.limit ?? candidates.length).map((e, i) => {
      const locator = { kind: 'collection-item', selectorKey, identity: identities[i], position: i, identityMode: options.identity === 'position' || !options.identity ? 'position' : 'callback', options: collectionOptions(options), parent: locatorOf(options.within), scopeKey: `${selectorKey}:${identities[i]}` }
      const item = { kind: 'cua-collection-item', concept, key: locator.scopeKey, identity: identities[i], position: i }
      attachLocator(item, locator); return item
    }) }
  }

  async resolveReference(ref, snapshotOptions) {
    if (typeof ref === 'string') ref = await this.observe(ref)
    if (!ref?.success && !locatorOf(ref)) return ref ?? { success: false, message: 'invalid reference' }
    const snap = await this.snapshot(snapshotOptions)
    const result = resolveLocator(locatorOf(ref), snap, this)
    return result.success ? { ...result, snapshot: snap } : result
  }

  async act(target, options = {}) {
    if (typeof options === 'string') options = { action: options }
    const ref = typeof target === 'string' ? await this.observe(target, options) : target
    const pixelAddressing = options.addressing === 'pixel'
    const fresh = await this.resolveReference(ref, { includeScreenshot: pixelAddressing })
    if (!fresh.success) return { success: false, actionRequested: false, actionPerformed: false, actionOutcome: 'rejected', message: fresh.message }
    const action = options.action ?? 'click'
    const tool = action === 'setValue' ? 'set_value' : action === 'typeText' ? 'type_text' : action === 'press' ? 'click' : action
    if (!['click', 'set_value', 'type_text'].includes(tool)) return { success: false, actionRequested: false, actionPerformed: false, actionOutcome: 'rejected', message: `unsupported CUA action: ${action}` }
    const e = fresh.element
    if (pixelAddressing && tool !== 'click') return { success: false, actionRequested: false, actionPerformed: false, actionOutcome: 'rejected', message: 'pixel addressing is supported only for click/press actions' }
    const point = pixelAddressing ? screenshotPoint(e.frame, this.window, fresh.snapshot) : null
    if (pixelAddressing && !point) return { success: false, actionRequested: false, actionPerformed: false, actionOutcome: 'rejected', message: 'pixel addressing requires an element frame and capturable window screenshot' }
    const input = { pid: this.pid, window_id: this.windowId, ...(point ?? (e.element_token ? { element_token: e.element_token } : { element_index: e.element_index })) }
    if (tool === 'click') Object.assign(input, { action: options.pressAction ?? 'press', delivery_mode: options.deliveryMode ?? 'background' })
    if (tool === 'set_value') input.value = String(options.value ?? '')
    if (tool === 'type_text') Object.assign(input, { text: String(options.text ?? options.value ?? ''), delivery_mode: options.deliveryMode ?? 'background' })
    try {
      const driverResult = await this.driver.call(tool, input)
      return { success: true, actionRequested: true, actionPerformed: true, actionOutcome: 'accepted', action, driverResult, message: 'action accepted once; verify via fresh state' }
    } catch (error) {
      const rejected = error?.name === 'CuaDriverError' && ['background_unavailable', 'desktop_scope_disabled'].includes(error.code)
      return { success: false, actionRequested: true, actionPerformed: false, actionOutcome: rejected ? 'rejected' : 'unknown', action, error: error.message, message: 'driver action failed after dispatch was requested; not retried' }
    }
  }

  async extract(target, { project = (view) => view, validate } = {}) {
    const fresh = await this.resolveReference(typeof target === 'string' ? await this.observe(target) : target)
    if (!fresh.success) return { success: false, message: fresh.message }
    const view = subtree(fresh.element, fresh.snapshot.elements)
    const data = project(view)
    return { success: validate ? Boolean(validate(data, view)) : true, data, view, fingerprint: fingerprint(data) }
  }

  async waitFor(target, options = {}) {
    const deadline = Date.now() + (options.timeoutMs ?? 5000)
    do {
      const out = await this.extract(target, options)
      if (out.success && (!options.until || options.until(out.data, out.view))) return out
      await new Promise((r) => setTimeout(r, options.pollMs ?? 100))
    } while (Date.now() <= deadline)
    return { success: false, message: 'waitFor timed out' }
  }
}

function unwrap(raw) { return raw?.structuredContent ?? raw?.result?.structuredContent ?? raw?.result ?? raw }
function normalizeElement(e) {
  const frame = e.frame ? { x: Number(e.frame.x ?? 0), y: Number(e.frame.y ?? 0), w: Number(e.frame.w ?? e.frame.width ?? 0), h: Number(e.frame.h ?? e.frame.height ?? 0) } : null
  const view = { element_index: e.element_index, ...(e.element_token ? { element_token: e.element_token } : {}), role: String(e.role ?? ''), label: String(e.label ?? e.name ?? ''), value: e.value == null ? null : String(e.value), identifier: String(e.identifier ?? ''), help: String(e.help ?? ''), actions: [...(e.actions ?? [])].map(String).sort(), frame, parent_index: e.parent_index ?? null, depth: e.depth ?? null }
  return JSON.parse(JSON.stringify(view))
}
function descriptorFor(e, concept, options, all) { const query = options.query ?? concept; return { concept: String(concept), query: options.query ?? null, role: e.role, labelTokens: sanitizedTokens(e.label, query), identifierTokens: sanitizedTokens(e.identifier, query), helpTokens: sanitizedTokens(e.help, query), actions: e.actions, ancestorRoles: ancestors(e, all).map((x) => x.role).filter(Boolean).slice(-4), relativeFrame: relative(e.frame, bounds(options.within?.window ?? null) ?? boundsFromElements(all)) } }
function seedDescriptor(concept, options) { return { concept, query: options.query, role: options.role, labelTokens: tokens(options.query ?? concept), actions: options.actions ?? [] } }
function resolve(elements, d, options, gui) {
  const scored = elements.filter((e) => structural(e, options)).map((element) => ({ element, score: score(element, d, elements) })).sort((a, b) => b.score - a.score)
  const best = scored[0], gap = best ? best.score - (scored[1]?.score ?? 0) : 0
  if (best && options.requireIdentity && !identityMatches(best.element, d)) return { status: 'miss', candidateCount: scored.length, score: best.score, scoreGap: gap }
  if (!best || best.score < gui.minScore) return { status: 'miss', candidateCount: scored.length, score: best?.score ?? 0, scoreGap: gap }
  if (scored[1] && gap < gui.minScoreGap) return { status: 'ambiguous', candidateCount: scored.length, score: best.score, scoreGap: gap }
  return { status: 'unique', candidateCount: scored.length, score: best.score, scoreGap: gap, element: best.element }
}
function identityMatches(e, d) {
  const expected = durableIdentityTokens([...(d.labelTokens ?? []), ...(d.identifierTokens ?? []), ...(d.helpTokens ?? [])])
  const actual = new Set([...tokens(e.label), ...tokens(e.identifier), ...tokens(e.help)])
  return expected.length > 0 && expected.every((token) => actual.has(token))
}
function descriptorIdentity(d) { return durableIdentityTokens([...(d.labelTokens ?? []), ...(d.identifierTokens ?? []), ...(d.helpTokens ?? [])]).length > 0 }
function score(e, d, all) { let s = e.role && e.role === d.role ? 3 : 0; s += overlap(tokens(e.label), d.labelTokens) * 4; s += overlap(tokens(e.identifier), d.identifierTokens) * 3; s += overlap(tokens(e.help), d.helpTokens) * 2; s += overlap(e.actions, d.actions); s += overlap(ancestors(e, all).map((x) => x.role), d.ancestorRoles); if (d.relativeFrame && e.frame) s += Math.max(0, 1 - distance(relative(e.frame, boundsFromElements(all)), d.relativeFrame)); return s }
function structural(e, o = {}) { return (!o.role || e.role === o.role) && (!o.actions || o.actions.every((a) => e.actions.includes(a))) && (!o.frame || Object.entries(o.frame).every(([k, v]) => e.frame && Number(e.frame[k]) === Number(v))) }
function ancestors(e, all) { const out = []; let p = e.parent_index; const map = new Map(all.map((x) => [x.element_index, x])); while (p != null && map.has(p) && out.length < 20) { const x = map.get(p); out.unshift(x); p = x.parent_index } return out }
function descendant(e, parent, all) { return ancestors(e, all).some((x) => x.element_index === parent.element_index) }
function tokens(s) { return [...new Set(norm(s).split(/[^a-z0-9]+/).filter((x) => x.length > 1))] }
function overlap(a = [], b = []) { const set = new Set(a); return b.filter((x) => set.has(x)).length }
function relative(f, b) { return f && b ? { x: +(f.x / Math.max(1, b.w)).toFixed(3), y: +(f.y / Math.max(1, b.h)).toFixed(3), w: +(f.w / Math.max(1, b.w)).toFixed(3), h: +(f.h / Math.max(1, b.h)).toFixed(3) } : null }
function distance(a, b) { return a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.w - b.w, a.h - b.h) : 9 }
function boundsFromElements(es) { const fs = es.map((e) => e.frame).filter(Boolean); return fs.length ? { x: Math.min(...fs.map((f) => f.x)), y: Math.min(...fs.map((f) => f.y)), w: Math.max(...fs.map((f) => f.x + f.w)) - Math.min(...fs.map((f) => f.x)), h: Math.max(...fs.map((f) => f.y + f.h)) - Math.min(...fs.map((f) => f.y)) } : null }
function collectionOptions(o) { return { role: o.role, actions: o.actions, frame: o.frame, where: o.where, identity: o.identity } }
function serializableMatch(o) { return Object.fromEntries(['role', 'actions', 'frame'].filter((k) => o[k] != null).map((k) => [k, o[k]])) }
function report(success, target, key, cacheStatus, match, descriptor, message = 'grounded') { return { success, target, key, cacheStatus, match: { status: match.status, candidateCount: match.candidateCount, score: match.score, scoreGap: match.scoreGap }, descriptor, message } }
function attachLocator(value, locator) { Object.defineProperty(value, 'locator', { value: locator, enumerable: false }) }
function locatorOf(value) { return value?.locator ?? null }
function resolveLocator(locator, snap, gui) {
  if (!locator) return { success: false, message: 'reference has no hierarchical locator' }
  const parent = locator.parent ? resolveLocator(locator.parent, snap, gui) : null
  if (locator.parent && !parent.success) return parent
  const pool = parent ? snap.elements.filter((e) => descendant(e, parent.element, snap.elements)) : snap.elements
  if (locator.kind === 'collection-item') {
    let candidates = pool.filter((e) => structural(e, locator.options))
    if (locator.options.where) candidates = candidates.filter((e) => locator.options.where(subtree(e, snap.elements)))
    if (locator.identityMode === 'position') {
      const element = candidates[locator.position]
      return element ? { success: true, element } : { success: false, message: 'collection position is no longer resolvable' }
    }
    const matches = candidates.filter((e, i) => String(locator.options.identity(subtree(e, snap.elements), i) ?? '').trim() === locator.identity)
    return matches.length === 1 ? { success: true, element: matches[0] } : { success: false, message: `collection identity matched ${matches.length} items; exactly one required` }
  }
  const match = resolve(pool, locator.descriptor, { ...locator.match, requireIdentity: true }, gui)
  return match.status === 'unique' ? { success: true, element: match.element } : { success: false, message: `fresh resolution ${match.status}` }
}
function subtree(root, all, maxNodes = 500, maxDepth = 20) {
  const byParent = new Map()
  for (const e of all) { const list = byParent.get(e.parent_index) ?? []; list.push(e); byParent.set(e.parent_index, list) }
  let count = 0
  const build = (e, depth) => {
    count++
    const view = { role: e.role, label: e.label, value: e.value, identifier: e.identifier, help: e.help, actions: [...e.actions], frame: e.frame ? { ...e.frame } : null, children: [] }
    if (depth < maxDepth && count < maxNodes) view.children = (byParent.get(e.element_index) ?? []).filter(() => count < maxNodes).map((child) => build(child, depth + 1))
    return view
  }
  return build(root, 0)
}
function fingerprint(value) {
  const text = JSON.stringify(value)
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}
function bounds(w) { const b = w?.bounds ?? w?.frame; if (!b) return null; return { x: b.x ?? b.left ?? 0, y: b.y ?? b.top ?? 0, w: b.w ?? b.width ?? ((b.right ?? 0) - (b.left ?? 0)), h: b.h ?? b.height ?? ((b.bottom ?? 0) - (b.top ?? 0)) } }
function screenshotPoint(frame, window, snapshot) {
  const windowBounds = bounds(window)
  if (!frame || !windowBounds || !snapshot.screenshotWidth || !snapshot.screenshotHeight || windowBounds.w <= 0 || windowBounds.h <= 0) return null
  return {
    x: ((frame.x + frame.w / 2 - windowBounds.x) * snapshot.screenshotWidth) / windowBounds.w,
    y: ((frame.y + frame.h / 2 - windowBounds.y) * snapshot.screenshotHeight) / windowBounds.h,
  }
}
function area(b) { return b ? b.w * b.h : 0 }
function visible(w) { return w.visible !== false && w.is_visible !== false && w.on_screen !== false && w.is_on_screen !== false && !w.minimized }
function norm(s) { return String(s ?? '').trim().toLowerCase() }
function slug(s) { return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
