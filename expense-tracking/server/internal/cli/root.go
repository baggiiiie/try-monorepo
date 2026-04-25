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
	secretPath  string
)

var rootCmd = &cobra.Command{
	Use:   "expense",
	Short: "Expense tracker CLI",
	PersistentPreRunE: func(cmd *cobra.Command, args []string) error {
		// Skip app initialization for commands that don't need DB access.
		if skipsAppInit(cmd) {
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

	defaultSecret := os.Getenv("EXPENSE_SECRET_FILE")
	if defaultSecret == "" {
		defaultSecret = "secret.json"
	}

	rootCmd.PersistentFlags().StringVar(&dbPath, "db", defaultDB, "path to SQLite database")
	rootCmd.PersistentFlags().StringVar(&configPath, "config", defaultConfig, "path to preferences file")
	rootCmd.PersistentFlags().StringVar(&secretPath, "secret-file", defaultSecret, "path to sync secret file")
}

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

func Execute() error {
	return rootCmd.Execute()
}
