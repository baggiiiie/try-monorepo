// Compatibility entrypoint.
//
// The agent-native Outlook triage flow now lives in the Pi skill
// `.pi/skills/outlook-email-triage/`: Pi runs Simulang helper scripts,
// classifies the collected emails in-session, asks the user for approval, and
// then runs the archive helper only for approved targets.
//
// Run this file to collect unread Outlook emails only:
//   simulang run outlook-unread-experiment.mts

import './outlook-collect-unread.mts'
