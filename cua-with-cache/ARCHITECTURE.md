# Target Architecture

The product is a Stagehand-style compiler and cache for native GUI actions.
Callers provide concise semantic actions and live extraction schemas. On a
miss, Pi resolves an action against the current GUI; the library validates and
condenses that result into structured replay data. On a hit, the action replays
without a model turn.

Current development focuses on CUA Driver. Simulang remains in the repository,
but the Outlook workflow should not be duplicated across backend-specific
capability files.

## Compilation boundary

The model does not generate source code. It selects one offered target and a
supported method. The library owns conversion into a durable action:

```js
{
  instruction: 'open the first unread email',
  target: {
    role: 'AXCell',
    labelTokens: ['unread'],
    ancestorRoles: ['AXTable'],
    relativeFrame: { x: 0.18, y: 0.24, w: 0.16, h: 0.05 },
  },
  method: 'click',
  arguments: [],
  addressing: 'pixel',
  deliveryMode: 'foreground',
}
```

This is equivalent to Stagehand's replayable
`Action { selector, description, method, arguments }`: structured intermediate
data interpreted by a generic dispatcher, not generated JavaScript.

## Ownership boundaries

### Generic library (`src/`)

The library owns reusable automation mechanics:

- Launching or attaching to an application and selecting a window.
- Grounding one element or a collection of elements.
- Scoped observation and extraction.
- Actions with accessibility and physical-input strategies.
- Generic waits, change detection, retries, and validation.
- Compiling model-grounded choices into validated actions.
- Action and workflow-step caching.
- Deterministic replay and granular self-healing.

Its target public interface remains small:

```js
openApp(...)
gui.act('semantic instruction')
gui.extract('semantic instruction', schema)
gui.run('workflow key', input)
```

The library contains no Outlook, Teams, or other application-specific concepts.

### App-specific workflows

Application or site semantics still exist, just as they do in Stagehand.
Prefer short instructions, schemas, and validation over traversal helpers. For
Outlook email triage, the workflow defines that it must:

- Open Inbox.
- Identify message rows rather than group headings.
- Open the first three messages.
- Wait for the reading pane to update.
- Read each current sender, subject, and body.
- Apply the requested triage rules.

These semantics belong in one concise workflow definition. CUA traversal,
physical input, coordinate conversion, waiting, and stale-target repair belong
in the generic library, not Outlook-specific helpers.

```js
const result = await gui.run('triage-inbox', { count: 3 })
```

### Live application data

Dynamic results are always read live. The cache may remember how to locate and
read an email, but it never stores the email's sender, subject, body, unread
state, or current triage result as reusable grounding data.

The current implementation extracts through deterministic `NodeView`
projections. The target API adds schema-constrained semantic extraction while
still reading current application data on every run.

## Runtime behavior

```text
semantic action
  → look up compiled action
  → HIT: resolve durable target and dispatch without Pi
  → MISS/STALE: snapshot current GUI, ask Pi to select a bounded target/method
  → validate and compile the action
  → dispatch once, verify, and cache only after a safe outcome
```

The CUA grounding snapshot should combine AX structure with a screenshot. AX is
preferred for durable identity and action dispatch; screenshot grounding is
needed when an app exposes actionless controls or a malformed/incomplete AX
tree. Pi may choose only offered candidates and supported methods. Workflow
runners never launch external coding agents.

Model grounding is fail-closed: unknown candidates, low confidence, generic or
missing replay identity, changed nodes, failed preconditions, and provider
errors do not dispatch an action. Once dispatch may have occurred, neither
backend retries or heals that action.

The cache-hit path uses no model inference. Application knowledge remains in
concise instructions, extraction schemas, and workflow ordering rather than a
large adapter or application logic inside `src/`.

Pi's local model/auth/settings configuration supplies inference. It does not
use Pi's TUI or launch a coding agent.

## Current implementation gap

Today the library caches individual element descriptors and Pi selects only
from structural AX candidates. It does not yet compile complete CUA actions,
use screenshot grounding, expose schema-based semantic extraction, or cache and
replay a workflow-step sequence. The existing Outlook capability is therefore
a prototype, not evidence that the target architecture is complete.
