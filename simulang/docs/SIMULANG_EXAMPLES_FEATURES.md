# Simulang Examples: Features You Can Leverage

This document summarizes every file under `examples/` and turns the patterns into a practical feature guide for writing Simulang scripts.

Sources studied:

- `examples/hello.ts`
- `examples/import-simulang.ts`
- `examples/tsconfig.json`
- `examples/core_patterns/01-basic-login/`
- `examples/core_patterns/02-login-otp-2fa/`
- `examples/core_patterns/03-multi-step-click-using-vision/`
- `examples/core_patterns/04-file-download/`
- `examples/core_patterns/05-file-upload/`
- `examples/core_patterns/06-form-fill-dynamic/`
- `examples/core_patterns/07-data-scraping/`
- `examples/core_patterns/08-popup-modal-handling/`
- `examples/core_patterns/09-multi-tab-workflow/`
- `examples/core_patterns/10-shell-integration/`

## Quick capability map

| Capability | Example(s) | Main APIs / Node features |
| --- | --- | --- |
| Run TypeScript/JavaScript directly | `hello.ts`, `import-simulang.ts` | `simulang run`, top-level `await`, dynamic `import()` |
| Import full Simulang JS API | `import-simulang.ts` | `import * as simulang from '@simular-ai/simulang-js'` |
| Open/focus browser windows | most browser examples | `App.defaultBrowser().open()`, `FocusPolicy`, `Visibility`, `instance.focus()` |
| Accessibility-tree automation | login, OTP, upload, scraping, multi-tab | `enableAccessibility()`, `AccessibilityTree`, `AccessibilityNode`, `AriaRole` |
| Keyboard automation | login, OTP, upload, navigation | `KeyboardController`, `Key`, `Direction`, `kb.text()` |
| Mouse automation | vision click, download, popup, forms | `MouseController`, `Button`, `Coordinate`, `Direction` |
| Vision grounding | nav, download, dynamic forms, popups | `screenshotFull()`, `Screen`, `GroundingModel`, `shot.ground()` |
| LLM reasoning over screenshots/text | popups, forms, scraping, summaries | `AskModel.default().ask()` |
| Clipboard-driven input | OTP, upload | `Clipboard.pasteText()` |
| File picker workflows | upload | OS-specific shortcuts + absolute path paste |
| Save/download workflow | download | right-click context menu + save dialog confirmation |
| Shell integration | OTP, shell art | `execSync`, platform-specific shell commands |
| Parallel LLM work | multi-tab | `node:worker_threads`, `Promise.all` over workers |
| Local deterministic mock sites | OTP, upload | static `index.html` served by `python3 -m http.server` or `npx serve` |

## Runtime and script authoring

Simulang scripts can use modern Node/ESM features directly.

```ts
// examples/hello.ts pattern
const { platform, version } = process
console.log(`Hello from simulang on ${platform}, Node ${version}.`)

// Top-level await works.
await new Promise((r) => setTimeout(r, 10))

// Dynamic imports work.
const fs = await import('node:fs/promises')
console.log(await fs.realpath(process.cwd()))
```

Use the CLI like this:

```bash
simulang run examples/hello.ts
simulang run examples/import-simulang.ts
```

TypeScript is usable without a build step, and `examples/tsconfig.json` shows how examples are typechecked with `noEmit`.

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

## Importing Simulang APIs

The import example verifies that `@simular-ai/simulang-js` resolves from a script and can be inspected at runtime.

```ts
import * as simulang from '@simular-ai/simulang-js'

const names = Object.keys(simulang).sort()
console.log(`Loaded ${names.length} exports`)
console.log(names.slice(0, 5))
```

For normal scripts, import only what you need:

```js
import {
  App,
  FocusPolicy,
  Visibility,
  AccessibilityTree,
  TraversalOrder,
  AriaRole,
  KeyboardController,
} from '@simular-ai/simulang-js'
```

## Browser launch and focus control

Most examples begin by opening a URL in the default browser, stealing focus, showing the window, and optionally waiting for page load.

```js
const instance = App.defaultBrowser().open(
  'https://example.com',
  FocusPolicy.Steal,
  Visibility.Show,
  true, // wait for load completion
)
instance.focus()
```

Useful variations:

```js
const browser = App.defaultBrowser()

// Foreground first tab.
browser.open(urlA, FocusPolicy.Steal, Visibility.Show, false)

// Background tabs/windows where supported.
browser.open(urlB, FocusPolicy.DoNotSteal, Visibility.Show, false)
```

