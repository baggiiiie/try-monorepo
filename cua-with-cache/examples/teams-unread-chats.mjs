import { openApp, summarizeResult } from '../src/index.mjs'
import {
    TEAMS_APP,
    TEAMS_CHAT_TARGET,
    TEAMS_UNREAD_TARGET,
    readUnreadChats,
} from './apps/teams/read-unread-chats.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

try {
    const gui = openApp('teams', TEAMS_APP)

    // Cached grounding + action on the two navigation controls.
    const nav = []
    for (const target of [TEAMS_CHAT_TARGET, TEAMS_UNREAD_TARGET]) {
        nav.push(await gui.act(target, { action: 'activate' }))
        await sleep(500)
    }

    // Chat content is read live from the app, never cached.
    console.error('[cache] Teams unread chat content: LIVE_READ (not cached)')
    const unreadChats = await readUnreadChats(gui)

    const report = {
        success: nav.every((r) => r.success) && unreadChats.success,
        app: gui.scope.appName,
        nav: nav.map(summarizeResult),
        unreadChats,
    }
    console.log(JSON.stringify(report, null, 2))
    if (!report.success) process.exitCode = 1
} catch (error) {
    console.error(`[teams-unread-chats] failed: ${error.stack || error.message}`)
    process.exitCode = 1
}
