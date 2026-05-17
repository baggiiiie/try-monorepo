package service_test

import (
	"errors"
	"testing"
	"time"

	"expense-tracker/internal/app"
	"expense-tracker/internal/service"
)

func TestWalletSuggestionConfirmCreatesExpenseAndAcceptsSuggestion(t *testing.T) {
	a, err := app.Open(t.TempDir()+"/test.db", t.TempDir()+"/prefs.json")
	if err != nil {
		t.Fatalf("open app: %v", err)
	}
	defer a.Close()
	services := a.Services()
	cats, err := services.Categories.List(t.Context())
	if err != nil {
		t.Fatalf("list categories: %v", err)
	}
	if len(cats) == 0 {
		t.Fatal("expected seeded categories")
	}
	amount := int64(1299)
	ws, err := services.WalletSuggestions.Create(t.Context(), service.WalletSuggestionInput{ID: "suggestion-1", Amount: &amount, Currency: "USD", Merchant: "Coffee", CapturedAt: time.Now().Unix(), Source: "shortcut"})
	if err != nil {
		t.Fatalf("create suggestion: %v", err)
	}
	if ws.Status != "pending" {
		t.Fatalf("status: got %q", ws.Status)
	}
	accepted, exp, err := services.WalletSuggestions.Confirm(t.Context(), "suggestion-1", service.ExpenseInput{ID: "expense-1", Amount: amount, Currency: "USD", CategoryID: cats[0].ID, Merchant: "Coffee", Date: time.Now().Unix()})
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}
	if exp.ID != "expense-1" {
		t.Fatalf("expense id: got %q", exp.ID)
	}
	if accepted.Status != "accepted" || accepted.LinkedExpenseID == nil || *accepted.LinkedExpenseID != exp.ID {
		t.Fatalf("accepted suggestion = %#v, expense = %#v", accepted, exp)
	}
	got, err := services.Expenses.Get(t.Context(), exp.ID)
	if err != nil {
		t.Fatalf("get created expense: %v", err)
	}
	if got.Merchant != "Coffee" || got.Amount != amount {
		t.Fatalf("created expense = %#v", got)
	}
}

func TestWalletSuggestionConfirmAlreadyAcceptedRollsBackExpense(t *testing.T) {
	a, err := app.Open(t.TempDir()+"/test.db", t.TempDir()+"/prefs.json")
	if err != nil {
		t.Fatalf("open app: %v", err)
	}
	defer a.Close()
	services := a.Services()
	cats, err := services.Categories.List(t.Context())
	if err != nil {
		t.Fatalf("list categories: %v", err)
	}
	amount := int64(1299)
	_, err = services.WalletSuggestions.Create(t.Context(), service.WalletSuggestionInput{ID: "suggestion-1", Amount: &amount, Currency: "USD", Merchant: "Coffee", CapturedAt: time.Now().Unix(), Source: "shortcut"})
	if err != nil {
		t.Fatalf("create suggestion: %v", err)
	}
	_, _, err = services.WalletSuggestions.Confirm(t.Context(), "suggestion-1", service.ExpenseInput{ID: "expense-1", Amount: amount, Currency: "USD", CategoryID: cats[0].ID, Merchant: "Coffee", Date: time.Now().Unix()})
	if err != nil {
		t.Fatalf("first confirm: %v", err)
	}

	_, _, err = services.WalletSuggestions.Confirm(t.Context(), "suggestion-1", service.ExpenseInput{ID: "expense-2", Amount: amount, Currency: "USD", CategoryID: cats[0].ID, Merchant: "Coffee", Date: time.Now().Unix()})
	if !errors.Is(err, service.ErrWalletSuggestionNotPending) {
		t.Fatalf("second confirm: expected ErrWalletSuggestionNotPending, got %v", err)
	}
	if _, err := services.Expenses.Get(t.Context(), "expense-2"); err == nil {
		t.Fatal("second confirm created an orphan expense")
	}
}

func TestWalletSuggestionDismissAlreadyAcceptedReturnsConflictError(t *testing.T) {
	a, err := app.Open(t.TempDir()+"/test.db", t.TempDir()+"/prefs.json")
	if err != nil {
		t.Fatalf("open app: %v", err)
	}
	defer a.Close()
	services := a.Services()
	cats, err := services.Categories.List(t.Context())
	if err != nil {
		t.Fatalf("list categories: %v", err)
	}
	amount := int64(1299)
	_, err = services.WalletSuggestions.Create(t.Context(), service.WalletSuggestionInput{ID: "suggestion-1", Amount: &amount, Currency: "USD", Merchant: "Coffee", CapturedAt: time.Now().Unix(), Source: "shortcut"})
	if err != nil {
		t.Fatalf("create suggestion: %v", err)
	}
	_, _, err = services.WalletSuggestions.Confirm(t.Context(), "suggestion-1", service.ExpenseInput{ID: "expense-1", Amount: amount, Currency: "USD", CategoryID: cats[0].ID, Merchant: "Coffee", Date: time.Now().Unix()})
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	_, err = services.WalletSuggestions.Dismiss(t.Context(), "suggestion-1")
	if !errors.Is(err, service.ErrWalletSuggestionNotPending) {
		t.Fatalf("dismiss accepted: expected ErrWalletSuggestionNotPending, got %v", err)
	}
}
