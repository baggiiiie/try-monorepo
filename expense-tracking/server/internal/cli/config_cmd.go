package cli

import (
	"fmt"

	"github.com/spf13/cobra"
)

func newConfigCmd(prefs preferencesServiceProvider) *cobra.Command {
	configCmd := &cobra.Command{
		Use:   "config",
		Short: "Manage user preferences",
	}

	configGetCmd := &cobra.Command{
		Use:   "get [key]",
		Short: "Get a preference value",
		Args:  cobra.MaximumNArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			jsonOutput, _ := cmd.Flags().GetBool("json")

			prefService := prefs()
			if prefService == nil {
				return fmt.Errorf("cli runtime is not initialized")
			}
			preferences := prefService.GetPreferences()

			if jsonOutput || len(args) == 0 {
				return writeJson(preferences)
			}

			key := args[0]
			switch key {
			case "currency":
				fmt.Println(preferences.Currency)
			case "timezone":
				fmt.Println(preferences.Timezone)
			case "date_format":
				fmt.Println(preferences.DateFormat)
			default:
				return fmt.Errorf("unknown preference: %s (valid: currency, timezone, date_format)", key)
			}
			return nil
		},
	}

	configSetCmd := &cobra.Command{
		Use:   "set [key] [value]",
		Short: "Set a preference value",
		Args:  cobra.ExactArgs(2),
		RunE: func(cmd *cobra.Command, args []string) error {
			prefService := prefs()
			if prefService == nil {
				return fmt.Errorf("cli runtime is not initialized")
			}

			key, value := args[0], args[1]
			preferences := prefService.GetPreferences()
			switch key {
			case "currency":
				preferences.Currency = value
			case "timezone":
				preferences.Timezone = value
			case "date_format":
				preferences.DateFormat = value
			default:
				return fmt.Errorf("unknown preference: %s (valid: currency, timezone, date_format)", key)
			}

			if err := prefService.SavePreferences(preferences); err != nil {
				return err
			}

			fmt.Printf("Set %s = %s\n", key, value)
			return nil
		},
	}

	configGetCmd.Flags().Bool("json", false, "output as JSON")

	configCmd.AddCommand(configGetCmd)
	configCmd.AddCommand(configSetCmd)
	return configCmd
}
