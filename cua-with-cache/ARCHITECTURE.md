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

## What the cache contains

The Stagehand mental model mostly applies here. On a miss, Stagehand asks a
model to resolve an instruction against the current DOM and stores a structured
browser action containing a selector, method, and arguments. It does **not**
cache literal model-generated source code. On a hit, it resolves that selector
to a current DOM node and executes the method without another model turn.

Native GUI automation has no CSS or XPath. Its closest equivalent is a durable
accessibility descriptor:

```js
{
  method: 'click',
  target: {
    kind: 'element',
    descriptor: {
      role: 'AXCell',
      scope: { role: 'AXTable', labelTokens: ['message', 'list'] },
      scopeOrdinal: 2,
    },
  },
  addressing: 'pixel',
  deliveryMode: 'foreground',
}
```

CUA element indices and tokens identify only one snapshot, so they are never
cached. The descriptor instead combines stable evidence such as the app and
window, containing element, accessibility role, structural position, and label,
identifier, or help tokens. On replay, the library takes a fresh AX snapshot,
resolves the descriptor to a current element and frame, and dispatches the
stored operation. If resolution or validation fails, Pi can re-ground the step
and replace the stale descriptor.

The CUA implementation has three cache levels under
`.gui-cache/<bundle-id>/`:

1. **Workflow cache:** semantic `act` and `extract` steps, so Pi does not have
   to plan the same workflow again.
2. **Action cache:** a supported operation plus its durable target descriptor,
   so a hit can execute without Pi.
3. **Extraction cache:** a root descriptor and validated structural paths to
   fields. A hit follows those paths and reads the current values without Pi.

For example, an Outlook extraction recipe can remember that `sender` is the
value of an `AXButton` at a validated path and `body` is the subtree text of an
`AXWebArea`. It never stores the sender, subject, body, screenshot, live AX
node, token, or process/window ID. Returned application content is always read
live.

| Concern | Stagehand | Native CUA cache |
| --- | --- | --- |
| Miss resolution | Model examines the DOM | Pi examines AX data and a screenshot |
| Cached action | Selector + method + arguments | Descriptor + method + addressing mode |
| Replay target | Current DOM node | Current AX element/frame |
| Stale cache | Re-resolve the locator | Re-ground the descriptor or extraction recipe |
| Extraction | Usually model-backed per call | Cached structural recipe, live values |
| Returned content cached | No | No |
| Workflow plan cached here | No | Yes |

This native representation is less readable and can be more brittle than a
good CSS or ARIA selector: values such as `scopeOrdinal: 2` and paths such as
`[36]` depend on current UI structure. Strict replay validation and granular
self-healing contain that brittleness; they do not eliminate it.

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
const cua = new CachedCua({ piDir: '~/.pi', model: 'provider/model' })
const app = await cua.openApp('Outlook', { bundleId: 'com.microsoft.Outlook' })
await app.act('semantic instruction')
await app.extract('semantic instruction', schema)
await app.agent().execute({ instruction, schema })
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

The current Outlook runner expresses this as one instruction plus an exact
three-item schema passed to `app.agent().execute(...)`.

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

## Current implementation

`CachedCua` now implements this boundary for CUA: lazy local-Pi initialization,
semantic workflow planning, AX-plus-screenshot action grounding, compiled
action replay, schema-based live extraction recipes, stale-step healing, and
workflow cache reporting. Visual points without durable AX identity are
single-run fallbacks and are deliberately not cached.

The remaining live limitation is below this layer: Outlook/CUA can
intermittently return a recursive menu-only accessibility tree with no Message
List or Reading Pane. The cache cannot compile a durable action or extraction
recipe from absent structure, so it fails visibly. A healthy snapshot is still
required to establish durable replay artifacts.
