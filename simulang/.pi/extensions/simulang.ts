import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { StringEnum } from '@earendil-works/pi-ai'
import { Text } from '@earendil-works/pi-tui'
import { Type } from 'typebox'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const MODE = StringEnum(['observe', 'step', 'batch', 'run'] as const)

const PARAMS = Type.Object({
  mode: MODE,
  name: Type.Optional(Type.String({ description: 'Short run name for artifacts, e.g. open-teams-calendar' })),
  code: Type.Optional(Type.String({ description: 'For mode=run: TypeScript body. gui, sim, input, and params are in scope; use return to produce the result.' })),
  action: Type.Optional(Type.Any({ description: 'For mode=step: one structured action, e.g. {type:"press", query:"Calendar"}' })),
  actions: Type.Optional(Type.Array(Type.Any(), { description: 'For mode=batch: structured actions to execute in order.' })),
  target: Type.Optional(Type.Any({ description: 'Optional target, e.g. {pid:123}, {titleRegex:"Outlook|Teams"}' })),

  options: Type.Optional(Type.Any({ description: 'Mode-specific options. For batch, use {observe:"afterEach"|"final"|false, stopOnFailure:true}.' })),
  stealFocus: Type.Optional(Type.Boolean({ description: 'Steal focus for this run. Defaults false unless STEAL_FOCUS=1.' })),
  timeoutMs: Type.Optional(Type.Number({ description: 'Execution timeout in milliseconds. Default 120000.' })),
})

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function slug(s: string | undefined) {
  return String(s || 'simulang').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'simulang'
}

function trimText(text: string, max = 5000) {
  if (text.length <= max) return text
  return `${text.slice(0, max)}\n... [truncated ${text.length - max} chars]`
}

function safeReadJson(path: string) {
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf8'))
}

function buildScript(params: any, runDir: string, runtimePath: string) {
  const runtimeUrl = pathToFileURL(runtimePath).href
  const encodedParams = JSON.stringify(params, null, 2)
  const encodedRunDir = JSON.stringify(runDir)
  const userCode = params.mode === 'run' ? String(params.code || '') : ''

  return `import * as sim from '@simular-ai/simulang-js'\n` +
`import { createGui, writeJson, toJsonSafe } from ${JSON.stringify(runtimeUrl)}\n\n` +
`const params = ${encodedParams}\n` +
`const input = params\n` +
`const runDir = ${encodedRunDir}\n` +
`const gui = createGui({ runDir, params })\n` +
`let result\n` +
`try {\n` +
`  let value\n` +
`  if (params.mode === 'observe') {\n` +
`    value = await gui.observe({ ...(params.options || {}), target: params.target })\n` +
`  } else if (params.mode === 'step') {\n` +
`    value = await gui.step(params.action, params.options || {})\n` +
`  } else if (params.mode === 'batch') {\n` +
`    value = await gui.batch(params.actions || [], params.options || {})\n` +
`  } else if (params.mode === 'run') {\n` +
`    value = await (async () => {\n${userCode}\n    })()\n` +
`  } else {\n` +
`    throw new Error('Unsupported mode: ' + params.mode)\n` +
`  }\n` +
`  const logicalOk = !(value && typeof value === 'object' && value.ok === false)\n` +
`  result = { ok: logicalOk, mode: params.mode, name: params.name || null, artifactDir: runDir, value: toJsonSafe(value), trace: gui.trace() }\n` +
`  writeJson(gui.artifactPath('result.json'), result)\n` +
`  console.log('__SIMULANG_RESULT__' + JSON.stringify({ ok: result.ok, mode: result.mode, artifactDir: result.artifactDir }))\n` +
`} catch (error) {\n` +
`  const diagnostics = await gui.captureFailure('failure')\n` +
`  result = { ok: false, mode: params.mode, name: params.name || null, artifactDir: runDir, error: { name: error?.name, message: error?.message ?? String(error), stack: error?.stack }, diagnostics, trace: gui.trace() }\n` +
`  writeJson(gui.artifactPath('result.json'), result)\n` +
`  console.error(error?.stack ?? String(error))\n` +
`  process.exitCode = 1\n` +
`}\n`
}

function summarizeResult(result: any, stdout: string, stderr: string, cwd: string) {
  const artifactDir = result?.artifactDir ? relative(cwd, result.artifactDir) || result.artifactDir : undefined
  const value = result?.value
  let summary = ''

  if (value?.summary) summary = value.summary
  else if (value?.observation?.summary) summary = value.observation.summary
  else if (value?.observation?.snapshot?.text) summary = value.observation.snapshot.text
  else if (value?.snapshot?.text) summary = value.snapshot.text
  else if (value !== undefined) summary = JSON.stringify(value, null, 2)
  else if (result?.error) summary = result.error.message || JSON.stringify(result.error)

  const header = result?.ok ? `simulang ${result.mode} ok` : `simulang ${result?.mode || 'run'} failed`
  const parts = [header]
  if (artifactDir) parts.push(`artifacts: ${artifactDir}`)
  if (summary) parts.push(trimText(summary, 3500))
  if (!result?.ok && stderr) parts.push(`stderr:\n${trimText(stderr, 1500)}`)
  else if (!result && (stdout || stderr)) parts.push(trimText(`${stdout}\n${stderr}`, 3500))
  return parts.join('\n\n')
}

