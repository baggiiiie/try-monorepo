package cli

import (
	"context"
	"fmt"
	"math"
	"time"

	"expense-tracker/internal/service"

	"github.com/spf13/cobra"
)

func newEditCmd(expenses expenseServiceProvider, prefs preferencesServiceProvider) *cobra.Command {
	cmd := &cobra.Command{
		Use:   "edit [id]",
		Short: "Edit an expense",
		Args:  cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			id := args[0]

			expenseService := expenses()
			if expenseService == nil {
				return fmt.Errorf("expense service is not initialized")
			}
			prefService := prefs()
			if prefService == nil {
				return fmt.Errorf("cli runtime is not initialized")
			}

			input := service.ExpenseInput{}

			if cmd.Flags().Changed("amount") {
				amount, _ := cmd.Flags().GetFloat64("amount")
				input.Amount = int64(math.Round(amount * 100))
			}
			if cmd.Flags().Changed("category") {
				input.Category, _ = cmd.Flags().GetString("category")
			}
			if cmd.Flags().Changed("merchant") {
				input.Merchant, _ = cmd.Flags().GetString("merchant")
			}
			if cmd.Flags().Changed("description") {
				input.Description, _ = cmd.Flags().GetString("description")
			}
			if cmd.Flags().Changed("date") {
				dateStr, _ := cmd.Flags().GetString("date")
				loc := loadTimezone(prefService.GetPreferences().Timezone)
				t, err := time.ParseInLocation("2006-01-02", dateStr, loc)
				if err != nil {
					return fmt.Errorf("invalid date format (expected YYYY-MM-DD): %w", err)
				}
				input.Date = t.Unix()
			}

			exp, err := expenseService.Update(context.Background(), id, input)
			if err != nil {
				return err
			}

			fmt.Printf("Updated expense %s\n", exp.ID)
			return nil
		},
	}
	cmd.Flags().Float64("amount", 0, "expense amount")
	cmd.Flags().String("category", "", "category name")
	cmd.Flags().String("merchant", "", "merchant name")
	cmd.Flags().String("description", "", "description")
	cmd.Flags().String("date", "", "date (YYYY-MM-DD)")
	return cmd
}
