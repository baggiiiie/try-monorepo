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

- `.pi/skills/gui-automation/SKILL.md` — Pi skill describing the exploration, safety, verifier, and repair loop.
- `workflow-utils.mts` — shared harness helpers for run dirs, diagnostics, strategies, safety policies, and proposals.
- `gui-workflows.json` — small registry of current reusable workflows.
- `teams-calendar.mts` — resilient Teams Calendar navigation workflow.
- `outlook-unread-experiment.mts` — Outlook unread-email extraction workflow.
- `outlook-new-mail.mts` — Outlook new-mail compose workflow.

## Runtime knobs

- `GUI_AUTOMATION_MODE=explore|dry_run|execute` controls the default safety mode.
- `STEAL_FOCUS=1` permits focus-stealing strategies such as app focus and keyboard shortcuts.
- `DIAG_AX=1` enables heavier accessibility snapshots on failure.
- `ALLOW_STATE_CHANGING=1`, `ALLOW_DESTRUCTIVE=1`, `ALLOW_EXTERNAL_SEND=1`, and `ALLOW_PRODUCTION_CHANGES=1` opt into higher-risk execution categories.

## Safety model

Before each meaningful GUI action, classify its consequence:

- `observe-only`
- `reversible-navigation`
- `state-changing`
- `destructive`
- `externally-visible`
- `production-impacting`

Exploration should prefer observe-only and reversible navigation. Risky actions should produce `proposed-actions.json` in dry-run/proposal mode instead of executing.

## Workflow contract

A production workflow should emit a machine-readable `result.json` under `.runs/<workflow>-<timestamp>/`. On failure, Pi should inspect `result.json`, candidate dumps, verification files, screenshots/window lists, patch the weakest part, and rerun.
