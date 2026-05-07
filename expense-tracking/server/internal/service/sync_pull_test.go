package service

import (
	"context"
	"testing"

	dbsqlc "expense-tracker/internal/repository/sqlc"
)

type countingTxManager struct {
	readCalls  int
	writeCalls int
	q          *dbsqlc.Queries
}

func (m *countingTxManager) WithTx(ctx context.Context, fn func(*dbsqlc.Queries) error) error {
	m.writeCalls++
	return fn(m.q)
}

func (m *countingTxManager) WithReadTx(ctx context.Context, fn func(*dbsqlc.Queries) error) error {
	m.readCalls++
	return fn(m.q)
}

func TestPullUsesReadTransaction(t *testing.T) {
	s := newTestSyncService(t)
	spy := &countingTxManager{q: s.queries}
	s.tx = spy

	if _, err := s.Pull(context.Background(), 0); err != nil {
		t.Fatalf("pull: %v", err)
	}
	if spy.readCalls != 1 {
		t.Fatalf("expected one read transaction, got %d", spy.readCalls)
	}
	if spy.writeCalls != 0 {
		t.Fatalf("expected no write transactions, got %d", spy.writeCalls)
	}
}

func TestPullWithDueRecurringDoesNotMaterialize(t *testing.T) {
	s := newTestSyncService(t)
	spy := &countingTxManager{q: s.queries}
	s.tx = spy

	seedCategoryForFK(t, s.queries, "cat1")
	if err := s.queries.CreateRecurringExpense(context.Background(), dbsqlc.CreateRecurringExpenseParams{
		ID:          "r1",
		Amount:      5000,
		Currency:    "USD",
		CategoryID:  "cat1",
		Description: "rent",
		Frequency:   "monthly",
		StartDate:   1,
		NextRunDate: 1,
		CreatedAt:   1,
		UpdatedAt:   1,
	}); err != nil {
		t.Fatalf("seed recurring expense: %v", err)
	}

	if _, err := s.Pull(context.Background(), 0); err != nil {
		t.Fatalf("pull: %v", err)
	}
	if spy.readCalls != 1 {
		t.Fatalf("expected one read transaction, got %d", spy.readCalls)
	}
	if spy.writeCalls != 0 {
		t.Fatalf("expected no write transactions, got %d", spy.writeCalls)
	}

	expenses, err := s.queries.ListExpensesSinceServerVersion(context.Background(), 0)
	if err != nil {
		t.Fatalf("list expenses: %v", err)
	}
	if len(expenses) != 0 {
		t.Fatalf("expected pull to remain read-only, got %d materialized expenses", len(expenses))
	}

	recurring, err := s.queries.GetRecurringExpense(context.Background(), "r1")
	if err != nil {
		t.Fatalf("get recurring expense: %v", err)
	}
	if recurring.LastRunDate.Valid {
		t.Fatalf("expected last_run_date to remain unset, got %d", recurring.LastRunDate.Int64)
	}
	if recurring.NextRunDate != 1 {
		t.Fatalf("expected next_run_date to remain unchanged, got %d", recurring.NextRunDate)
	}
}

func TestEmptyPushMaterializesDueRecurring(t *testing.T) {
	s := newTestSyncService(t)

	seedCategoryForFK(t, s.queries, "cat1")
	if err := s.queries.CreateRecurringExpense(context.Background(), dbsqlc.CreateRecurringExpenseParams{
		ID:          "r1",
		Amount:      5000,
		Currency:    "USD",
		CategoryID:  "cat1",
		Description: "rent",
		Frequency:   "monthly",
		StartDate:   1,
		NextRunDate: 1,
		CreatedAt:   1,
		UpdatedAt:   1,
	}); err != nil {
		t.Fatalf("seed recurring expense: %v", err)
	}

	if _, err := s.Push(context.Background(), PushRequest{}); err != nil {
		t.Fatalf("empty push: %v", err)
	}

	expenses, err := s.queries.ListExpensesSinceServerVersion(context.Background(), 0)
	if err != nil {
		t.Fatalf("list expenses: %v", err)
	}
	if len(expenses) == 0 {
		t.Fatal("expected empty push to materialize a due recurring expense")
	}

	recurring, err := s.queries.GetRecurringExpense(context.Background(), "r1")
	if err != nil {
		t.Fatalf("get recurring expense: %v", err)
	}
	if !recurring.LastRunDate.Valid {
		t.Fatal("expected empty push to advance last_run_date")
	}
}
