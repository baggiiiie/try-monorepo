package api

import (
	"context"
	"net/http"

	"expense-tracker/internal/auth"
	"expense-tracker/internal/config"
	"expense-tracker/internal/service"

	"github.com/go-chi/chi/v5"
)

type ExpenseService interface {
	Create(context.Context, service.ExpenseInput) (*service.Expense, error)
	List(context.Context) ([]service.Expense, error)
	Get(context.Context, string) (*service.Expense, error)
	Update(context.Context, string, service.ExpenseInput) (*service.Expense, error)
	Delete(context.Context, string) error
}

type CategoryService interface {
	Create(context.Context, service.CategoryInput) (*service.Category, error)
	List(context.Context) ([]service.Category, error)
	Update(context.Context, string, service.CategoryInput) (*service.Category, error)
	Delete(context.Context, string) error
}

type SyncService interface {
	Pull(context.Context, int64) (*service.PullResponse, error)
	Push(context.Context, service.PushRequest) (*service.PushResponse, error)
}

type PreferencesService interface {
	GetPreferences() config.Preferences
	SavePreferences(config.Preferences) error
}

type RouterServices struct {
	Expenses    ExpenseService
	Categories  CategoryService
	Sync        SyncService
	Preferences PreferencesService
}

// NewRouter builds the HTTP API router. The syncSecret is required on every
// /api/* route except /api/health; pass an empty string only in tests that
// stub out auth.
func NewRouter(services RouterServices, syncSecret string) http.Handler {
	r := chi.NewRouter()
	r.Use(observabilityMiddleware)

	r.Get("/api/health", healthHandler)

	r.Group(func(r chi.Router) {
		if syncSecret != "" {
			r.Use(auth.Middleware(syncSecret, writeError))
		}

		r.Route("/api/expenses", func(r chi.Router) {
			r.Post("/", createExpense(services.Expenses))
			r.Get("/", listExpenses(services.Expenses))
			r.Get("/{id}", getExpense(services.Expenses))
			r.Put("/{id}", updateExpense(services.Expenses))
			r.Delete("/{id}", deleteExpense(services.Expenses))
		})

		r.Route("/api/categories", func(r chi.Router) {
			r.Post("/", createCategory(services.Categories))
			r.Get("/", listCategories(services.Categories))
			r.Put("/{id}", updateCategory(services.Categories))
			r.Delete("/{id}", deleteCategory(services.Categories))
		})

		r.Get("/api/preferences", getPreferences(services.Preferences))
		r.Put("/api/preferences", updatePreferences(services.Preferences))

		r.Get("/api/sync/pull", syncPull(services.Sync))
		r.Post("/api/sync/push", syncPush(services.Sync))
	})

	return r
}
