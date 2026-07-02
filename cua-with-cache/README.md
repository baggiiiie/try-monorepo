# gui-cache Phase 1 spike

This repo currently contains the `gui-cache` design and a Phase-1 validation
harness for Outlook.

## Run the cache-backed Outlook check

```sh
npm run check:outlook
```

This runs the reusable GUI cache layer against Outlook, verifies the cached
`Search` and `Inbox` descriptors, then selects the top 3 visible inbox rows and
returns reading-pane content. The email-reading step uses row-center mouse
clicks because Outlook exposes row boxes reliably, while row `activate()` can
return `AXError::AttributeUnsupported` on macOS.

The workflow entrypoint intentionally has no command-line options; it runs the
default workflow and prints the JSON report. If you need different behavior,
import `runOutlookCheck(...)` from `src/workflows/outlook-check.mjs` and pass
options in code instead of growing another CLI wrapper.

Note: selecting unread messages in Outlook may cause Outlook itself to mark
them read depending on the user's mail settings. URLs in extracted content are
redacted to `[url]` before they are printed or returned.

## Run the Outlook descriptor spike

```sh
npm run phase1:outlook
```

The harness is intentionally non-destructive: it attaches to an existing Outlook
process, reads accessibility metadata, runs `AccessibilityNode.scoredSearch(...)`
from the app root by default, and writes a sanitized local report under
`phase1-results/`. It does not focus the window by default because Outlook focus
can block in the native API. Window-scoped probing is available with
`--window-scope`, but `Window.allForPid` can hang on some Outlook builds.

Useful options:

```sh
simulang run scripts/phase1-outlook.mjs -- --help
simulang run scripts/phase1-outlook.mjs -- --open
simulang run scripts/phase1-outlook.mjs -- --window-scope
simulang run scripts/phase1-outlook.mjs -- --scan-all-windows
simulang run scripts/phase1-outlook.mjs -- --target "Search" --target "New mail"
simulang run scripts/phase1-outlook.mjs -- --trials 5 --pause-ms 1000
```

Current Outlook finding: app-root AX probing resolves `Search` and `Inbox`
stably in this environment. Generic targets like `New mail`, `Calendar`, and
`Settings` did not resolve via app-root `scoredSearch` even with lower thresholds;
they likely need better target wording, a safe window-scope path, or vision
grounding.

## Optional LLM grounding

Grounding is opt-in because it sends a screenshot to the configured model:

```sh
ANTHROPIC_BASE_URL=... ANTHROPIC_API_KEY=... \
  npm run phase1:outlook:ground
```

When grounding is enabled, the harness uses only `ANTHROPIC_BASE_URL` and
`ANTHROPIC_API_KEY` for the LLM call. `ANTHROPIC_MODEL` is optional and defaults
to `claude-3-5-sonnet-latest`.

Generated reports are ignored by VCS because Outlook windows can contain private
mail metadata even after sanitization.
