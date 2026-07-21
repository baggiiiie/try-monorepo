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
- Deterministic workflow replay and granular self-healing.

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

### Cached workflows

App-specific logic lives in short agent-authored workflows composed from the
generic API. For Outlook email triage, the workflow defines that it must:

- Open Inbox.
- Identify message rows rather than group headings.
- Open the first three messages.
- Wait for the reading pane to update.
- Read each current sender, subject, and body.
- Apply the requested triage rules.

The successful program, its grounded operations, scopes, waits, and validation
conditions are cached as one replayable workflow. App-specific exceptions stay
in this artifact; they never become APIs such as `readOutlookEmails()` or
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
load cached workflow
  → resolve cached operations
  → replay deterministically
  → read current app data live
  → validate the result
```

If a target descriptor drifts, the library gives its configured grounding
model a fresh JSON-safe UI snapshot, validates the proposed target/action, and
updates only that operation. Workflow runners never launch external coding
agents.

The cache-hit path therefore uses no model inference. App-specific knowledge
still exists, but as a concise cached program rather than a large handwritten
adapter or application logic inside the generic library.
