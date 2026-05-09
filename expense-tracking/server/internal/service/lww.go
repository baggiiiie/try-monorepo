package service

import (
	"context"
	"database/sql"
	"errors"

	dbsqlc "expense-tracker/internal/repository/sqlc"
)

// LWWInput is satisfied by every PushX type. The reconciler reads only
// the timestamps from the input; everything else is opaque to it.
//
// The conflict-resolution clock is `client_updated_at` (ADR 007), the
// client's wall-clock at edit time. The server-side `updated_at` column
// continues to exist as an audit "received at" stamp but is intentionally
// not used here — comparing client vs. server clocks is apples-to-oranges.
type LWWInput interface {
	GetClientUpdatedAt() int64
	GetDeletedAt() *int64
}

// LWWHooks adapts a single record type onto the LWWMerge algorithm.
// The algorithm itself lives in ApplyLWW; each entity supplies the
// strategy. See server/CONTEXT.md for the LWWMerge rule.
type LWWHooks[E any, I LWWInput] struct {
	// Load returns the existing row, or (zero, false, nil) if not found.
	// Returning a sql.ErrNoRows wrapped error is also accepted.
	Load func(ctx context.Context, q *dbsqlc.Queries, incoming I) (E, bool, error)

	// ExistingClientUpdatedAt extracts the row's client_updated_at — sqlc
	// rows are plain structs, so this is a one-line accessor per entity.
	// This is the conflict-resolution clock per ADR 007.
	ExistingClientUpdatedAt func(existing E) int64

	// ExistingDeleted reports whether the row is soft-deleted.
	ExistingDeleted func(existing E) bool

	// Normalize is optional. It runs once before everything else and
	// lets adapters apply defaults (e.g. blank source -> "manual") so
	// EqualState compares against a canonical input.
	Normalize func(I) I

	// EqualState reports whether existing and incoming are the same
	// in everything except ClientUpdatedAt. The deleted-state comparison
	// is a boolean ("is-deleted-or-not"), not a timestamp comparison.
	EqualState func(existing E, incoming I) bool

	// Create inserts a new row. If incoming.GetDeletedAt() != nil the
	// adapter is responsible for landing in the soft-deleted state
	// (some entities accept DeletedAt in INSERT, others must follow
	// up with a SoftDelete*Returning call).
	Create func(ctx context.Context, q *dbsqlc.Queries, incoming I, now int64) (E, error)

	// Update writes incoming's non-deleted fields onto existing.
	Update func(ctx context.Context, q *dbsqlc.Queries, existing E, incoming I, now int64) (E, error)

	// SoftDelete marks existing as deleted. Only called when existing
	// is not already soft-deleted. Receives `incoming` so the adapter
	// can persist the client's claimed client_updated_at on the
	// resulting tombstone (ADR 007).
	SoftDelete func(ctx context.Context, q *dbsqlc.Queries, existing E, incoming I, now int64) (E, error)
}

// ApplyLWW runs the LWWMerge rule (see server/CONTEXT.md):
//
//  1. No existing row -> Create.
//  2. Apply iff incoming.ClientUpdatedAt > existing.ClientUpdatedAt, OR
//     the timestamps are equal and EqualState is false.
//  3. If incoming carries a deleted_at, SoftDelete (idempotent on
//     already-deleted rows). Otherwise Update.
//
// Returns the resulting row in all branches, including no-op.
func ApplyLWW[E any, I LWWInput](
	ctx context.Context,
	q *dbsqlc.Queries,
	hooks LWWHooks[E, I],
	incoming I,
	now int64,
) (E, error) {
	var zero E

	if hooks.Normalize != nil {
		incoming = hooks.Normalize(incoming)
	}

	existing, found, err := hooks.Load(ctx, q, incoming)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return zero, err
	}
	if errors.Is(err, sql.ErrNoRows) {
		found = false
	}

	if !found {
		return hooks.Create(ctx, q, incoming, now)
	}

	incomingTs := incoming.GetClientUpdatedAt()
	existingTs := hooks.ExistingClientUpdatedAt(existing)

	switch {
	case incomingTs > existingTs:
		// strictly newer: apply
	case incomingTs == existingTs && !hooks.EqualState(existing, incoming):
		// tie-break on state divergence: apply
	default:
		return existing, nil
	}

	if incoming.GetDeletedAt() != nil {
		if hooks.ExistingDeleted(existing) {
			return existing, nil
		}
		return hooks.SoftDelete(ctx, q, existing, incoming, now)
	}
	return hooks.Update(ctx, q, existing, incoming, now)
}
