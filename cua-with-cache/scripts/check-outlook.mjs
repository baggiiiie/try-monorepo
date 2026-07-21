#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const workflow = ['run', 'examples/outlook-check.mjs']
const first = run('simulang', workflow)
if (first.status === 0) process.exit(0)

if (process.env.OUTLOOK_SELF_HEAL === '0') {
  console.error('[self-heal] Outlook check failed; agent repair is disabled by OUTLOOK_SELF_HEAL=0')
  process.exit(first.status ?? 1)
}

console.error('[self-heal] Outlook check failed; starting an Amp agent to repair the cache or workflow')
const prompt = `The cache-backed Outlook email-triage workflow failed.

Goal: make \`simulang run examples/outlook-check.mjs\` reliably read and report the top three Outlook emails. Stable GUI controls should use the generic cache library; dynamic email content must be read live. Fix stale cache data under .gui-cache/outlook, the app-specific files under examples/ or scripts/, or the generic cache library only when the failure proves a library defect. Keep src/ app-agnostic, preserve replay safety, do not hard-code email output, and do not commit changes.

Run \`npm test\` and then validate with \`OUTLOOK_SELF_HEAL=0 npm run check:outlook\`. The environment already disables nested healing, so this validation will not launch another agent.

Failure output from the first attempt:
--- stdout ---
${truncate(first.stdout)}
--- stderr ---
${truncate(first.stderr)}`

const agent = spawnSync('amp', [
  '--no-ide',
  '--no-notifications',
  '--mode',
  process.env.OUTLOOK_SELF_HEAL_MODE || 'high',
  '--execute',
], {
  cwd: process.cwd(),
  encoding: 'utf8',
  input: prompt,
  stdio: ['pipe', 'inherit', 'inherit'],
  env: { ...process.env, OUTLOOK_SELF_HEAL: '0' },
})

if (agent.error || agent.status !== 0) {
  console.error(`[self-heal] Agent repair failed${agent.error ? `: ${agent.error.message}` : ''}`)
  process.exit(agent.status ?? 1)
}

console.error('[self-heal] Agent finished; retrying Outlook triage once')
const retry = run('simulang', workflow)
process.exit(retry.status ?? 1)

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) console.error(`[self-heal] Could not run ${command}: ${result.error.message}`)
  return result
}

function truncate(value, maxLength = 20_000) {
  const text = String(value ?? '')
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}\n...[truncated]`
}
