// Run: simulang run demo.mts
//
// A short tour of @simular-ai/simulang-js. The script:
//   1. Reports system + screen info
//   2. Captures the main screen (with a grid overlay) and saves a PNG
//   3. Copies the saved file path to the clipboard
//   4. Opens the screenshot in the default browser
//
// macOS: the first run will prompt for Screen Recording and
// Accessibility permissions. Grant them in System Settings, then re-run.

import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  App,
  Clipboard,
  FocusPolicy,
  Screen,
  System,
  Visibility,
  Window,
  screenshotFull,
} from '@simular-ai/simulang-js'

// ─── 1. System overview ────────────────────────────────────────────────
console.log('── system overview ──')

const apps = System.listApps()
console.log(`installed apps:   ${apps.length}`)

const windows = Window.all()
console.log(`open windows:     ${windows.length}`)
for (const w of windows.slice(0, 5)) {
  console.log(`  • [pid ${w.pid}] ${w.title || '(untitled)'}`)
}
if (windows.length > 5) console.log(`  …and ${windows.length - 5} more`)

const screen = Screen.mainScreen()
const [x, y, width, height] = screen.dimensions()
console.log(`main screen:      ${width}×${height} @ (${x}, ${y}) physical px`)

// ─── 2. Screenshot ────────────────────────────────────────────────────
console.log('\n── screenshot ──')

const shot = screenshotFull(true, screen) // hideCursor = true
shot.shrink(1920, 1080)                   // cap at 1080p, preserve aspect
shot.addGrid(200, 200)                    // 200-px crosshair grid
shot.compress(80)                         // JPEG quality 80

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const outPath = join(tmpdir(), `simulang-demo-${stamp}.png`)
shot.save(outPath)

const [sw, sh] = shot.dimensions
console.log(`saved ${sw}×${sh} screenshot → ${outPath}`)

// ─── 3. Clipboard ─────────────────────────────────────────────────────
console.log('\n── clipboard ──')

const clip = new Clipboard()
const previous = clip.setString(outPath)
console.log(`clipboard now holds the screenshot path`)
if (previous !== null) {
  console.log(`(previous clipboard preserved: ${previous.slice(0, 60)}…)`)
}

// ─── 4. Open in default browser ───────────────────────────────────────
console.log('\n── open ──')

const url = pathToFileURL(outPath).toString()
const browser = App.defaultBrowser()
const instance = browser.open(url, FocusPolicy.Steal, Visibility.Show, true)
console.log(`opened in default browser (pid ${instance.pid})`)

console.log('\nDone — paste (Cmd/Ctrl+V) anywhere to recover the path.')
