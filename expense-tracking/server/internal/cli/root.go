package cli

import (
	"fmt"
	"os"

	"expense-tracker/internal/app"

	"github.com/spf13/cobra"
)

var (
	application *app.App
	dbPath      string
	configPath  string
)

var rootCmd = &cobra.Command{
	Use:   "expense",
	Short: "Expense tracker CLI",
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// Skip app initialization for the serve command — it does its own bootstrap.
		if cmd.Name() == "serve" || (cmd.Parent() != nil && cmd.Parent().Name() == "serve") {
			return nil
		}
		a, err := app.Open(dbPath, configPath)
		if err != nil {
			return fmt.Errorf("initializing app: %w", err)
		}
		application = a
		return nil
	},
	PersistentPostRunE: func(cmd *cobra.Command, args []string) error {
		if application != nil {
			return application.Close()
		}
		return nil
	},
}

func init() {
	defaultDB := os.Getenv("EXPENSE_DB")
	if defaultDB == "" {
		defaultDB = "expense.db"
	}
	defaultConfig := os.Getenv("EXPENSE_CONFIG")
	if defaultConfig == "" {
		defaultConfig = "preferences.json"
	}

	rootCmd.PersistentFlags().StringVar(&dbPath, "db", defaultDB, "path to SQLite database")
	rootCmd.PersistentFlags().StringVar(&configPath, "config", defaultConfig, "path to preferences file")
}

func Execute() error {
	return rootCmd.Execute()
}
