# GUI Workflow Contract

## Modes

- `explore`: safe discovery. Observe-only and reversible navigation are allowed. Risky actions are proposals only.
- `dry_run`: compute and verify intended mutations, but do not execute them.
- `execute`: execute allowed actions subject to policy flags and target re-verification.

## Risk levels

Use one of:

- `observe-only`
- `reversible-navigation`
- `state-changing`
- `destructive`
- `externally-visible`
- `production-impacting`

## `result.json`

Success:

```json
{
  "ok": true,
  "app": "Microsoft Teams",
  "goal": "open_calendar",
  "mode": "explore",
  "riskLevel": "reversible-navigation",
  "strategy": "ax-search-click-calendar-nav",
  "phase": "verify",
  "artifactsDir": ".runs/teams-calendar-...",
  "attempts": [],
  "verification": {
    "ok": true,
    "reason": "calendar_nav_plus_page_signals",
    "signals": {}
  }
}
```

Failure:

```json
{
  "ok": false,
  "app": "Microsoft Teams",
  "goal": "open_calendar",
  "mode": "explore",
  "riskLevel": "reversible-navigation",
  "phase": "verify",
  "reason": "calendar_nav_found_but_page_signals_missing",
  "strategiesTried": ["already-on-calendar", "ax-search-click-calendar-nav"],
  "artifactsDir": ".runs/teams-calendar-...",
  "attempts": [],
  "suggestedNextSteps": []
}
```

## `proposed-actions.json`

Risky actions in `explore` or `dry_run` mode should be recorded, not executed:

```json
{
  "proposalId": "2026-06-11T00-00-00-000Z",
  "mode": "dry_run",
  "actions": [
    {
      "action": "delete_email",
      "riskLevel": "destructive",
      "target": {
        "sender": "spam@example.com",
        "subject": "Win a prize",
        "receivedAt": "2026-06-11T09:00:00"
      },
      "evidence": {
        "rowText": "...",
        "bounds": { "left": 100, "top": 200, "right": 800, "bottom": 260 }
      },
      "reason": "Matched low-value spam criteria"
    }
  ]
}
```

Before executing a proposal, the script must re-identify each target and verify identity fields still match.
