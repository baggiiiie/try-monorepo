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

type App struct {
	DB               *sql.DB
	Store            *repository.Store
	Queries          *dbsqlc.Queries
	Preferences      config.Preferences
	PreferencesPath  string
	ExpenseService   *service.ExpenseService
	CategoryService  *service.CategoryService
	ReportService    *service.ReportService
	SyncService      *service.SyncService
	RecurringService *service.RecurringService
}

func Open(dbPath, configPath string) (*App, error) {
	// Load preferences
	prefs, err := config.LoadPreferences(configPath)
	if err != nil {
		return nil, fmt.Errorf("loading preferences: %w", err)
	}

	// Open SQLite
	db, err := sql.Open("sqlite", dbPath+"?_pragma=journal_mode(WAL)&_pragma=foreign_keys(1)")
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
	expenseService := service.NewExpenseService(queries, &prefs, configPath)
	reportService := service.NewReportService(queries, &prefs)
	recurringService := service.NewRecurringService(queries, prefs.Timezone)
	syncService := service.NewSyncService(store, prefs.Timezone)

	app := &App{
		DB:               db,
		Store:            store,
		Queries:          queries,
		Preferences:      prefs,
		PreferencesPath:  configPath,
		ExpenseService:   expenseService,
		CategoryService:  categoryService,
		ReportService:    reportService,
		SyncService:      syncService,
		RecurringService: recurringService,
	}

	// Seed default categories
	if err := categoryService.EnsureDefaults(context.Background()); err != nil {
		return nil, fmt.Errorf("seeding categories: %w", err)
	}

	return app, nil
}

func (a *App) Close() error {
	return a.DB.Close()
}

func (a *App) ReloadPreferences() error {
	p, err := config.LoadPreferences(a.PreferencesPath)
	if err != nil {
		return err
	}
	a.Preferences = p
	a.ExpenseService.UpdatePreferences(&p)
	a.ReportService.UpdatePreferences(&p)
	a.SyncService.UpdateTimezone(p.Timezone)
	a.RecurringService.UpdateTimezone(p.Timezone)
	return nil
}

func runMigrations(db *sql.DB) error {
	goose.SetBaseFS(dbmigrations.Migrations)
	if err := goose.SetDialect("sqlite3"); err != nil {
		return err
	}
	return goose.Up(db, "migrations")
}
