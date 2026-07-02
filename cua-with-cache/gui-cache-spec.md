# Spec: `gui-cache` — Stagehand-style action caching for GUI automation

> **Status:** Validated hypothesis / design draft, pending Phase-1 validation (§11).
> **Target platform:** macOS only (for now).
> **Substrate:** [`@simular-ai/simulang-js`](https://github.com/simular-ai/simulang-js).
> **Deliverable:** a standalone, agent-agnostic npm library — *not* a Pi extension,
> *not* an agent. The GUI equivalent of Stagehand.
> **This document is self-contained.** A reviewing agent should be able to read it
> top to bottom and verify every external claim using §12.

**2026-07 correction after API review:** the core idea is plausible, but the
public `simulang-js` API has important constraints that shape this spec:

- `scoredSearch(...)` returns matching `AccessibilityNode[]`; it does **not**
  expose confidence scores or ranked top-k candidates.
- `role` is a cross-platform `AriaRole` enum / `ariaRoleToString(role)` value,
  not native macOS strings like `"AXButton"`.
- `AccessibilityTree.snapshot()` returns a materialized tree with `refId`s; replay
  should use `Window.scoredSearch(...)` / `AccessibilityNode.scoredSearch(...)`
  and avoid cached `refId`s.
- `act()` needs a structured action spec at first. Natural-language sugar can be
  layered later with an agent callback or `AskModel`, but Simulang does not
  itself infer action kind / variable mapping / verification predicates.
- The stable cache lookup key must not include `pid` or `structuralHash`; those
  belong in soft context checks so UI drift can heal instead of causing a miss.

This document is the source of truth. Any earlier exploratory notes / annotated
HTML files are optional context and are not required to validate or implement the
design.

---

## 1. One-paragraph summary

We are building a library that lets any coding agent complete a macOS GUI task
once (model-in-the-loop), and **cache each semantic action so that re-running the
same script is deterministic, self-healing, and model-free**. It is modeled
directly on [Stagehand](https://github.com/browserbase/stagehand)'s web-automation
cache, adapted to the desktop by building on `simulang-js`, which already ships
the hard parts (a fuzzy accessibility resolver, VLM grounding, and a vision→AX
bridge).

---

## 2. Motivation

GUI automation with an LLM/VLM is slow and expensive: every step may require a
screenshot, an accessibility-tree walk, and one or more model calls to decide
what to click. For **repeatable** flows (e.g. the Okta → AWS → Bedrock key
rotation scripts in this repo), the same UI path is walked over and over, paying
that cost every time.

Stagehand solved the equivalent problem for the web: it caches each `act()` call
as deterministic DOM actions keyed by `instruction + URL + variable-key-names`,
replays them without the LLM, and self-heals stale selectors. We want the same
three wins for macOS GUIs:

- **Speed / cost** — skip screenshots, AX walks, and VLM grounding on known steps.
- **Determinism** — replay a known-good action instead of re-planning.
- **Resilience** — self-heal when the UI drifts, updating the cache in place.

---

## 3. Background: how Stagehand caching works (the model we copy)

Verifiable in `node_modules/@browserbasehq/stagehand` if installed locally, or in
the upstream Stagehand package source.

- **Cache unit:** one `act(instruction)` call.
- **Key:** `sha256({ instruction, normalizedUrl, variableKeys })` → `<hex>.json`.
- **Stored value:** an ordered list of deterministic actions
  `{ selector (XPath), method, arguments, description }`.
- **Lookup / replay:** on `act()`, read `<hash>.json`; if present and valid,
  **replay the actions without calling the LLM** (`ActCache.tryReplay`).
- **Self-heal:** if the stored selector fails, `takeDeterministicAction` (with
  `selfHeal` on by default) re-invokes the LLM to re-resolve the element, retries,
  and **rewrites the cache entry** with the new selector.
- **Secret hygiene:** only variable **key names** are hashed/stored; values never
  touch disk.
- **No separate replay entrypoint.** You just call `act()` again. The *script* of
  `act()` calls is the workflow; the cache is a sidecar. **We copy this exactly
  (see §6.1).**

---

## 4. Core problem: GUIs have no durable handle (this is the whole project)

Stagehand's cache hinges on a **durable, re-resolvable selector (XPath)**. Desktop
accessibility APIs do not give us one:

- Accessibility element handles are **live and ephemeral** — they invalidate on
  the next tree rebuild / app relaunch. (simulang `CLAUDE.md`: *"Accessibility refs
  invalidate on every tree rebuild … re-resolve as needed."*)
- Screen coordinates are fragile across DPI, window size, and layout.

**Therefore the central deliverable is a durable element descriptor — the AX
equivalent of an XPath — plus a resolver that re-finds the element from the
current live window / AX tree.** Everything else (keys, storage, replay) is
comparatively mechanical.

**Why simulang solves this and other tools don't:** the resolver is normally the
hard, hand-rolled part. simulang ships the needed primitives as first-class calls
— thresholded fuzzy accessibility search (`scoredSearch`), VLM grounding
(`ground`), and a vision→AX bridge (`fromPoint`). So our "durable descriptor +
resolver" becomes *"store a query; re-run `scoredSearch`; reject ambiguous or
unsafe results."* `scoredSearch` does not expose scores today, so the cache must
not depend on exact confidence values unless we add our own scorer or upstream
API support. (Previously evaluated alternatives — `injaneity/pi-computer-use`,
`trycua/cua` — expose only ephemeral per-snapshot handles and would require
building the resolver ourselves.)

---

## 5. Decision & scope

- **Build on `simulang-js` (macOS).** It is the only evaluated substrate that
  ships the resolver + grounding + vision→AX bridge as callable primitives.
- **Depend on `@simular-ai/simulang-js`, not `@simular-ai/simulang`.** The latter
  is the CLI/script runner; the former is the Node binding library used here.
- **Accepted trade-offs:**
  - The core engine `simulang-rs` is a **private crate**
    (`Cargo.toml:20` → `ssh://…/simulang-rs-internal`, tag `v0.5.5`). We build on
    the published `simulang-js` API and do not fork/patch it. **Accepted.**
  - **macOS only.** simulang's node-level API also supports Windows/Linux, but we
    neither target nor test them yet.
- **Standalone library, agent-agnostic.** No harness coupling. Any coding agent
  (Pi, Claude Code, Cursor, Codex, custom) calls the ops as tools. Packaging as a
  Pi extension / MCP server is a possible future, explicitly out of scope.

---

## 6. Design principles (non-negotiables)

### 6.1 Transparent per-action caching — no `record`/`replay` (Model A)

Like Stagehand, there is **no separate record/replay execution path**. The agent
writes/drives a script of `act()` calls; caching happens transparently under
each call. **The script is the re-runnable artifact.** Re-running the same script
*is* the replay.

For the first implementable version, `act()` takes a **structured action spec**
(`target`, `action`, optional `valueVar`, `verify`) rather than a raw natural-
language instruction. Natural-language sugar can be layered later by an agent,
planner callback, or `AskModel`, but Simulang itself does not infer action type,
variable binding, or verification predicates from text.

- Each `act()` cache entry stores everything a "workflow step" needs (descriptor +
  verify + soft `contextCheck`), and the script provides the ordering. There is
  no opaque `workflow.json` and no second execution model.
- (A future "run a stored flow by name without its script" helper is a thin
  read-over of the ordered entries, not a new execution model. Out of scope now.)

### 6.2 Resolve-then-verify replay (safer than Stagehand)

Stagehand's replay is blind XPath. Ours re-resolves the descriptor semantically
and **verifies before and after acting**. GUI mis-clicks can be destructive, so
replay must be able to **refuse before acting** rather than proceed on a bad
match. This lets our lookup key be *coarser* than a URL while context checks and
per-step verification catch false hits (§8.4, §8.7).

### 6.3 Coarse context gate + precise per-step check

Split the two jobs Stagehand's URL did: a **coarse lookup context** for scoping /
invalidation, and the **descriptor match + verify predicate** for "am I really on
the right screen". Keep the stable lookup key deliberately coarse. Store volatile
data like `structuralHash` as a soft `contextCheck`, not as part of the lookup
key, so UI drift can heal instead of forcing a cache miss.

### 6.4 Secret hygiene

Hash/store variable **key names** only; never values. Never persist raw
screenshots that may contain secrets. Do not persist raw `value` or unsanitized
`overallDescription`; both can contain typed secrets or generated credentials.
Descriptors store roles, sanitized label/description tokens, ancestry, and
position hints only.

### 6.5 Prefer `scoredSearch` over `find`

Use `Window.scoredSearch` or `AccessibilityNode.scoredSearch` (fuzzy, returns
self-contained handles) as the resolver. Treat its output as **unique acceptable
match / ambiguous match / no match**; the public API does not expose confidence
scores or ranked candidates. Do **not** use `AccessibilityTree.find` /
`findByDescription` for replay: they match by substring/exact and share one
mutable `refs` table — the simulang source carries a "KNOWN FOOTGUN" note that a
later `find` / `snapshot` silently invalidates earlier `refId`s (verify:
`src/ax_tree.rs`, `filter_nodes`).

---

## 7. Public API (rough shape)

```ts
import { Gui } from "gui-cache"

// Open/attach to a target window and start a cached session.
const g = await Gui.open({
  app: "Safari",              // or { pid } / { windowTitle }
  cacheDir: ".gui-cache",     // default; per-act <hash>.json files
  cacheMode: "auto",          // "auto" | "off" | "readonly"
  threshold: 0.6,             // scoredSearch filter threshold
})

// The core op. Transparently cached: HIT → deterministic; MISS → resolve + store.
// Phase-1/2 API is structured because Simulang does not infer action semantics
// from a free-form instruction.
await g.act({
  target: "address bar",
  action: "setValue",
  valueVar: "url",
  variables: { url },          // values not cached
  verify: { post: { valueContainsVar: "url" } },
})
await g.act({
  target: "Generate short-term API keys",
  action: "activate",
  verify: {
    pre: { role: "button", enabled: true },
    post: { textPresent: "bedrock-api-key-" },
  },
})

// Read-only resolution (for agent planning); also caches the descriptor.
const el = await g.observe({ target: "generated key text field" })

// Deterministic read of on-screen text (not cached).
const text = await g.readText(el)
```

**`act()` result** (also drives observability):

```ts
interface ActSpec {
  target: string
  windowSelector?: string | { title?: string; pid?: number }
  action:
    | "activate"
    | "setValue"
    | "toggle"
    | "select"
    | "expandCollapse"
    | "focus"
    | "scrollIntoView"
  valueVar?: string             // name only; value comes from variables at runtime
  variables?: Record<string, unknown>
  verify?: VerifySpec
}

interface ActResult {
  success: boolean
  cacheStatus: "HIT" | "MISS" | "HEALED" | "REFUSED"
  descriptor: Descriptor        // the resolved/updated descriptor
  match: {
    status: "unique" | "ambiguous" | "none"
    candidateCount: number       // no exposed scoredSearch confidence in public API
    threshold: number
  }
  message: string
}
```

There is intentionally **no** `record()`, `end()`, or `replay()` (see §6.1).

---

## 8. Data model & algorithms

### 8.1 The cache unit and key

- **Unit:** one structured `act(spec)` call → one `<key>.json`.
- **Lookup key:** `sha256({ target, action, stableAppId, routeKey, variableKeys })`.
  - `target`: normalized concept text, e.g. `"generate short-term api keys"`.
  - `action`: deterministic action type, e.g. `"activate"`, `"setValue"`.
  - `stableAppId`: app canonical name / launch target / bundle-ish identifier;
    **not** the live `pid`.
  - `routeKey`: coarse route/window identity (§8.4).
  - `variableKeys`: sorted names only; values never enter the key or cache entry.

Volatile context (`pid`, structural hash, window title, app version) is stored in
the entry as `contextCheck`, not folded into the lookup key.

### 8.2 Durable descriptor (the XPath analog)

Synthesized from the resolved AX node at MISS time; rewritten on HEALED.

```jsonc
{
  "role": "button",                         // ariaRoleToString(node.role)
  "query": "generate short-term api keys",  // target concept for scoredSearch
  "nameTokens": ["generate", "short", "term", "api", "keys"],
  "descriptionTokens": ["generate", "short", "term", "api", "keys"],
  "ancestorRoles": ["window", "toolbar"],   // ariaRoleToString over ancestors
  "className": "",                          // optional platform hint
  "localizedControlType": "button",         // optional platform hint
  "supportedActions": ["activate"],
  "posHint": { "xRatio": 0.73, "yRatio": 0.18 } // window-relative tiebreaker
}
// NOTE: no raw value or unsanitized overallDescription; both can contain secrets.
// automationId is Windows-only and empty on macOS, so it is not canonical.
```

### 8.3 Resolver (`resolve(descriptor) → Match`)

On the current target `Window`:

1. Run `window.scoredSearch(DepthFirst, maxNodes, collapseStructural=true,
   descriptor.query, threshold)`.
2. Filter returned nodes by canonical role, supported action, enabled state,
   bounding box inside the target window, and optional ancestry/path hints.
3. If one candidate remains, return `{ status: "unique", node }`.
4. If multiple plausible candidates remain, use deterministic tiebreakers only:
   stronger token overlap with sanitized name/description tokens, ancestor-role
   match, then nearest normalized `posHint`. If still tied, return
   `{ status: "ambiguous" }` and refuse/fall back rather than guessing.
5. If no candidate remains, return `{ status: "none" }` and escalate to grounding
   or REFUSED.

Important: public `scoredSearch` does not expose scores. If we need true
confidence or ranked second-best candidates, either implement a JS-side scorer
over snapshots / `overallDescription` (sanitized before storage) or request an
upstream `scoredSearchWithScores` API.

### 8.4 Lookup context and soft context checks (replacing the missing URL)

Split stable lookup identity from volatile safety checks:

- **stableAppId** — app canonical name / launch path / bundle-ish identifier. Use
  live `pid` only to attach to a running app; do **not** include it in the cache
  key because it changes on relaunch.
- **routeKey** — coarse and normalized:
  - *browser windows:* recover the real URL from the address-bar text field /
    textbox value when reliable (or CDP if available), normalized like Stagehand
    (`searchParams.sort()`). If URL recovery is unreliable, fall back to a weaker
    normalized window route plus stronger `verify.pre` checks.
  - *native apps:* `normalizeTitle(windowTitle)` + salient markers (selected tab,
    highlighted sidebar item, sheet/dialog present, window subrole).

Store, but do not key on:

- **structuralHash** — coarse AX skeleton: roles + hierarchy for the top N levels,
  **text/values/counts stripped**. Source: reduced `AccessibilityTree.snapshot()`
  / `Window.snapshot()` or a role-only walk.
- **normalizedTitle**, **windowSelector**, **appVersion**, **lastSeenPid** — soft
  checks and diagnostics.

Tension: too specific (raw titles/text) → dynamic content busts it; too coarse →
false hits. Mitigate with aggressive title normalization + text-agnostic
structural hash as a soft gate, and rely on pre/post `verify` predicates to catch
residual false hits.

### 8.5 One `act(spec)` — control flow

```
act(spec):
  window = resolveTargetWindow(spec.windowSelector)
  stableAppId = computeStableAppId(window)
  routeKey = computeRouteKey(window)
  key = sha256(spec.target, spec.action, stableAppId, routeKey, variableKeys(spec))
  entry = cache.read(key)

  if entry:                                  # candidate HIT
    if !contextCheck(entry.contextCheck, window):
      # Soft drift: do not miss the cache; require stronger checks / healing.
      markDrifted()

    match = resolve(entry.descriptor, window)
    if match.status == "unique" and verify(entry.verify?.pre, window, match.node):
      perform(entry.action, match.node, spec.variables)
      if verify(entry.verify?.post, window, match.node): return HIT
      return REFUSED                          # post failed; surface to agent

    if match.status in ["none", "ambiguous"]:
      node2 = groundAndBridge(spec.target, window, spec.action) # §8.6
      if node2 && verify(entry.verify?.pre, window, node2):
        perform(entry.action, node2, spec.variables)
        if verify(entry.verify?.post, window, node2):
          rewrite(entry, synthesize(node2)); return HEALED
      return REFUSED

  # MISS: no entry. Try AX-only first; ground only when AX cannot resolve safely.
  match = resolve(descriptorFromSpec(spec), window)
  node = match.status == "unique" ? match.node : null
  if !node:
    node = groundAndBridge(spec.target, window, spec.action) # VLM ground → fromPoint
  if !node || !verify(spec.verify?.pre, window, node): return REFUSED
  perform(spec.action, node, spec.variables)
  if !verify(spec.verify?.post, window, node): return REFUSED
  descriptor = synthesize(node)
  cache.write(key, {
    specMinusValues, contextCheck, descriptor,
    action: spec.action, verify: spec.verify,
  })
  return MISS
```

`specMinusValues` means the structured action spec with runtime variable values
removed; keep variable names only.

- **HIT** — resolved from cache, no model call.
- **HEALED** — resolved but drifted; re-resolved and cache rewritten.
- **MISS** — resolved AX-only or grounded via VLM, then stored.
- **REFUSED** — could not resolve/verify a (possibly destructive) step; do not act,
  return control to the driving agent. This is the safety net Stagehand lacks.

### 8.6 `groundAndBridge(concept, window, desiredAction) → node | null`

```
[x, y] = window.ground(GroundingModel.default(), concept) # VLM; needs configured provider
if !sameWindowOrPid(Window.fromPoint(x, y), window): return null # wrong window/monitor
node = AccessibilityNode.fromPoint(x, y)                  # vision → AX node
return normalizeActionable(node, desiredAction)           # climb to actionable ancestor
```

Prefer `Window.ground(...)` / `window.screenshot(true).ground(...)` over full
main-screen screenshots to avoid grounding onto duplicate UI elsewhere. Cache the
**descriptor derived from the actionable node**, never raw `[x, y]`. Store any
position hint as normalized window-relative coordinates. `sameWindowOrPid` should
prefer exact window identity when available, then fall back to pid + bounds/title
checks on macOS where window handles can be coarse.

### 8.7 Verify predicate

Stored per step; cheap pre/post conditions on the live AX tree, e.g.
`{ role: "button", enabled: true }`, `{ textPresent: "bedrock-api-key-" }`, or
`{ windowTitleContains: "..." }`.

```ts
interface VerifySpec {
  pre?: VerifyPredicate    // must pass before action; required for destructive ops
  post?: VerifyPredicate   // confirms the action succeeded
  risk?: "safe" | "destructive"
}
```

For destructive actions, missing `pre` or `post` should return `REFUSED`. Failure
before acting refuses safely; failure after acting surfaces to the agent and may
trigger healing only when the operation is known safe to retry.

### 8.8 Storage layout

```
<cacheDir>/
  <key>.json          # one per act(): { version, target, action,
                      #   stableAppId, routeKey, variableKeys, contextCheck,
                      #   descriptor, verify }
```

Mirror Stagehand's `CacheStorage`: atomic writes, JSON, in-memory fallback when no
dir. No TTL initially; stamp entries with a `descriptorVersion` + app version for
cheap future invalidation.

---

## 9. simulang-js primitive reference (verify these)

All paths are in the `simular-ai/simulang-js` repo. Line numbers may drift on
`main`; grep the **symbol** if so.

| Our use | simulang-js API | Verify at |
| --- | --- | --- |
| Read window AX tree | `AccessibilityTree.snapshot(visibleOnly?)` → tree of `AccessibilityNodeJs` (with `refId`) | `src/ax_tree.rs` (`snapshot`) |
| Bind a window | `AccessibilityTree.fromForeground()` / `fromPid(pid)` / `fromWindow(w)`; `Window.allForPid(pid)` / `Window.fromPoint(x,y)` | `src/ax_tree.rs`, `src/window.rs` |
| **Fuzzy resolver** | `Window.scoredSearch(...)` / `AccessibilityNode.scoredSearch(...)` → `AccessibilityNode[]`; internal scorer is `BowJaccard::score(node.summary_with_context(), query).primary`, but scores are **not exposed** | `index.d.ts` (`scoredSearch`), `src/accessibility_node.rs:328`, `src/window.rs` |
| **VLM grounding** | `GroundingModel.default()/byAlias/uiTars7B/uiVenus30B`; `.ground(screenshot\|image, concept) → [x,y]`; `Window.ground(model, concept)` | `src/language_model/vlm.rs:99`, `src/window.rs` |
| **Vision → AX bridge** | `AccessibilityNode.fromPoint(x, y) → node \| null` (macOS `AXUIElementCopyElementAtPosition`) | `src/accessibility_node.rs:57` |
| Descriptor fields | node getters: `role` (`AriaRole` enum), `name`, `overallDescription` (= `summary_with_context()`), `value`, `boundingBox()`, `ancestors()`, `parent()`, `supportedActions()`; sanitize before persistence | `src/accessibility_node.rs`, `index.d.ts` |
| Perform action on a node | `node.activate()` / `setValue(v)` / `toggle()` / `select()` / `expandCollapse()` / `scrollIntoView()` / `focus()` | `src/accessibility_node.rs:~354` |
| Screenshot | `Window.screenshot(hideCursor)` preferred; `screenshotFull(hideCursor, screen)`; `Screenshot.ground(model, concept)` | `index.d.ts` (`Window`, `screenshotFull`, `Screen`, `Screenshot`) |
| Coordinate/key fallback | `MouseController`, `KeyboardController` | `src/mouse.rs`, `src/keyboard.rs` |
| App / window identity | `App` (`canonicalName`, launch target); `Window` (`title`, `pid`, `boundingBox`) | `src/app.rs`, `src/window.rs` |
| Roles | `AriaRole` enum + `ariaRoleToString(role)` | `index.d.ts` (`AriaRole`) |

**Behavioral facts to confirm:**
- `refId`s are per-traversal and invalidate when `snapshot()` / `find()` rebuilds
  the shared refs table → never persist a `refId`; replay should re-run
  `Window.scoredSearch` / `AccessibilityNode.scoredSearch` and action the returned
  self-contained node.
- `AccessibilityTree.find`/`findByDescription` share a mutable `refs` table
  ("KNOWN FOOTGUN") → we use `scoredSearch` instead. (`src/ax_tree.rs`.)
- macOS `fromForeground`/`fromPid` scope to the whole application (all windows +
  menu bar); `fromWindow` and `Window.scoredSearch` scope to one window. Relevant
  to route/context checks and duplicate controls.
- `scoredSearch` returns max-scoring matches over threshold but not the score; a
  cache must detect ambiguous matches rather than assume a confidence number.
- Grounding requires a configured VLM provider (bundled OpenRouter defaults use
  `OPENROUTER_API_KEY`); the library must degrade to AX-only resolution
  (`scoredSearch`, no `ground`) when unavailable.
- `AccessibilityNode.fromPoint` may return a child/static text node; normalize to
  an actionable ancestor before acting or caching.
- `simulang-rs` core is private (`Cargo.toml:20`); only `simulang-js` is public.

---

## 10. Rough shape of the final product

### 10.1 Module layout

```
gui-cache/
  src/
    index.ts        # public API: Gui.open, act, observe, readText
    gui.ts          # thin simulang-js seam: snapshot/resolve/ground/perform
    descriptor.ts   # synthesize + resolve durable descriptors (scoredSearch)
    context.ts      # stable lookup context + soft contextCheck fields
    verify.ts       # verify predicates
    storage.ts      # <key>.json read/write (Stagehand CacheStorage analog)
    key.ts          # sha256 cache-key construction; variable-key hashing
    types.ts        # Descriptor, ActResult, CacheEntry, config
  package.json      # deps: @simular-ai/simulang-js
```

Only a **thin seam** wraps simulang (`gui.ts`) — enough to swap later, not a full
multi-backend abstraction.

### 10.2 End-to-end example

**First run (explore, model-in-the-loop):**

```ts
const g = await Gui.open({ app: "Safari" })
await g.act({
  target: "address bar",
  action: "setValue",
  valueVar: "url",
  variables: { url },
  verify: { post: { valueContainsVar: "url" } },
})                                                       // MISS → ground/search → store
await g.act({
  target: "Generate short-term API keys",
  action: "activate",
  verify: {
    pre: { role: "button", enabled: true },
    post: { textPresent: "bedrock-api-key-" },
  },
})                                                       // MISS → ground/search → store
// two <key>.json files now exist under .gui-cache/
```

**Later runs (same script, deterministic):**

```ts
// identical script; each act() is now HIT (or HEALED on drift, REFUSED if broken)
```

### 10.3 Sample cache entry (`.gui-cache/<hash>.json`)

```jsonc
{
  "version": 1,
  "target": "Generate short-term API keys",
  "action": { "type": "activate" },
  "stableAppId": "Safari",
  "routeKey": "https://console.aws.amazon.com/...",
  "variableKeys": [],
  "contextCheck": {
    "structuralHash": "a1b2c3…",
    "normalizedTitle": "aws console",
    "lastSeenPid": 12345
  },
  "descriptor": {
    "role": "button",
    "query": "generate short-term api keys",
    "nameTokens": ["generate", "short", "term", "api", "keys"],
    "descriptionTokens": ["generate", "short", "term", "api", "keys"],
    "ancestorRoles": ["window", "toolbar"],
    "supportedActions": ["activate"],
    "posHint": { "xRatio": 0.73, "yRatio": 0.18 }
  },
  "verify": {
    "pre": { "role": "button", "enabled": true },
    "post": { "textPresent": "bedrock-api-key-" }
  }
}
```

---

## 11. Phased plan (with the make-or-break gate)

1. **Phase 1 — descriptor/context stability spike (make-or-break).** No caching
   and no destructive actions. On a few real target windows (a browser page, the
   AWS/Bedrock console, one native app), acquire descriptors via
   `Window.scoredSearch` and, when needed, `Window.ground` → `fromPoint` →
   actionable ancestor. Re-resolve after fresh AX walks, window move/resize,
   refresh, and app relaunch. Measure: hit rate, ambiguous-match rate,
   wrong-target accepts, candidate count, threshold robustness (probing thresholds
   if useful), and lookup-key stability. *Decision gate:* zero wrong-target
   accepts, ambiguous matches refused, acceptable re-resolution rate on target
   flows, and stable lookup keys across normal reruns.
2. **Phase 2 — structured single-action cache.** Implement `act(spec)` with
   HIT/MISS/HEALED, descriptor synth + resolve, storage, `cacheStatus`, and no
   natural-language action planner.
3. **Phase 3 — verify + REFUSED.** Pre/post verify predicates, refuse-before-act
   for risky operations, soft `contextCheck`, and secret-safe descriptor storage.
4. **Phase 4 — hardening.** Threshold tuning, optional JS-side scoring or upstream
   score API, descriptor/app-version stamping and invalidation, `readonly` cache
   mode, observability/logging, and optional natural-language sugar.

---

## 12. How to verify this document

A reviewing agent should independently confirm the load-bearing claims:

1. **simulang API exists as described.**
   ```
   git clone https://github.com/simular-ai/simulang-js /tmp/simulang-js
   grep -n "fn scored_search\|BowJaccard\|from_point\|fn ground" \
     /tmp/simulang-js/src/accessibility_node.rs /tmp/simulang-js/src/language_model/vlm.rs
   grep -n "simulang-rs" /tmp/simulang-js/Cargo.toml     # confirms private core dep
   less /tmp/simulang-js/index.d.ts                       # full typed surface
   less /tmp/simulang-js/CLAUDE.md                        # lifecycle caveats (refId churn)
   ```
   Confirm: `scoredSearch` (fuzzy, threshold, returns `AccessibilityNode[]` but no
   scores), `Window.ground` / `GroundingModel.ground` (VLM), `fromPoint`
   (vision→AX), node getters/actions, `AriaRole` / `ariaRoleToString`, the `find`
   shared-`refs` footgun, and the macOS scoping notes.

2. **Stagehand model matches §3.** Inspect an installed package copy, e.g.
   `node_modules/@browserbasehq/stagehand/dist/esm/lib/v3/cache/ActCache.js` and
   `.../handlers/actHandler.js` (`takeDeterministicAction`, `selfHeal`), or the
   equivalent upstream Stagehand source.

3. **The "no durable handle" premise (§4)** should be verified for alternatives
   too if they are reconsidered (e.g. `trycua/cua` element tokens,
   `pi-computer-use` AX target reacquisition). Do not assume they provide a
   durable XPath-equivalent without source/API evidence.

4. **Sanity-check the plan:** the design's viability rests entirely on §11
   Phase 1. If that gate fails, the rest does not matter.

5. **Package split:** `simular-ai/simulang` is the CLI runner package
   (`@simular-ai/simulang`); `simular-ai/simulang-js` is the Node binding package
   (`@simular-ai/simulang-js`) this library depends on.

---

## 13. Risks, gotchas, non-goals

**Risks / gotchas**
- **Descriptor stability is the whole bet** (§11 Phase 1). Poor-AX apps
  (Electron/canvas, no labels) resolve badly and degrade toward vision, which
  caches worse.
- **No exposed `scoredSearch` confidence** — replay must detect unique/ambiguous/no
  match, or add its own scorer / upstream score API.
- **Action inference is not provided by Simulang** — initial `act()` is structured;
  free-form natural-language sugar is future work.
- **Blind replay is dangerous on desktop** — hence mandatory pre/post verify +
  REFUSED before acting when checks are weak or destructive.
- **Dynamic screen content** (badges, timestamps, notifications) can bust the
  context checks — keep lookup keys coarse, keep structural hashes soft, normalize
  titles, and rely on per-step verification.
- **Grounding cost/latency** — VLM calls only on MISS/HEAL; needs a configured
  provider (bundled OpenRouter defaults use `OPENROUTER_API_KEY`).
- **Secret leakage through AX text** — raw `value` / `overallDescription` can
  contain typed secrets or generated keys; sanitize or omit before persistence.
- **No TTL yet** — stamp versions for future invalidation.

**Non-goals (for now)**
- Non-macOS platforms.
- Forking/patching `simulang-rs` (closed core accepted).
- A separate `record`/`replay` execution model or opaque workflow blobs (§6.1).
- Free-form natural-language action planning in Phase 1/2; use structured
  `act(spec)` first.
- Packaging as a Pi/MCP plugin.
- Cross-machine cache sharing; caching read-only extracts.

---

## 14. Open questions

- Best `scoredSearch` threshold default; per-app overrides? Do we need JS-side
  scoring or an upstream scored-search API?
- On MISS with no configured VLM provider, fail hard or return control to the
  agent?
- How to represent multi-window / window-switch steps (lookup key + contextCheck
  may span windows).
- Structural-hash depth `N` and title-normalization rules — tune empirically in
  Phase 1.
- Exact sanitizer for descriptor tokens so labels remain useful without storing
  secrets.
