package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var listCmd = &cobra.Command{
	Use:   "list",
	Short: "List expenses",
	RunE: func(cmd *cobra.Command, args []string) error {
		jsonOutput, _ := cmd.Flags().GetBool("json")

		expenses, err := application.ExpenseService.List(context.Background())
		if err != nil {
			return err
		}

		var total int64
		for _, e := range expenses {
			total += e.Amount
		}

		if jsonOutput {
			result := map[string]interface{}{
				"expenses": expenses,
				"count":    len(expenses),
				"total":    total,
			}
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			return enc.Encode(result)
		}

		if len(expenses) == 0 {
			fmt.Println("No expenses found.")
			return nil
		}

		fmt.Printf("%-8s  %-12s  %10s  %-15s  %-20s  %s\n", "ID", "Date", "Amount", "Category", "Merchant", "Description")
		loc := loadTimezone(application.Preferences.Timezone)
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
		fmt.Printf("Total: %s (%d expenses)\n", formatAmount(total, application.Preferences.Currency), len(expenses))
		return nil
	},
}

func init() {
	listCmd.Flags().Bool("json", false, "output as JSON")
	rootCmd.AddCommand(listCmd)
}
