package cli

import (
	"context"

	"expense-tracker/internal/config"
	dbsqlc "expense-tracker/internal/repository/sqlc"
	"expense-tracker/internal/service"
)

type txRunner interface {
	WithTx(context.Context, func(*dbsqlc.Queries) error) error
}

type preferencesService interface {
	GetPreferences() config.Preferences
	SavePreferences(config.Preferences) error
}

type expenseCLIService interface {
	CreateWithQueries(context.Context, *dbsqlc.Queries, service.ExpenseInput) (*service.Expense, error)
	List(context.Context) ([]service.Expense, error)
	Get(context.Context, string) (*service.Expense, error)
	Update(context.Context, string, service.ExpenseInput) (*service.Expense, error)
	Delete(context.Context, string) error
}

type categoryCLIService interface {
	Create(context.Context, service.CategoryInput) (*service.Category, error)
	List(context.Context) ([]service.Category, error)
	Update(context.Context, string, service.CategoryInput) (*service.Category, error)
	Delete(context.Context, string) error
}

type reportCLIService interface {
	Summary(context.Context, string) (*service.SummaryResult, error)
	Budget(context.Context, string) (*service.BudgetResult, error)
}

type recurringCLIService interface {
	CreateWithQueries(context.Context, *dbsqlc.Queries, service.RecurringExpenseInput) (*service.RecurringExpense, error)
}

type txRunnerProvider func() txRunner

type preferencesServiceProvider func() preferencesService

type expenseServiceProvider func() expenseCLIService

type categoryServiceProvider func() categoryCLIService

type reportServiceProvider func() reportCLIService

type recurringServiceProvider func() recurringCLIService

type pathProvider func() (dbPath string, configPath string, secretPath string)
