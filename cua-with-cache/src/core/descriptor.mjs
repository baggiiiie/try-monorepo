import { TraversalOrder, ariaRoleToString } from '@simular-ai/simulang-js'

import { posHint, round, safe, sha256 } from './util.mjs'

const UI_TOKEN_ALLOWLIST = new Set([
  'account', 'all', 'archive', 'back', 'button', 'calendar', 'compose',
  'contacts', 'delete', 'drafts', 'filter', 'folder', 'folders', 'focused',
  'forward', 'inbox', 'mail', 'message', 'messages', 'new', 'next', 'other',
  'people', 'previous', 'reply', 'search', 'send', 'sent', 'settings', 'tab',
  'toolbar', 'unread', 'view',
])

const ACTIONABLE_ACTIONS = new Set([
  'activate',
  'set_value',
  'toggle',
  'select',
  'expand_collapse',
  'scroll_into_view',
  'focus',
])

export function roleName(role) {
  return safe('role', () => ariaRoleToString(role), String(role))
}

export function tokenize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' url ')
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, ' email ')
    .match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && token.length <= 24) ?? []
}

export function sanitizedTokens(text, query) {
  const allowed = new Set([...UI_TOKEN_ALLOWLIST, ...tokenize(query)])
  const seen = new Set()
  const result = []
  for (const token of tokenize(text)) {
    if (!allowed.has(token) || seen.has(token)) continue
    seen.add(token)
    result.push(token)
    if (result.length >= 24) break
  }
  return result
}

export function nodeDescriptor(node, query, containerBox = null) {
  const role = roleName(safe('role', () => node.role, 'unknown'))
  const box = safe('boundingBox', () => node.boundingBox(), null)
  const name = safe('name', () => node.name, '')
  const description = safe('description', () => node.description, '')
  const overall = safe('overallDescription', () => node.overallDescription, '')
  const supportedActions = safe('supportedActions', () => node.supportedActions(), [])
  const ancestors = safe('ancestors', () => node.ancestors(), [])
  const ancestorRoles = ancestors
    .slice(0, 8)
    .map((ancestor) => roleName(safe('ancestorRole', () => ancestor.role, 'unknown')))

  return {
    role,
    query,
    nameTokens: sanitizedTokens(name, query),
    descriptionTokens: sanitizedTokens(`${description} ${overall}`, query),
    nameTokenCount: tokenize(name).length,
    descriptionTokenCount: tokenize(`${description} ${overall}`).length,
    ancestorRoles,
    classNameHash: sha256(safe('className', () => node.className, '')),
    localizedControlType: safe('localizedControlType', () => node.localizedControlType, ''),
    isEnabled: safe('isEnabled', () => node.isEnabled, null),
    supportedActions,
    box: box ? {
      left: round(box.left),
      top: round(box.top),
      right: round(box.right),
      bottom: round(box.bottom),
    } : null,
    posHint: posHint(box, containerBox),
  }
}

export function normalizeActionable(node) {
  let current = node
  for (let depth = 0; current && depth < 6; depth += 1) {
    if (hasAnyAction(current)) return current
    current = safe('parent', () => current.parent(), null)
  }
  return node
}

function hasAnyAction(node) {
  const actions = safe('supportedActions', () => node.supportedActions(), [])
  return actions.some((action) => ACTIONABLE_ACTIONS.has(action))
}

export function searchScope(scope, query, { threshold = 0.35, maxNodes = 4000 } = {}) {
  const nodes = scope.scoredSearch(
    TraversalOrder.DepthFirst,
    maxNodes,
    true,
    query,
    threshold,
  )
  return nodes.map(normalizeActionable)
}

export function resolveTarget(scope, target, options = {}) {
  const nodes = searchScope(scope, target, options)
  const queryTokens = tokenize(target)
  return rankCandidates(nodes, {
    query: target,
    nameTokens: queryTokens,
    descriptionTokens: queryTokens,
  }, options)
}

export function resolveDescriptor(scope, descriptor, options = {}) {
  const nodes = searchScope(scope, descriptor.query, options)
  return rankCandidates(nodes, descriptor, options)
}

