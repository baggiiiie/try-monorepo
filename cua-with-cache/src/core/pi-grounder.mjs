import { Type, createModels, validateToolCall } from '@earendil-works/pi-ai'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { openaiProvider } from '@earendil-works/pi-ai/providers/openai'

const selectElement = {
  name: 'select_element',
  description: 'Select exactly one candidate that represents the requested UI concept.',
  parameters: Type.Object({
    candidateId: Type.Integer({ minimum: 0 }),
    confidence: Type.Number({ minimum: 0, maximum: 1 }),
  }),
}

export function createPiGrounder({
  providerId = 'openai',
  modelId,
  models: suppliedModels,
  model: suppliedModel,
  apiKey,
  reasoning = 'low',
  minConfidence = 0.7,
  maxCandidates = 200,
  maxPromptBytes = 64 * 1024,
} = {}) {
  const models = suppliedModels ?? configuredModels(providerId)
  const model = suppliedModel ?? models.getModel(providerId, required(modelId, 'modelId'))
  if (!model) throw new Error(`Pi model not found: ${providerId}/${modelId}`)

  return {
    async ground({ target, action, app, scope, candidates, reason }) {
      const request = { target, action, app, reason, candidates: [] }
      const offered = compactCandidates(candidates.slice(0, maxCandidates), request, maxPromptBytes)
      if (!offered.length) return null
      const payload = JSON.stringify({ ...request, candidates: offered })
      const response = await models.completeSimple(model, {
        systemPrompt: [
          'Ground one concrete native-GUI concept to one supplied accessibility candidate.',
          'Use select_element exactly once. Never invent an ID and never choose based on email/chat content alone.',
          'The requested action is fixed by the caller; you only select its target.',
        ].join(' '),
        messages: [{
          role: 'user',
          timestamp: Date.now(),
          content: payload,
        }],
        tools: [selectElement],
      }, { apiKey, reasoning, temperature: 0, maxTokens: 300 })
      if (['error', 'aborted', 'length'].includes(response.stopReason)) {
        throw new Error(response.errorMessage ?? `Pi grounding stopped: ${response.stopReason}`)
      }
      const calls = response.content.filter((part) => part.type === 'toolCall')
      if (response.stopReason !== 'toolUse' || calls.length !== 1 || calls[0].name !== selectElement.name) {
        throw new Error('Pi grounder must stop with exactly one select_element tool call')
      }
      const proposal = validateToolCall([selectElement], calls[0])
      if (proposal.confidence < minConfidence) throw new Error(`Pi grounding confidence ${proposal.confidence} is below ${minConfidence}`)
      if (!offered.some((candidate) => candidate.id === proposal.candidateId)) {
        throw new Error(`Pi grounder selected unknown candidate ${proposal.candidateId}`)
      }
      return proposal
    },
  }
}

export async function createLocalPiGrounder({
  agentDir,
  cwd = process.cwd(),
  providerId,
  modelId,
  reasoning,
  models: suppliedModels,
  settings: suppliedSettings,
  ...grounderOptions
} = {}) {
  const { ModelRuntime, SettingsManager, getAgentDir } = await import('@earendil-works/pi-coding-agent')
  const localAgentDir = agentDir ?? getAgentDir()
  const models = suppliedModels ?? await ModelRuntime.create({
    authPath: `${localAgentDir}/auth.json`,
    modelsPath: `${localAgentDir}/models.json`,
  })
  const settings = suppliedSettings ?? SettingsManager.create(cwd, localAgentDir)
  const selectedProvider = providerId ?? settings.getDefaultProvider()
  const selectedModelId = modelId ?? settings.getDefaultModel()
  if (!selectedProvider || !selectedModelId) {
    throw new Error(`Pi local config at ${localAgentDir} must set defaultProvider and defaultModel`)
  }
  const model = models.getModel(selectedProvider, selectedModelId)
  if (!model) throw new Error(`Pi local model not found: ${selectedProvider}/${selectedModelId}`)
  return createPiGrounder({
    ...grounderOptions,
    providerId: selectedProvider,
    modelId: selectedModelId,
    models,
    model,
    reasoning: reasoning ?? settings.getDefaultThinkingLevel() ?? 'low',
  })
}

function compactCandidates(candidates, request, maxBytes) {
  const result = []
  if (Buffer.byteLength(JSON.stringify(request)) > maxBytes) {
    throw new Error(`Pi grounding request exceeds maxPromptBytes (${maxBytes}) before candidates`)
  }
  for (const candidate of candidates) {
    const compact = {
      id: candidate.id,
      view: compactView(candidate.view),
      ...(candidate.descriptor ? { descriptor: compactDescriptor(candidate.descriptor) } : {}),
    }
    const payload = JSON.stringify({ ...request, candidates: [...result, compact] })
    if (Buffer.byteLength(payload) > maxBytes) break
    result.push(compact)
  }
  return result
}

function compactView(view = {}) {
  return compactObject(view, ['role', 'enabled', 'actions', 'box', 'frame'])
}

function compactDescriptor(descriptor = {}) {
  return compactObject(descriptor, ['role', 'directTokens', 'nameTokens', 'descriptionTokens', 'labelTokens', 'identifierTokens', 'helpTokens', 'actions', 'supportedActions', 'ancestorRoles', 'posHint', 'relativeFrame'])
}

function compactObject(value, keys) {
  return Object.fromEntries(keys.filter((key) => value[key] != null).map((key) => [key, compactValue(value[key])]))
}

function compactValue(value) {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim().slice(0, 300)
  if (Array.isArray(value)) return value.slice(0, 30).map(compactValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 20).map(([key, item]) => [key, compactValue(item)]))
  return value
}

function configuredModels(providerId) {
  const models = createModels()
  if (providerId === 'openai') models.setProvider(openaiProvider())
  else if (providerId === 'anthropic') models.setProvider(anthropicProvider())
  else throw new Error(`Unsupported built-in Pi provider: ${providerId}; pass configured models and model instead`)
  return models
}

function required(value, name) {
  if (!value) throw new Error(`createPiGrounder requires ${name}`)
  return value
}

export async function selectModelCandidate(grounder, request, candidates) {
  if (!grounder || candidates.length === 0) return null
  const proposal = await grounder.ground({ ...request, candidates: candidates.map(({ node, element, ...candidate }) => candidate) })
  if (!proposal) return null
  if (!Number.isInteger(proposal.candidateId) || !Number.isFinite(proposal.confidence) || proposal.confidence < 0 || proposal.confidence > 1) {
    throw new Error('Grounder returned an invalid candidateId or confidence')
  }
  const selected = candidates.find((candidate) => candidate.id === proposal.candidateId)
  if (!selected) throw new Error(`Grounder selected unknown candidate ${proposal.candidateId}`)
  return { selected, proposal }
}
