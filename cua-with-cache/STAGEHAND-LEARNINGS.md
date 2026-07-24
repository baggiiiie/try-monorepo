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

The CUA path now follows this boundary. It compiles a Pi-grounded choice into
`{ target, method, addressing, deliveryMode }`, caches that structured action
after successful dispatch, and replays it against fresh AX. Simulang remains
available, while current Outlook development focuses on CUA.

Remaining directions:

1. **Broaden `observe()`.** It currently returns zero actions for a noop or one
   resolved action; Stagehand can return multiple useful candidates.
2. **Keep autonomous planning optional.** Imperative workflows need no plan
   cache. `cua.execute()` may cache plans only when callers deliberately
   delegate ordering to Pi.
3. **Broaden durable native-GUI identity carefully.** Preserve replay safety
   without leaking dynamic content or relying on ephemeral element handles.
4. **Ground from AX plus screenshots.** Add cycle-safe, window-rooted traversal
   and vision fallback for missing or custom-drawn controls.
5. **Never cache live app content.** Cache how to reach and read email data,
   but read sender, subject, body, and state on every run.

The target top-level workflow should remain small and imperative:

```js
const outlook = await cua.openApp('Outlook', options)
await cua.act('Open the topmost Inbox email', { scope: outlook })

const emails = []
while (emails.length < 3) {
  const email = await cua.extract('Read the open email', {
    scope: outlook,
    schema: emailSchema,
  })
  emails.push(email.data)
  if (emails.length < 3) await cua.pressKey({ scope: outlook, key: 'down' })
}
```

The Outlook meaning belongs in concise instructions, schemas, and workflow
ordering—not in `src/` and not in a family of backend-specific adapters.

The preserved Simulang `extract` path serializes bounded `NodeView` values and
uses explicit projections. The current CUA path instead uses Pi on a recipe
miss to compile a schema-constrained structural extraction recipe, then reads
live values without Pi on a valid hit.

## References

- [Stagehand `act()`](https://docs.stagehand.dev/v3/basics/act)
- [Stagehand `observe()`](https://docs.stagehand.dev/v3/basics/observe)
- [Stagehand caching](https://docs.stagehand.dev/v3/best-practices/caching)
- [Stagehand `ActCache`](https://github.com/browserbase/stagehand/blob/main/packages/core/lib/v3/cache/ActCache.ts)
- [Stagehand `AgentCache`](https://github.com/browserbase/stagehand/blob/main/packages/core/lib/v3/cache/AgentCache.ts)
