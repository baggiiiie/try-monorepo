import { join } from 'node:path'

import { cacheKey, variableKeys } from '../core/key.mjs'
import { JsonCacheStorage } from '../core/storage.mjs'
import { CuaDriverCli } from './driver.mjs'
import { openCuaApp } from './gui-cache.mjs'
import { createLocalPiCuaInference } from './pi-inference.mjs'

export class CachedCua {
  constructor({ piDir, model, reasoning, cacheDir = '.gui-cache', cacheMode = 'auto', driver, driverOptions, inference, inferenceFactory, maxCandidates = 500, logger = console.log } = {}) {
    this.piDir = piDir
    this.model = model
    this.reasoning = reasoning
    this.cacheDir = cacheDir
    this.cacheMode = cacheMode
    this.driver = driver ?? new CuaDriverCli(driverOptions)
    this.suppliedInference = inference ?? null
    this.inferenceFactory = inferenceFactory ?? createLocalPiCuaInference
    this.inferencePromise = null
    this.maxCandidates = maxCandidates
    this.logger = logger === false ? null : logger
  }

  async init() { return this }

  log(category, message) { this.logger?.(`[${category}] ${message}`) }

  async inference() {
    if (this.suppliedInference) return this.suppliedInference
    this.inferencePromise ??= this.inferenceFactory({ piDir: this.piDir, model: this.model, reasoning: this.reasoning })
    return this.inferencePromise
  }

  async openApp(name, options = {}) {
    this.log('app', `Opening ${name}`)
    const appSlug = slug(options.bundleId ?? name)
    const gui = await openCuaApp(name, {
      ...options,
      driver: this.driver,
      cacheMode: this.cacheMode,
      cacheDir: join(this.cacheDir, appSlug, 'descriptors'),
      grounder: null,
    })
    this.log('app', `${name} is ready${gui.window?.title ? ` (${gui.window.title})` : ''}`)
    return new CachedCuaApp({ runtime: this, gui, cacheDir: join(this.cacheDir, appSlug) })
  }
}

export class CachedCuaApp {
  constructor({ runtime, gui, cacheDir }) {
    this.runtime = runtime
    this.gui = gui
    this.name = gui.name
    this.storage = new JsonCacheStorage({ cacheDir: join(cacheDir, 'actions'), cacheMode: runtime.cacheMode })
    this.extractionStorage = new JsonCacheStorage({ cacheDir: join(cacheDir, 'extractions'), cacheMode: runtime.cacheMode })
    this.workflowStorage = new JsonCacheStorage({ cacheDir: join(cacheDir, 'workflows'), cacheMode: runtime.cacheMode })
  }

  agent() { return new CachedCuaAgent(this) }

  actionKey(instruction, variables = {}) {
    return cacheKey({
      target: instruction,
      stableAppId: this.gui.bundleId ?? this.gui.name,
      routeKey: `window:${normalize(this.gui.window.title ?? this.gui.window.name)}`,
      operationKind: 'compiled-cua-action',
      operationId: variableKeys(variables).join(','),
    })
  }

