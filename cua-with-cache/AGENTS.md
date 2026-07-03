# Project guidance

- This is a reusable GUI cache library on top of `@simular-ai/simulang-js`.
- Keep `src/` library-only: cache keys, descriptor matching, storage, replay/heal logic, and generic cached-simulang APIs.
- Do not put Outlook, Teams, or other app/workflow-specific automation under `src/`.
- Put demos, probes, and app-specific GUI automation under `examples/`.
- Demo workflows should stay thin: configure/find an app, call `gui.act(...)`, print the report.
- Returned app data such as email or chat content should be read live by demos/capabilities, not cached by the library.
- Use `jj` for version-control operations in this repository.
