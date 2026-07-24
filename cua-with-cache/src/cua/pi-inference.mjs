import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

import { Type, validateToolCall } from '@earendil-works/pi-ai'

const resolveActionTool = {
  name: 'resolve_action',
  description: 'Resolve the requested GUI action to one offered accessibility element or one screenshot point.',
  parameters: Type.Object({
    targetType: Type.Union([Type.Literal('element'), Type.Literal('pixel'), Type.Literal('noop')]),
    candidateId: Type.Optional(Type.Integer({ minimum: 0 })),
    x: Type.Optional(Type.Number({ minimum: 0 })),
    y: Type.Optional(Type.Number({ minimum: 0 })),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
  }),
}

const resolveExtractionTool = {
  name: 'resolve_extraction',
  description: 'Select a stable container and one descendant for every requested live output field.',
  parameters: Type.Object({
    rootCandidateId: Type.Integer({ minimum: 0 }),
    fields: Type.Array(Type.Object({
      name: Type.String({ minLength: 1 }),
      candidateId: Type.Integer({ minimum: 0 }),
      source: Type.Union([Type.Literal('label'), Type.Literal('value'), Type.Literal('subtree_text')]),
    }), { minItems: 1, maxItems: 30 }),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
  }),
}

export async function createLocalPiCuaInference({
  piDir = join(homedir(), '.pi'),
  model: modelOption,
  reasoning,
  cwd = process.cwd(),
  models: suppliedModels,
  settings: suppliedSettings,
  minConfidence = 0.7,
  maxPromptBytes = 128 * 1024,
} = {}) {
  const { ModelRuntime, SettingsManager } = await import('@earendil-works/pi-coding-agent')
  const expanded = String(piDir).replace(/^~(?=$|\/)/, homedir())
  const agentDir = basename(expanded) === 'agent' ? resolve(expanded) : resolve(expanded, 'agent')
  const models = suppliedModels ?? await ModelRuntime.create({
    authPath: join(agentDir, 'auth.json'),
    modelsPath: join(agentDir, 'models.json'),
  })
  const settings = suppliedSettings ?? SettingsManager.create(cwd, agentDir)
  const explicit = parseModel(modelOption)
  const providerId = explicit?.providerId ?? settings.getDefaultProvider()
  const modelId = explicit?.modelId ?? settings.getDefaultModel()
  if (!providerId || !modelId) throw new Error(`Pi config at ${agentDir} must select a default provider and model`)
  const selected = models.getModel(providerId, modelId)
  if (!selected) throw new Error(`Pi model not found: ${providerId}/${modelId}`)
  return createPiCuaInference({
    models,
    model: selected,
    reasoning: reasoning ?? settings.getDefaultThinkingLevel() ?? 'low',
    minConfidence,
    maxPromptBytes,
  })
}

export function createPiCuaInference({ models, model, apiKey, reasoning = 'low', minConfidence = 0.7, maxPromptBytes = 128 * 1024 }) {
  if (!models?.completeSimple || !model) throw new Error('createPiCuaInference requires models and model')
  const run = async ({ systemPrompt, request, candidates = [], screenshot, tool, maxTokens = 1200 }) => {
    const offered = compactCandidates(candidates, request, maxPromptBytes)
    const payload = JSON.stringify({ ...request, candidates: offered })
    const content = [{ type: 'text', text: payload }]
    if (screenshot?.data) content.push({ type: 'image', data: screenshot.data, mimeType: screenshot.mimeType ?? 'image/png' })
    const response = await models.completeSimple(model, {
      systemPrompt,
      messages: [{ role: 'user', timestamp: Date.now(), content }],
      tools: [tool],
    }, { apiKey, reasoning, maxTokens })
    if (['error', 'aborted', 'length'].includes(response.stopReason)) throw new Error(response.errorMessage ?? `Pi inference stopped: ${response.stopReason}`)
    const calls = response.content.filter((part) => part.type === 'toolCall')
    if (response.stopReason !== 'toolUse' || calls.length !== 1 || calls[0].name !== tool.name) throw new Error(`Pi must stop with exactly one ${tool.name} tool call`)
    return { result: validateToolCall([tool], calls[0]), offered }
  }

  return {
    async resolveAction({ instruction, app, candidates, screenshot }) {
      const { result, offered } = await run({
        systemPrompt: [
          'Resolve one native GUI instruction from the supplied current-window accessibility candidates and screenshot.',
          'Prefer an element candidate when it represents the target and has a frame; the runtime can pixel-click actionless accessibility elements.',
          'Use a raw screenshot pixel only when the target is absent from the accessibility candidates.',
          'Use noop only when the screenshot clearly shows that the requested state is already satisfied.',
          'For pixel targets, x and y are screenshot pixels. Do not invent a candidate ID.',
          'Use resolve_action exactly once. The only supported method is a single left click.',
        ].join(' '),
        request: { instruction, app, screenshot: screenshot ? { width: screenshot.width, height: screenshot.height } : null },
        candidates,
        screenshot,
        tool: resolveActionTool,
      })
      requireConfidence(result.confidence, minConfidence)
      if (result.targetType === 'noop') return { targetType: 'noop', confidence: result.confidence }
      if (result.targetType === 'element') {
        if (!Number.isInteger(result.candidateId) || !offered.some((candidate) => candidate.id === result.candidateId)) throw new Error(`Pi selected unknown action candidate ${result.candidateId}`)
        return { targetType: 'element', candidateId: result.candidateId, confidence: result.confidence }
      }
      if (!screenshot || !Number.isFinite(result.x) || !Number.isFinite(result.y) || result.x < 0 || result.y < 0 || result.x > screenshot.width || result.y > screenshot.height) throw new Error('Pi selected an invalid screenshot point')
      return { targetType: 'pixel', x: result.x, y: result.y, confidence: result.confidence }
    },

    async planWorkflow({ instruction, scopes, schema, candidates, screenshot }) {
      const scopeNames = scopes.map(({ name }) => name)
      const pairCount = workflowPairCount(schema)
      const tool = planWorkflowTool(scopeNames, pairCount)
      const { result } = await run({
        systemPrompt: [
          'Plan a short native GUI workflow using only the supplied named application scopes.',
          'Every step must name exactly one supplied scope.',
          'Use act steps for one concrete interaction each and extract steps whenever current application data must be returned.',
          'Honor the requested output cardinality exactly. For repeated items, emit one position-specific act followed by one extract for each item.',
          'Keep step instructions semantic and reusable; never copy current candidate labels, screenshot text, or extracted application data into them.',
          'Do not include navigation or parsing code. Use plan_workflow exactly once.',
        ].join(' '),
        request: { instruction, scopes, outputFields: schemaFields(schema), outputCardinality: cardinality(schema) },
        candidates,
        screenshot,
        tool,
        maxTokens: 2000,
      })
      return result.pairs.flatMap(({ act, extract }) => [
        { kind: 'act', scope: normalizeInstruction(act.scope), instruction: normalizeInstruction(act.instruction) },
        { kind: 'extract', scope: normalizeInstruction(extract.scope), instruction: normalizeInstruction(extract.instruction) },
      ])
    },

    async resolveExtraction({ instruction, schema, app, candidates, screenshot }) {
      const expected = schemaFields(schema)
      const { result, offered } = await run({
        systemPrompt: [
          'Compile a reusable live extraction recipe from the current native GUI.',
          'Select one stable container containing the requested data and exactly one candidate for every requested field.',
          'Use label or value for a scalar node. Use subtree_text for a body/content container.',
          'Use resolve_extraction exactly once and never omit or add fields.',
        ].join(' '),
        request: { instruction, app, fields: expected },
        candidates,
        screenshot,
        tool: resolveExtractionTool,
        maxTokens: 1800,
      })
      requireConfidence(result.confidence, minConfidence)
      const ids = new Set(offered.map((candidate) => candidate.id))
      if (!ids.has(result.rootCandidateId) || result.fields.some((field) => !ids.has(field.candidateId))) throw new Error('Pi extraction selected an unknown candidate')
      const actual = result.fields.map((field) => field.name).sort()
      if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error('Pi extraction fields do not match the requested schema')
      return result
    },
  }
}

