# ADR 006: Wide Events Discipline

## Status

Accepted (2026-05-07)

## Context

`internal/wideevent` is a thin wrapper around `slog` exposing
`Info`/`Warn`/`Error`, with `request_id` and `client_build` propagated via
context. Events are emitted as JSONL to stdout via
`slog.NewJSONHandler` (`internal/cli/logging.go`).

Audit of call sites (2026-05-07):

| Site | Event | Verdict |
|---|---|---|
| `api/observability.go` middleware | `http.request` (one per request) | Wide. Carries method, path, status, bytes, duration_ms, remote_addr, user_agent. |
| `api/observability.go` panic | `http.request.panic` | Wide. Carries stack. |
| `api/sync.go` ×2 | `sync.pull.failed`, `sync.push.failed` | Redundant with the middleware's status-5xx event. Same failure logged twice. |
| CLI commands | (none) | CLI is not instrumented at all. |

Two failure modes show through:

- **Redundant events** seed the "structured logs in disguise" pattern. Once
  two services emit a second event for the same unit of work, the
  one-event-per-unit discipline is gone.
- **Push is the most interesting endpoint** in the system (materializer +
  LWW reconciliation across three entity types + transactions) and its
  middleware event records nothing about *what happened* — only the HTTP
  shape. There is no `expenses_pushed`, `categories_pushed`, `materialized`,
  `tx_retries`.

There is no schema/registry for event names or field names. With four
events today this is fine; at twenty it will not be, and field names will
drift (`duration_ms` vs. `latency_ms`).

## Decision

### One event per unit of work

- An HTTP request is a unit of work. The middleware emits exactly one
  `http.request` event per request, in the deferred handler.
- A CLI command invocation is a unit of work. `cli.Execute` emits exactly
  one `cli.command` event per invocation, in a deferred handler that runs
  even on panic.
- Service methods do **not** emit their own wideevents. They contribute to
  the surrounding unit-of-work event via the attribute bag (below).

### Attribute bag in context

- Add `wideevent.AddAttrs(ctx, ...slog.Attr)` (and a `Attrs(ctx) []slog.Attr`
  reader). Handlers attach structured fields to the in-flight event.
- The middleware (HTTP) and `cli.Execute` (CLI) merge the bag into the
  single deferred event for the unit of work.
- Pattern in handlers:

  ```go
  wideevent.AddAttrs(ctx,
      slog.Int("expenses_pushed", n),
      slog.Bool("materialized", true),
  )
  ```

### Remove redundant events

- Delete `wideevent.Error(..., "sync.pull.failed", ...)` and
  `wideevent.Error(..., "sync.push.failed", ...)` once the attribute bag is
  in place. The middleware's status-5xx `http.request` event already
  records the failure; the bag carries any sync-specific detail.

### CLI instrumentation

- `cli.Execute` (or each Cobra command's `RunE`) sets up a deferred
  emitter that fires `cli.command` with at minimum: `command`,
  `args_count`, `duration_ms`, `outcome` (`ok` | `error` | `panic`).
- A panicking command must still emit its event. Use `recover()` in the
  deferred function and tag the event accordingly.

### Event registry

- `internal/wideevent/wideevent.go` declares event names as `const`
  identifiers (`EventHTTPRequest`, `EventHTTPRequestPanic`,
  `EventCLICommand`). Call sites reference the constants.
- This is enough discipline for the current size; revisit if event count
  exceeds ~20.

## Consequences

- Anyone debugging a sync failure looks at one event with full request
  shape + sync-specific attributes, not two events to correlate by
  `request_id`.
- CLI commands gain the same observability surface as HTTP requests.
- The "shared package for api and cli" framing in `architecture.md`
  becomes accurate.
- New handlers do not get to invent their own event names; they enrich
  the unit-of-work event.

## Tradeoffs

- The attribute bag is mutable state attached to context. Misuse (writing
  to it after the unit of work has emitted) is silent. The implementation
  must document that the bag is intended for one-shot enrichment within
  the request lifetime.
- Truly orthogonal events (e.g. background materializer triggered from a
  future scheduler, panics inside goroutines that escape the request
  context) still need their own emit calls. The discipline is "no second
  event per unit of work," not "never call `wideevent.Info` outside the
  middleware."

## Out of scope

- Choosing a downstream destination beyond stdout JSONL. Today stdout +
  systemd-journal (or `docker logs`) is enough. Revisit if/when query
  patterns demand it.
