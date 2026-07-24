import { join } from 'node:path'

import { cacheKey, variableKeys } from '../core/key.mjs'
import { JsonCacheStorage } from '../core/storage.mjs'
import { CuaDriverCli } from './driver.mjs'
import { openCuaApp } from './gui-cache.mjs'
import { createLocalPiCuaInference } from './pi-inference.mjs'

const scopeContexts = new WeakMap()
const observedActions = new WeakMap()

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
    this.workflowStorage = new JsonCacheStorage({ cacheDir: join(cacheDir, 'workflows'), cacheMode })
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
    const scope = Object.freeze({ name: gui.name })
    scopeContexts.set(scope, new CachedCuaScopeContext({ runtime: this, gui, cacheDir: join(this.cacheDir, appSlug) }))
    return scope
  }

  async observe(instructionOrRequest, options = {}) {
    const { scope, instruction, variables = {} } = typeof instructionOrRequest === 'string'
      ? { ...options, instruction: instructionOrRequest }
      : instructionOrRequest ?? {}
    const context = this.#requireScope(scope)
    const prepared = await context.prepareAction(instruction, { variables })
    if (!prepared.success) throw new Error(prepared.message)
    if (prepared.compiledAction.method === 'noop') return []
    const action = deepFreeze({
      description: prepared.instruction,
      method: prepared.compiledAction.method,
      target: structuredClone(prepared.compiledAction.target),
      cacheStatus: prepared.cacheStatus,
    })
    observedActions.set(action, { runtime: this, context, prepared })
    return [action]
  }

  async act(actionOrRequest, options = {}) {
    const observed = observedActions.get(actionOrRequest)
    if (observed) {
      if (observed.runtime !== this) throw new Error('action must be returned by this CachedCua instance')
      return observed.context.dispatchAction(observed.prepared, { variables: options.variables ?? {} })
    }
    const { scope, instruction, variables = {} } = typeof actionOrRequest === 'string'
      ? { ...options, instruction: actionOrRequest }
      : actionOrRequest ?? {}
    return this.#requireScope(scope).act(instruction, { variables })
  }

  async extract(instructionOrRequest, options = {}) {
    const { scope, instruction, schema } = typeof instructionOrRequest === 'string'
      ? { ...options, instruction: instructionOrRequest }
      : instructionOrRequest ?? {}
    return this.#requireScope(scope).extract(instruction, schema)
  }

  async pressKey({ scope, key, deliveryMode = 'background' }) {
    return this.#requireScope(scope).pressKey(key, { deliveryMode })
  }

  async execute({ scopes, instruction, schema }) {
    return new CachedCuaExecution({
      runtime: this,
      scopes: normalizeScopes(scopes, (scope) => this.#requireScope(scope)),
    }).execute({ instruction, schema })
  }

  #requireScope(scope) {
    const context = scopeContexts.get(scope)
    if (!context || context.runtime !== this) throw new Error('scope must be returned by this CachedCua instance')
    return context
  }
}

class CachedCuaScopeContext {
  constructor({ runtime, gui, cacheDir }) {
    this.runtime = runtime
    this.gui = gui
    this.name = gui.name
    this.storage = new JsonCacheStorage({ cacheDir: join(cacheDir, 'actions'), cacheMode: runtime.cacheMode })
    this.extractionStorage = new JsonCacheStorage({ cacheDir: join(cacheDir, 'extractions'), cacheMode: runtime.cacheMode })
  }

