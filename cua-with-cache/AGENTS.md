# Project guidance

- This is a reusable GUI cache library on top of `@simular-ai/simulang-js`.
- Design goal: a Stagehand-style layer for GUIs. `observe` grounds + caches a
  UI concept; `act` replays it deterministically and self-heals on drift.
- Keep `src/` library-only: cache keys, descriptor matching, storage, the
  observe/act replay/heal engine, and the generic `openApp(...)` factory.
- The library must stay app-agnostic. No natural-language task parsing / intent
  routing in `src/` — callers name concrete UI concepts ("Search", "Inbox").
- Do not put Outlook, Teams, or other app/workflow-specific automation under `src/`.
- Put demos, probes, and app-specific GUI automation under `examples/`.
- Demo workflows should stay thin: `openApp(...)`, a few `observe`/`act` calls
  on stable controls, then live reading; print the report.
- Agent-authored top-level workflows should use the small public cached API,
  not import raw simulang primitives. Hide unavoidable app-specific traversal,
  filtering, and parsing in capability modules under `examples/apps/<app>/`
  so runnable workflow files remain declarative. Physical-input fallback,
  polling, stale-node recovery, and tree serialization belong in the generic
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
