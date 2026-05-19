package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"expense-tracker/internal/service"
)

type stubRecurringService struct {
	createdInput service.RecurringExpenseInput
	updatedID    string
	updatedInput service.RecurringExpenseInput
	deletedID    string
	rows         []service.RecurringExpense
}

func (s *stubRecurringService) Create(_ context.Context, input service.RecurringExpenseInput) (*service.RecurringExpense, error) {
	s.createdInput = input
	return &service.RecurringExpense{ID: "rec-1", Amount: input.Amount, Currency: input.Currency, CategoryID: input.CategoryID, Frequency: input.Frequency, StartDate: input.StartDate, NextRunDate: input.StartDate}, nil
}

func (s *stubRecurringService) List(context.Context) ([]service.RecurringExpense, error) {
	return s.rows, nil
}

func (s *stubRecurringService) Update(_ context.Context, id string, input service.RecurringExpenseInput) (*service.RecurringExpense, error) {
	s.updatedID = id
	s.updatedInput = input
	return &service.RecurringExpense{ID: id, Amount: input.Amount, Currency: input.Currency, CategoryID: input.CategoryID, Frequency: input.Frequency, StartDate: input.StartDate, NextRunDate: input.StartDate}, nil
}

func (s *stubRecurringService) Delete(_ context.Context, id string) error {
	s.deletedID = id
	return nil
}

func TestRecurringExpenseHandlers(t *testing.T) {
	recurring := &stubRecurringService{
		rows: []service.RecurringExpense{{ID: "rec-1", Amount: 1200, Currency: "USD", CategoryID: "cat-1", Frequency: "monthly", StartDate: 100, NextRunDate: 100}},
	}
	router := NewRouter(RouterServices{Recurring: recurring}, "")

	body := bytes.NewBufferString(`{"amount":1200,"currency":"USD","category_id":"cat-1","frequency":"monthly","start_date":100}`)
	req := httptest.NewRequest(http.MethodPost, "/api/recurring-expenses", body)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	if recurring.createdInput.Amount != 1200 || recurring.createdInput.Frequency != "monthly" {
		t.Fatalf("create input not decoded: %+v", recurring.createdInput)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/recurring-expenses", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var listed struct {
		RecurringExpenses []service.RecurringExpense `json:"recurring_expenses"`
		Count             int                        `json:"count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("list decode: %v", err)
	}
	if listed.Count != 1 || listed.RecurringExpenses[0].ID != "rec-1" {
		t.Fatalf("list response: %+v", listed)
	}

	body = bytes.NewBufferString(`{"amount":1500,"currency":"USD","category_id":"cat-2","frequency":"weekly","start_date":200}`)
	req = httptest.NewRequest(http.MethodPut, "/api/recurring-expenses/rec-1", body)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("update: expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if recurring.updatedID != "rec-1" || recurring.updatedInput.CategoryID != "cat-2" {
		t.Fatalf("update input not decoded: id=%q input=%+v", recurring.updatedID, recurring.updatedInput)
	}

	req = httptest.NewRequest(http.MethodDelete, "/api/recurring-expenses/rec-1", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("delete: expected 204, got %d (%s)", rec.Code, rec.Body.String())
	}
	if recurring.deletedID != "rec-1" {
		t.Fatalf("delete id: expected rec-1, got %q", recurring.deletedID)
	}
}
