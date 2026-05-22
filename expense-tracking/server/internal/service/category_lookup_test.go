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

func TestExpenseService_CreateRejectsInactiveCategoryID(t *testing.T) {
	s := newTestSyncService(t)
	deletedAt := int64(300)
	seedCategory(t, s.queries, "c1", "Food", "🍕", nil, 100, &deletedAt)

	svc := NewExpenseService(s.queries, &config.Preferences{Currency: "USD"})
	_, err := svc.CreateWithQueries(context.Background(), s.queries, ExpenseInput{
		Amount:     100,
		CategoryID: "c1",
	})
	if err == nil || !strings.Contains(err.Error(), `category "c1" not found`) {
		t.Fatalf("expected inactive category error, got %v", err)
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

func TestExpenseService_UpdateRejectsInactiveCategoryID(t *testing.T) {
	s := newTestSyncService(t)
	deletedAt := int64(300)
	seedCategory(t, s.queries, "active", "Travel", "✈️", nil, 50, nil)
	seedCategory(t, s.queries, "deleted", "Food", "🍕", nil, 100, &deletedAt)

	_, err := s.queries.CreateExpense(context.Background(), dbsqlc.CreateExpenseParams{
		ID:         "e1",
		Amount:     100,
		Currency:   "USD",
		CategoryID: "active",
		Date:       123,
		Source:     "cli",
		CreatedAt:  123,
		UpdatedAt:  123,
	})
	if err != nil {
		t.Fatalf("seed expense: %v", err)
	}

	svc := NewExpenseService(s.queries, &config.Preferences{Currency: "USD"})
	_, err = svc.Update(context.Background(), "e1", ExpenseInput{CategoryID: "deleted"})
	if err == nil || !strings.Contains(err.Error(), `category "deleted" not found`) {
		t.Fatalf("expected inactive category error, got %v", err)
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

func TestRecurringService_CreateRejectsInactiveCategoryID(t *testing.T) {
	s := newTestSyncService(t)
	deletedAt := int64(300)
	seedCategory(t, s.queries, "c1", "Food", "🍕", nil, 100, &deletedAt)

	svc := NewRecurringService(s.queries, s.tx, "UTC")
	_, err := svc.CreateWithQueries(context.Background(), s.queries, RecurringExpenseInput{
		Amount:     100,
		Currency:   "USD",
		CategoryID: "c1",
		Frequency:  "monthly",
		StartDate:  123,
	})
	if err == nil || !strings.Contains(err.Error(), `category "c1" not found`) {
		t.Fatalf("expected inactive category error, got %v", err)
	}
}

func TestRecurringService_UpdateRejectsInactiveCategoryID(t *testing.T) {
	s := newTestSyncService(t)
	deletedAt := int64(300)
	seedCategory(t, s.queries, "active", "Travel", "✈️", nil, 50, nil)
	seedCategory(t, s.queries, "deleted", "Food", "🍕", nil, 100, &deletedAt)

	err := s.queries.CreateRecurringExpense(context.Background(), dbsqlc.CreateRecurringExpenseParams{
		ID:              "r1",
		Amount:          100,
		Currency:        "USD",
		CategoryID:      "active",
		Frequency:       "monthly",
		StartDate:       123,
		NextRunDate:     123,
		CreatedAt:       123,
		UpdatedAt:       123,
		ClientUpdatedAt: 123,
	})
	if err != nil {
		t.Fatalf("seed recurring expense: %v", err)
	}

	svc := NewRecurringService(s.queries, s.tx, "UTC")
	_, err = svc.Update(context.Background(), "r1", RecurringExpenseInput{CategoryID: "deleted"})
	if err == nil || !strings.Contains(err.Error(), `category "deleted" not found`) {
		t.Fatalf("expected inactive category error, got %v", err)
	}
}
