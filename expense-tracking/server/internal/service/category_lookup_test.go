package service

import (
	"context"
	"strings"
	"testing"

	"expense-tracker/internal/config"
	dbsqlc "expense-tracker/internal/repository/sqlc"
)

func TestExpenseService_CreateRejectsAmbiguousCategoryName(t *testing.T) {
	s := newTestSyncService(t)
	seedCategory(t, s.queries, "c1", "Food", "🍕", nil, 100, nil)
	seedCategory(t, s.queries, "c2", "Food", "🍔", nil, 200, nil)

	svc := NewExpenseService(s.queries, &config.Preferences{Currency: "USD"})
	_, err := svc.CreateWithQueries(context.Background(), s.queries, ExpenseInput{
		Amount:   100,
		Category: "Food",
	})
	if err == nil || !strings.Contains(err.Error(), `category "Food" is ambiguous`) {
		t.Fatalf("expected ambiguous category error, got %v", err)
	}
}

func TestExpenseService_UpdateRejectsAmbiguousCategoryName(t *testing.T) {
	s := newTestSyncService(t)
	seedCategory(t, s.queries, "c1", "Food", "🍕", nil, 100, nil)
	seedCategory(t, s.queries, "c2", "Food", "🍔", nil, 200, nil)
	seedCategory(t, s.queries, "other", "Travel", "✈️", nil, 50, nil)

	_, err := s.queries.CreateExpense(context.Background(), dbsqlc.CreateExpenseParams{
		ID:         "e1",
		Amount:     100,
		Currency:   "USD",
		CategoryID: "other",
		Date:       123,
		Source:     "cli",
		CreatedAt:  123,
		UpdatedAt:  123,
	})
	if err != nil {
		t.Fatalf("seed expense: %v", err)
	}

	svc := NewExpenseService(s.queries, &config.Preferences{Currency: "USD"})
	_, err = svc.Update(context.Background(), "e1", ExpenseInput{Category: "Food"})
	if err == nil || !strings.Contains(err.Error(), `category "Food" is ambiguous`) {
		t.Fatalf("expected ambiguous category error, got %v", err)
	}
}

func TestRecurringService_CreateRejectsAmbiguousCategoryName(t *testing.T) {
	s := newTestSyncService(t)
	seedCategory(t, s.queries, "c1", "Food", "🍕", nil, 100, nil)
	seedCategory(t, s.queries, "c2", "Food", "🍔", nil, 200, nil)

	svc := NewRecurringService(s.queries, s.tx, "UTC")
	_, err := svc.CreateWithQueries(context.Background(), s.queries, RecurringExpenseInput{
		Amount:    100,
		Currency:  "USD",
		Category:  "Food",
		Frequency: "monthly",
		StartDate: 123,
	})
	if err == nil || !strings.Contains(err.Error(), `category "Food" is ambiguous`) {
		t.Fatalf("expected ambiguous category error, got %v", err)
	}
}
