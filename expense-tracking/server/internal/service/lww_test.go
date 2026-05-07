package service

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"

	dbmigrations "expense-tracker/db"
	"expense-tracker/internal/ptr"
	"expense-tracker/internal/repository"
	dbsqlc "expense-tracker/internal/repository/sqlc"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

// newTestSyncService spins up a fresh, isolated SQLite database
// (file-backed, in t.TempDir()) and returns a SyncService wired to it.
// We use a temp file rather than ":memory:" because goose runs each
// migration in its own connection.
func newTestSyncService(t *testing.T) *SyncService {
	t.Helper()

	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := sql.Open("sqlite", dbPath+"?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("opening sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })

	goose.SetBaseFS(dbmigrations.Migrations)
	if err := goose.SetDialect("sqlite3"); err != nil {
		t.Fatalf("goose dialect: %v", err)
	}
	if err := goose.Up(db, "migrations"); err != nil {
		t.Fatalf("goose up: %v", err)
	}

	store := repository.NewStore(db)
	return NewSyncService(store.Queries(), store, "UTC")
}

func mustGetCategory(t *testing.T, q *dbsqlc.Queries, id string) dbsqlc.Category {
	t.Helper()
	row, err := q.GetCategoryIncludingDeleted(context.Background(), id)
	if err != nil {
		t.Fatalf("get category %q: %v", id, err)
	}
	return row
}

// seedCategory inserts a category directly via sqlc, bypassing
// pushCategory, so tests can set up arbitrary existing-row state.
func seedCategory(t *testing.T, q *dbsqlc.Queries, id, name, icon string, budget *int64, updatedAt int64, deletedAt *int64) {
	t.Helper()
	_, err := q.CreateCategory(context.Background(), dbsqlc.CreateCategoryParams{
		ID:        id,
		Name:      name,
		Icon:      icon,
		Budget:    nullInt64(budget),
		CreatedAt: updatedAt,
		UpdatedAt: updatedAt,
	})
	if err != nil {
		t.Fatalf("seed category: %v", err)
	}
	if deletedAt != nil {
		_, err := q.SoftDeleteCategoryReturning(context.Background(), dbsqlc.SoftDeleteCategoryReturningParams{
			DeletedAt: sql.NullInt64{Int64: *deletedAt, Valid: true},
			UpdatedAt: updatedAt,
			ID:        id,
		})
		if err != nil {
			t.Fatalf("seed soft-delete: %v", err)
		}
	}
}

