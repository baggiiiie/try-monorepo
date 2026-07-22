# Learnings from Stagehand

Stagehand v3 separates application intent from generic automation machinery.
Callers still define site-specific goals and ordering, while Stagehand provides
grounding, actions, extraction, deterministic replay, and healing.

## What Stagehand does

- `observe()` turns an instruction into executable actions containing a
  selector, method, and arguments.
- `act()` performs one grounded action. Passing an observed action skips a new
  grounding call.
- `extract()` reads live page data into a caller-provided schema.
- `agent()` plans multi-step workflows from a high-level task.
- A resolved action is structured replay data—selector, description, method,
  and arguments—not generated Playwright source code.
- The local action cache stores those resolved actions across runs and replays
  them without an LLM when `cacheDir` is configured.
- The agent cache records successful trajectories and deterministically replays
  navigation, actions, scrolling, waits, and form input.
- On an action-cache miss, Stagehand invokes its configured inference client
  in-process to ground the instruction, executes the resolved action, and
  stores it. It does not launch an external coding agent.
- Failed action replay can use that same inference client to re-ground the
  target and update its cached selector.

Stagehand does not eliminate site-specific logic. The caller writes the steps,
or an agent generates them. It also does not cache dynamic business data such
as current page content; that data must be extracted live.

## Implications for this project

Our current cache stores individual Simulang or CUA element descriptors, which
is one level below Stagehand's action artifact. We should compile a Pi-grounded
CUA choice into `{ target, method, arguments, addressing, deliveryMode }`, then
cache and replay that structured action. Simulang remains available, but the
first complete path will focus on CUA.

Remaining directions:

1. **Compile and cache CUA actions.** Resolve semantic instructions with Pi,
   validate the target and method, and persist a replayable action artifact.
2. **Cache workflow replay steps.** A successful multi-step run should bypass
   planning on later runs while healing only stale steps.
3. **Broaden durable native-GUI identity carefully.** Preserve replay safety
   without leaking dynamic content or relying on ephemeral element handles.
4. **Ground from AX plus screenshots.** Add cycle-safe, window-rooted traversal
   and vision fallback for missing or custom-drawn controls.
5. **Never cache live app content.** Cache how to reach and read email data,
   but read sender, subject, body, and state on every run.

The target top-level workflow should remain declarative:

```js
await gui.act('Inbox', 'activate')
const messages = await gui.observeMany('first three messages', {
  within: 'Message list',
})

for (const message of messages) {
  const before = await gui.extract('Reading pane', { project: parseEmail })
  await gui.act(message, 'activate')
  yield await gui.waitForChange('Reading pane', { from: before, project: parseEmail })
}
```

The Outlook meaning belongs in concise instructions, schemas, and workflow
ordering—not in `src/` and not in a family of backend-specific adapters.

Unlike an LLM-backed schema extractor, this project's `extract` only serializes
a bounded `NodeView` and invokes explicit projection and validation callbacks.
It makes no natural-language or schema inference claims.

## References

- [Stagehand `act()`](https://docs.stagehand.dev/v3/basics/act)
- [Stagehand `observe()`](https://docs.stagehand.dev/v3/basics/observe)
- [Stagehand caching](https://docs.stagehand.dev/v3/best-practices/caching)
- [Stagehand `ActCache`](https://github.com/browserbase/stagehand/blob/main/packages/core/lib/v3/cache/ActCache.ts)
- [Stagehand `AgentCache`](https://github.com/browserbase/stagehand/blob/main/packages/core/lib/v3/cache/AgentCache.ts)
