package service

import (
	"context"
	"database/sql"
	"strings"
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

func TestPushWalletSuggestionAcceptsAndPullsDelta(t *testing.T) {
	s := newTestSyncService(t)
	ctx := context.Background()

	if err := s.queries.CreateWalletSuggestion(ctx, dbsqlc.CreateWalletSuggestionParams{
		ID:              "suggestion-1",
		Amount:          sql.NullInt64{Int64: 1299, Valid: true},
		Currency:        "USD",
		Merchant:        "Coffee",
		CapturedAt:      10,
		Source:          "shortcut",
		CreatedAt:       10,
		UpdatedAt:       10,
		ClientUpdatedAt: 10,
	}); err != nil {
		t.Fatalf("seed wallet suggestion: %v", err)
	}

	linkedExpenseID := "expense-1"
	seedCategoryForFK(t, s.queries, "cat1")
	resp, err := s.Push(ctx, PushRequest{
		Expenses: []PushExpense{
			{
				ID:              linkedExpenseID,
				Amount:          1299,
				Currency:        "USD",
				CategoryID:      "cat1",
				Description:     "",
				Merchant:        "Coffee",
				Date:            20,
				Source:          "shortcut",
				ClientUpdatedAt: 20,
			},
		},
		WalletSuggestions: []PushWalletSuggestion{
			{
				ID:              "suggestion-1",
				Status:          WalletSuggestionStatusAccepted,
				LinkedExpenseID: &linkedExpenseID,
				ClientUpdatedAt: 20,
			},
		},
	})
	if err != nil {
		t.Fatalf("push wallet suggestion: %v", err)
	}
	if len(resp.WalletSuggestions) != 1 {
		t.Fatalf("expected one pushed suggestion, got %d", len(resp.WalletSuggestions))
	}
	if resp.WalletSuggestions[0].Status != WalletSuggestionStatusAccepted {
		t.Fatalf("status = %q", resp.WalletSuggestions[0].Status)
	}
	if resp.WalletSuggestions[0].LinkedExpenseID == nil || *resp.WalletSuggestions[0].LinkedExpenseID != linkedExpenseID {
		t.Fatalf("linked expense id = %#v", resp.WalletSuggestions[0].LinkedExpenseID)
	}

	pull, err := s.Pull(ctx, 0)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	if len(pull.WalletSuggestions) != 1 {
		t.Fatalf("expected one pulled suggestion, got %d", len(pull.WalletSuggestions))
	}
	if pull.WalletSuggestions[0].Status != WalletSuggestionStatusAccepted {
		t.Fatalf("pulled status = %q", pull.WalletSuggestions[0].Status)
	}
}

func TestPushWalletSuggestionRejectsInvalidLifecycleState(t *testing.T) {
	tests := []struct {
		name            string
		status          string
		linkedExpenseID *string
		wantErr         string
	}{
		{
			name:    "accepted missing linked expense",
			status:  WalletSuggestionStatusAccepted,
			wantErr: "accepted wallet suggestion requires linked_expense_id",
		},
		{
			name:            "dismissed with linked expense",
			status:          WalletSuggestionStatusDismissed,
			linkedExpenseID: ptrString("expense-1"),
			wantErr:         "dismissed wallet suggestion must not include linked_expense_id",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s := newTestSyncService(t)
			ctx := context.Background()

			if err := s.queries.CreateWalletSuggestion(ctx, dbsqlc.CreateWalletSuggestionParams{
				ID:              "suggestion-1",
				Amount:          sql.NullInt64{Int64: 1299, Valid: true},
				Currency:        "USD",
				Merchant:        "Coffee",
				CapturedAt:      10,
				Source:          "shortcut",
				CreatedAt:       10,
				UpdatedAt:       10,
				ClientUpdatedAt: 10,
			}); err != nil {
				t.Fatalf("seed wallet suggestion: %v", err)
			}

			_, err := s.Push(ctx, PushRequest{
				WalletSuggestions: []PushWalletSuggestion{
					{
						ID:              "suggestion-1",
						Status:          tt.status,
						LinkedExpenseID: tt.linkedExpenseID,
						ClientUpdatedAt: 20,
					},
				},
			})
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("expected %q error, got %v", tt.wantErr, err)
			}
		})
	}
}

func ptrString(v string) *string {
	return &v
}
