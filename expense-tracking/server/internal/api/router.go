package api

import (
	"net/http"

	"expense-tracker/internal/app"
	"expense-tracker/internal/auth"

	"github.com/go-chi/chi/v5"
)

// NewRouter builds the HTTP API router. The syncSecret is required on every
// /api/* route except /api/health; pass an empty string only in tests that
// stub out auth.
func NewRouter(a *app.App, syncSecret string) http.Handler {
	r := chi.NewRouter()
	r.Use(observabilityMiddleware)

	r.Get("/api/health", healthHandler)

	r.Group(func(r chi.Router) {
		if syncSecret != "" {
			r.Use(auth.Middleware(syncSecret, writeError))
		}

		r.Route("/api/expenses", func(r chi.Router) {
			r.Post("/", createExpense(a))
			r.Get("/", listExpenses(a))
			r.Get("/{id}", getExpense(a))
			r.Put("/{id}", updateExpense(a))
			r.Delete("/{id}", deleteExpense(a))
		})

		r.Route("/api/categories", func(r chi.Router) {
			r.Post("/", createCategory(a))
			r.Get("/", listCategories(a))
			r.Put("/{id}", updateCategory(a))
			r.Delete("/{id}", deleteCategory(a))
		})

		r.Get("/api/preferences", getPreferences(a))
		r.Put("/api/preferences", updatePreferences(a))

		r.Get("/api/sync/pull", syncPull(a))
		r.Post("/api/sync/push", syncPush(a))
	})

	return r
}
