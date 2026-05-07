package api

import (
	"net/http"

	"expense-tracker/internal/service"

	"github.com/go-chi/chi/v5"
)

type createExpenseRequest struct {
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	CategoryID  string `json:"category_id"`
	Merchant    string `json:"merchant"`
	Description string `json:"description"`
	Date        int64  `json:"date"`
}

type updateExpenseRequest struct {
	Amount      *int64  `json:"amount"`
	Currency    *string `json:"currency"`
	CategoryID  *string `json:"category_id"`
	Merchant    *string `json:"merchant"`
	Description *string `json:"description"`
	Date        *int64  `json:"date"`
}

func createExpense(expenses ExpenseService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createExpenseRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}

		exp, err := expenses.Create(r.Context(), service.ExpenseInput{
			Amount:      req.Amount,
			Currency:    req.Currency,
			CategoryID:  req.CategoryID,
			Description: req.Description,
			Merchant:    req.Merchant,
			Date:        req.Date,
		})
		if err != nil {
			writeError(w, r, http.StatusUnprocessableEntity, err.Error())
			return
		}

		writeJSON(w, http.StatusCreated, exp)
	}
}

func listExpenses(expenses ExpenseService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		expenses, err := expenses.List(r.Context())
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, map[string]interface{}{
			"expenses": expenses,
			"count":    len(expenses),
		})
	}
}

func getExpense(expenses ExpenseService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		exp, err := expenses.Get(r.Context(), id)
		if err != nil {
			if err.Error() == "expense not found" {
				writeError(w, r, http.StatusNotFound, err.Error())
				return
			}
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, exp)
	}
}

func updateExpense(expenses ExpenseService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		var req updateExpenseRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}

		input := service.ExpenseInput{}
		if req.Amount != nil {
			input.Amount = *req.Amount
		}
		if req.Currency != nil {
			input.Currency = *req.Currency
		}
		if req.CategoryID != nil {
			input.CategoryID = *req.CategoryID
		}
		if req.Description != nil {
			input.Description = *req.Description
		}
		if req.Merchant != nil {
			input.Merchant = *req.Merchant
		}
		if req.Date != nil {
			input.Date = *req.Date
		}

		exp, err := expenses.Update(r.Context(), id, input)
		if err != nil {
			if err.Error() == "expense not found" {
				writeError(w, r, http.StatusNotFound, err.Error())
				return
			}
			writeError(w, r, http.StatusUnprocessableEntity, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, exp)
	}
}

func deleteExpense(expenses ExpenseService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		if err := expenses.Delete(r.Context(), id); err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		w.WriteHeader(http.StatusNoContent)
	}
}