Use `enableAccessibility()` before AX-tree work:

```js
instance.enableAccessibility()
await new Promise((r) => setTimeout(r, 1500))
```

## Accessibility-tree element automation

The login, OTP, upload, scraping, and multi-tab examples show that the AX tree is best when controls have stable roles and labels.

### Find and fill fields by role/name

```js
const tree = AccessibilityTree.fromPid(instance.pid)
const kb = new KeyboardController()

const [username] = tree.find(
  TraversalOrder.BreadthFirst,
  AriaRole.Textbox,
  'Username',
  true, // exact-ish name matching in examples
  1,    // max results
)
if (!username) throw new Error('Username field not found')

tree.focusElement(username.refId)
kb.text('student')
```

### Activate buttons

```js
const [submit] = tree.find(TraversalOrder.BreadthFirst, AriaRole.Button, 'Submit', true, 1)
if (!submit) throw new Error('Submit button not found')

tree.activate(submit.refId)
```

### Prefer AX tree when

- You know the accessible label (`Username`, `Password`, `Choose File`, etc.).
- The element has a clear role (`Textbox`, `Button`).
- You want deterministic automation that is less affected by visual layout.

### Prefer vision when

- The DOM/AX names are unstable.
- You need to hit browser menus, context menus, popups, or visually rendered controls.
- The page uses complex custom UI that does not expose useful accessibility metadata.

> Note: `examples/core_patterns/01-basic-login/script.js` ends with a `console.log` referencing `sx` and `sy`, but those variables are not defined in that file. If copying that example, either remove that final line or add a real screenshot/grounding verification step.

## Keyboard and mouse automation

### Text and key presses

```js
const kb = new KeyboardController()

kb.text('hello@example.com')
kb.key(Key.Return, Direction.Click)
```

### Modifier shortcuts

```js
const BACK_MODIFIER = process.platform === 'darwin' ? Key.Meta : Key.Alt

kb.key(BACK_MODIFIER, Direction.Press)
kb.key(Key.LeftArrow, Direction.Click)
kb.key(BACK_MODIFIER, Direction.Release)
```

### Mouse movement and clicks

```js
const mouse = new MouseController()

mouse.moveMouse(x, y, Coordinate.Abs)
mouse.button(Button.Left, Direction.Click)
mouse.button(Button.Right, Direction.Click)
```

A good defensive pattern from the vision navigation example is to release a potentially stuck mouse button at startup:

```js
mouse.button(Button.Left, Direction.Release)
```

## Vision grounding: click things by description

Vision grounding is used for navigation links, context menus, save dialogs, popups, and dynamic reservation forms.

```js
const shot = screenshotFull(true, Screen.mainScreen())
const [x, y] = shot.ground(GroundingModel.default(), '"Save Link As" context menu item')

mouse.moveMouse(x, y, Coordinate.Abs)
mouse.button(Button.Left, Direction.Click)
```

Reusable helper:

```js
function click(mouse, x, y) {
  mouse.moveMouse(x, y, Coordinate.Abs)
  mouse.button(Button.Left, Direction.Click)
}

async function visionClick(mouse, concept, label = concept) {
  const shot = screenshotFull(true, Screen.mainScreen())
  const [x, y] = shot.ground(GroundingModel.default(), concept)
  click(mouse, x, y)
  console.log(`[vision] ${label} → (${x}, ${y})`)
  await new Promise((r) => setTimeout(r, 500))
}
```

Prompt design matters. Prefer specific visible targets:

```js
await visionClick(mouse, 'first [PDF] arxiv.org link in the search results')
await visionClick(mouse, 'close or dismiss button on the popup or modal overlay')
await visionClick(mouse, '"7:15 pm" option in the time dropdown list')
```

## AskModel: reason over screenshots or page text

`AskModel` appears in popup detection, dynamic form handling, scraping, and parallel summaries.

### Ask about a screenshot

```js
const shot = screenshotFull(true, Screen.mainScreen())
shot.shrink(1920, 1080)

const answer = AskModel.default().ask(
  'Is there a popup, modal, or overlay blocking the page? Reply only yes or no.',
  null,
  [shot],
)

if (/yes/i.test(answer)) {
  await visionClick(mouse, 'close, dismiss, decline, or no thanks button')
}
```

### Ask over AX-tree text

```js
const pageText = AccessibilityNode.fromPid(instance.pid).snapshot()
const response = AskModel.default().ask(
  'Extract all social media links. Return only JSON: [{"platform":"...","url":"..."}]',
  pageText,
)

const links = JSON.parse(response)
```

