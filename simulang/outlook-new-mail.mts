// Run: simulang run outlook-new-mail.mts
//
// Opens Microsoft Outlook, finds the "New Mail" button, and presses it.

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  App,
  FocusPolicy,
  Screen,
  System,
  TraversalOrder,
  Visibility,
  Window,
  screenshotFull,
} from '@simular-ai/simulang-js'

const RUN_DIR = join(process.cwd(), '.runs', `outlook-new-mail-${new Date().toISOString().replace(/[:.]/g, '-')}`)
mkdirSync(RUN_DIR, { recursive: true })

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let outlookPid = 0
let stepIndex = 0

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function latestOutlookWindow() {
  const windows = Window.allForPid(outlookPid)
  if (!windows.length) throw new Error(`No visible Outlook windows for pid ${outlookPid}`)

  return windows.find((w) => /outlook|inbox|mail/i.test(w.title))
    ?? windows.find((w) => w.title.trim())
    ?? windows[0]
}

function dumpDiagnostics(label, err) {
  const dir = join(RUN_DIR, label)
  mkdirSync(dir, { recursive: true })

  writeFileSync(join(dir, 'error.txt'), err?.stack ?? String(err))
  writeFileSync(
    join(dir, 'windows.json'),
    JSON.stringify(Window.all().map((w) => ({ pid: w.pid, title: w.title })), null, 2),
  )

  try {
    screenshotFull(true, Screen.mainScreen()).save(join(dir, 'screen.png'))
  } catch (e) {
    writeFileSync(join(dir, 'screen-error.txt'), String(e))
  }

  console.error(`Diagnostics saved to ${dir}`)
}

async function step(name, action, verify) {
  const id = `${String(++stepIndex).padStart(2, '0')}-${slug(name)}`
  console.log(`\n▶ ${id}`)
  try {
    const result = await action()
    if (verify) await verify(result)
    console.log(`✓ ${id}`)
    return result
  } catch (err) {
    console.error(`✗ ${id}: ${err?.message ?? err}`)
    dumpDiagnostics(id, err)
    throw err
  }
}

const instance = await step(
  'open and focus Outlook',
  async () => {
    const app = App.exists('Microsoft Outlook') ? App.exactName('Microsoft Outlook') : System.fuzzySearch('Outlook')
    const inst = app.open(null, FocusPolicy.Steal, Visibility.Show, true)
    await sleep(2500)
    inst.focus()
    inst.enableAccessibility()
    outlookPid = inst.pid
    await sleep(1000)
    return inst
  },
  async () => {
    if (!outlookPid) throw new Error('Outlook pid was 0/unknown')
    latestOutlookWindow()
  },
)

await step(
  'click New Mail button',
  async () => {
    const w = latestOutlookWindow()
    const candidates = w.scoredSearch(
      TraversalOrder.BreadthFirst,
      3000,
      true,
      'New Mail button compose new email',
      0.04,
    )

    const candidateDescriptions = candidates.slice(0, 10).map((node, index) => ({
      index,
      name: node.name,
      value: node.value,
      description: node.description,
    }))
    writeFileSync(join(RUN_DIR, 'new-mail-candidates.json'), JSON.stringify(candidateDescriptions, null, 2))

    const button = candidates.find((node) => {
      const text = [node.name, node.value, node.description].filter(Boolean).join(' ')
      return /new\s+mail/i.test(text)
    }) ?? candidates[0]

    if (!button) throw new Error('Could not find the New Mail button')

    try { button.focus() } catch {}
    await sleep(150)
    button.activate()
    await sleep(1500)
    return button
  },
  async () => {
    const titles = Window.allForPid(outlookPid).map((w) => w.title)
    writeFileSync(join(RUN_DIR, 'windows-after-click.json'), JSON.stringify(titles, null, 2))

    // If Outlook did not expose a named compose window yet, still continue:
    // the AX press is the important postcondition for this tiny experiment.
    if (!titles.some((title) => /new|untitled|message|compose|mail/i.test(title))) {
      console.warn('Clicked New Mail; no obvious compose-window title detected yet.')
    }
  },
)

try { instance.disableAccessibility() } catch {}

console.log(`\nDone. Artifacts saved in ${RUN_DIR}`)
