package app

import (
	"context"
	"database/sql"
	"fmt"

	dbmigrations "expense-tracker/db"
	"expense-tracker/internal/config"
	"expense-tracker/internal/repository"
	dbsqlc "expense-tracker/internal/repository/sqlc"
	"expense-tracker/internal/service"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

type Services struct {
	Expenses   *service.ExpenseService
	Categories *service.CategoryService
	Reports    *service.ReportService
	Sync       *service.SyncService
	Recurring  *service.RecurringService
}

type App struct {
	db              *sql.DB
	store           *repository.Store
	preferences     config.Preferences
	preferencesPath string
	services        Services
}

func Open(dbPath, configPath string) (*App, error) {
	// Load preferences
	prefs, err := config.LoadPreferences(configPath)
	if err != nil {
		return nil, fmt.Errorf("loading preferences: %w", err)
	}

	// Open SQLite
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)")
	if err != nil {
		return nil, fmt.Errorf("opening database: %w", err)
	}

	// Run migrations using goose with embedded SQL
	if err := runMigrations(db); err != nil {
		return nil, fmt.Errorf("running migrations: %w", err)
	}

	store := repository.NewStore(db)
	queries := store.Queries()

	categoryService := service.NewCategoryService(queries)
	expenseService := service.NewExpenseService(queries, &prefs)
	reportService := service.NewReportService(queries, &prefs)
	recurringService := service.NewRecurringService(queries, store, prefs.Timezone)
	syncService := service.NewSyncService(queries, store, prefs.Timezone)

	app := &App{
		db:              db,
		store:           store,
		preferences:     prefs,
		preferencesPath: configPath,
		services: Services{
			Expenses:   expenseService,
			Categories: categoryService,
			Reports:    reportService,
			Sync:       syncService,
			Recurring:  recurringService,
		},
	}

	// Seed default categories
	if err := categoryService.EnsureDefaults(context.Background()); err != nil {
		return nil, fmt.Errorf("seeding categories: %w", err)
	}

	return app, nil
}

func (a *App) Close() error {
	return a.db.Close()
}

func (a *App) WithTx(ctx context.Context, fn func(*dbsqlc.Queries) error) error {
	return a.store.WithTx(ctx, fn)
}

func (a *App) Services() Services {
	return a.services
}

func (a *App) GetPreferences() config.Preferences {
	return a.preferences
}

func (a *App) SavePreferences(p config.Preferences) error {
	if err := config.SavePreferences(a.preferencesPath, p); err != nil {
		return err
	}
	return a.reloadPreferences()
}

func (a *App) reloadPreferences() error {
	p, err := config.LoadPreferences(a.preferencesPath)
	if err != nil {
		return err
	}
	a.preferences = p
	a.services.Expenses.UpdatePreferences(&p)
	a.services.Reports.UpdatePreferences(&p)
	a.services.Sync.UpdateTimezone(p.Timezone)
	a.services.Recurring.UpdateTimezone(p.Timezone)
	return nil
}

func runMigrations(db *sql.DB) error {
	goose.SetBaseFS(dbmigrations.Migrations)
	if err := goose.SetDialect("sqlite3"); err != nil {
		return err
	}
	return goose.Up(db, "migrations")
}
