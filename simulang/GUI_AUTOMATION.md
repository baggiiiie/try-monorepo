# GUI Automation Authoring

This repo contains early building blocks for Pi-authored GUI automations.

## Vision

A coding agent should be able to:

1. explore a GUI safely with Simulang, cua-driver, and browser/opencli tools;
2. discover stable controls and postcondition verifiers;
3. write a reusable workflow script;
4. run it without stealing focus by default;
5. save structured diagnostics for self-repair;
6. avoid destructive or externally visible actions unless explicitly approved.

## Files

- `.pi/extensions/simulang.ts` — project-local Pi extension registering the single `simulang` GUI automation tool.
- `.pi/extensions/simulang-runtime.mts` — runtime helper used by generated `simulang run` scripts.
- `SIMULANG_PI_EXTENSION.md` — usage notes for the new one-tool Pi integration.
- `.pi/skills/gui-automation/SKILL.md` — Pi skill describing the exploration, verifier, and repair loop.
- `.pi/skills/outlook-email-triage/SKILL.md` — app/task skill where Pi owns Outlook triage reasoning and approval.
- `workflow-utils.mts` — legacy/shared harness helpers from the early demos; useful reference material, not a required long-term API.
- `gui-workflows.json` — small registry of current reusable workflows.
- `teams-calendar.mts` — resilient Teams Calendar navigation workflow.
- `outlook-collect-unread.mts` — observe-only Outlook unread-email extraction helper.
- `outlook-archive-approved.mts` — state-changing helper that archives only explicit approved-actions targets.
- `outlook-unread-experiment.mts` — compatibility entrypoint that runs the collect helper.
- `outlook-new-mail.mts` — Outlook new-mail compose workflow.

## Runtime knobs

- `STEAL_FOCUS=1` permits focus-stealing strategies such as app focus and keyboard shortcuts.
- `DIAG_AX=1` enables heavier accessibility snapshots on failure in the legacy workflows.

## Workflow contract

A production workflow should emit a machine-readable `result.json` under `.runs/<workflow>-<timestamp>/`. On failure, Pi should inspect `result.json`, candidate dumps, verification files, screenshots/window lists, patch the weakest part, and rerun.
