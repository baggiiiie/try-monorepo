import { pathToFileURL } from 'node:url'

import gui from '../cached-simulang.mjs'

const OUTLOOK_CHECK_TASK = 'check first 4 emails, return subject, sender, content, and other info'

export async function runOutlookCheck() {
    gui.findApp('outlook')
    return gui.act(OUTLOOK_CHECK_TASK)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runOutlookCheck()
        .then((report) => {
            console.log(JSON.stringify(report, null, 2))
            if (!report.success) process.exitCode = 1
        })
        .catch((error) => {
            console.error(`[check-outlook] failed: ${error.stack || error.message}`)
            process.exitCode = 1
        })
}
