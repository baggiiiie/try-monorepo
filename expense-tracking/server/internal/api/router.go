package api

import (
	"context"
	"net/http"

	"expense-tracker/internal/config"
	"expense-tracker/internal/service"
	"expense-tracker/internal/singleusersecret"

	"github.com/go-chi/chi/v5"
)

type ExpenseService interface {
	Create(context.Context, service.ExpenseInput) (*service.Expense, error)
	List(context.Context) ([]service.Expense, error)
	ListWindow(context.Context, service.ListWindowOptions) ([]service.Expense, error)
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

type RecurringService interface {
	Create(context.Context, service.RecurringExpenseInput) (*service.RecurringExpense, error)
	List(context.Context) ([]service.RecurringExpense, error)
	Update(context.Context, string, service.RecurringExpenseInput) (*service.RecurringExpense, error)
	Delete(context.Context, string) error
}

type SyncService interface {
	Pull(context.Context, int64) (*service.PullResponse, error)
	Push(context.Context, service.PushRequest) (*service.PushResponse, error)
}

type WalletSuggestionService interface {
	Create(context.Context, service.WalletSuggestionInput) (*service.WalletSuggestion, error)
	List(context.Context, string) ([]service.WalletSuggestion, error)
	Confirm(context.Context, string, service.ExpenseInput) (*service.WalletSuggestion, *service.Expense, error)
	Dismiss(context.Context, string) (*service.WalletSuggestion, error)
}

type PreferencesService interface {
	GetPreferences() config.Preferences
	SavePreferences(config.Preferences) error
}

type RouterServices struct {
	Expenses          ExpenseService
	Categories        CategoryService
	Recurring         RecurringService
	Sync              SyncService
	Preferences       PreferencesService
	WalletSuggestions WalletSuggestionService
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
			r.Use(singleusersecret.Require(syncSecret, writeError))
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

		r.Route("/api/recurring-expenses", func(r chi.Router) {
			r.Post("/", createRecurringExpense(services.Recurring))
			r.Get("/", listRecurringExpenses(services.Recurring))
			r.Put("/{id}", updateRecurringExpense(services.Recurring))
			r.Delete("/{id}", deleteRecurringExpense(services.Recurring))
		})

		r.Get("/api/preferences", getPreferences(services.Preferences))
		r.Put("/api/preferences", updatePreferences(services.Preferences))

		r.Route("/api/wallet-suggestions", func(r chi.Router) {
			r.Post("/", createWalletSuggestion(services.WalletSuggestions))
			r.Get("/", listWalletSuggestions(services.WalletSuggestions))
			r.Post("/{id}/confirm", confirmWalletSuggestion(services.WalletSuggestions))
			r.Post("/{id}/dismiss", dismissWalletSuggestion(services.WalletSuggestions))
		})

		r.Post("/api/auth/exchange", authExchange())

		r.Get("/api/sync/pull", syncPull(services.Sync))
		r.Post("/api/sync/push", syncPush(services.Sync))
	})

	return r
}
