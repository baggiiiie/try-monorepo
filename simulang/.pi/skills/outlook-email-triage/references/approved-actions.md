# Approved Actions Format

Usually you do not need to write this file manually. Prefer:

```bash
EXECUTE=1 STEAL_FOCUS=1 SOURCE_EMAILS_FILE=.runs/outlook-collect-unread-.../emails.json APPROVED_INDEXES=5,6 simulang run outlook-archive-approved.mts
```

The helper reads `emails.json`, extracts the approved indexes, and writes `approved-actions.generated.json` in its run directory.

For custom plans, the archive helper can also read `APPROVED_ACTIONS_FILE` and executes only actions with `action: "archive_email"`.

Required shape:

```json
{
  "approvedBy": "user",
  "approvedAt": "2026-06-11T00:00:00.000Z",
  "sourceEmailsFile": ".runs/outlook-collect-unread-.../emails.json",
  "actions": [
    {
      "action": "archive_email",
      "reason": "Automated notification; no action needed.",
      "target": {
        "index": 2,
        "signature": "lowercased normalized signature from emails.json",
        "raw": "full raw email row from emails.json"
      }
    }
  ]
}
```

Notes:

- Use `signature` from `emails.json` when available.
- Include full `raw` text for diagnostics and repair.
- Only include targets the user explicitly approved.
- Do not include `needs_attention` or `unsure` items.
- The archive helper re-identifies each target in the current Outlook unread message list before archiving.