  async act(instruction, { variables = {} } = {}) {
    instruction = normalizeInstruction(instruction)
    const key = this.actionKey(instruction, variables)
    this.runtime.log('cache', `Checking action: ${instruction}`)
    const cached = await this.storage.read(key)
    if (cached?.version === 1 && cached.action) {
      let replay
      try { replay = await this.gui.dispatchCompiled(cached.action, { variables }) } catch (error) { return { success: false, stale: false, cacheStatus: 'HIT', instruction, actionRequested: false, actionPerformed: false, actionOutcome: 'rejected', safeToRetry: true, message: `cached action preparation failed: ${error.message}` } }
      if (!replay.stale) {
        this.runtime.log('cache', `HIT — replayed action: ${instruction}`)
        return withTargetEvidence({ ...replay, cacheStatus: 'HIT', instruction, compiledAction: cached.action }, replay)
      }
      this.runtime.log('self-heal', `Cached action is stale — asking Pi to re-ground: ${instruction}`)
    } else {
      this.runtime.log('cache', `MISS — no cached action: ${instruction}`)
    }

    let compiled
    try {
      this.runtime.log('llm', `Resolving action with Pi: ${instruction}`)
      compiled = await this.compileAction(instruction)
    } catch (error) {
      this.runtime.log('error', `Pi could not resolve action: ${error.message}`)
      return { success: false, cacheStatus: cached ? 'HEALED' : 'MISS', instruction, actionRequested: false, actionPerformed: false, actionOutcome: 'rejected', safeToRetry: true, message: `Pi action resolution failed: ${error.message}` }
    }
    const cacheStatus = cached ? 'HEALED' : 'MISS'
    let result
    try { result = await this.gui.dispatchCompiled(compiled, { variables }) } catch (error) { return { success: false, stale: false, cacheStatus, instruction, compiledAction: compiled, actionRequested: false, actionPerformed: false, actionOutcome: 'rejected', safeToRetry: true, message: `compiled action preparation failed: ${error.message}` } }
    let cacheWriteError
    if (result.success && compiled.cacheable !== false) {
      try { await this.storage.write(key, { version: 1, instruction, action: compiled }) } catch (error) { cacheWriteError = error.message }
    }
    if (result.success) this.runtime.log(cacheStatus === 'HEALED' ? 'self-heal' : 'cache', `${cacheStatus === 'HEALED' ? 'Updated cached' : compiled.cacheable === false ? 'Resolved non-cacheable' : 'Resolved and cached'} action: ${instruction}`)
    return withTargetEvidence({ ...result, cacheStatus, instruction, compiledAction: compiled, ...(cacheWriteError ? { cacheWriteError } : {}) }, result)
  }

  async compileAction(instruction) {
    const snapshot = await this.gui.snapshot({ includeScreenshot: true })
    const candidates = actionCandidates(snapshot, instruction, this.runtime.maxCandidates)
    const proposal = await (await this.runtime.inference()).resolveAction({
      instruction,
      app: this.gui.bundleId ?? this.gui.name,
      candidates: candidates.map(publicCandidate),
      screenshot: screenshotOf(snapshot),
    })
    if (proposal.targetType === 'noop') return { version: 1, method: 'noop', target: { kind: 'none' }, cacheable: false }
    if (proposal.targetType === 'pixel') {
      return {
        version: 1,
        method: 'click',
        target: { kind: 'pixel', xRatio: proposal.x / snapshot.screenshotWidth, yRatio: proposal.y / snapshot.screenshotHeight },
        addressing: 'pixel',
        deliveryMode: 'foreground',
        cacheable: false,
      }
    }
    const selected = candidates.find((candidate) => candidate.id === proposal.candidateId)
    if (!selected) throw new Error(`selected candidate ${proposal.candidateId} is unavailable`)
    const descriptor = this.gui.descriptorForElement(selected.element, instruction, snapshot)
    if (!hasIdentity(descriptor)) throw new Error('selected element has no durable identity related to the instruction')
    const accessibility = selected.element.actions.includes('AXPress')
    return {
      version: 1,
      method: 'click',
      target: { kind: 'element', descriptor },
      addressing: accessibility ? 'accessibility' : 'pixel',
      deliveryMode: accessibility ? 'background' : 'foreground',
    }
  }

  extractionKey(instruction, schema) {
    return cacheKey({
      target: instruction,
      match: schema,
      stableAppId: this.gui.bundleId ?? this.gui.name,
      routeKey: `window:${normalize(this.gui.window.title ?? this.gui.window.name)}`,
      operationKind: 'compiled-cua-extraction',
    })
  }

  async extract(instruction, schema) {
    const prepared = await this.prepareExtraction(instruction, schema)
    if (!prepared.success) return prepared
    return { success: true, stale: false, data: prepared.data, cacheStatus: prepared.cacheStatus, instruction: prepared.instruction }
  }

