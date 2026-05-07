# ADR 002: Service Composition, Granularity, and Transactions

## Status

Accepted (2026-05-07)

## Context

`internal/app` is described in `architecture.md` as the composition root, but
it is currently passed wholesale into `api.NewRouter` and into CLI commands.
That makes `App` behave more like a service locator (a bag of services that
handlers reach into) than a true composition root (which wires dependencies
once and hands each consumer only what it needs).

Two related questions arise from this shape:

1. **Service granularity.** Five services exist (`Expense`, `Category`,
   `Report`, `Sync`, `Recurring`). It is unclear today whether services may
   call each other or whether each owns its slice of the schema and reads
   directly via `Queries`.

2. **Transaction boundaries.** sqlc generates a `Queries` struct over `DBTX`,
   which can be either `*sql.DB` or `*sql.Tx`. Multi-write operations
   (Recurring materialization, Sync push) need atomicity. Today some paths
   use ad-hoc transactions and others do not, and SQLite-specific concerns
   (busy timeout, `SQLITE_BUSY` retry) are not centralized.

## Decision

### Composition root (Q1)

- `App` remains the composition root. It opens SQLite, runs migrations, and
  wires the concrete services.
- `App` is constructed in `cmd/expense` (for CLI) and in `cli serve` (for HTTP).
- `api.NewRouter` and CLI command constructors **must take only the specific
  services they need** as explicit parameters, not the full `App`. This makes
  handler dependencies visible in their signatures and prevents accidental
  coupling across unrelated services.

### Service granularity (Q2)

- Services own a slice of the schema and talk **directly** to `Queries`.
- **Services do not call each other.** A handler that needs both expense and
  category data calls both services.
- Cross-cutting concerns (timezone, currency formatting, ID generation) live
  in small shared helper packages, not in another service.
- Aggregations (e.g. `ReportService.MonthlySummary`) issue their own sqlc
  queries rather than looping over another service's reads.

### Transactions (Q3)

- A single `txManager`, owned by `App`, exposes
  `WithTx(ctx context.Context, fn func(*sqlc.Queries) error) error`.
- Services receive a `*sqlc.Queries` for single-statement work and call
  `txManager.WithTx` for multi-statement work.
- Services **never touch `*sql.DB` or `*sql.Tx` directly.**
- SQLite-specific concerns (busy timeout, `SQLITE_BUSY` retry, transaction
  mode such as `BEGIN IMMEDIATE` for write paths) live in `txManager`.

## Consequences

- Per-handler tests can construct a fake `ExpenseService` without standing up
  a full `App`.
- Swapping the storage engine (or adding a second one for tests) means
  reimplementing `txManager` and the `Queries` interface — a finite surface.
- One global SQLite-busy retry policy instead of scattered ad-hoc handling.
- Services do not form a graph; the dependency graph stops at `App` and
  `Queries`.

## Tradeoffs

- More verbose constructors (each handler/command lists its services) in
  exchange for explicit dependencies.
- Some duplication of read patterns across services (e.g. `Report` and
  `Expense` both read expenses) instead of one calling the other. This is
  intentional; sqlc-generated readers are cheap to add and the alternative
  (service-to-service calls) creates hidden test dependencies.
