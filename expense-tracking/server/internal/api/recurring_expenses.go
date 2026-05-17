package api

import (
	"net/http"

	"expense-tracker/internal/service"

	"github.com/go-chi/chi/v5"
)

type createRecurringExpenseRequest struct {
	Amount      int64  `json:"amount"`
	Currency    string `json:"currency"`
	CategoryID  string `json:"category_id"`
	Category    string `json:"category"`
	Description string `json:"description"`
	Merchant    string `json:"merchant"`
	Frequency   string `json:"frequency"`
	DayOfMonth  *int64 `json:"day_of_month"`
	StartDate   int64  `json:"start_date"`
	EndDate     *int64 `json:"end_date"`
}

type updateRecurringExpenseRequest struct {
	Amount      *int64  `json:"amount"`
	Currency    *string `json:"currency"`
	CategoryID  *string `json:"category_id"`
	Category    *string `json:"category"`
	Description *string `json:"description"`
	Merchant    *string `json:"merchant"`
	Frequency   *string `json:"frequency"`
	DayOfMonth  *int64  `json:"day_of_month"`
	StartDate   *int64  `json:"start_date"`
	EndDate     *int64  `json:"end_date"`
}

func listRecurringExpenses(recurring RecurringService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		rows, err := recurring.List(r.Context())
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"recurring_expenses": rows,
			"count":              len(rows),
		})
	}
}

func createRecurringExpense(recurring RecurringService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req createRecurringExpenseRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}

		row, err := recurring.Create(r.Context(), service.RecurringExpenseInput{
			Amount:      req.Amount,
			Currency:    req.Currency,
			CategoryID:  req.CategoryID,
			Category:    req.Category,
			Description: req.Description,
			Merchant:    req.Merchant,
			Frequency:   req.Frequency,
			DayOfMonth:  req.DayOfMonth,
			StartDate:   req.StartDate,
			EndDate:     req.EndDate,
		})
		if err != nil {
			writeError(w, r, http.StatusUnprocessableEntity, err.Error())
			return
		}
		writeJSON(w, http.StatusCreated, row)
	}
}

func updateRecurringExpense(recurring RecurringService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")

		var req updateRecurringExpenseRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}

		input := service.RecurringExpenseInput{}
		if req.Amount != nil {
			input.Amount = *req.Amount
		}
		if req.Currency != nil {
			input.Currency = *req.Currency
		}
		if req.CategoryID != nil {
			input.CategoryID = *req.CategoryID
		}
		if req.Category != nil {
			input.Category = *req.Category
		}
		if req.Description != nil {
			input.Description = *req.Description
		}
		if req.Merchant != nil {
			input.Merchant = *req.Merchant
		}
		if req.Frequency != nil {
			input.Frequency = *req.Frequency
		}
		if req.DayOfMonth != nil {
			input.DayOfMonth = req.DayOfMonth
		}
		if req.StartDate != nil {
			input.StartDate = *req.StartDate
		}
		if req.EndDate != nil {
			input.EndDate = req.EndDate
		}

		row, err := recurring.Update(r.Context(), id, input)
		if err != nil {
			if err.Error() == "recurring expense not found" {
				writeError(w, r, http.StatusNotFound, err.Error())
				return
			}
			writeError(w, r, http.StatusUnprocessableEntity, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, row)
	}
}

func deleteRecurringExpense(recurring RecurringService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := chi.URLParam(r, "id")
		if err := recurring.Delete(r.Context(), id); err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}
