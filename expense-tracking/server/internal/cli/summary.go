package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var summaryCmd = &cobra.Command{
	Use:   "summary",
	Short: "Show monthly expense summary",
	RunE: func(cmd *cobra.Command, args []string) error {
		jsonOutput, _ := cmd.Flags().GetBool("json")
		month, _ := cmd.Flags().GetString("month")

		result, err := application.ReportService.Summary(context.Background(), month)
		if err != nil {
			return err
		}

		if jsonOutput {
			enc := json.NewEncoder(os.Stdout)
			enc.SetIndent("", "  ")
			return enc.Encode(result)
		}

		fmt.Printf("Summary for %s\n\n", result.Month)
		for _, c := range result.Categories {
			fmt.Printf("  %-20s  %s\n", c.Name, formatAmount(c.Total, application.Preferences.Currency))
		}
		fmt.Printf("  ────────────────────────────\n")
		fmt.Printf("  %-20s  %s\n", "Total", formatAmount(result.Total, application.Preferences.Currency))
		return nil
	},
}

func init() {
	summaryCmd.Flags().Bool("json", false, "output as JSON")
	summaryCmd.Flags().String("month", "", "month (YYYY-MM, defaults to current)")

	rootCmd.AddCommand(summaryCmd)
}
