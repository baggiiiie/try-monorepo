package api

import (
	"log/slog"
	"net/http"
	"strconv"

	"expense-tracker/internal/service"
	"expense-tracker/internal/wideevent"
)

func syncPull(sync SyncService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sinceStr := r.URL.Query().Get("since")
		var sinceVersion int64
		if sinceStr != "" {
			var err error
			sinceVersion, err = strconv.ParseInt(sinceStr, 10, 64)
			if err != nil {
				writeError(w, r, http.StatusBadRequest, "invalid since parameter")
				return
			}
		}
		wideevent.AddAttrs(r.Context(), slog.Int64("since_version", sinceVersion))

		resp, err := sync.Pull(r.Context(), sinceVersion)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		wideevent.AddAttrs(r.Context(),
			slog.Int("expenses_pulled", len(resp.Expenses)),
			slog.Int("categories_pulled", len(resp.Categories)),
			slog.Int("recurring_expenses_pulled", len(resp.RecurringExpenses)),
			slog.Int64("server_version", resp.ServerVersion),
		)
		writeJSON(w, http.StatusOK, resp)
	}
}

func syncPush(sync SyncService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req service.PushRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}
		wideevent.AddAttrs(r.Context(),
			slog.Int("categories_pushed", len(req.Categories)),
			slog.Int("expenses_pushed", len(req.Expenses)),
			slog.Int("recurring_expenses_pushed", len(req.RecurringExpenses)),
		)

		resp, err := sync.Push(r.Context(), req)
		if err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		wideevent.AddAttrs(r.Context(), slog.Int64("server_version", resp.ServerVersion))
		writeJSON(w, http.StatusOK, resp)
	}
}
