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
- Prefer simulang primitives over reinventing them: `scoredSearch` for
  grounding, node action methods (`activate`/`setValue`/...), `.children()`,
  `App`/`Instance`/`Window` for launch/scope.
- `observe`/`act` reports expose the live grounded node as a non-enumerable
  `.node`; read live app data from it instead of re-searching.
- Returned app data such as email or chat content should be read live by demos/capabilities, not cached by the library.
- Use `jj` for version-control operations in this repository.
