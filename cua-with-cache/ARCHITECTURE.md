# Target Architecture

The final product is a Stagehand-style cached automation layer for native GUIs.
Callers write short workflows against a small, app-agnostic API. Cached actions
replay deterministically; a cache miss or stale target invokes a configured
grounding model inside the library and stores the validated replacement.

## Ownership boundaries

### Generic library (`src/`)

The library owns reusable automation mechanics:

- Launching or attaching to an application and selecting a window.
- Grounding one element or a collection of elements.
- Scoped observation and extraction.
- Actions with accessibility and physical-input strategies.
- Generic waits, change detection, retries, and validation.
- Descriptor and operation caching.
- Deterministic operation replay and granular self-healing.

Its public interface remains small:

```js
openApp(...)
gui.observe(...)
gui.observeMany(...)
gui.act(...)
gui.extract(...)
gui.waitFor(...)
gui.waitForChange(...)
```

The library contains no Outlook, Teams, or other application-specific concepts.

### App-specific workflows

App-specific logic lives in short agent-authored workflows composed from the
generic API. For Outlook email triage, the workflow defines that it must:

- Open Inbox.
- Identify message rows rather than group headings.
- Open the first three messages.
- Wait for the reading pane to update.
- Read each current sender, subject, and body.
- Apply the requested triage rules.

The workflow remains ordinary caller code. The current library caches each
grounded UI concept independently; it does not yet serialize or replay a whole
program. App-specific exceptions stay in capability modules under `examples/`;
they never become APIs such as `readOutlookEmails()` or
`waitForOutlookReadingPane()` in `src/`.

```js
await gui.act('Inbox', 'activate')

const messages = await gui.observeMany('first three email messages', {
  within: 'Message list',
})

for (const message of messages) {
  const before = await gui.extract('Reading pane', { project: parseEmail })
  await gui.act(message, 'activate')
  yield await gui.waitForChange('Reading pane', {
    from: before,
    project: parseEmail,
    validate: isValidEmail,
  })
}
```

### Live application data

Dynamic results are always read live. The cache may remember how to locate and
read an email, but it never stores the email's sender, subject, body, unread
state, or current triage result as reusable grounding data.

Extraction is deliberately not semantic inference: the library creates a
bounded JSON-safe `NodeView`, then runs deterministic caller-provided projection
and validation callbacks. Application meaning remains in capability code.

## Runtime behavior

```text
run workflow code
  → resolve each operation from its cached descriptor
  → replay deterministic actions
  → read current app data live
  → validate the result
```

If a target descriptor drifts, the library grounds only that operation again.
Without a grounder it uses backend-local deterministic scoring. With a Pi
grounder it sends bounded structural candidates and sanitized durable tokens,
then validates one structured `select_element` result and updates the cache.
The model selects a target only; the caller's action is immutable. Workflow
runners never launch external coding agents.

Model grounding is fail-closed: unknown candidates, low confidence, generic or
missing replay identity, changed nodes, failed preconditions, and provider
errors do not dispatch an action. Once dispatch may have occurred, neither
backend retries or heals that action.

The cache-hit path therefore uses no model inference. App-specific knowledge
still exists in concise workflow/capability code rather than a large adapter or
application logic inside the generic library.

The model integration uses `@earendil-works/pi-ai` directly for provider/model
configuration and a single structured `select_element` tool call. It does not
use Pi's TUI, coding agent, or an open-ended autonomous tool loop.
