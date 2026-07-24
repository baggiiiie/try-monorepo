import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { Stagehand } from '@browserbasehq/stagehand'
import { z } from 'zod'

try { process.loadEnvFile(join(homedir(), '.env')) } catch (error) { if (error.code !== 'ENOENT') throw error }

const modelName = process.env.STAGEHAND_MODEL ?? 'anthropic/anthropic.claude-opus-4-8'
const model = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_BASE_URL
  ? {
      modelName,
      apiKey: process.env.ANTHROPIC_API_KEY,
      baseURL: process.env.ANTHROPIC_BASE_URL,
    }
  : modelName
const userDataDir = process.env.CHROME_USER_DATA_DIR ?? join(homedir(), '.stagehand-outlook')
const profileDirectory = process.env.CHROME_PROFILE_DIRECTORY
await mkdir(userDataDir, { recursive: true })
let activeAction

function logStagehand(line) {
  if (!activeAction) return
  if (line.message === 'act cache hit') {
    activeAction.cacheHit = true
    console.log(`[cache] HIT — replaying ${activeAction.label}`)
  } else if (line.message === 'act cache stored') {
    console.log(`[cache] MISS — resolved ${activeAction.label} with the LLM and cached it`)
  } else if (line.message === 'Error performing action. Reprocessing the page and trying again') {
    console.log(`[self-heal] Cached action was stale — asking the LLM to re-ground ${activeAction.label}`)
  } else if (line.message === 'act cache entry updated after self-heal') {
    console.log(`[self-heal] Updated the cache for ${activeAction.label}`)
  }
}

const Email = z.object({
  sender: z.string().min(1).describe('The sender name and email address shown in the open message'),
  subject: z.string().min(1).describe('The subject of the open message'),
  body: z.string().min(1).describe('The visible body text of the open message'),
})

const stagehand = new Stagehand({
  env: 'LOCAL',
  model,
  cacheDir: '.gui-cache/stagehand-outlook',
  selfHeal: true,
  verbose: 2,
  disablePino: true,
  logger: logStagehand,
  localBrowserLaunchOptions: {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    userDataDir,
    preserveUserDataDir: true,
    connectTimeoutMs: 30_000,
    viewport: { width: 1440, height: 1000 },
    ...(profileDirectory ? { args: [`--profile-directory=${profileDirectory}`] } : {}),
  },
})

try {
  console.log(`[browser] Launching Chrome with profile ${userDataDir}`)
  await stagehand.init()
  const page = stagehand.context.pages()[0]
  console.log('[browser] Opening Outlook Inbox')
  await page.goto('https://outlook.office.com/mail/inbox')

  if (process.env.STAGEHAND_SKIP_LOGIN_WAIT !== '1') {
    console.log('[login] Waiting for Outlook. Log in in the opened Chrome window if prompted.')
    await waitForOutlook(page)
    console.log('[login] Outlook Inbox is ready')
  }

  const messages = []
  for (const position of ['first', 'second', 'third']) {
    const label = `the ${position} Inbox message`
    const instruction = `Open the ${position} individual email in the Inbox message list and wait for the Reading Pane to show that email.`
    activeAction = { label, cacheHit: false }
    console.log(`[cache] Checking ${label}`)
    const action = await stagehand.act(instruction)
    if (!action.success) throw new Error(`Could not open the ${position} Inbox message: ${action.message}`)
    if (!activeAction.cacheHit) console.log(`[action] Opened ${label}`)
    activeAction = undefined
    console.log(`[llm] Extracting live sender, subject, and body from ${label}`)
    messages.push(await stagehand.extract(
      'Read the sender, subject, and visible body from the currently open email in the Reading Pane.',
      Email,
    ))
    console.log(`[llm] Extracted ${label}`)
  }

  if (new Set(messages.map((message) => JSON.stringify(message))).size !== 3) {
    throw new Error('Outlook returned duplicate messages')
  }

  console.log(JSON.stringify({ success: true, messages }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2))
  process.exitCode = 1
} finally {
  await stagehand.close()
}

async function waitForOutlook(page) {
  const deadline = Date.now() + 300_000
  do {
    try {
      const state = await page.evaluate(() => ({ href: location.href, text: document.body.innerText.slice(0, 20_000) }))
      const url = new URL(state.href)
      if (['outlook.office.com', 'outlook.live.com', 'outlook.cloud.microsoft'].includes(url.hostname) && url.pathname.includes('/mail') && /\bInbox\b/i.test(state.text) && !/sign in to your account/i.test(state.text)) return
    } catch {
      // Microsoft replaces the document several times while completing login.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  } while (Date.now() <= deadline)
  throw new Error('Timed out waiting for Outlook login')
}