function rankCandidates(nodes, descriptor, {
  containerBox = null,
  minScore = 1.5,
  minScoreGap = 0.25,
  requireTokenMatch = false,
} = {}) {
  const query = descriptor.query
  const rawCandidates = nodes.map((node) => ({
    node,
    descriptor: nodeDescriptor(node, query, containerBox),
  }))
  const candidates = dedupeCandidateRecords(rawCandidates)
  const plausible = candidates
    .map((candidate, index) => ({
      index,
      ...candidate,
      score: candidateScore(candidate.descriptor, descriptor),
      tokenScore: candidateTokenScore(candidate.descriptor, descriptor),
    }))
    .filter(({ descriptor: candidate }) => !descriptor.role || candidate.role === descriptor.role)
    .sort((a, b) => b.score - a.score)

  if (plausible.length === 0) {
    return stripNodes({
      status: 'none',
      rawCandidateCount: rawCandidates.length,
      candidateCount: candidates.length,
      plausibleCount: 0,
      candidates,
    })
  }

  const top = plausible[0]
  const runnerUp = plausible[1]
  const scoreGap = runnerUp ? round(top.score - runnerUp.score, 4) : null
  if (top.score < minScore || (requireTokenMatch && top.tokenScore === 0)) {
    return stripNodes({
      status: 'low-confidence',
      rawCandidateCount: rawCandidates.length,
      candidateCount: candidates.length,
      plausibleCount: plausible.length,
      tieBreakScore: top.score,
      scoreGap,
      candidates,
    })
  }

  if (!runnerUp || scoreGap >= minScoreGap) {
    const selected = top
    return stripNodes({
      status: 'unique',
      rawCandidateCount: rawCandidates.length,
      candidateCount: candidates.length,
      plausibleCount: plausible.length,
      selectedNode: selected.node,
      selectedDescriptor: selected.descriptor,
      selectedIndex: selected.index,
      tieBreakScore: selected.score,
      scoreGap,
      candidates,
    })
  }

  return stripNodes({
    status: 'ambiguous',
    rawCandidateCount: rawCandidates.length,
    candidateCount: candidates.length,
    plausibleCount: plausible.length,
    tieBreakScore: plausible[0].score,
    scoreGap,
    candidates,
  })
}

function dedupeCandidateRecords(candidates) {
  const seen = new Set()
  const unique = []
  for (const candidate of candidates) {
    const fingerprint = candidateFingerprint(candidate.descriptor)
    if (seen.has(fingerprint)) continue
    seen.add(fingerprint)
    unique.push(candidate)
  }
  return unique
}

function candidateFingerprint(candidate) {
  const box = candidate.box
  const boxKey = box
    ? [box.left, box.top, box.right, box.bottom].map((value) => Math.round(value)).join(',')
    : 'no-box'
  return JSON.stringify({
    role: candidate.role,
    box: boxKey,
    actions: candidate.supportedActions ?? [],
    nameTokens: candidate.nameTokens ?? [],
    descriptionTokens: candidate.descriptionTokens ?? [],
  })
}

function candidateScore(candidate, descriptor) {
  const tokenScore = candidateTokenScore(candidate, descriptor)
  const roleScore = !descriptor.role || candidate.role === descriptor.role ? 1 : 0
  const actionScore = descriptor.supportedActions?.some((action) => candidate.supportedActions?.includes(action)) ? 1 : 0
  const posScore = candidate.posHint && descriptor.posHint
    ? 1 - Math.min(1, Math.hypot(candidate.posHint.xRatio - descriptor.posHint.xRatio, candidate.posHint.yRatio - descriptor.posHint.yRatio))
    : 0
  const specificRoleScore = ['window', 'application'].includes(candidate.role) ? 0 : 0.5
  const depthScore = Math.min(0.25, (candidate.ancestorRoles?.length ?? 0) * 0.05)
  const smallBoxScore = candidate.box ? Math.max(0, 0.25 - boxArea(candidate.box) / 10_000_000) : 0
  return round(
    roleScore * 3 + actionScore * 2 + tokenScore * 2 + posScore
      + specificRoleScore + depthScore + smallBoxScore,
    4,
  )
}

function candidateTokenScore(candidate, descriptor) {
  return Math.max(
    tokenOverlap(candidate.nameTokens, descriptor.nameTokens),
    tokenOverlap(candidate.nameTokens, descriptor.descriptionTokens),
    tokenOverlap(candidate.descriptionTokens, descriptor.nameTokens),
    tokenOverlap(candidate.descriptionTokens, descriptor.descriptionTokens),
  )
}

function boxArea(box) {
  return Math.max(0, box.right - box.left) * Math.max(0, box.bottom - box.top)
}

function tokenOverlap(a = [], b = []) {
  const aa = new Set(a)
  const bb = new Set(b)
  if (aa.size === 0 || bb.size === 0) return 0
  let intersection = 0
  for (const token of aa) if (bb.has(token)) intersection += 1
  return intersection / Math.max(aa.size, bb.size)
}

function stripNodes(result) {
  const publicCandidates = result.candidates?.map(({ descriptor }) => descriptor) ?? []
  return {
    ...result,
    candidates: publicCandidates,
  }
}
