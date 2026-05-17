package api

import (
	"errors"
	"net/http"

	"expense-tracker/internal/service"

	"github.com/go-chi/chi/v5"
)

type walletSuggestionRequest struct {
	ID              string  `json:"id"`
	Merchant        string  `json:"merchant"`
	Amount          *int64  `json:"amount"`
	Currency        string  `json:"currency"`
	CapturedAt      int64   `json:"captured_at"`
	CardName        *string `json:"card_name"`
	Source          string  `json:"source"`
	ClientUpdatedAt int64   `json:"client_updated_at"`
}
type confirmWalletSuggestionRequest struct {
	ID              string `json:"id"`
	Amount          int64  `json:"amount"`
	Currency        string `json:"currency"`
	CategoryID      string `json:"category_id"`
	Category        string `json:"category"`
	Description     string `json:"description"`
	Merchant        string `json:"merchant"`
	Date            int64  `json:"date"`
	ClientUpdatedAt int64  `json:"client_updated_at"`
}

func createWalletSuggestion(wallet WalletSuggestionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req walletSuggestionRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}
		row, err := wallet.Create(r.Context(), service.WalletSuggestionInput{ID: req.ID, Amount: req.Amount, Currency: req.Currency, Merchant: req.Merchant, CardName: req.CardName, CapturedAt: req.CapturedAt, Source: req.Source, ClientUpdatedAt: req.ClientUpdatedAt})
		if err != nil {
			writeError(w, r, http.StatusUnprocessableEntity, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, row)
	}
}
func listWalletSuggestions(wallet WalletSuggestionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := wallet.List(r.Context(), r.URL.Query().Get("status"))
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"wallet_suggestions": rows, "count": len(rows)})
	}
}
func confirmWalletSuggestion(wallet WalletSuggestionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		var req confirmWalletSuggestionRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}
		suggestion, expense, err := wallet.Confirm(r.Context(), id, service.ExpenseInput{ID: req.ID, Amount: req.Amount, Currency: req.Currency, CategoryID: req.CategoryID, Category: req.Category, Description: req.Description, Merchant: req.Merchant, Date: req.Date, Source: "wallet_suggestion", ClientUpdatedAt: req.ClientUpdatedAt})
		if err != nil {
			writeWalletSuggestionError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{"wallet_suggestion": suggestion, "expense": expense})
	}
}
func dismissWalletSuggestion(wallet WalletSuggestionService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		row, err := wallet.Dismiss(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			writeWalletSuggestionError(w, r, err)
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

func writeWalletSuggestionError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, service.ErrWalletSuggestionNotFound):
		writeError(w, r, http.StatusNotFound, err.Error())
	case errors.Is(err, service.ErrWalletSuggestionNotPending):
		writeError(w, r, http.StatusConflict, err.Error())
	default:
		writeError(w, r, http.StatusUnprocessableEntity, err.Error())
	}
}
