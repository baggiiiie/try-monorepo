package cli

import (
	"context"
	"fmt"

	"github.com/spf13/cobra"
)

var showCmd = &cobra.Command{
	Use:   "show [id]",
	Short: "Show a single expense",
	Args:  cobra.ExactArgs(1),
	RunE: func(cmd *cobra.Command, args []string) error {
		jsonOutput, _ := cmd.Flags().GetBool("json")

		exp, err := application.ExpenseService.Get(context.Background(), args[0])
		if err != nil {
			return err
		}

		if jsonOutput {
			return writeJson(exp)
		}

		loc := loadTimezone(application.Preferences.Timezone)
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

func init() {
	showCmd.Flags().Bool("json", false, "output as JSON")
	rootCmd.AddCommand(showCmd)
}
