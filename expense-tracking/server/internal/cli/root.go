package cli

import (
	"fmt"
	"os"

	"expense-tracker/internal/app"

	"github.com/spf13/cobra"
)

// skipsAppInit reports whether cmd should bypass the persistent app/database
// bootstrap. The serve command does its own bootstrap; the secret command
// only touches the secret file.
func skipsAppInit(cmd *cobra.Command) bool {
	for c := cmd; c != nil; c = c.Parent() {
		switch c.Name() {
		case "serve", "secret":
			return true
		}
	}
	return false
}

func newRootCmd() *cobra.Command {
	defaultDB := os.Getenv("EXPENSE_DB")
	if defaultDB == "" {
		defaultDB = "expense.db"
	}
	defaultConfig := os.Getenv("EXPENSE_CONFIG")
	if defaultConfig == "" {
		defaultConfig = "preferences.json"
	}
	defaultSecret := os.Getenv("EXPENSE_SECRET_FILE")
	if defaultSecret == "" {
		defaultSecret = "secret.json"
	}

	dbPath := defaultDB
	configPath := defaultConfig
	secretPath := defaultSecret

	var rt *runtime

	txProvider := func() txRunner {
		if rt == nil {
			return nil
		}
		return rt
	}
	preferencesProvider := func() preferencesService {
		if rt == nil {
			return nil
		}
		return rt
	}
	expenseProvider := func() expenseCLIService {
		if rt == nil {
			return nil
		}
		return rt.ExpenseService
	}
	categoryProvider := func() categoryCLIService {
		if rt == nil {
			return nil
		}
		return rt.CategoryService
	}
	reportProvider := func() reportCLIService {
		if rt == nil {
			return nil
		}
		return rt.ReportService
	}
	recurringProvider := func() recurringCLIService {
		if rt == nil {
			return nil
		}
		return rt.RecurringService
	}
	paths := func() (string, string, string) {
		return dbPath, configPath, secretPath
	}

	rootCmd := &cobra.Command{
		Use:   "expense",
		Short: "Expense tracker CLI",
		PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
			if skipsAppInit(cmd) {
				return nil
			}
			a, err := app.Open(dbPath, configPath)
			if err != nil {
				return fmt.Errorf("initializing app: %w", err)
			}
			rt = newRuntime(a)
			return nil
		},
		PersistentPostRunE: func(cmd *cobra.Command, args []string) error {
			if rt == nil {
				return nil
			}
			err := rt.Close()
			rt = nil
			return err
		},
	}

	rootCmd.PersistentFlags().StringVar(&dbPath, "db", defaultDB, "path to SQLite database")
	rootCmd.PersistentFlags().StringVar(&configPath, "config", defaultConfig, "path to preferences file")
	rootCmd.PersistentFlags().StringVar(&secretPath, "secret-file", defaultSecret, "path to sync secret file")

	rootCmd.AddCommand(newAddCmd(txProvider, expenseProvider, preferencesProvider))
	rootCmd.AddCommand(newAddRecurringCmd(txProvider, recurringProvider, preferencesProvider))
	rootCmd.AddCommand(newBudgetCmd(reportProvider, preferencesProvider))
	rootCmd.AddCommand(newCategoryCmd(categoryProvider, preferencesProvider))
	rootCmd.AddCommand(newConfigCmd(preferencesProvider))
	rootCmd.AddCommand(newDeleteCmd(expenseProvider))
	rootCmd.AddCommand(newEditCmd(expenseProvider, preferencesProvider))
	rootCmd.AddCommand(newListCmd(expenseProvider, preferencesProvider))
	rootCmd.AddCommand(newSecretCmd(paths))
	rootCmd.AddCommand(newServeCmd(paths))
	rootCmd.AddCommand(newShowCmd(expenseProvider, preferencesProvider))
	rootCmd.AddCommand(newSummaryCmd(reportProvider, preferencesProvider))

	return rootCmd
}

func Execute() error {
	return newRootCmd().Execute()
}
