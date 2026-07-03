import gui from './gui.mjs'

const OUTLOOK_CHECK_TASK = 'check first 5 emails, return subject, sender, content, and other info'

try {
    gui.findApp('outlook')
    const report = await gui.act(OUTLOOK_CHECK_TASK)
    console.log(JSON.stringify(report, null, 2))
    if (!report.success) process.exitCode = 1
} catch (error) {
    console.error(`[check-outlook] failed: ${error.stack || error.message}`)
    process.exitCode = 1
}