Use a `try/catch` when parsing LLM output:

```js
try {
  console.log(JSON.parse(response))
} catch {
  console.log('Raw model response:', response)
}
```

## Popup and modal handling loop

The popup example uses a bounded detect-and-dismiss loop. This pattern is useful before any workflow on noisy consumer websites.

```js
let attempts = 0
const MAX_ATTEMPTS = 10

while (attempts < MAX_ATTEMPTS) {
  const shot = screenshotFull(true, Screen.mainScreen())
  shot.shrink(1920, 1080)

  const answer = askModel.ask(
    'Look at this browser screenshot. Is there any popup, modal dialog, cookie banner, sign-in prompt, bottom drawer, or overlay blocking the main page content? Reply only yes or no.',
    null,
    [shot],
  )

  if (!/yes/i.test(answer)) break

  await visionClick(
    mouse,
    'close, dismiss, decline, or "no thanks" button on the popup, modal, cookie banner, or sign-in overlay',
  )
  await new Promise((r) => setTimeout(r, 1000))
  attempts++
}
```

Important safeguards:

- Always cap attempts.
- Shrink screenshots before sending to the model.
- Ask for `yes`/`no` only.
- Make the dismiss target broad enough to cover close, decline, and no-thanks buttons.

## Clipboard-driven input

The OTP and upload examples use the clipboard instead of simulated typing when exact text matters.

```js
const clip = new Clipboard()
clip.pasteText('123456')
```

Use this for:

- OTP codes.
- Long file paths.
- Values affected by keyboard layout.
- Numeric inputs with `inputmode="numeric"` or masked behavior.

## OTP / 2FA workflow

The OTP example combines Node shell execution, a local mock site, AX-tree focus, clipboard paste, and Enter submit.

```js
import { execSync } from 'node:child_process'

const TOTP_SECRET = process.env.TOTP_SECRET ?? 'JBSWY3DPEHPK3PXP'
const code = execSync(`oathtool --totp --base32 ${TOTP_SECRET}`).toString().trim()

const [otpField] = tree.find(
  TraversalOrder.BreadthFirst,
  AriaRole.Textbox,
  'One-Time Password',
  true,
  1,
)

tree.focusElement(otpField.refId)
new Clipboard().pasteText(code)
new KeyboardController().key(Key.Return, Direction.Click)
```

Setup pattern:

```bash
brew install oath-toolkit
cd examples/core_patterns/02-login-otp-2fa/mock-site
python3 -m http.server 8080
simulang run examples/core_patterns/02-login-otp-2fa/script.js
```

## File download workflow

The download example uses visual grounding to right-click a link, pick a browser context-menu item, and confirm the save dialog.

```js
const shot = screenshotFull(true, Screen.mainScreen())
const [x, y] = shot.ground(GroundingModel.default(), 'first [PDF] arxiv.org link in the search results')

mouse.moveMouse(x, y, Coordinate.Abs)
mouse.button(Button.Right, Direction.Click)
await new Promise((r) => setTimeout(r, 800))

const menuShot = screenshotFull(true, Screen.mainScreen())
const [mx, my] = menuShot.ground(GroundingModel.default(), '"Save Link As" context menu item')
mouse.moveMouse(mx, my, Coordinate.Abs)
mouse.button(Button.Left, Direction.Click)

await new Promise((r) => setTimeout(r, 1500))
kb.key(Key.Return, Direction.Click)
```

This is useful when direct HTTP download is not representative because the goal is to test or drive a real browser workflow.

## File upload workflow

The upload example creates a temporary file, activates a browser file input through AX, then uses OS path-entry shortcuts to avoid brittle file-picker clicking.

```js
import { writeFileSync } from 'node:fs'
import { tmpdir, platform } from 'node:os'
import { join } from 'node:path'

const FILE_PATH = join(tmpdir(), 'simulang_upload_demo.txt')
writeFileSync(FILE_PATH, `Hello from simulang!\nGenerated at: ${new Date().toISOString()}\n`)
```

Find the file input:

```js
let fileBtn =
  tree.find(TraversalOrder.BreadthFirst, AriaRole.Button, 'Choose File', true, 1)[0] ??
  tree.find(TraversalOrder.BreadthFirst, AriaRole.Button, 'Choose file', true, 1)[0] ??
  tree.find(TraversalOrder.BreadthFirst, AriaRole.Button, null, true, 1)[0]

tree.activate(fileBtn.refId)
```