export default function simulangExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: 'simulang',
    label: 'Simulang',
    description: 'Navigate and automate desktop GUIs with Simulang. One tool supports observe, act-and-observe, batches, and code-first mini automations.',
    promptSnippet: 'Use simulang for GUI observation/navigation/automation. It can observe, step, batch, or run a TypeScript body with gui helpers.',
    promptGuidelines: [
      'Use simulang when the user asks Pi to inspect, navigate, or automate a desktop GUI.',
      'Prefer simulang mode=step for one action that should immediately return fresh GUI state, instead of separate observe/action/observe turns.',
      'Use simulang mode=batch for short GUI navigation sequences; set options.observe="afterEach" while debugging and omit it for faster final-state feedback.',
      'Use simulang mode=run for adaptive GUI automation. The TypeScript body has gui, sim, input, and params in scope; use gui.observe({target}) for app/window state, gui.find({target,text}) for semantic UI lookup, gui.activate(), gui.act(), gui.batch(), gui.verify(), gui.screenshot(), gui.sleep(), and return a compact result.',
      'In simulang mode=run, do not write import statements; use the provided sim namespace for raw @simular-ai/simulang-js APIs when necessary.',
      'Simulang defaults to no focus stealing. Set stealFocus=true (or STEAL_FOCUS=1) to allow focus-stealing actions, e.g. action type activateWindow to raise a target window.',
      'After a successful exploratory simulang run, use the trace/result artifacts under .runs/ to manually condense the workflow into a reusable script if the task is routine.',
    ],
    parameters: PARAMS,
    executionMode: 'sequential',

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = ctx.cwd
      const root = resolve(cwd)
      const name = slug(params.name || params.mode)
      const runDir = join(root, '.runs', `simulang-${name}-${timestamp()}`)
      mkdirSync(runDir, { recursive: true })

      const runtimePath = join(root, '.pi', 'extensions', 'simulang-runtime.mts')
      if (!existsSync(runtimePath)) {
        throw new Error(`Missing Simulang runtime helper: ${relative(root, runtimePath)}`)
      }

      if (params.mode === 'run' && !params.code?.trim()) {
        throw new Error('simulang mode=run requires non-empty code')
      }
      if (params.mode === 'step' && !params.action) {
        throw new Error('simulang mode=step requires action')
      }
      if (params.mode === 'batch' && !Array.isArray(params.actions)) {
        throw new Error('simulang mode=batch requires actions array')
      }

      const scriptPath = join(runDir, 'run.mts')
      writeFileSync(scriptPath, buildScript(params, runDir, runtimePath))

      onUpdate?.({
        content: [{ type: 'text', text: `Running simulang ${params.mode}...` }],
        details: { mode: params.mode, artifactDir: relative(root, runDir), script: relative(root, scriptPath) },
      })

      const execResult = await pi.exec('simulang', ['run', scriptPath], {
        signal,
        cwd: root,
        timeout: params.timeoutMs ?? 120_000,
      })

      const resultPath = join(runDir, 'result.json')
      const result = safeReadJson(resultPath)
      if (!result && execResult.code !== 0) {
        throw new Error(`simulang failed before writing result.json\n${trimText(execResult.stderr || execResult.stdout, 4000)}`)
      }

      const text = summarizeResult(result, execResult.stdout, execResult.stderr, root)
      return {
        content: [{ type: 'text', text }],
        details: {
          mode: params.mode,
          artifactDir: relative(root, runDir),
          script: relative(root, scriptPath),
          exitCode: execResult.code,
          result,
          stdout: trimText(execResult.stdout, 8000),
          stderr: trimText(execResult.stderr, 8000),
        },
      }
    },

    renderCall(args, theme) {
      const mode = args?.mode || '?'
      const name = args?.name ? ` ${args.name}` : ''
      return new Text(`${theme.fg('toolTitle', theme.bold('simulang '))}${theme.fg('accent', mode)}${theme.fg('dim', name)}`, 0, 0)
    },

    renderResult(result, { expanded, isPartial }, theme) {
      if (isPartial) return new Text(theme.fg('warning', 'running...'), 0, 0)
      const details = result.details as any
      const ok = details?.result?.ok
      const dir = details?.artifactDir ? ` ${details.artifactDir}` : ''
      let text = ok === false ? theme.fg('error', 'failed') : theme.fg('success', 'done')
      text += theme.fg('dim', dir)
      if (expanded && result.content?.[0]?.type === 'text') {
        text += `\n${theme.fg('dim', result.content[0].text)}`
      }
      return new Text(text, 0, 0)
    },
  })
}
