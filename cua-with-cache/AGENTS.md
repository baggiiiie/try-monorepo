# Project guidance

- This is a reusable GUI workflow-cache library with both Simulang and CUA
  Driver backends. Keep both backends unless the user explicitly decides
  otherwise.
- Focus current product development and the first complete Outlook workflow on
  CUA Driver. Preserve Simulang, but do not duplicate new app workflows for it
  while the shared compiled-action API is being established.
- Product goal: an agent authors a small, declarative cached GUI workflow. On a
  cache hit, the library replays the cached workflow deterministically without
  a model turn. On a cache miss or stale step, the library invokes Pi internally
  to resolve that step from the current GUI, validates it, and updates the
  workflow cache before continuing.
- Cache reusable workflow operations and durable grounding, never returned app
  content, screenshots, live nodes, process/window IDs, or ephemeral backend
  handles.
- Follow Stagehand's compilation boundary: Pi selects a bounded current-UI
  target and supported method; the library converts that choice into a
  structured replayable action. Cache this action data, not generated source
  code and not an unconstrained model-authored tool call.
- Here, self-healing means the cache layer internally uses Pi to re-ground a
  missing or stale workflow operation and updates its cache, never that a
  workflow runner launches an external coding agent or edits its own source.
- Keep `src/` library-only: cache keys, descriptor matching, storage, the
  observe/act replay/heal engine, and the generic `openApp(...)` factory.
- The library must stay app-agnostic. No natural-language task parsing / intent
  routing in `src/` — callers name concrete UI concepts ("Search", "Inbox").
- Do not put Outlook, Teams, or other app/workflow-specific automation under `src/`.
- Put demos, probes, and app-specific GUI automation under `examples/`.
- Demo workflows should stay thin: open the app, declare or invoke one cached
  workflow, and print its live result. The current CUA-focused implementation
  may leave Simulang unsupported by that workflow temporarily, but must not add
  a second copy of its app semantics.
- Agent-authored top-level workflows should use the small public cached API,
  not import raw simulang primitives. Hide unavoidable app-specific traversal,
  filtering, and parsing in capability modules under `examples/apps/<app>/`
  so runnable workflow files remain declarative. Minimize these modules: prefer
  concise semantic instructions and extraction schemas over helper-heavy app
  adapters. Physical-input fallback, coordinate conversion, polling, stale-node
  recovery, workflow replay, and tree serialization belong in the generic
  library.
- Prefer simulang primitives over reinventing them: `scoredSearch` for
  grounding, node action methods (`activate`/`setValue`/...), `.children()`,
  `App`/`Instance`/`Window` for launch/scope.
- Treat the non-enumerable `.node` on reports as a compatibility escape hatch.
  Agent-authored workflows should pass reports back to `act`/`extract`/wait
  APIs so the library can re-resolve stale nodes, and should interpret only
  JSON-safe `NodeView` values rather than raw simulang nodes.
- Returned app data such as email or chat content should be read live by demos/capabilities, not cached by the library.
- Use `jj` for version-control operations in this repository.