  async pressKey(key, { deliveryMode = 'background' } = {}) {
    key = normalizeInstruction(key).toLowerCase()
    this.runtime.log('action', `Pressing ${key}`)
    try {
      const driverResult = await this.gui.driver.call('press_key', {
        pid: this.gui.pid,
        window_id: this.gui.windowId,
        key,
        delivery_mode: deliveryMode,
      })
      return { success: true, actionRequested: true, actionPerformed: true, actionOutcome: 'accepted', safeToRetry: false, driverResult }
    } catch (error) {
      return { success: false, actionRequested: true, actionPerformed: false, actionOutcome: 'unknown', safeToRetry: false, message: `key press failed after dispatch was requested: ${error.message}` }
    }
  }

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
    const prepared = await this.prepareAction(instruction, { variables })
    if (!prepared.success) return prepared
    return this.dispatchAction(prepared, { variables })
  }

  async prepareAction(instruction, { variables = {} } = {}) {
    instruction = normalizeInstruction(instruction)
    const key = this.actionKey(instruction, variables)
    this.runtime.log('cache', `Checking action: ${instruction}`)
    const cached = await this.storage.read(key)
    if (cached?.version === 1 && cached.action) {
      let validation
      try { validation = await this.validateCompiledAction(cached.action) } catch (error) { return { success: false, stale: false, cacheStatus: 'HIT', instruction, actionRequested: false, actionPerformed: false, actionOutcome: 'rejected', safeToRetry: true, message: `cached action preparation failed: ${error.message}` } }
      if (validation.success) {
        this.runtime.log('cache', `HIT — resolved cached action: ${instruction}`)
        return { success: true, stale: false, cacheStatus: 'HIT', instruction, key, compiledAction: cached.action }
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
    return { success: true, stale: false, cacheStatus, instruction, key, compiledAction: compiled }
  }

  async validateCompiledAction(action) {
    if (action?.method === 'noop') return { success: true }
    if (action?.target?.kind !== 'element') return { success: false }
    const snapshot = await this.gui.snapshot({ includeScreenshot: action.addressing === 'pixel' })
    const resolved = this.gui.resolveDescriptor(action.target.descriptor, snapshot)
    if (!resolved.success) return resolved
    if (action.addressing === 'pixel' && (!snapshot.screenshotWidth || !snapshot.screenshotHeight || !resolved.element.frame)) return { success: false }
    return { success: true }
  }

  async dispatchAction(prepared, { variables = {} } = {}) {
    let { cacheStatus, instruction, key, compiledAction: compiled } = prepared
    let result
    try { result = await this.gui.dispatchCompiled(compiled, { variables }) } catch (error) { return { success: false, stale: false, cacheStatus, instruction, compiledAction: compiled, actionRequested: false, actionPerformed: false, actionOutcome: 'rejected', safeToRetry: true, message: `compiled action preparation failed: ${error.message}` } }
    if (result.stale && !result.actionRequested) {
      try {
        this.runtime.log('self-heal', `Prepared action became stale — asking Pi to re-ground: ${instruction}`)
        compiled = await this.compileAction(instruction)
        cacheStatus = 'HEALED'
        result = await this.gui.dispatchCompiled(compiled, { variables })
      } catch (error) {
        return { success: false, stale: true, cacheStatus, instruction, compiledAction: compiled, actionRequested: false, actionPerformed: false, actionOutcome: 'rejected', safeToRetry: true, message: `Pi action resolution failed: ${error.message}` }
      }
    }
    let cacheWriteError
    if (result.success && compiled.cacheable !== false) {
      try { await this.storage.write(key, { version: 1, instruction, action: compiled }) } catch (error) { cacheWriteError = error.message }
    }
    if (result.success) {
      const message = cacheStatus === 'HIT'
        ? 'Replayed cached'
        : compiled.cacheable === false
          ? cacheStatus === 'HEALED' ? 'Resolved non-cacheable replacement; stale cache unchanged for' : 'Resolved non-cacheable'
          : cacheStatus === 'HEALED' ? 'Updated cached' : 'Resolved and cached'
      this.runtime.log(cacheStatus === 'HEALED' ? 'self-heal' : 'cache', `${message} action: ${instruction}`)
    }
    return withTargetEvidence({ ...result, cacheStatus, instruction, compiledAction: structuredClone(compiled), safeToRetry: !result.actionRequested, ...(cacheWriteError ? { cacheWriteError } : {}) }, result)
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

  async waitForExtractionChange(prepared, { timeoutMs = 5000, pollMs = 150, settlePolls = 1 } = {}) {
    const deadline = Date.now() + timeoutMs
    let candidateFingerprint = null
    let stablePolls = 0
    do {
      const current = await this.applyExtraction(prepared.recipe)
      if (current.success) {
        const currentFingerprint = fingerprint(current.data)
        if (currentFingerprint !== prepared.fingerprint) {
          stablePolls = currentFingerprint === candidateFingerprint ? stablePolls + 1 : 1
          candidateFingerprint = currentFingerprint
          if (stablePolls >= settlePolls) return current
        }
      }
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
      return { name: field.name, path, source: field.source, role: element.role, identityTokens, roleOrdinal: siblings.findIndex((candidate) => candidate.element_index === element.element_index) }
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
      if (!parent || roleSiblings[field.roleOrdinal]?.element_index !== element.element_index) return { success: false, stale: true, message: `extraction field ${field.name} structural position changed` }
      if (element.role !== field.role || (identityTokens.length > 0 && !identityTokens.every((token) => tokens(`${element.label} ${element.identifier} ${element.help}`).includes(token)))) return { success: false, stale: true, message: `extraction field ${field.name} no longer matches its compiled endpoint` }
      data[field.name] = readSource(element, field.source, children)
      if (!String(data[field.name] ?? '').trim()) return { success: false, stale: true, message: `extraction field ${field.name} is empty` }
    }
    return { success: true, stale: false, data }
  }
}

class CachedCuaExecution {
  constructor({ runtime, scopes }) {
    this.runtime = runtime
    this.scopes = scopes
  }

  async execute({ instruction, schema }) {
    instruction = normalizeInstruction(instruction)
    workflowPairCount(schema)
    const scopeContext = Object.fromEntries(Object.entries(this.scopes).map(([name, scope]) => [name, {
      app: scope.gui.bundleId ?? scope.gui.name,
      route: normalize(scope.gui.window.title ?? scope.gui.window.name),
    }]))
    const key = cacheKey({
      target: instruction,
      match: { schema, scopes: scopeContext },
      stableAppId: 'cached-cua',
      routeKey: 'declared-scopes',
      operationKind: 'cua-workflow',
    })
    this.runtime.log('cache', `Checking workflow plan: ${instruction}`)
    const cached = await this.runtime.workflowStorage.read(key)
    let steps = cached?.version === 1 ? cached.steps : null
    const planCacheStatus = steps ? 'HIT' : 'MISS'
    this.runtime.log('cache', steps ? `HIT — replaying workflow plan: ${instruction}` : `MISS — no cached workflow plan: ${instruction}`)
    if (!steps) {
      try {
        this.runtime.log('llm', `Planning workflow with Pi: ${instruction}`)
        steps = await (await this.runtime.inference()).planWorkflow({
          instruction,
          schema,
          scopes: Object.entries(scopeContext).map(([name, context]) => ({ name, app: context.app, route: context.route })),
          candidates: [],
          screenshot: null,
        })
        steps = normalizeWorkflowSteps(steps, schema, Object.keys(this.scopes))
        this.runtime.log('llm', `Planned ${steps.length / 2} action/extraction pair(s)`)
      } catch (error) {
        this.runtime.log('error', `Pi could not plan workflow: ${error.message}`)
        return { success: false, cacheStatus: planCacheStatus, planCacheStatus, instruction, actionRequested: false, safeToRetry: true, message: `Pi workflow planning failed: ${error.message}` }
      }
    }
    if (steps) {
      try { steps = normalizeWorkflowSteps(steps, schema, Object.keys(this.scopes)) } catch (error) { return { success: false, cacheStatus: planCacheStatus, planCacheStatus, instruction, actionRequested: false, safeToRetry: true, message: `Invalid cached workflow: ${error.message}` } }
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
        const actionScope = this.scopes[actionStep.scope]
        const extractionScope = this.scopes[extractionStep.scope]
        const sameScope = actionScope === extractionScope
        const preparedBeforeAction = sameScope
          ? await extractionScope.prepareExtraction(extractionStep.instruction, itemSchema(schema))
          : null
        if (preparedBeforeAction) stepStatuses.push(preparedBeforeAction.cacheStatus)

        const action = await actionScope.act(actionStep.instruction)
        actions.push({ scope: actionStep.scope, instruction: actionStep.instruction, cacheStatus: action.cacheStatus, success: action.success })
        stepStatuses.push(action.cacheStatus)
        mergeActionState(actionState, action)
        if (!action.success) return fail({ actionOutcome: action.actionOutcome, message: action.message })

        const prepared = preparedBeforeAction
          ?? await extractionScope.prepareExtraction(extractionStep.instruction, itemSchema(schema))
        if (!preparedBeforeAction) stepStatuses.push(prepared.cacheStatus)
        let extraction
        if (sameScope && prepared.success && action.actionRequested) {
          extraction = await extractionScope.waitForExtractionChange(prepared)
          if (!extraction.success && targetMatchesExtraction(action._targetEvidence, prepared.data)) extraction = prepared
          if (!extraction.success) return fail({ message: extraction.message })
        } else if (prepared.success) {
          extraction = prepared
        } else {
          extraction = await extractionScope.waitForExtractionAvailable(prepared)
          if (!extraction.success) return fail({ message: extraction.message })
        }
        extracted.push(extraction.data)
        this.runtime.log('extract', `Read live data from ${extractionStep.scope}: ${extractionStep.instruction}`)
      }
    } catch (error) {
      return fail({ message: `workflow execution failed: ${error.message}` })
    }
    const data = outputData(schema, extracted)
    const validation = validateOutput(schema, data)
    if (!validation.success) return fail({ message: validation.message })
    let cacheWriteError
    if (!cached) { try { await this.runtime.workflowStorage.write(key, { version: 1, instruction, schema, scopes: scopeContext, steps }) } catch (error) { cacheWriteError = error.message } }
    const cacheStatus = overallStatus(planCacheStatus, stepStatuses)
    if (!cached && !cacheWriteError) this.runtime.log('cache', `Stored workflow plan: ${instruction}`)
    this.runtime.log('workflow', `Completed with cache status ${cacheStatus}`)
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
function normalizeSteps(steps, scopeNames) {
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 30) throw new Error('workflow plan must contain 1-30 steps')
  const allowed = new Set(scopeNames)
  return steps.map((step) => {
    if (!['act', 'extract'].includes(step?.kind)) throw new Error(`unsupported workflow step: ${step?.kind}`)
    const scope = normalizeInstruction(step.scope)
    if (!allowed.has(scope)) throw new Error(`workflow step selected undeclared scope: ${scope}`)
    return { kind: step.kind, scope, instruction: normalizeInstruction(step.instruction) }
  })
}
function normalizeWorkflowSteps(steps, schema, scopeNames) {
  const normalized = normalizeSteps(steps, scopeNames)
  const expected = workflowPairCount(schema)
  if (normalized.length !== expected * 2) throw new Error(`workflow must contain exactly ${expected} act/extract pairs`)
  for (let index = 0; index < normalized.length; index += 2) if (normalized[index].kind !== 'act' || normalized[index + 1].kind !== 'extract') throw new Error('workflow steps must alternate act then extract')
  return normalized
}
function normalizeScopes(scopes, resolveScope) {
  if (!scopes || Array.isArray(scopes) || typeof scopes !== 'object') throw new Error('execute scopes must be a non-empty named object')
  const entries = Object.entries(scopes)
  if (entries.length === 0) throw new Error('execute scopes must be a non-empty named object')
  const normalized = {}
  for (const [name, scope] of entries) {
    const normalizedName = normalizeInstruction(name)
    if (Object.hasOwn(normalized, normalizedName)) throw new Error(`duplicate normalized scope name: ${normalizedName}`)
    normalized[normalizedName] = resolveScope(scope)
  }
  return normalized
}
function workflowPairCount(schema) {
  if (schema?.type !== 'array') return 1
  if (!Number.isInteger(schema.minItems) || schema.minItems < 1 || schema.minItems !== schema.maxItems) throw new Error('array workflow schemas require equal positive integer minItems and maxItems')
  return schema.minItems
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
function deepFreeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; for (const child of Object.values(value)) deepFreeze(child); return Object.freeze(value) }
