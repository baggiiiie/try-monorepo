#!/usr/bin/env node
import { runOutlookCheck, DEFAULT_OUTLOOK_TARGETS } from '../src/workflows/outlook-check.mjs'

function parseArgs(argv) {
  const opts = {
    targets: [],
    app: 'Microsoft Outlook',
    cacheDir: '.gui-cache/outlook',
    cacheMode: 'auto',
    threshold: 0.35,
    maxNodes: 1000,
    openApp: false,
    windowScope: false,
    scanAllWindows: false,
    focusWindow: false,
    json: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[++i]
      if (value == null) throw new Error(`Missing value for ${arg}`)
      return value
    }

    if (arg === '--help' || arg === '-h') opts.help = true
    else if (arg === '--target') opts.targets.push(next())
    else if (arg === '--targets') opts.targets.push(...next().split(',').map((v) => v.trim()).filter(Boolean))
    else if (arg === '--app') opts.app = next()
    else if (arg === '--cache-dir') opts.cacheDir = next()
    else if (arg === '--cache-mode') opts.cacheMode = next()
    else if (arg === '--threshold') opts.threshold = Number(next())
    else if (arg === '--max-nodes') opts.maxNodes = Number(next())
    else if (arg === '--open') opts.openApp = true
    else if (arg === '--window-scope') opts.windowScope = true
    else if (arg === '--scan-all-windows') opts.scanAllWindows = true
    else if (arg === '--focus') opts.focusWindow = true
    else if (arg === '--json') opts.json = true
    else throw new Error(`Unknown argument: ${arg}`)
  }

  if (opts.targets.length === 0) opts.targets = DEFAULT_OUTLOOK_TARGETS
  return opts
}

function printHelp() {
  console.log(`Usage: simulang run scripts/check-outlook.mjs -- [options]

Runs the Phase-2 cache-backed Outlook check workflow.

Options:
  --target <text>           Observe a target; repeatable
  --targets <a,b,c>         Comma-separated targets
  --cache-dir <path>        Cache directory (default: .gui-cache/outlook)
  --cache-mode <mode>       auto | readonly | off (default: auto)
  --threshold <n>           scoredSearch threshold (default: 0.35)
  --max-nodes <n>           Max AX nodes visited per search (default: 1000)
  --open                    Open Outlook if needed
  --window-scope            Use Window.* APIs (can hang on Outlook)
  --scan-all-windows        Fallback all-window scan for window scope
  --focus                   Focus selected window (off by default)
  --json                    Print full JSON report
`)
}

const opts = parseArgs(process.argv.slice(2))
if (opts.help) {
  printHelp()
  process.exit(0)
}

runOutlookCheck(opts)
  .then((report) => {
    if (opts.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      console.log(`[check-outlook] scope=${report.scope.kind} pid=${report.scope.pid} cache=${report.cacheDir} mode=${report.cacheMode}`)
      console.table(report.summary)
    }
    if (report.results.some((result) => !result.success)) process.exitCode = 1
  })
  .catch((error) => {
    console.error(`[check-outlook] failed: ${error.stack || error.message}`)
    process.exitCode = 1
  })