Paste an absolute path into the system picker:

```js
const os = platform()

if (os === 'darwin') {
  kb.key(Key.Meta, Direction.Press)
  kb.key(Key.Shift, Direction.Press)
  kb.key(Key.G, Direction.Click)
  kb.key(Key.Shift, Direction.Release)
  kb.key(Key.Meta, Direction.Release)
} else if (os === 'linux') {
  kb.key(Key.Control, Direction.Press)
  kb.key(Key.L, Direction.Click)
  kb.key(Key.Control, Direction.Release)
}
// Windows: standard file-name box accepts absolute paths directly.

clip.pasteText(FILE_PATH)
kb.key(Key.Return, Direction.Click)

if (os === 'darwin') {
  // First Enter loads the path in the Go-to-folder sheet; second confirms selection.
  kb.key(Key.Return, Direction.Click)
}
```

## Dynamic form filling

The Chope example demonstrates combining computed data, popup dismissal, vision clicks, and keyboard text.

```js
function roundToNearest(date, minutes) {
  const ms = minutes * 60 * 1000
  return new Date(Math.round(date.getTime() / ms) * ms)
}

function formatChopeTime(date) {
  let h = date.getHours()
  const m = date.getMinutes()
  const ampm = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`
}

const targetTime = roundToNearest(new Date(Date.now() + 60 * 60 * 1000), 15)
const label = formatChopeTime(targetTime)

await visionClick(mouse, 'food text input field', 'search field')
kb.text('Capitol Theatre')
await visionClick(mouse, 'Guests number of people pax field')
await visionClick(mouse, '+ button to increase number of adults')
await visionClick(mouse, 'time selector drop down field')
await visionClick(mouse, `"${label}" option in the time dropdown list`)
await visionClick(mouse, "Let's Go search submit button")
```

This pattern is powerful for consumer websites whose controls are visually clear but programmatically inconsistent.

## Data extraction and scraping

The data-scraping example uses the accessibility snapshot as compact, structured page text, then asks the model to extract JSON.

```js
instance.enableAccessibility()
await new Promise((r) => setTimeout(r, 2000))

const pageText = AccessibilityNode.fromPid(instance.pid).snapshot()
const response = AskModel.default().ask(
  'Extract all social media links from the page content below. Return only a JSON array.',
  pageText,
)
```

Use this when:

- You need semantic page content, not pixels.
- You want an LLM to normalize messy text into a structured schema.
- You can tolerate model variability and validate/parse the output.

If links or content are lazy-loaded, scroll first and snapshot again.

## Multi-tab and parallel LLM summaries

The multi-tab example shows browser orchestration plus real parallelism with Node workers.

Key idea: `AskModel.ask()` is synchronous, so `Promise.all([ask(), ask()])` on the same thread will not overlap. Use `worker_threads` so each ask runs in its own V8 isolate.

```js
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { AskModel } from '@simular-ai/simulang-js'

const SELF = fileURLToPath(import.meta.url)

if (!isMainThread) {
  const { prompt, text } = workerData
  const summary = AskModel.default().ask(prompt, text)
  parentPort.postMessage(summary)
  process.exit(0)
}
```

Main-thread pattern:

```js
const instances = PAGES.map(({ url }, i) => {
  const instance = browser.open(
    url,
    i === 0 ? FocusPolicy.Steal : FocusPolicy.DoNotSteal,
    Visibility.Show,
    false,
  )
  instance.enableAccessibility()
  return instance
})

await new Promise((r) => setTimeout(r, 4000))

const snapshots = instances.map((instance, i) => {
  instance.focus()
  return {
    label: PAGES[i].label,
    text: AccessibilityNode.fromPid(instance.pid).snapshot(),
  }
})

const summaries = await Promise.all(
  snapshots.map(({ text }) =>
    new Promise((resolve, reject) => {
      const w = new Worker(SELF, {
        workerData: { prompt: 'Summarise this web page in one sentence.', text },
      })
      w.once('message', resolve)
      w.once('error', reject)
      w.once('exit', (code) => {
        if (code !== 0) reject(new Error(`worker exited with code ${code}`))
      })
    }),
  ),
)
```

Use workers for multiple independent model calls, not for tiny local operations where worker startup dominates.

## Shell integration

The shell example proves Simulang scripts can call local programs through Node.

```js
import { execSync } from 'node:child_process'
import { platform } from 'node:os'

const isWindows = platform() === 'win32'

