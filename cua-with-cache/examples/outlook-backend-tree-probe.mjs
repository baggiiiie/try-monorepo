import {
  App,
  FocusPolicy,
  TraversalOrder,
  Visibility,
  Window,
  ariaRoleToString,
} from '@simular-ai/simulang-js'

import { openCuaApp } from '../src/cua/gui-cache.mjs'

const MAX_NODES = 1000
const outlook = App.exactName('Microsoft Outlook').open(
  null,
  FocusPolicy.DoNotSteal,
  Visibility.Show,
  true,
)
outlook.enableAccessibility()
const windows = Window.allForPid(outlook.pid)
const window = windows.find(({ title }) => /Inbox/i.test(title)) ?? windows[0]
if (!window) throw new Error('No Outlook window is available')

const simulangSearch = search(window, 'Search', TraversalOrder.DepthFirst)
const simulangDepthFirstMessageList = search(window, 'Message List', TraversalOrder.DepthFirst)
const simulangBreadthFirstMessageList = search(window, 'Message List', TraversalOrder.BreadthFirst)
const cua = await openCuaApp('Outlook', {
  bundleId: 'com.microsoft.Outlook',
  windowTitle: 'Inbox',
})
const cuaSnapshot = await cua.snapshot()
const cuaMessageLists = cuaSnapshot.elements.filter((element) =>
  element.role === 'AXTable' && /Message List/i.test(element.label),
)
const cuaSearchFields = cuaSnapshot.elements.filter((element) =>
  /TextField$/i.test(element.role) && /Search/i.test(`${element.label} ${element.value} ${element.help}`),
)

console.log(JSON.stringify({
  simulang: {
    maxNodes: MAX_NODES,
    depthFirst: {
      messageListHits: simulangDepthFirstMessageList.length,
      searchHits: simulangSearch.length,
      uniqueSearchSignatures: [...new Set(simulangSearch.map(signature))],
    },
    breadthFirst: {
      messageListHits: simulangBreadthFirstMessageList.length,
      roles: [...new Set(simulangBreadthFirstMessageList.map((node) => ariaRoleToString(node.role)))],
    },
  },
  cua: {
    elementCount: cuaSnapshot.elements.length,
    truncated: cuaSnapshot.truncated,
    messageLists: cuaMessageLists.map(({ element_index, role, label }) => ({ element_index, role, label })),
    searchFieldCount: cuaSearchFields.length,
  },
  interpretation: simulangDepthFirstMessageList.length === 0
    && simulangSearch.length > 0
    && new Set(simulangSearch.map(signature)).size < simulangSearch.length
    && simulangBreadthFirstMessageList.length > 0
    && cuaMessageLists.length > 0
    ? 'Reproduced: Simulang DFS revisited duplicate search nodes until its traversal budget was consumed. Breadth-first search reaches Message List.'
    : 'Not reproduced in this snapshot; rerun while the Outlook Inbox window is visible.',
}, null, 2))

function search(scope, query, order) {
  return scope.scoredSearch(
    order,
    MAX_NODES,
    true,
    query,
    0.01,
  )
}

function signature(node) {
  return `${ariaRoleToString(node.role)}|${node.name}|${node.overallDescription}`
}