  async prepareExtraction(instruction, schema) {
    instruction = normalizeInstruction(instruction)
    const key = this.extractionKey(instruction, schema)
    this.runtime.log('cache', `Checking extraction recipe: ${instruction}`)
    const cached = await this.extractionStorage.read(key)
    if (cached?.version === 1 && cached.recipe) {
      const replay = await this.applyExtraction(cached.recipe)
      if (replay.success) {
        this.runtime.log('cache', `HIT — read live data with cached extraction recipe: ${instruction}`)
        return { ...replay, recipe: cached.recipe, key, schema, cacheStatus: 'HIT', instruction, fingerprint: fingerprint(replay.data) }
      }
      this.runtime.log('self-heal', `Cached extraction recipe is stale — asking Pi to re-ground: ${instruction}`)
    } else {
      this.runtime.log('cache', `MISS — no cached extraction recipe: ${instruction}`)
    }
    try {
      this.runtime.log('llm', `Resolving extraction recipe with Pi: ${instruction}`)
      const recipe = await this.compileExtraction(instruction, schema)
      const result = await this.applyExtraction(recipe)
      let cacheWriteError
      try { await this.extractionStorage.write(key, { version: 1, instruction, schema, recipe }) } catch (error) { cacheWriteError = error.message }
      if (!result.success) return { ...result, recipe, key, schema, cacheStatus: cached ? 'HEALED' : 'MISS', instruction, fingerprint: null, ...(cacheWriteError ? { cacheWriteError } : {}) }
      this.runtime.log(cached ? 'self-heal' : 'cache', `${cached ? 'Updated cached' : 'Resolved and cached'} extraction recipe: ${instruction}`)
      return { ...result, recipe, key, schema, cacheStatus: cached ? 'HEALED' : 'MISS', instruction, fingerprint: fingerprint(result.data), ...(cacheWriteError ? { cacheWriteError } : {}) }
    } catch (error) {
      this.runtime.log('error', `Pi could not resolve extraction recipe: ${error.message}`)
      return { success: false, key, schema, cacheStatus: cached ? 'HEALED' : 'MISS', instruction, message: `Pi extraction resolution failed: ${error.message}` }
    }
  }

  async waitForExtractionChange(prepared, { timeoutMs = 5000, pollMs = 150 } = {}) {
    const deadline = Date.now() + timeoutMs
    do {
      const current = await this.applyExtraction(prepared.recipe)
      if (current.success && fingerprint(current.data) !== prepared.fingerprint) return current
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    } while (Date.now() <= deadline)
    return { success: false, stale: false, message: 'live extraction did not change after the action' }
  }

  async waitForExtractionAvailable(prepared, { timeoutMs = 5000, pollMs = 300 } = {}) {
    const deadline = Date.now() + timeoutMs
    let recipe = prepared.recipe
    do {
      if (recipe) {
        const current = await this.applyExtraction(recipe)
        if (current.success) return current
      } else {
        const current = await this.prepareExtraction(prepared.instruction, prepared.schema)
        recipe = current.recipe ?? recipe
        if (current.success) return current
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    } while (Date.now() <= deadline)
    return { success: false, stale: false, message: 'live extraction did not become available after the action' }
  }

  async compileExtraction(instruction, schema) {
    const snapshot = await this.gui.snapshot({ includeScreenshot: true })
    const candidates = extractionCandidates(snapshot, this.runtime.maxCandidates)
    const proposal = await (await this.runtime.inference()).resolveExtraction({
      instruction,
      schema,
      app: this.gui.bundleId ?? this.gui.name,
      candidates: candidates.map(publicCandidate),
      screenshot: screenshotOf(snapshot),
    })
    const root = candidates.find((candidate) => candidate.id === proposal.rootCandidateId)?.element
    if (!root) throw new Error('selected extraction root is unavailable')
    const rootDescriptor = this.gui.descriptorForElement(root, instruction, snapshot)
    if (!hasIdentity(rootDescriptor)) throw new Error('selected extraction root has no durable identity related to the instruction')
    const fields = proposal.fields.map((field) => {
      const element = candidates.find((candidate) => candidate.id === field.candidateId)?.element
      const path = element ? descendantPath(root, element, snapshot.elements) : null
      if (!path) throw new Error(`field ${field.name} is not inside the selected extraction root`)
      const identityTokens = fieldIdentity(element, field.name)
      const parent = snapshot.elements.find((candidate) => candidate.element_index === element.parent_index)
      const siblings = snapshot.elements.filter((candidate) => candidate.parent_index === element.parent_index && candidate.role === element.role)
      if (!parent) throw new Error(`field ${field.name} has no structural parent`)
      return { name: field.name, path, source: field.source, role: element.role, identityTokens, roleOrdinal: siblings.findIndex((candidate) => candidate.element_index === element.element_index), expectedRoleCount: siblings.length }
    })
    return { version: 1, root: rootDescriptor, fields }
  }

  async applyExtraction(recipe) {
    const snapshot = await this.gui.snapshot()
    const resolved = this.gui.resolveDescriptor(recipe.root, snapshot)
    if (!resolved.success) return { success: false, stale: true, message: resolved.message }
    const children = childMap(snapshot.elements)
    const data = {}
    for (const field of recipe.fields) {
      const element = followPath(resolved.element, field.path, children)
      if (!element) return { success: false, stale: true, message: `extraction field ${field.name} is no longer resolvable` }
      const identityTokens = field.identityTokens ?? []
      const parentPath = field.path.slice(0, -1)
      const parent = followPath(resolved.element, parentPath, children)
      const roleSiblings = parent ? (children.get(parent.element_index) ?? []).filter((candidate) => candidate.role === field.role) : []
      if (!parent || roleSiblings.length !== field.expectedRoleCount || roleSiblings[field.roleOrdinal]?.element_index !== element.element_index) return { success: false, stale: true, message: `extraction field ${field.name} structural position changed` }
      if (element.role !== field.role || (identityTokens.length > 0 && !identityTokens.every((token) => tokens(`${element.label} ${element.identifier} ${element.help}`).includes(token)))) return { success: false, stale: true, message: `extraction field ${field.name} no longer matches its compiled endpoint` }
      data[field.name] = readSource(element, field.source, children)
      if (!String(data[field.name] ?? '').trim()) return { success: false, stale: true, message: `extraction field ${field.name} is empty` }
    }
    return { success: true, stale: false, data }
  }
}

export class CachedCuaAgent {
  constructor(app) { this.app = app }

