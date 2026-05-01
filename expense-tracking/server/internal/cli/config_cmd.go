package cli

import (
	"fmt"

	"expense-tracker/internal/config"

	"github.com/spf13/cobra"
)

var configCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage user preferences",
}

var configGetCmd = &cobra.Command{
	Use:   "get [key]",
	Short: "Get a preference value",
	Args:  cobra.MaximumNArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		jsonOutput, _ := cmd.Flags().GetBool("json")

		if jsonOutput || len(args) == 0 {
			return writeJson(application.Preferences)
		}

		key := args[0]
		switch key {
		case "currency":
			fmt.Println(application.Preferences.Currency)
		case "timezone":
			fmt.Println(application.Preferences.Timezone)
		case "date_format":
			fmt.Println(application.Preferences.DateFormat)
		default:
			return fmt.Errorf("unknown preference: %s (valid: currency, timezone, date_format)", key)
		}
		return nil
	},
}

var configSetCmd = &cobra.Command{
	Use:   "set [key] [value]",
	Short: "Set a preference value",
	Args:  cobra.ExactArgs(2),
	RunE: func(cmd *cobra.Command, args []string) error {
		key, value := args[0], args[1]

		prefs := application.Preferences
		switch key {
		case "currency":
			prefs.Currency = value
		case "timezone":
			prefs.Timezone = value
		case "date_format":
			prefs.DateFormat = value
		default:
			return fmt.Errorf("unknown preference: %s (valid: currency, timezone, date_format)", key)
		}

		if err := config.SavePreferences(application.PreferencesPath, prefs); err != nil {
			return err
		}
		if err := application.ReloadPreferences(); err != nil {
			return err
		}

		fmt.Printf("Set %s = %s\n", key, value)
		return nil
	},
}

func init() {
	configGetCmd.Flags().Bool("json", false, "output as JSON")

	configCmd.AddCommand(configGetCmd)
	configCmd.AddCommand(configSetCmd)

	rootCmd.AddCommand(configCmd)
}
