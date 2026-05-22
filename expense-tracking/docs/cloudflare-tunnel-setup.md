# Cloudflare Tunnel Setup

This is the one manual infrastructure step required before production PWA
install validation.

## Install

On the host that runs `expense serve`:

```sh
brew install cloudflared
cloudflared tunnel login
```

## Create Tunnel

```sh
cloudflared tunnel create expense-tracker
cloudflared tunnel route dns expense-tracker <host>
```

Replace `<host>` with the final HTTPS hostname, for example
`expenses.example.com`.

## Configure

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: expense-tracker
credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json

ingress:
  - hostname: <host>
    service: http://localhost:8080
  - service: http_status:404
```

## Run

Start the app server:

```sh
make web
cd server
./bin/expense serve --db expense.db --config preferences.json --secret-file secret.json
```

In another shell:

```sh
cloudflared tunnel run expense-tracker
```

For a launchd service:

```sh
cloudflared service install
```

## Verify

```sh
curl -I https://<host>/
curl -I https://<host>/manifest.webmanifest
curl -I https://<host>/service-worker.js
```

Expected:

- `/` returns `200` and `Cache-Control: no-cache`
- `/manifest.webmanifest` returns `Content-Type: application/manifest+json`
- `/service-worker.js` returns `Cache-Control: no-cache` and
  `Service-Worker-Allowed: /`

Then continue with [`pwa-validation-runbook.md`](pwa-validation-runbook.md).