const stdout = execSync(isWindows ? 'powershell -NoProfile -Command "Write-Output hello"' : 'echo hello', {
  encoding: 'utf8',
  shell: isWindows ? undefined : '/bin/sh',
})

console.log(stdout.trim())
```

This is useful for:

- Generating OTPs (`oathtool`).
- Calling CLI tools that already know how to query local state.
- Pre/post-processing data before GUI automation.
- Integrating with platform-specific utilities.

Prefer Node standard libraries for simple filesystem/network work, and shell out when an external CLI is the right abstraction.

## Local mock sites as fixtures

Two examples include self-contained static sites:

- `02-login-otp-2fa/mock-site/index.html`
- `05-file-upload/mock-site/index.html`

This is a strong testing pattern because it gives you:

- Stable markup and accessibility names.
- No external network dependency.
- No real account or backend side effects.
- Deterministic success banners.

Run a mock site with either:

```bash
cd examples/core_patterns/05-file-upload/mock-site
python3 -m http.server 8080
# or
npx serve -l 8080
```

Then point your script to `http://localhost:8080`.

## Permissions and environment checklist

Depending on which features you use, you may need:

- Screen Recording permission: screenshots and visual grounding.
- Accessibility permission: AX tree, element focus/activation, window control.
- Input Monitoring permission: synthesized keyboard and mouse events.
- `OPENROUTER_API_KEY`: hosted LLM/model calls such as `AskModel` and likely visual grounding workflows.
- External CLIs: e.g. `oathtool` for OTP generation.

General first-run setup:

```bash
simulang setup
export OPENROUTER_API_KEY=...
simulang run path/to/script.ts
```

## Reusable mini-library for new scripts

You can start many Simulang scripts with these helpers:

```js
import {
  App,
  FocusPolicy,
  Visibility,
  GroundingModel,
  AskModel,
  Screen,
  screenshotFull,
  MouseController,
  KeyboardController,
  Coordinate,
  Button,
  Direction,
} from '@simular-ai/simulang-js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function openDefaultBrowser(url, wait = true) {
  const instance = App.defaultBrowser().open(url, FocusPolicy.Steal, Visibility.Show, wait)
  instance.focus()
  return instance
}

function click(mouse, x, y) {
  mouse.moveMouse(x, y, Coordinate.Abs)
  mouse.button(Button.Left, Direction.Click)
}

async function visionClick(mouse, concept, delay = 500) {
  const shot = screenshotFull(true, Screen.mainScreen())
  const [x, y] = shot.ground(GroundingModel.default(), concept)
  click(mouse, x, y)
  await sleep(delay)
  return { x, y }
}

function askScreenshotYesNo(question) {
  const shot = screenshotFull(true, Screen.mainScreen())
  shot.shrink(1920, 1080)
  const answer = AskModel.default().ask(`${question} Reply only yes or no.`, null, [shot])
  return /yes/i.test(answer)
}
```

## Choosing the right pattern

| Task | Recommended pattern |
| --- | --- |
| Fill a normal form with labels | AX tree + `KeyboardController.text()` |
| Click a visually obvious but semantically messy element | `screenshotFull().ground()` + mouse click |
| Close unpredictable cookie/sign-in popups | Ask screenshot yes/no + bounded vision-click loop |
| Paste exact values or paths | `Clipboard.pasteText()` |
| Upload a file | AX activate file input + OS path-entry shortcut + paste path |
| Download through browser UI | Vision-ground link/context menu + keyboard confirm |
| Extract structured data from a page | `AccessibilityNode.snapshot()` + `AskModel.ask()` + JSON validation |
| Summarize many pages | Open tabs in parallel + snapshot + worker-thread `AskModel.ask()` |
| Need local CLI capability | Node `execSync()` / `spawn` integration |
| Need reliable demos/tests | Build a static mock site with accessible labels |

## Common pitfalls from the examples

- Wait for page load before building the AX tree or grounding screenshots.
- Accessibility node references should be treated as short-lived; re-find after major page changes.
- Browser context-menu labels and save dialogs vary by browser, OS, and locale.
- Visual prompts that are too vague may click the wrong target; make them precise.
- Background tabs may load slowly or be throttled; increase waits or focus each tab before snapshotting.
- Model output may include prose or fences even when asked for JSON; parse defensively.
- File pickers are stateful; paste absolute paths instead of navigating by clicks.
- Shell commands must branch for Windows vs Unix when syntax differs.
- Always cap loops that depend on model judgement.
