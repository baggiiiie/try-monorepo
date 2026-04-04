package api

import (
	"net/http"

	"expense-tracker/internal/app"
	"expense-tracker/internal/config"
)

func getPreferences(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, a.Preferences)
	}
}

type updatePreferencesRequest struct {
	Currency   *string `json:"currency"`
	Timezone   *string `json:"timezone"`
	DateFormat *string `json:"date_format"`
}

func updatePreferences(a *app.App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req updatePreferencesRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, http.StatusBadRequest, "invalid request body")
			return
		}

		prefs := a.Preferences
		if req.Currency != nil {
			prefs.Currency = *req.Currency
		}
		if req.Timezone != nil {
			prefs.Timezone = *req.Timezone
		}
		if req.DateFormat != nil {
			prefs.DateFormat = *req.DateFormat
		}

		if err := config.SavePreferences(a.PreferencesPath, prefs); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		if err := a.ReloadPreferences(); err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, a.Preferences)
	}
}
