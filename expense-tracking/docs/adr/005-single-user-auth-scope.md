# ADR 005: Single-User Shared-Secret Auth

## Status

Accepted (2026-05-07)

## Context

`internal/auth` is a shared-secret middleware that guards `/api/*` (except
`/api/health`). Every device uses the same secret. There is no per-device
identity, no user table, no token rotation, no revocation list.

For a single-user personal app this is the right amount of auth: a
network-layer "are you me" check and nothing more. The full apparatus of
real auth (users, password hashing, sessions, refresh tokens, OAuth) would
be ceremony for a one-person system.

The risk is that the assumption — *exactly one principal exists, and they
have the secret* — gets quietly violated and no one notices. The trigger
for replacement should be visible and named.

## Decision

### Keep shared-secret auth as-is

- No code change to the auth scheme.
- `/api/health` remains unauthenticated.

### Make the assumption visible

- Rename the middleware (or its package or struct) from a generic `Auth`
  name to one that makes the scope explicit, e.g. `SingleUserSecret` or
  `PersonalAccessToken`. This is a documentation change in the form of a
  symbol name; future-you reading the code sees the assumption immediately.
- The secret is configured via environment variable. **It must not be
  checked into the repository.**

### Name the replacement triggers in writing

This auth scheme is replaced when **any** of the following becomes true:

1. A second user (e.g. a household partner) needs access to the data.
2. The iOS app is distributed to anyone other than the project owner.
3. A device is lost and needs revocation without rotating every other
   device's secret.
4. Server-side audit logs need to attribute actions to a specific person.

When a trigger fires, write a successor ADR (006-or-later) describing the
chosen replacement (most likely per-user accounts + bearer tokens). Until
then, the current scheme is the considered, documented choice — not an
oversight.

## Consequences

- Implementation cost is zero today.
- The scope of the current auth scheme is legible to future readers, both
  human and agent.
- Any future expansion of the system that violates the named assumptions
  is forced to engage with this ADR rather than incrementally adding
  workarounds.

## Tradeoffs

- Compromise of the secret means rotating it on every device. Acceptable
  at scale = 1 device per platform.
- No audit trail beyond "someone with the secret did this." Acceptable
  when "someone" is always the project owner.

---

## Update (2026-05-17): Public exposure via Cloudflare Tunnel

### Context change

The original decision assumed an implicit trusted-network deployment
(LAN / Tailscale). The Web Client Plan
([docs/web-client-plan.md](../web-client-plan.md)) introduces a second
client (an installable PWA) which requires HTTPS for installability and
is hosted by exposing the Go server publicly via **Cloudflare Tunnel**.

The principal model — *exactly one human, holding the secret* — does
not change. What changes is the network path: the server is now reachable
from any internet host that knows the Cloudflare hostname. The shared
secret is the only thing standing between the public internet and the
data (modulo Cloudflare's edge protections).

A third credential bearer is also added: an **iOS Shortcut** invoking
`POST /api/wallet-suggestions` from the Apple Pay automation. The
Shortcut holds the same shared secret hardcoded in its HTTP-action
headers.

### Decision (additive — does not supersede the original)

1. **Keep the single shared secret.** Principal count is still 1. No
   per-source token, no per-client identity. The original ADR's
   reasoning still applies.

2. **Add a cookie credential path for browsers.** A new endpoint
   `POST /api/auth/exchange` accepts `Authorization: Bearer <secret>`
   and responds with
   `Set-Cookie: et_session=<secret>; HttpOnly; Secure; SameSite=Strict;
   Path=/api; Max-Age=<long>`. The existing middleware accepts the
   cookie value as an equivalent credential.

   Rationale: with the origin now public, an XSS bug in the PWA's
   own code would otherwise allow exfiltrating the bearer from
   browser-accessible storage. `HttpOnly` removes that exfiltration
   vector while preserving the single-principal model. iOS continues
   to send the header from Keychain; the Shortcut continues to send
   the header hardcoded.

3. **Add basic abuse-resistance.** A naive in-memory rate limit on
   auth failures per remote IP is added to
   [`internal/singleusersecret`](../../server/internal/singleusersecret/),
   logged at warn level on trip. This is not a security boundary —
   the 32-byte secret is computationally safe against brute-force —
   but it caps log noise and keeps a single bad actor from holding
   the auth middleware open against unbounded scan traffic.

4. **Cloudflare is treated as part of the trust boundary, not a
   security layer to depend on.** Tunnel-only ingress (the origin is
   not reachable except via the `cloudflared` daemon) is a meaningful
   reduction in attack surface, but the application must remain
   correct if Cloudflare's edge protections fail open.

### New replacement triggers (additive to the original four)

5. The Shortcut is shared with anyone other than the project owner
   (e.g. an iCloud Shortcut link posted publicly), causing the bearer
   to escape into a context the owner does not control.
6. Auth-failure rate sustained above a threshold from non-trivial
   distributed sources (suggests credential leakage or targeted
   brute-force, not just background scanning).
7. The cookie credential is needed for **a different scope than `/api/*`**
   (e.g., admin endpoints), at which point per-scope tokens are warranted.

When any of these fires, succeed this ADR rather than patching it in
place.

### Consequences

- The PWA may be added without introducing a real auth system.
- A second credential format (cookie) coexists with the header. The
  middleware contract is "either header or cookie matching the secret."
- The trust boundary is now "Cloudflare edge + shared secret," not
  "LAN + shared secret." Operators must rotate the secret if they
  suspect compromise of *any* of: the iOS Keychain, the Shortcut
  configuration, the PWA cookie store, or the server's `secret.json`.

### Tradeoffs (additive)

- An XSS in the PWA can still execute requests in the user's session
  (cookie auto-attached). The cookie change only blocks token theft,
  not in-session abuse. Acceptable while the PWA has no third-party
  JS in its build.
- The rate limit is per-IP and in-memory; a distributed scanner is
  unaffected. That is an acceptable failure mode for the threat model
  (the scanner still cannot guess the secret).
- A future move to Cloudflare Access (Google/GitHub OAuth in front of
  the PWA hostname, free for ≤50 users) would *strictly improve*
  defense by adding an identity layer in front of the bearer. Not
  adopted now to keep the principal model in this ADR intact;
  reconsider if trigger #5 or #6 fires.
