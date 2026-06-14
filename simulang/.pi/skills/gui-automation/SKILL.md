---
name: gui-automation
description: Use when asked to explore, automate, or repair a desktop/web GUI workflow with Simulang, cua-driver, opencli, or reusable scripts. Emphasizes safe exploration, postcondition verifiers, diagnostics, and durable workflow generation.
---

# GUI Automation Authoring

You are authoring a reusable GUI automation, not just clicking through once.

Use this skill when the user asks you to accomplish or automate a task in a GUI app. Your job is to safely explore the UI, discover stable interaction strategies, write a script that can run later, verify it, and leave useful artifacts for self-repair.

## Core loop

1. Restate the goal and expected final state.
2. Think about action consequences before every GUI action.
3. Classify the workflow risk.
4. Explore safely with Simulang, cua-driver, opencli, screenshots, AX trees, and logs.
5. Design the verifier before trusting any action.
6. Implement strategy-based automation using the shared workflow harness.
7. Run the script.
8. Inspect `result.json` and artifacts.
9. Patch and rerun until the verifier passes or the failure is an environment/auth/permission issue.
10. Commit the working automation if the repo uses version control.

## Default constraints

- Do not steal focus by default. Use `FocusPolicy.DoNotSteal` and avoid `focus()`, keyboard, and mouse fallbacks unless `STEAL_FOCUS=1` is explicitly needed.
- Prefer AX reads/actions over coordinates.
- Treat `gui.observe({ target })` as app/window state only; do not pass semantic queries to observe.
- Use `gui.find({ target, text: "..." })` for locating semantic UI elements.
- After `openApp()`, prefer targeting by the returned PID (`{ pid: opened.result.instance.pid }`) rather than matching the app name in the window title.
- Use coordinates only as a last resort and always verify afterward.
- Keep exploration artifacts under `.runs/<workflow>-<timestamp>/`.

## Verifier-first design

For each task, define postconditions that prove success. Examples:

- Teams Calendar: Calendar nav item exists; Calendar page/route/content appears; Today/New meeting/Work week signals are visible.
- Outlook unread extraction: unread search/filter applied; candidate email rows found; extracted rows have sender/subject/time-like evidence.
- New email draft: compose editor exists; To/Subject/body controls are visible; Send was not clicked.
- Archive/delete spam: exact target messages are re-identified before action.

Never trust a click by itself. Trust verified UI state.

## Strategy stack

Generated workflows should try strategies in order:

1. `already-done`: run verifier first; no-op if final state already holds.
2. Stable AX interaction: scored search / exact AX descriptions / roles / bounding boxes.
3. App shortcut, only when focus is allowed.
4. Deep link, URL, or opencli/browser path if appropriate.
5. Visual fallback via cua-driver.
6. Coordinate fallback only if there is no better option.

Run the verifier after every strategy.

## Required workflow shape

Use shared helpers from `workflow-utils.mts` when available:

- `createRunDir`
- `createStepRunner`
- `safeNodeInfo`

Every generated workflow should write machine-readable artifacts:

```text
.runs/<workflow-run>/
  result.json
  verification.json or <goal>-verification.json
  candidates.json or <goal>-candidates.json
  windows.json on failure
  screen.png on failure
```

`result.json` must include:

```json
{
  "ok": true,
  "goal": "...",
  "strategy": "...",
  "artifactsDir": ".runs/...",
  "verification": { "ok": true, "signals": {} }
}
```

On failure, include phase, reason, strategies tried, artifacts dir, and suggested next steps.

## Self-repair behavior

If a workflow fails:

1. Read `result.json` first.
2. Inspect verifier/candidate artifacts.
3. Inspect screenshots/window lists/AX snapshots as needed.
4. Classify the failure: locator broke, verifier too strict, app state changed, auth/permission issue, page slow, wrong window, or focus required.
5. Patch only the weakest part.
6. Rerun.

Ask the human only for login/MFA, missing permissions, or ambiguous high-impact decisions.

## References

See `references/workflow-contract.md` for the standard result contract.
