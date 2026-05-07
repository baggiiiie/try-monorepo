package cli

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
)

func newListCmd(expenses expenseServiceProvider, prefs preferencesServiceProvider) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "list",
		Short: "List expenses",
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
			preferences := prefService.GetPreferences()

			expenses, err := expenseService.List(context.Background())
			if err != nil {
				return err
			}

			var total int64
			for _, e := range expenses {
				total += e.Amount
			}

			if jsonOutput {
				result := map[string]any{
					"expenses": expenses,
					"count":    len(expenses),
					"total":    total,
				}
				return writeJson(result)
			}

			if len(expenses) == 0 {
				fmt.Println("No expenses found.")
				return nil
			}

			fmt.Printf("%-8s  %-12s  %10s  %-15s  %-20s  %s\n", "ID", "Date", "Amount", "Category", "Merchant", "Description")
			loc := loadTimezone(preferences.Timezone)
			for _, e := range expenses {
				shortID := e.ID
				if len(shortID) > 8 {
					shortID = shortID[:8]
				}
				fmt.Printf("%-8s  %-12s  %10s  %-15s  %-20s  %s\n",
					shortID,
					formatDate(e.Date, loc),
					formatAmount(e.Amount, e.Currency),
					e.Category,
					e.Merchant,
					e.Description,
				)
			}
			fmt.Printf("────────────────────────────────────────────────────────\n")
			fmt.Printf("Total: %s (%d expenses)\n", formatAmount(total, preferences.Currency), len(expenses))
			return nil
		},
	}
	cmd.Flags().Bool("json", false, "output as JSON")
	return cmd
}
