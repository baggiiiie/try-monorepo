package cli

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
)

func newShowCmd(expenses expenseServiceProvider, prefs preferencesServiceProvider) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "show [id]",
		Short: "Show a single expense",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			jsonOutput, _ := cmd.Flags().GetBool("json")

			expenseService := expenses()
			if expenseService == nil {
				return fmt.Errorf("expense service is not initialized")
			}
			prefService := prefs()
			if prefService == nil {
				return fmt.Errorf("cli runtime is not initialized")
			}

			exp, err := expenseService.Get(context.Background(), args[0])
			if err != nil {
				return err
			}

			if jsonOutput {
				return writeJson(exp)
			}

			loc := loadTimezone(prefService.GetPreferences().Timezone)
			fmt.Printf("ID:          %s\n", exp.ID)
			fmt.Printf("Amount:      %s\n", formatAmount(exp.Amount, exp.Currency))
			fmt.Printf("Category:    %s\n", exp.Category)
			fmt.Printf("Merchant:    %s\n", exp.Merchant)
			fmt.Printf("Description: %s\n", exp.Description)
			fmt.Printf("Date:        %s\n", formatDate(exp.Date, loc))
			fmt.Printf("Source:      %s\n", exp.Source)
			return nil
		},
	}
	cmd.Flags().Bool("json", false, "output as JSON")
	return cmd
}
