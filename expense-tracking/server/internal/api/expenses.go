package api

import (
	"net/http"
	"strconv"
	"time"

	"expense-tracker/internal/service"

	"github.com/go-chi/chi/v5"
)

// expenseListDefaults bound the PWA's expense feed in two ways:
//   - defaultWindow caps the initial page to the last week so the first paint
//     is cheap; the client uses the returned cursor to load older history on
//     demand.
//   - defaultLimit / maxLimit cap the response size regardless of how far
//     back the caller scrolls, so a malformed cursor cannot drag down the
//     whole feed.
const (
	expenseDefaultWindow = 7 * 24 * time.Hour
	expenseDefaultLimit  = 100
	expenseMaxLimit      = 500
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

// listExpenses serves the paginated expense feed for the PWA.
//
// Query parameters:
//   - before: exclusive upper bound on expense date (unix seconds). Used as
//     the cursor when scrolling back through history. Omit on the first
//     page; the server then defaults to "newer than 7 days ago".
//   - limit: page size. Defaults to expenseDefaultLimit, capped at
//     expenseMaxLimit.
//
// The response includes a next_before cursor whenever the page filled
// exactly to the limit — the client uses it verbatim as the before parameter
// on the next request. When fewer rows are returned the feed has reached
// the bottom and next_before is omitted.
func listExpenses(expenses ExpenseService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		now := time.Now()

		var (
			before    int64
			since     int64
			explicit  = q.Has("before")
		)
		if explicit {
			parsed, err := strconv.ParseInt(q.Get("before"), 10, 64)
			if err != nil || parsed <= 0 {
				writeError(w, r, http.StatusBadRequest, "invalid 'before' parameter")
				return
			}
			before = parsed
			// When a cursor is supplied the caller is explicitly walking
			// older history; do not also apply the 7-day floor.
			since = 0
		} else {
			// Half-open upper bound so a row recorded at exactly `now` is
			// included on the first page.
			before = now.Unix() + 1
			since = now.Add(-expenseDefaultWindow).Unix()
		}

		limit := expenseDefaultLimit
		if raw := q.Get("limit"); raw != "" {
			parsed, err := strconv.Atoi(raw)
			if err != nil || parsed <= 0 {
				writeError(w, r, http.StatusBadRequest, "invalid 'limit' parameter")
				return
			}
			if parsed > expenseMaxLimit {
				parsed = expenseMaxLimit
			}
			limit = parsed
		}

		rows, err := expenses.ListWindow(r.Context(), service.ListWindowOptions{
			Before: before,
			Since:  since,
			Limit:  limit,
		})
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		resp := map[string]interface{}{
			"expenses": rows,
			"count":    len(rows),
		}
		// Only advertise a cursor when the page was full; otherwise the
		// client knows it has reached the end of the feed.
		if len(rows) == limit {
			resp["next_before"] = rows[len(rows)-1].Date
		}
		writeJSON(w, http.StatusOK, resp)
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
