import {
  Coordinate,
  MouseController,
  TraversalOrder,
} from '@simular-ai/simulang-js'

import { summarizeCacheResult } from '../../../src/cached-simulang.mjs'
import { roleName } from '../../../src/core/descriptor.mjs'
import { boxCenter, safe } from '../../../src/core/util.mjs'

export const DEFAULT_MAX_SCROLLS = 8
export const DEFAULT_MAX_NODES = 1600
const TEAMS_CHAT_TARGET = 'Chat (⌘ 2)'
const TEAMS_UNREAD_TARGET = 'Unread (⌥ ⌘ U)'
const SCROLL_SETTLE_MS = 400

const ZERO_WIDTH_PATTERN = /[\u034f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g
const URL_PATTERN = /https?:\/\/\S+/gi

export const TEAMS_APP = {
  app: 'Microsoft Teams',
  appCandidates: ['Microsoft Teams', 'Teams', 'Microsoft Teams (work or school)', 'Microsoft Teams classic'],
  cacheDir: '.gui-cache/teams',
  threshold: 0.35,
  maxNodes: DEFAULT_MAX_NODES,
  openApp: true,
  focusApp: true,
}

export const teamsUnreadChatsAction = {
  match: matchTeamsUnreadChatsIntent,
  run: runTeamsUnreadChatsAction,
}

function matchTeamsUnreadChatsIntent({ app, task, options }) {
  if (app.id !== 'teams') return null

  if (task && typeof task === 'object') {
    const type = normalizeIntentType(task.type ?? task.intent)
    if (!type) return null
    return {
      type,
      text: task.text ?? task.task ?? type,
      fields: task.fields ?? options.fields ?? ['sender', 'message'],
    }
  }

  const text = String(task ?? '').trim()
  const lower = text.toLowerCase()
  if (!/\b(chat|chats|teams)\b/.test(lower) || !/\bunread\b/.test(lower)) return null
  return {
    type: 'readUnreadChats',
    text,
    fields: options.fields ?? chatFieldsFromText(lower),
  }
}

async function runTeamsUnreadChatsAction({ agent, app, options, intent }) {
  const logCache = options.logCache ?? app.options.logCache ?? true
  const cache = agent.openCache(app, options)
  const navigation = [
    { target: options.chatTarget ?? TEAMS_CHAT_TARGET, action: 'activate' },
    { target: options.unreadTarget ?? TEAMS_UNREAD_TARGET, action: 'activate' },
  ]

  const results = []
  for (const step of navigation) {
    results.push(await cache.act(step))
    await sleep(options.navigationDelayMs ?? 500)
  }

  if (logCache) console.error('[cache] Teams unread chat content: LIVE_READ (not cached)')
  const unreadChats = await readUnreadChats(cache, {
    maxNodes: options.maxNodes ?? app.options.maxNodes,
    maxScrolls: options.maxScrolls,
    maxChats: options.maxChats,
  })

  return {
    success: results.every((result) => result.success) && unreadChats.success,
    app: app.app,
    appId: app.id,
    task: intent.text,
    intent: {
      type: intent.type,
      fields: intent.fields,
    },
    cacheDir: cache.storage.cacheDir,
    cacheMode: cache.storage.cacheMode,
    threshold: cache.threshold,
    maxNodes: cache.maxNodes,
    scope: {
      kind: cache.scope.kind,
      pid: cache.scope.pid,
      pidsSeen: cache.pidsSeen,
      windowsSeen: cache.windowsSeen,
    },
    context: cache.context,
    results,
    summary: results.map(summarizeCacheResult),
    unreadChats,
    chats: unreadChats.chats,
  }
}

export async function readUnreadChats(gui, {
  maxNodes = DEFAULT_MAX_NODES,
  maxScrolls = DEFAULT_MAX_SCROLLS,
  maxChats = null,
} = {}) {
  const chats = []
  const seen = new Set()
  let stableScrolls = 0

  for (let scroll = 0; scroll <= maxScrolls; scroll += 1) {
    const rows = unreadChatRows(gui.scope, maxNodes)
    let added = 0
    for (const row of rows) {
      const chat = parseUnreadChatRow(row)
      if (!chat.sender && !chat.message) continue

      const key = chatKey(chat)
      if (seen.has(key)) continue
      seen.add(key)
      chats.push({ sender: chat.sender, message: chat.message })
      added += 1

      if (maxChats && chats.length >= maxChats) break
    }

    if (maxChats && chats.length >= maxChats) break
    if (rows.length === 0 || added === 0) stableScrolls += 1
    else stableScrolls = 0
    if (stableScrolls >= 2) break
    if (!scrollUnreadList(rows)) break
    await sleep(SCROLL_SETTLE_MS)
  }

  return {
    success: true,
    cacheStatus: 'LIVE_READ',
    returned: chats.length,
    message: chats.length === 1 ? 'Read 1 unread Teams chat' : `Read ${chats.length} unread Teams chats`,
    chats,
  }
}

function unreadChatRows(scope, maxNodes) {
  const matches = safe('scoredSearch:Unread message', () => scope.scoredSearch(
    TraversalOrder.DepthFirst,
    maxNodes,
    true,
    'Unread message',
    0.2,
  ), [])

  return dedupeRows(matches
    .filter((node) => nodeRole(node) === 'row')
    .filter((node) => /^Unread message\b/i.test(nodeText(node)))
    .filter((node) => Boolean(nodeBox(node))))
    .sort((a, b) => nodeBox(a).top - nodeBox(b).top)
}

function parseUnreadChatRow(row) {
  const rowBox = nodeBox(row)
  const textItems = rowTextItems(row)
    .filter((item) => item.text && item.text !== 'Unread')
    .filter((item) => !isDateLine(item.text))
    .sort((a, b) => a.top - b.top || a.left - b.left)

  const rowMidY = rowBox ? rowBox.top + (rowBox.bottom - rowBox.top) * 0.5 : null
  const title = textItems.find((item) => rowMidY == null || item.top < rowMidY)?.text ?? null
  const preview = textItems.find((item) => rowMidY != null && item.top >= rowMidY)?.text
    ?? textItems.find((item) => item.text !== title)?.text
    ?? previewFromRowText(nodeText(row))

  return parseSenderMessage({ title, preview, rowText: nodeText(row) })
}

function parseSenderMessage({ title, preview, rowText }) {
  const cleanTitle = normalizeChatText(title)
  const cleanPreview = normalizeChatText(preview)
  const fallback = normalizeChatText(rowText)
  const previewText = cleanPreview || previewFromRowText(fallback)

  const split = splitSenderPreview(previewText)
  if (split) return split

  return {
    sender: cleanTitle || senderFromRowText(fallback),
    message: previewText || messageFromRowText(fallback),
  }
}

function splitSenderPreview(preview) {
  const match = String(preview ?? '').match(/^(.{1,120}?):\s*(.+)$/)
  if (!match) return null
  if (!isLikelySenderPrefix(match[1])) return null
  return {
    sender: normalizeChatText(match[1]),
    message: normalizeChatText(match[2]),
  }
}

function isLikelySenderPrefix(value) {
  const prefix = normalizeChatText(value)
  if (!prefix || prefix.length > 60) return false
  if (prefix.split(/\s+/).length > 8) return false
  return true
}

function normalizeIntentType(type) {
  const value = String(type ?? '').trim().toLowerCase()
  if (['readunreadchats', 'checkunreadchats', 'readteamschats', 'checkteamschats'].includes(value)) return 'readUnreadChats'
  return null
}

function chatFieldsFromText(text) {
  const fields = []
  if (/\bsender\b/.test(text)) fields.push('sender')
  if (/\b(message|content|body)\b/.test(text)) fields.push('message')
  return fields.length > 0 ? fields : ['sender', 'message']
}

function rowTextItems(row) {
  const items = []
  walkNode(row, (node) => {
    if (nodeRole(node) !== 'text') return
    const box = nodeBox(node)
    if (!box) return
    const text = normalizeChatText(nodeText(node))
    if (!text) return
    items.push({ text, top: box.top, left: box.left })
  })
  return items
}

function scrollUnreadList(rows) {
  const boxes = rows.map(nodeBox).filter(Boolean)
  if (boxes.length === 0) return false

  const top = Math.min(...boxes.map((box) => box.top))
  const bottom = Math.max(...boxes.map((box) => box.bottom))
  const left = Math.min(...boxes.map((box) => box.left))
  const right = Math.max(...boxes.map((box) => box.right))
  const center = boxCenter({ left, top, right, bottom })
  if (!center) return false

  const mouse = new MouseController()
  mouse.moveMouse(Math.round(center.x), Math.round(center.y), Coordinate.Abs)
  mouse.scroll(0, 4)
  return true
}

function previewFromRowText(rowText) {
  return messageFromRowText(rowText)
}

function senderFromRowText(rowText) {
  const match = String(rowText ?? '').match(/\bmessage\s+([^:]{1,120}):\s+/i)
  if (match) return normalizeChatText(match[1])
  const title = String(rowText ?? '').match(/^Unread message\s+(.+?)\s+chat\b/i)?.[1]
  return normalizeChatText(title)
}

function messageFromRowText(rowText) {
  const match = String(rowText ?? '').match(/\bmessage\s+[^:]{1,120}:\s+(.+?)(?:\s+\d{1,2}\/\d{1,2}|$)/i)
  if (match) return normalizeChatText(match[1])
  return ''
}

function normalizeChatText(value) {
  return String(value ?? '')
    .replace(ZERO_WIDTH_PATTERN, '')
    .replace(URL_PATTERN, '[url]')
    .replace(/\s+/g, ' ')
    .trim()
}

function isDateLine(text) {
  return /^(Today|Yesterday|Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(text)
    || /^\d{1,2}\/\d{1,2}$/.test(text)
    || /^\d{1,2}:\d{2}\s?(AM|PM)?$/i.test(text)
}

function dedupeRows(rows) {
  const seen = new Set()
  const result = []
  for (const row of rows) {
    const key = `${boxKey(nodeBox(row))}:${nodeText(row).slice(0, 240)}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push(row)
  }
  return result
}

function chatKey(chat) {
  return `${chat.sender}\n${chat.message}`.toLowerCase()
}

function walkNode(root, visitor, depth = 0, state = { seen: new Set(), count: 0 }) {
  if (!root || depth > 10 || state.count > 2000) return
  state.count += 1
  const key = `${depth}:${nodeRole(root)}:${boxKey(nodeBox(root))}:${nodeText(root).slice(0, 100)}`
  if (state.seen.has(key)) return
  state.seen.add(key)

  visitor(root, depth)
  for (const child of nodeChildren(root)) walkNode(child, visitor, depth + 1, state)
}

function nodeRole(node) {
  return roleName(safe('role', () => node.role, 'unknown'))
}

function nodeChildren(node) {
  const children = safe('children', () => node.children(), [])
  return Array.isArray(children) ? children : []
}

function nodeBox(node) {
  if (!node) return null
  const box = safe('boundingBox', () => node.boundingBox(), null)
  return box && typeof box === 'object' ? box : null
}

function nodeText(node) {
  return normalizeChatText([
    safe('name', () => node.name, ''),
    safe('description', () => node.description, ''),
    safe('value', () => node.value, ''),
  ].filter(Boolean).join(' | '))
}

function boxKey(box) {
  return box ? [box.left, box.top, box.right, box.bottom].map((value) => Math.round(value)).join(',') : 'no-box'
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
