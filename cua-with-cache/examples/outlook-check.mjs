import { openApp, summarizeResult } from '../src/index.mjs'
import { OUTLOOK_APP, OUTLOOK_TARGETS, readTopInboxEmails } from './apps/outlook/read-emails.mjs'

const EMAIL_COUNT = 5

try {
    const gui = openApp('outlook', OUTLOOK_APP)

    // Ground + cache the stable controls (self-heals if the UI drifted).
    const grounded = []
    for (const target of OUTLOOK_TARGETS) grounded.push(await gui.observe(target))

    // Email content is read live from the app, never cached.
    console.error('[cache] email content: LIVE_READ (not cached)')
    const emails = await readTopInboxEmails(gui, { emailCount: EMAIL_COUNT })

    // The demo's pass/fail gate is the cached grounding (what the library
    // guarantees) plus a non-empty live read. Individual email reads are
    // best-effort: some content (digests, coverage tables) legitimately fails
    // the reading-pane row verifier, and that is reported, not treated as a
    // library failure.
    const report = {
        success: grounded.every((r) => r.success) && emails.returned > 0,
        app: gui.scope.appName,
        grounded: grounded.map(summarizeResult),
        emails,
    }
    console.log(JSON.stringify(report, null, 2))
    if (!report.success) process.exitCode = 1
} catch (error) {
    console.error(`[check-outlook] failed: ${error.stack || error.message}`)
    process.exitCode = 1
}