function planWorkflowTool(scopeNames, pairCount) {
  if (!Array.isArray(scopeNames) || scopeNames.length === 0) throw new Error('workflow planning requires at least one declared scope')
  const scope = Type.Union(scopeNames.map((name) => Type.Literal(name)))
  return {
    name: 'plan_workflow',
    description: 'Return exact ordered act/live-extract pairs using only declared scopes.',
    parameters: Type.Object({
      pairs: Type.Array(Type.Object({
        act: Type.Object({ scope, instruction: Type.String({ minLength: 1 }) }),
        extract: Type.Object({ scope, instruction: Type.String({ minLength: 1 }) }),
      }), { minItems: pairCount, maxItems: pairCount }),
    }),
  }
}

function compactCandidates(candidates, request, maxBytes) {
  const result = []
  if (Buffer.byteLength(JSON.stringify(request)) > maxBytes) throw new Error(`Pi request exceeds maxPromptBytes (${maxBytes}) before candidates`)
  for (const candidate of candidates) {
    const compact = {
      id: candidate.id,
      role: clean(candidate.role, 80),
      label: clean(candidate.label, 240),
      value: clean(candidate.value, 240),
      help: clean(candidate.help, 160),
      actions: (candidate.actions ?? []).slice(0, 20),
      frame: candidate.frame,
      depth: candidate.depth,
    }
    if (Buffer.byteLength(JSON.stringify({ ...request, candidates: [...result, compact] })) > maxBytes) break
    result.push(compact)
  }
  return result
}

function schemaFields(schema) {
  const properties = schema?.type === 'array' ? schema.items?.properties : schema?.properties ?? schema
  const fields = Object.keys(properties ?? {})
  if (!fields.length) throw new Error('semantic extraction requires an object schema with named fields')
  return fields
}
function cardinality(schema) { return schema?.type === 'array' ? { minItems: schema.minItems ?? null, maxItems: schema.maxItems ?? null } : { minItems: 1, maxItems: 1 } }
function workflowPairCount(schema) {
  if (schema?.type !== 'array') return 1
  if (!Number.isInteger(schema.minItems) || schema.minItems < 1 || schema.minItems !== schema.maxItems) throw new Error('array workflow schemas require equal positive integer minItems and maxItems')
  return schema.minItems
}
function clean(value, max) { return value == null ? null : String(value).replace(/\s+/g, ' ').trim().slice(0, max) }
function requireConfidence(value, minimum) { if (value < minimum) throw new Error(`Pi confidence ${value} is below ${minimum}`) }
function normalizeInstruction(value) { return String(value).trim().replace(/\s+/g, ' ') }
function parseModel(value) {
  if (!value) return null
  if (typeof value === 'object') return { providerId: value.providerId ?? value.provider, modelId: value.modelId ?? value.id }
  const slash = String(value).indexOf('/')
  if (slash < 1) throw new Error('model must use provider/model format')
  return { providerId: String(value).slice(0, slash), modelId: String(value).slice(slash + 1) }
}
