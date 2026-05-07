package cli

import (
	"context"

	"expense-tracker/internal/app"
	"expense-tracker/internal/config"
	dbsqlc "expense-tracker/internal/repository/sqlc"
	"expense-tracker/internal/service"
)

type runtime struct {
	Preferences      config.Preferences
	ExpenseService   *service.ExpenseService
	CategoryService  *service.CategoryService
	ReportService    *service.ReportService
	SyncService      *service.SyncService
	RecurringService *service.RecurringService

	app *app.App
}

func newRuntime(a *app.App) *runtime {
	services := a.Services()
	return &runtime{
		Preferences:      a.GetPreferences(),
		ExpenseService:   services.Expenses,
		CategoryService:  services.Categories,
		ReportService:    services.Reports,
		SyncService:      services.Sync,
		RecurringService: services.Recurring,
		app:              a,
	}
}

func (r *runtime) Close() error { return r.app.Close() }

func (r *runtime) GetPreferences() config.Preferences {
	return r.Preferences
}

func (r *runtime) WithTx(ctx context.Context, fn func(*dbsqlc.Queries) error) error {
	return r.app.WithTx(ctx, fn)
}

func (r *runtime) SavePreferences(p config.Preferences) error {
	if err := r.app.SavePreferences(p); err != nil {
		return err
	}
	r.Preferences = r.app.GetPreferences()
	return nil
}
