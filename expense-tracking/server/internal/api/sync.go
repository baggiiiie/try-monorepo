package api

import (
	"net/http"
	"strconv"

	"expense-tracker/internal/app"
	"expense-tracker/internal/service"
)

func syncPull(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sinceStr := r.URL.Query().Get("since")
		var since int64
		if sinceStr != "" {
			var err error
			since, err = strconv.ParseInt(sinceStr, 10, 64)
			if err != nil {
				writeError(w, http.StatusBadRequest, "invalid since parameter")
				return
			}
		}

		resp, err := a.SyncService.Pull(r.Context(), since)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, resp)
	}
}

func syncPush(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req service.PushRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		resp, err := a.SyncService.Push(r.Context(), req)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, resp)
	}
}
