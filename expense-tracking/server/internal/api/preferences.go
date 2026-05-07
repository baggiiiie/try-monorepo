package api

import "net/http"

func getPreferences(preferences PreferencesService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, preferences.GetPreferences())
	}
}

type updatePreferencesRequest struct {
	Currency   *string `json:"currency"`
	Timezone   *string `json:"timezone"`
	DateFormat *string `json:"date_format"`
}

func updatePreferences(preferences PreferencesService) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req updatePreferencesRequest
		if err := readJSON(r, &req); err != nil {
			writeError(w, r, http.StatusBadRequest, "invalid request body")
			return
		}

		prefs := preferences.GetPreferences()
		if req.Currency != nil {
			prefs.Currency = *req.Currency
		}
		if req.Timezone != nil {
			prefs.Timezone = *req.Timezone
		}
		if req.DateFormat != nil {
			prefs.DateFormat = *req.DateFormat
		}

		if err := preferences.SavePreferences(prefs); err != nil {
			writeError(w, r, http.StatusInternalServerError, err.Error())
			return
		}

		writeJSON(w, http.StatusOK, preferences.GetPreferences())
	}
}