  async execute({ instruction, schema }) {
    instruction = normalizeInstruction(instruction)
    const key = cacheKey({
      target: instruction,
      match: schema,
      stableAppId: this.app.gui.bundleId ?? this.app.gui.name,
      routeKey: `window:${normalize(this.app.gui.window.title ?? this.app.gui.window.name)}`,
      operationKind: 'cua-workflow',
    })
    this.app.runtime?.log?.('cache', `Checking workflow plan: ${instruction}`)
    const cached = await this.app.workflowStorage.read(key)
    let steps = cached?.version === 1 ? cached.steps : null
    const planCacheStatus = steps ? 'HIT' : 'MISS'
    this.app.runtime?.log?.('cache', steps ? `HIT — replaying workflow plan: ${instruction}` : `MISS — no cached workflow plan: ${instruction}`)
    if (!steps) {
      try {
        this.app.runtime?.log?.('llm', `Planning workflow with Pi: ${instruction}`)
        steps = await (await this.app.runtime.inference()).planWorkflow({
          instruction,
          schema,
          app: this.app.gui.bundleId ?? this.app.gui.name,
          candidates: [],
          screenshot: null,
        })
        steps = normalizeWorkflowSteps(steps, schema)
        this.app.runtime?.log?.('llm', `Planned ${steps.length / 2} action/extraction pair(s)`)
      } catch (error) {
        this.app.runtime?.log?.('error', `Pi could not plan workflow: ${error.message}`)
        return { success: false, cacheStatus: planCacheStatus, planCacheStatus, instruction, actionRequested: false, safeToRetry: true, message: `Pi workflow planning failed: ${error.message}` }
      }
    }
    if (steps) {
      try { steps = normalizeWorkflowSteps(steps, schema) } catch (error) { return { success: false, cacheStatus: planCacheStatus, planCacheStatus, instruction, actionRequested: false, safeToRetry: true, message: `Invalid cached workflow: ${error.message}` } }
    }

    const actions = []
    const extracted = []
    const stepStatuses = []
    const actionState = { requested: false, performed: false, outcome: null }
    const fail = (details) => workflowFailure({ planCacheStatus, instruction, actions, extracted, schema, actionState, stepStatuses, ...details })
    try {
      for (let index = 0; index < steps.length; index += 2) {
        const actionStep = steps[index]
        const extractionStep = steps[index + 1]
        const prepared = await this.app.prepareExtraction(extractionStep.instruction, itemSchema(schema))
        stepStatuses.push(prepared.cacheStatus)

        const action = await this.app.act(actionStep.instruction)
        actions.push({ instruction: actionStep.instruction, cacheStatus: action.cacheStatus, success: action.success })
        stepStatuses.push(action.cacheStatus)
        mergeActionState(actionState, action)
        if (!action.success) return fail({ actionOutcome: action.actionOutcome, message: action.message })

        let extraction
        if (prepared.success && action.actionRequested) {
          extraction = await this.app.waitForExtractionChange(prepared)
          if (!extraction.success && targetMatchesExtraction(action._targetEvidence, prepared.data)) extraction = prepared
          if (!extraction.success) return fail({ message: extraction.message })
        } else if (prepared.success) {
          extraction = prepared
        } else {
          extraction = await this.app.waitForExtractionAvailable(prepared)
          if (!extraction.success) return fail({ message: extraction.message })
        }
        extracted.push(extraction.data)
        this.app.runtime?.log?.('extract', `Read live data: ${extractionStep.instruction}`)
      }
    } catch (error) {
      return fail({ message: `workflow execution failed: ${error.message}` })
    }
    const data = outputData(schema, extracted)
    const validation = validateOutput(schema, data)
    if (!validation.success) return fail({ message: validation.message })
    let cacheWriteError
    if (!cached) { try { await this.app.workflowStorage.write(key, { version: 1, instruction, schema, steps }) } catch (error) { cacheWriteError = error.message } }
    const cacheStatus = overallStatus(planCacheStatus, stepStatuses)
    if (!cached && !cacheWriteError) this.app.runtime?.log?.('cache', `Stored workflow plan: ${instruction}`)
    this.app.runtime?.log?.('workflow', `Completed with cache status ${cacheStatus}`)
    return { success: true, cacheStatus, planCacheStatus, instruction, actions, data, actionRequested: actionState.requested, actionPerformed: actionState.performed, actionOutcome: actionState.outcome, safeToRetry: !actionState.requested, ...(cacheWriteError ? { cacheWriteError } : {}) }
  }
}

function actionCandidates(snapshot, instruction, limit) {
  const wanted = new Set(tokens(instruction))
  return snapshot.elements.map((element, original) => ({ element, original, score: tokens(`${element.label} ${element.help} ${element.identifier}`).filter((token) => wanted.has(token)).length * 10 + (element.frame?.w > 0 && element.frame?.h > 0 ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || a.original - b.original)
    .slice(0, limit)
    .map(({ element }, id) => ({ id, element }))
}
function extractionCandidates(snapshot, limit) { return snapshot.elements.slice(0, limit).map((element, id) => ({ id, element })) }
function publicCandidate(candidate) { const e = candidate.element; return { id: candidate.id, role: e.role, label: e.label, value: e.value, help: e.help, actions: e.actions, frame: e.frame, depth: e.depth } }
function screenshotOf(snapshot) { return snapshot.screenshot ? { data: snapshot.screenshot, mimeType: snapshot.screenshotMimeType, width: snapshot.screenshotWidth, height: snapshot.screenshotHeight } : null }
function hasIdentity(descriptor) { return Boolean(descriptor.scope) || [...(descriptor.labelTokens ?? []), ...(descriptor.identifierTokens ?? []), ...(descriptor.helpTokens ?? [])].length > 0 }
function childMap(elements) { const map = new Map(); for (const element of elements) { const list = map.get(element.parent_index) ?? []; list.push(element); map.set(element.parent_index, list) } return map }
function descendantPath(root, target, elements) {
  if (root.element_index === target.element_index) return []
  const byIndex = new Map(elements.map((element) => [element.element_index, element]))
  const children = childMap(elements)
  const reversed = []
  let current = target
  while (current && current.element_index !== root.element_index) {
    const parent = byIndex.get(current.parent_index)
    if (!parent) return null
    const index = (children.get(parent.element_index) ?? []).findIndex((child) => child.element_index === current.element_index)
    if (index < 0) return null
    reversed.push(index)
    current = parent
  }
  return current?.element_index === root.element_index ? reversed.reverse() : null
}
function followPath(root, path, children) { let current = root; for (const index of path) { current = (children.get(current.element_index) ?? [])[index]; if (!current) return null } return current }
function readSource(element, source, children) {
  if (source === 'label') return element.label
  if (source === 'value') return element.value ?? element.label
  const values = []
  const visit = (current) => { for (const value of [current.label, current.value]) if (value && !values.includes(value)) values.push(value); for (const child of children.get(current.element_index) ?? []) visit(child) }
  visit(element)
  return values.join('\n').slice(0, 10_000)
}
function itemSchema(schema) { return schema?.type === 'array' ? schema.items : schema }
function outputData(schema, values) { return schema?.type === 'array' ? values : values.at(-1) ?? null }
function fieldIdentity(element, fieldName) { const wanted = new Set(tokens(fieldName)); return tokens(`${element.label} ${element.identifier} ${element.help}`).filter((token) => wanted.has(token)) }
function fingerprint(value) { return JSON.stringify(value) }
function normalizeSteps(steps) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 30) throw new Error('workflow plan must contain 1-30 steps')
  return steps.map((step) => {
    if (!['act', 'extract'].includes(step?.kind)) throw new Error(`unsupported workflow step: ${step?.kind}`)
    return { kind: step.kind, instruction: normalizeInstruction(step.instruction) }
  })
}
function normalizeWorkflowSteps(steps, schema) {
  const normalized = normalizeSteps(steps)
  const expected = schema?.type === 'array' && schema.minItems === schema.maxItems ? schema.minItems : 1
  if (!Number.isInteger(expected) || expected < 1 || normalized.length !== expected * 2) throw new Error(`workflow must contain exactly ${expected} act/extract pairs`)
  for (let index = 0; index < normalized.length; index += 2) if (normalized[index].kind !== 'act' || normalized[index + 1].kind !== 'extract') throw new Error('workflow steps must alternate act then extract')
  return normalized
}
function validateOutput(schema, data) {
  if (schema?.type === 'array') {
    if (!Array.isArray(data)) return { success: false, message: 'workflow output is not an array' }
    if (schema.minItems != null && data.length < schema.minItems) return { success: false, message: `workflow returned ${data.length} items; at least ${schema.minItems} required` }
    if (schema.maxItems != null && data.length > schema.maxItems) return { success: false, message: `workflow returned ${data.length} items; at most ${schema.maxItems} allowed` }
    if (new Set(data.map(fingerprint)).size !== data.length) return { success: false, message: 'workflow returned duplicate items' }
    for (const item of data) { const result = validateOutput(schema.items, item); if (!result.success) return result }
    return { success: true }
  }
  if (!data || typeof data !== 'object') return { success: false, message: 'workflow output is not an object' }
  for (const field of schema?.required ?? Object.keys(schema?.properties ?? {})) if (!String(data[field] ?? '').trim()) return { success: false, message: `workflow output field ${field} is empty` }
  return { success: true }
}
function overallStatus(planStatus, stepStatuses) { return planStatus === 'HIT' && stepStatuses.every((status) => status === 'HIT') ? 'HIT' : planStatus === 'MISS' ? 'MISS' : 'HEALED' }
function mergeActionState(state, result) { state.requested ||= Boolean(result.actionRequested); state.performed ||= Boolean(result.actionPerformed); if (result.actionOutcome === 'unknown' || !state.outcome) state.outcome = result.actionOutcome ?? state.outcome }
function workflowFailure({ planCacheStatus, instruction, actions, extracted, schema, stepStatuses, actionState = {}, ...details }) { return { success: false, cacheStatus: overallStatus(planCacheStatus, stepStatuses), planCacheStatus, instruction, actions, data: outputData(schema, extracted), actionRequested: Boolean(actionState.requested), actionPerformed: Boolean(actionState.performed), actionOutcome: actionState.outcome ?? details.actionOutcome ?? null, safeToRetry: !actionState.requested, ...details } }
function withTargetEvidence(report, source) { if (source?._targetEvidence) Object.defineProperty(report, '_targetEvidence', { value: source._targetEvidence }); return report }
function targetMatchesExtraction(evidence, data) {
  if (!evidence || !data || typeof data !== 'object') return false
  const target = new Set(tokens(`${evidence.label} ${evidence.value}`).filter((token) => token.length > 2))
  if (target.size < 2) return false
  const matches = Object.values(data).filter((value) => {
    const valueTokens = [...new Set(tokens(value).filter((token) => token.length > 2))]
    if (valueTokens.length === 0) return false
    const overlap = valueTokens.filter((token) => target.has(token)).length
    return overlap >= Math.min(2, valueTokens.length) && overlap / Math.min(valueTokens.length, 8) >= 0.25
  })
  return matches.length >= Math.min(2, Object.keys(data).length)
}
function tokens(value) { return normalize(value).split(/[^a-z0-9]+/).filter((token) => token.length > 1) }
function normalize(value) { return String(value ?? '').trim().toLowerCase() }
function normalizeInstruction(value) { const out = String(value ?? '').trim().replace(/\s+/g, ' '); if (!out) throw new Error('instruction is required'); return out }
function slug(value) { return normalize(value).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