func TestPushCategory_LWW(t *testing.T) {
	const now int64 = 1_000_000

	tests := []struct {
		name          string
		seed          func(t *testing.T, q *dbsqlc.Queries) // optional pre-state
		input         PushCategory
		wantName      string
		wantIcon      string
		wantBudget    *int64
		wantDeleted   bool
		wantUpdatedAt int64 // expected updated_at after the push
	}{
		{
			name: "create new",
			input: PushCategory{
				ID: "c1", Name: "Food", Icon: "🍕", Budget: ptr.To[int64](500),
				UpdatedAt: 100,
			},
			wantName: "Food", wantIcon: "🍕", wantBudget: ptr.To[int64](500),
			wantDeleted: false, wantUpdatedAt: now,
		},
		{
			name: "create soft-deleted",
			input: PushCategory{
				ID: "c1", Name: "Food", Icon: "🍕",
				UpdatedAt: 100, DeletedAt: ptr.To[int64](150),
			},
			wantName: "Food", wantIcon: "🍕", wantDeleted: true, wantUpdatedAt: now,
		},
		{
			name: "update when incoming newer",
			seed: func(t *testing.T, q *dbsqlc.Queries) {
				seedCategory(t, q, "c1", "Food", "🍕", ptr.To[int64](500), 100, nil)
			},
			input: PushCategory{
				ID: "c1", Name: "Groceries", Icon: "🛒", Budget: ptr.To[int64](800),
				UpdatedAt: 200,
			},
			wantName: "Groceries", wantIcon: "🛒", wantBudget: ptr.To[int64](800),
			wantDeleted: false, wantUpdatedAt: now,
		},
		{
			name: "soft-delete when incoming newer",
			seed: func(t *testing.T, q *dbsqlc.Queries) {
				seedCategory(t, q, "c1", "Food", "🍕", nil, 100, nil)
			},
			input: PushCategory{
				ID: "c1", Name: "Food", Icon: "🍕",
				UpdatedAt: 200, DeletedAt: ptr.To[int64](150),
			},
			wantName: "Food", wantDeleted: true, wantUpdatedAt: now,
		},
		{
			name: "no-op when already soft-deleted",
			seed: func(t *testing.T, q *dbsqlc.Queries) {
				seedCategory(t, q, "c1", "Food", "🍕", nil, 100, ptr.To[int64](120))
			},
			input: PushCategory{
				ID: "c1", Name: "Food", Icon: "🍕",
				UpdatedAt: 200, DeletedAt: ptr.To[int64](150),
			},
			wantName: "Food", wantDeleted: true, wantUpdatedAt: 100, // existing untouched
		},
		{
			name: "no-op when incoming older",
			seed: func(t *testing.T, q *dbsqlc.Queries) {
				seedCategory(t, q, "c1", "Groceries", "🛒", ptr.To[int64](800), 200, nil)
			},
			input: PushCategory{
				ID: "c1", Name: "Food", Icon: "🍕", Budget: ptr.To[int64](500),
				UpdatedAt: 100,
			},
			wantName: "Groceries", wantIcon: "🛒", wantBudget: ptr.To[int64](800),
			wantUpdatedAt: 200, // existing untouched
		},
		{
			name: "no-op on equal timestamp + same state",
			seed: func(t *testing.T, q *dbsqlc.Queries) {
				seedCategory(t, q, "c1", "Food", "🍕", ptr.To[int64](500), 200, nil)
			},
			input: PushCategory{
				ID: "c1", Name: "Food", Icon: "🍕", Budget: ptr.To[int64](500),
				UpdatedAt: 200,
			},
			wantName: "Food", wantIcon: "🍕", wantBudget: ptr.To[int64](500),
			wantUpdatedAt: 200, // unchanged
		},
		{
			name: "apply on equal timestamp + different state",
			seed: func(t *testing.T, q *dbsqlc.Queries) {
				seedCategory(t, q, "c1", "Food", "🍕", ptr.To[int64](500), 200, nil)
			},
			input: PushCategory{
				ID: "c1", Name: "Food", Icon: "🍕", Budget: ptr.To[int64](800),
				UpdatedAt: 200,
			},
			wantName: "Food", wantIcon: "🍕", wantBudget: ptr.To[int64](800),
			wantUpdatedAt: now, // tie-break applied
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestSyncService(t)
			ctx := context.Background()

			if tt.seed != nil {
				tt.seed(t, s.queries)
			}

			cat, err := s.pushCategory(ctx, s.queries, tt.input, now)
			if err != nil {
				t.Fatalf("pushCategory: %v", err)
			}
			if cat.Name != tt.wantName {
				t.Errorf("name: got %q, want %q", cat.Name, tt.wantName)
			}
			if cat.Icon != tt.wantIcon && tt.wantIcon != "" {
				t.Errorf("icon: got %q, want %q", cat.Icon, tt.wantIcon)
			}
			if !int64PtrEqual(cat.Budget, tt.wantBudget) {
				t.Errorf("budget: got %v, want %v", deref(cat.Budget), deref(tt.wantBudget))
			}
			if (cat.DeletedAt != nil) != tt.wantDeleted {
				t.Errorf("deleted: got %v, want %v", cat.DeletedAt != nil, tt.wantDeleted)
			}
			if cat.UpdatedAt != tt.wantUpdatedAt {
				t.Errorf("updated_at: got %d, want %d", cat.UpdatedAt, tt.wantUpdatedAt)
			}
		})
	}
}

