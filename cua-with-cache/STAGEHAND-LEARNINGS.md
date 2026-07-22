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
- The action cache stores resolved operations and replays them without an LLM.
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

Our cache stores individual Simulang or CUA element descriptors. Like
Stagehand's action cache, hits replay without a model and misses can use an
in-process inference client. The public API now includes scoped observation,
collections, bounded live extraction, and generic waits/change detection.
Whole-program workflow caching and a high-level planning agent are not
implemented; Outlook-specific meaning remains in capability modules under
`examples/apps/outlook/`.

Remaining directions:

1. **Cache generated workflows.** Let an agent write a short program against
   that API, validate a successful run, then replay the program without the
   agent.
2. **Broaden durable native-GUI identity carefully.** Preserve replay safety
   without leaking dynamic content or relying on ephemeral element handles.
3. **Improve native snapshots.** Add cycle-safe, window-rooted traversal and a
   vision fallback for custom-drawn controls.
4. **Never cache live app content.** Cache how to reach and read email data,
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

The Outlook meaning belongs in this generated workflow, not in `src/`. The
generic cache layer should make the workflow short enough that a repair agent
can safely generate and update it.

Unlike an LLM-backed schema extractor, this project's `extract` only serializes
a bounded `NodeView` and invokes explicit projection and validation callbacks.
It makes no natural-language or schema inference claims.

## References

- [Stagehand `act()`](https://docs.stagehand.dev/v3/basics/act)
- [Stagehand `observe()`](https://docs.stagehand.dev/v3/basics/observe)
- [Stagehand caching](https://docs.stagehand.dev/v3/best-practices/caching)
- [Stagehand `ActCache`](https://github.com/browserbase/stagehand/blob/main/packages/core/lib/v3/cache/ActCache.ts)
- [Stagehand `AgentCache`](https://github.com/browserbase/stagehand/blob/main/packages/core/lib/v3/cache/AgentCache.ts)
