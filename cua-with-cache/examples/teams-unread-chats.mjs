import gui from './gui.mjs'

const TEAMS_UNREAD_CHATS_TASK = 'get all my unread chats, return a list of sender and message'

try {
    gui.findApp('teams')
    const report = await gui.act(TEAMS_UNREAD_CHATS_TASK)
    console.log(JSON.stringify(report, null, 2))
    if (!report.success) process.exitCode = 1
} catch (error) {
    console.error(`[teams-unread-chats] failed: ${error.stack || error.message}`)
    process.exitCode = 1
}
