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

type stubWalletSuggestionService struct {
	createdInput service.WalletSuggestionInput
	listStatus   string
	confirmID    string
	confirmInput service.ExpenseInput
	dismissID    string
	rows         []service.WalletSuggestion
}

func (s *stubWalletSuggestionService) Create(_ context.Context, input service.WalletSuggestionInput) (*service.WalletSuggestion, error) {
	s.createdInput = input
	return &service.WalletSuggestion{ID: input.ID, Amount: input.Amount, Currency: input.Currency, Merchant: input.Merchant, CapturedAt: input.CapturedAt, Source: input.Source, Status: "pending"}, nil
}

func (s *stubWalletSuggestionService) List(_ context.Context, status string) ([]service.WalletSuggestion, error) {
	s.listStatus = status
	return s.rows, nil
}

func (s *stubWalletSuggestionService) Confirm(_ context.Context, id string, input service.ExpenseInput) (*service.WalletSuggestion, *service.Expense, error) {
	s.confirmID = id
	s.confirmInput = input
	linkedID := input.ID
	return &service.WalletSuggestion{ID: id, Status: "accepted", LinkedExpenseID: &linkedID}, &service.Expense{ID: input.ID, Amount: input.Amount, Currency: input.Currency, CategoryID: input.CategoryID, Merchant: input.Merchant, Date: input.Date, Source: input.Source}, nil
}

func (s *stubWalletSuggestionService) Dismiss(_ context.Context, id string) (*service.WalletSuggestion, error) {
	s.dismissID = id
	return &service.WalletSuggestion{ID: id, Status: "dismissed"}, nil
}

func TestWalletSuggestionHandlers(t *testing.T) {
	amount := int64(2199)
	wallet := &stubWalletSuggestionService{
		rows: []service.WalletSuggestion{{ID: "ws-1", Amount: &amount, Currency: "USD", Merchant: "Cafe", CapturedAt: 100, Source: "shortcut", Status: "pending"}},
	}
	router := NewRouter(RouterServices{WalletSuggestions: wallet}, "")

	body := bytes.NewBufferString(`{"id":"ws-1","merchant":"Cafe","amount":2199,"currency":"USD","captured_at":100,"source":"shortcut","client_updated_at":101}`)
	req := httptest.NewRequest(http.MethodPost, "/api/wallet-suggestions", body)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d (%s)", rec.Code, rec.Body.String())
	}
	if wallet.createdInput.ID != "ws-1" || wallet.createdInput.Amount == nil || *wallet.createdInput.Amount != 2199 {
		t.Fatalf("create input not decoded: %+v", wallet.createdInput)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/wallet-suggestions?status=pending", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("list: expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	var listed struct {
		WalletSuggestions []service.WalletSuggestion `json:"wallet_suggestions"`
		Count             int                        `json:"count"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &listed); err != nil {
		t.Fatalf("list decode: %v", err)
	}
	if wallet.listStatus != "pending" || listed.Count != 1 || listed.WalletSuggestions[0].ID != "ws-1" {
		t.Fatalf("list did not use status/shape correctly: status=%q body=%+v", wallet.listStatus, listed)
	}

	body = bytes.NewBufferString(`{"id":"exp-1","amount":2199,"currency":"USD","category_id":"cat-1","merchant":"Cafe","date":100,"client_updated_at":102}`)
	req = httptest.NewRequest(http.MethodPost, "/api/wallet-suggestions/ws-1/confirm", body)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm: expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if wallet.confirmID != "ws-1" || wallet.confirmInput.ID != "exp-1" || wallet.confirmInput.Source != "wallet_suggestion" {
		t.Fatalf("confirm input not decoded: id=%q input=%+v", wallet.confirmID, wallet.confirmInput)
	}
	var confirmed struct {
		WalletSuggestion service.WalletSuggestion `json:"wallet_suggestion"`
		Expense          service.Expense          `json:"expense"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &confirmed); err != nil {
		t.Fatalf("confirm decode: %v", err)
	}
	if confirmed.WalletSuggestion.Status != "accepted" || confirmed.Expense.ID != "exp-1" {
		t.Fatalf("confirm response: %+v", confirmed)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/wallet-suggestions/ws-1/dismiss", nil)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("dismiss: expected 200, got %d (%s)", rec.Code, rec.Body.String())
	}
	if wallet.dismissID != "ws-1" {
		t.Fatalf("dismiss id: expected ws-1, got %q", wallet.dismissID)
	}
}
