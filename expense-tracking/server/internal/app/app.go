package app

import (
	"context"
	"database/sql"
	"fmt"

	"expense-tracker/internal/config"
	dbmigrations "expense-tracker/db"
	dbsqlc "expense-tracker/internal/repository/sqlc"
	"expense-tracker/internal/service"

	"github.com/pressly/goose/v3"
	_ "modernc.org/sqlite"
)

type App struct {
	DB              *sql.DB
	Queries         *dbsqlc.Queries
	Preferences     config.Preferences
	PreferencesPath string
	ExpenseService  *service.ExpenseService
	CategoryService *service.CategoryService
	ReportService   *service.ReportService
	SyncService     *service.SyncService
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

	queries := dbsqlc.New(db)

	categoryService := service.NewCategoryService(queries, db)
	expenseService := service.NewExpenseService(queries, db, &prefs, configPath)
	reportService := service.NewReportService(queries, &prefs)
	syncService := service.NewSyncService(queries, db)

	app := &App{
		DB:              db,
		Queries:         queries,
		Preferences:     prefs,
		PreferencesPath: configPath,
		ExpenseService:  expenseService,
		CategoryService: categoryService,
		ReportService:   reportService,
		SyncService:     syncService,
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
	return nil
}

func runMigrations(db *sql.DB) error {
	goose.SetBaseFS(dbmigrations.Migrations)
	if err := goose.SetDialect("sqlite3"); err != nil {
		return err
	}
	return goose.Up(db, "migrations")
}
