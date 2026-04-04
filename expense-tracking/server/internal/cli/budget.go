package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var budgetCmd = &cobra.Command{
	Use:   "budget",
	Short: "Show budget status",
	RunE: func(cmd *cobra.Command, args []string) error {
		jsonOutput, _ := cmd.Flags().GetBool("json")
		month, _ := cmd.Flags().GetString("month")

		result, err := application.ReportService.Budget(context.Background(), month)
		if err != nil {
			return err
		}

		if jsonOutput {
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			return enc.Encode(result)
		}

		fmt.Printf("Budget for %s\n\n", result.Month)
		for _, c := range result.Categories {
			status := "✓"
			if c.OverBudget {
				status = "⚠ OVER"
			}
			fmt.Printf("  %-20s  %s / %s  %s\n",
				c.Name,
				formatAmount(c.Spent, application.Preferences.Currency),
				formatAmount(c.Budget, application.Preferences.Currency),
				status,
			)
		}
		return nil
	},
}

func init() {
	budgetCmd.Flags().Bool("json", false, "output as JSON")
	budgetCmd.Flags().String("month", "", "month (YYYY-MM, defaults to current)")

	rootCmd.AddCommand(budgetCmd)
}
