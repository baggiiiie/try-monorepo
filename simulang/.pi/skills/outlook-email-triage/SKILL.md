---
name: outlook-email-triage
description: Use when the user asks to check unread Outlook emails, decide which need attention, identify emails that can be archived, ask for approval, and archive approved items using Simulang helper scripts.
---

# Outlook Email Triage

You own the reasoning and approval flow. Simulang scripts are helper tools only.

Do **not** call Pi from Simulang scripts. Instead:

1. Run the observe-only collector.
2. Read `emails.json`.
3. Classify emails yourself in this Pi session.
4. Show the user `needs_attention`, `archive_now`, and `unsure`.
5. Ask for explicit approval before archiving.
6. Write an approved-actions file.
7. Run the archive helper.
8. Read `archive-result.json` / `result.json` and report outcome.

## Safety

Before every GUI action, think about its consequences. Collecting unread email is `observe-only`. Archiving is `state-changing`: do not archive until the user explicitly approves exact targets.

Default behavior should not steal focus. The archive helper may need focus for Outlook row selection, so use `STEAL_FOCUS=1` only after the user approves archiving.

## Step 1: collect unread emails

Run:

```bash
LIMIT=10 simulang run outlook-collect-unread.mts
```

For more/fewer messages, adjust `LIMIT`.

Then find the latest run directory from the output and read:

```text
.runs/outlook-collect-unread-*/emails.json
.runs/outlook-collect-unread-*/result.json
```

## Step 2: classify in-session

Classify every email exactly once:

- `archive_now`: routine notifications, automated status, FYI-only, low-value updates likely safe to archive after approval.
- `needs_attention`: direct asks, important human messages, meetings/invites, blockers, incidents, security/customer issues, review requests, or anything the user should read.
- `unsure`: insufficient context or borderline.

Be conservative. If a message may require user action, put it in `needs_attention` or `unsure`, not `archive_now`.

## Step 3: present and ask approval

Show the user a concise list:

```text
Needs attention:
- #... reason

Can archive if approved:
- #... reason

Unsure:
- #... reason

Approve archiving #... ?
```

Do not archive until the user approves specific indexes or says to archive all `archive_now` items.

## Step 4: write approved actions

After approval, write an approved-actions JSON file. Use exact `raw` and `signature` from `emails.json`.

Example:

```json
{
  "approvedBy": "user",
  "approvedAt": "2026-06-11T00:00:00.000Z",
  "sourceEmailsFile": ".runs/outlook-collect-unread-.../emails.json",
  "actions": [
    {
      "action": "archive_email",
      "reason": "Automated GitHub PR merged notification; no action needed.",
      "target": {
        "index": 3,
        "signature": "...",
        "raw": "..."
      }
    }
  ]
}
```

Save it near the collection run, for example:

```text
.runs/outlook-collect-unread-.../approved-actions.json
```

See `references/approved-actions.md` for details.

## Step 5: archive approved targets

Run only after explicit approval:

```bash
EXECUTE=1 STEAL_FOCUS=1 APPROVED_ACTIONS_FILE=.runs/outlook-collect-unread-.../approved-actions.json simulang run outlook-archive-approved.mts
```

Then read the archive helper's latest:

```text
.runs/outlook-archive-approved-*/archive-result.json
.runs/outlook-archive-approved-*/result.json
```

Report archived count, failures, and any items still needing attention.

## Repair loop

If archiving fails:

1. Read `archive-result.json`.
2. Read diagnostics under the failing step directory.
3. Determine whether the target disappeared, row selection failed, archive button lookup failed, or verification was too strict.
4. Patch the helper script or rerun with a smaller approved set.
5. Never broaden approved targets without asking the user.