// TestPushCategory_ByNameReconciliation verifies the pre-step that
// splices a fresh-UUID push onto an existing same-name row.
func TestPushCategory_ByNameReconciliation(t *testing.T) {
	const now int64 = 1_000_000

	s := newTestSyncService(t)
	ctx := context.Background()

	// Existing server row under id=server1
	seedCategory(t, s.queries, "server1", "Food", "🍕", ptr.To[int64](500), 100, nil)

	// Client pushes with a brand-new UUID but the same name.
	cat, err := s.pushCategory(ctx, s.queries, PushCategory{
		ID: "client1", Name: "Food", Icon: "🍔", Budget: ptr.To[int64](700),
		UpdatedAt: 200,
	}, now)
	if err != nil {
		t.Fatalf("pushCategory: %v", err)
	}

	// Expect the response to use the client ID (the splice replaces server1's id).
	if cat.ID != "client1" {
		t.Errorf("id: got %q, want %q", cat.ID, "client1")
	}
	if cat.Icon != "🍔" {
		t.Errorf("icon: got %q, want %q", cat.Icon, "🍔")
	}

	// Old ID should no longer exist.
	if _, err := s.queries.GetCategoryIncludingDeleted(ctx, "server1"); err != sql.ErrNoRows {
		t.Errorf("expected server1 to be gone, got err=%v", err)
	}
	// New ID should exist.
	got := mustGetCategory(t, s.queries, "client1")
	if got.Name != "Food" {
		t.Errorf("name: got %q, want %q", got.Name, "Food")
	}
}

