import { createCachedSimulang } from '../src/cached-simulang.mjs'
import { OUTLOOK_APP, outlookReadEmailsAction } from './apps/outlook/read-emails.mjs'
import { TEAMS_APP, teamsUnreadChatsAction } from './apps/teams/read-unread-chats.mjs'

const gui = createCachedSimulang({
  apps: {
    outlook: OUTLOOK_APP,
    teams: TEAMS_APP,
  },
  actions: [
    outlookReadEmailsAction,
    teamsUnreadChatsAction,
  ],
})

export default gui
