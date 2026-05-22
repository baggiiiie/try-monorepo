# PWA Validation Runbook

Use this after the Cloudflare Tunnel hostname and the Apple Pay Shortcut exist.

## Prerequisites

- `make web` has produced `server/web/dist`.
- The server is running behind Cloudflare Tunnel at `https://<host>`.
- The sync secret is available from `expense secret show`.
- The iOS app has the same server URL and sync secret configured.
- The Apple Pay Shortcut posts to `https://<host>/api/wallet-suggestions`.

## Local Baseline

Run:

```sh
make test
```

This includes `tests/e2e/10_web_pwa_smoke.sh`, which checks the embedded PWA
shell, install metadata, cache headers, auth cookie exchange, and wallet
suggestion REST path.

## Production Checks

1. Open `https://<host>/manifest.webmanifest` and confirm:
   - `display` is `standalone`
   - `start_url` is `/`
   - 192 and 512 icons are present
2. Run Lighthouse against `https://<host>/` and confirm the PWA installability
   audit passes.
3. In iOS Safari, open `https://<host>/`, paste the sync secret in Settings,
   then use Share -> Add to Home Screen.
4. Launch from the home-screen icon and confirm it opens standalone without
   Safari chrome.
5. With the app online, fetch the expense feed, categories, recurring
   expenses, settings, and wallet suggestions at least once.
6. Enable airplane mode, cold launch from the home-screen icon, and confirm the
   shell and last-fetched views render from cache.
7. While offline, create an expense. Confirm the write queues locally, then
   disable airplane mode and confirm it syncs and survives reload.
8. Rotate the sync secret on the server, make a PWA API request, and confirm
   the app returns to Settings for re-auth. Paste the new secret and confirm
   API access resumes.
9. Trigger the Apple Pay automation. Confirm:
   - the Shortcut receives a 2xx response
   - the suggestion appears in the PWA review screen
   - iOS sync-pull shows the same suggestion
10. Accept a suggestion in the PWA. Confirm the expense appears in the PWA
    feed and the iOS app pulls both the accepted suggestion and the expense.
11. Forge a 4xx write, such as an expense with a deleted category. Confirm the
    outbox row is marked failed and Settings offers Retry and Discard.
12. Leave the installed PWA unused for seven days, then relaunch and confirm
    storage has not been evicted.