func deref(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

// seedCategoryForFK creates a minimal category row to satisfy the
// expenses.category_id foreign key in expense/recurring tests.
func seedCategoryForFK(t *testing.T, q *dbsqlc.Queries, id string) {
	t.Helper()
	seedCategory(t, q, id, "FK-"+id, "", nil, 1, nil)
}

func TestPushExpense_LWW(t *testing.T) {
	const now int64 = 1_000_000

	t.Run("source defaults to manual on create", func(t *testing.T) {
		s := newTestSyncService(t)
		seedCategoryForFK(t, s.queries, "cat1")

		exp, err := s.pushExpense(context.Background(), s.queries, PushExpense{
			ID: "e1", Amount: 1000, Currency: "USD", CategoryID: "cat1",
			Date: 200, UpdatedAt: 100,
			// Source intentionally empty — Normalize hook should set it.
		}, now)
		if err != nil {
			t.Fatalf("pushExpense: %v", err)
		}
		if exp.Source != "manual" {
			t.Errorf("source: got %q, want %q", exp.Source, "manual")
		}
	})

	t.Run("equal timestamp + empty incoming source is a no-op vs existing manual", func(t *testing.T) {
		// Bug fix Q6b: blank source must normalize before EqualState.
		s := newTestSyncService(t)
		seedCategoryForFK(t, s.queries, "cat1")
		_, err := s.queries.CreateExpense(context.Background(), dbsqlc.CreateExpenseParams{
			ID: "e1", Amount: 1000, Currency: "USD", CategoryID: "cat1",
			Date: 200, Source: "manual", CreatedAt: 100, UpdatedAt: 100,
		})
		if err != nil {
			t.Fatalf("seed: %v", err)
		}

		exp, err := s.pushExpense(context.Background(), s.queries, PushExpense{
			ID: "e1", Amount: 1000, Currency: "USD", CategoryID: "cat1",
			Date: 200, UpdatedAt: 100, // equal ts; blank source
		}, now)
		if err != nil {
			t.Fatalf("pushExpense: %v", err)
		}
		// No-op: existing UpdatedAt unchanged.
		if exp.UpdatedAt != 100 {
			t.Errorf("updated_at: got %d, want 100 (no-op expected)", exp.UpdatedAt)
		}
	})

	t.Run("create soft-deleted in one shot", func(t *testing.T) {
		s := newTestSyncService(t)
		seedCategoryForFK(t, s.queries, "cat1")

		exp, err := s.pushExpense(context.Background(), s.queries, PushExpense{
			ID: "e1", Amount: 1000, Currency: "USD", CategoryID: "cat1",
			Date: 200, UpdatedAt: 100, DeletedAt: ptr.To[int64](150),
		}, now)
		if err != nil {
			t.Fatalf("pushExpense: %v", err)
		}
		if exp.DeletedAt == nil {
			t.Errorf("expected soft-deleted expense, got DeletedAt=nil")
		}
	})
}

func TestPushRecurringExpense_LWW(t *testing.T) {
	const now int64 = 1_000_000

	t.Run("equal timestamp + identical state including same is-deleted is a no-op", func(t *testing.T) {
		// Bug fix Q6a: deleted-state comparison must be boolean,
		// not timestamp. Two soft-deleted rows with different
		// DeletedAt timestamps but equal UpdatedAt must NOT ping-pong.
		s := newTestSyncService(t)
		seedCategoryForFK(t, s.queries, "cat1")
		// Seed a soft-deleted recurring expense.
		if err := s.queries.CreateRecurringExpense(context.Background(), dbsqlc.CreateRecurringExpenseParams{
			ID: "r1", Amount: 5000, Currency: "USD", CategoryID: "cat1",
			Frequency: "monthly", StartDate: 100, NextRunDate: 100,
			CreatedAt: 100, UpdatedAt: 200,
			DeletedAt: sql.NullInt64{Int64: 180, Valid: true},
		}); err != nil {
			t.Fatalf("seed: %v", err)
		}

		// Push with the same fields, equal UpdatedAt, but a different
		// DeletedAt timestamp. Old behaviour (int64PtrEqual) treated
		// these as different and re-applied; correct behaviour is no-op.
		_, err := s.pushRecurringExpense(context.Background(), s.queries, PushRecurringExpense{
			ID: "r1", Amount: 5000, Currency: "USD", CategoryID: "cat1",
			Frequency: "monthly", StartDate: 100, NextRunDate: 100,
			UpdatedAt: 200, DeletedAt: ptr.To[int64](999), // different timestamp
		}, now)
		if err != nil {
			t.Fatalf("pushRecurringExpense: %v", err)
		}

		got, err := s.queries.GetRecurringExpense(context.Background(), "r1")
		if err != nil {
			t.Fatalf("get: %v", err)
		}
		if got.UpdatedAt != 200 {
			t.Errorf("updated_at: got %d, want 200 (no-op expected; ping-pong bug)", got.UpdatedAt)
		}
	})

	t.Run("update applies on newer timestamp", func(t *testing.T) {
		s := newTestSyncService(t)
		seedCategoryForFK(t, s.queries, "cat1")
		if err := s.queries.CreateRecurringExpense(context.Background(), dbsqlc.CreateRecurringExpenseParams{
			ID: "r1", Amount: 5000, Currency: "USD", CategoryID: "cat1",
			Frequency: "monthly", StartDate: 100, NextRunDate: 100,
			CreatedAt: 100, UpdatedAt: 100,
		}); err != nil {
			t.Fatalf("seed: %v", err)
		}

		r, err := s.pushRecurringExpense(context.Background(), s.queries, PushRecurringExpense{
			ID: "r1", Amount: 9999, Currency: "USD", CategoryID: "cat1",
			Frequency: "monthly", StartDate: 100, NextRunDate: 100,
			UpdatedAt: 200,
		}, now)
		if err != nil {
			t.Fatalf("pushRecurringExpense: %v", err)
		}
		if r.Amount != 9999 {
			t.Errorf("amount: got %d, want 9999", r.Amount)
		}
		if r.UpdatedAt != now {
			t.Errorf("updated_at: got %d, want %d", r.UpdatedAt, now)
		}
	})
}
