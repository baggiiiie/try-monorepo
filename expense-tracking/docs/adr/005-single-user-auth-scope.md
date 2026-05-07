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
