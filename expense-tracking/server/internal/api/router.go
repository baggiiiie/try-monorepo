package api

import (
	"net/http"

	"expense-tracker/internal/app"

	"github.com/go-chi/chi/v5"
)

func NewRouter(a *app.App) http.Handler {
	r := chi.NewRouter()
	r.Use(observabilityMiddleware)

	r.Get("/api/health", healthHandler)

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

	return r
}
