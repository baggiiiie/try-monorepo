package service

import (
	"context"
	"testing"

	dbsqlc "expense-tracker/internal/repository/sqlc"
)

type countingTxManager struct {
	calls int
	q     *dbsqlc.Queries
}

func (m *countingTxManager) WithTx(ctx context.Context, fn func(*dbsqlc.Queries) error) error {
	m.calls++
	return fn(m.q)
}

func TestPullWithoutDueRecurringSkipsWriteTransaction(t *testing.T) {
	s := newTestSyncService(t)
	spy := &countingTxManager{q: s.queries}
	s.tx = spy

	if _, err := s.Pull(context.Background(), 0); err != nil {
		t.Fatalf("pull: %v", err)
	}
	if spy.calls != 0 {
		t.Fatalf("expected no write transaction, got %d", spy.calls)
	}
}

func TestPullWithDueRecurringUsesWriteTransaction(t *testing.T) {
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
	if spy.calls != 1 {
		t.Fatalf("expected one write transaction, got %d", spy.calls)
	}

	expenses, err := s.queries.ListExpensesUpdatedSince(context.Background(), 0)
	if err != nil {
		t.Fatalf("list expenses: %v", err)
	}
	if len(expenses) == 0 {
		t.Fatal("expected due recurring expense to materialize an expense row")
	}
}
