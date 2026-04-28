package api

import (
	"log/slog"
	"net/http"
	"strconv"

	"expense-tracker/internal/app"
	"expense-tracker/internal/service"
	"expense-tracker/internal/wideevent"
)

func syncPull(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sinceStr := r.URL.Query().Get("since")
		var since int64
		if sinceStr != "" {
			var err error
			since, err = strconv.ParseInt(sinceStr, 10, 64)
			if err != nil {
				writeError(w, r, http.StatusBadRequest, "invalid since parameter")
				return
			}
		}

		resp, err := a.SyncService.Pull(r.Context(), since)
		if err != nil {
			wideevent.Error(r.Context(), "sync.pull.failed",
				slog.Int64("since", since),
				slog.Any("error", err),
			)
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, resp)
	}
}

func syncPush(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req service.PushRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}

		resp, err := a.SyncService.Push(r.Context(), req)
		if err != nil {
			wideevent.Error(r.Context(), "sync.push.failed",
				slog.Int("categories", len(req.Categories)),
				slog.Int("expenses", len(req.Expenses)),
				slog.Int("recurring_expenses", len(req.RecurringExpenses)),
				slog.Any("error", err),
			)
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, resp)
	}
}
