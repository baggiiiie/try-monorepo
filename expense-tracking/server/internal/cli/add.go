package cli

import (
	"context"
	"fmt"
	"math"
	"time"

	"expense-tracker/internal/service"

	"github.com/spf13/cobra"
)

var addCmd = &cobra.Command{
	Use:   "add",
	Short: "Add a new expense",
	RunE: func(cmd *cobra.Command, args []string) error {
		amount, _ := cmd.Flags().GetFloat64("amount")
		category, _ := cmd.Flags().GetString("category")
		merchant, _ := cmd.Flags().GetString("merchant")
		description, _ := cmd.Flags().GetString("description")
		dateStr, _ := cmd.Flags().GetString("date")

		amountCents := int64(math.Round(amount * 100))

		var date int64
		if dateStr != "" {
			loc := loadTimezone(application.Preferences.Timezone)
			t, err := time.ParseInLocation("2006-01-02", dateStr, loc)
			if err != nil {
				return fmt.Errorf("invalid date format (expected YYYY-MM-DD): %w", err)
			}
			date = t.Unix()
		}

		exp, err := application.ExpenseService.Create(context.Background(), service.ExpenseInput{
			Amount:      amountCents,
			Category:    category,
			Description: description,
			Merchant:    merchant,
			Date:        date,
		})
		if err != nil {
			return err
		}

		fmt.Printf("Added expense %s: %s %.2f at %s\n", exp.ID, exp.Currency, float64(exp.Amount)/100, exp.Merchant)
		return nil
	},
}

func init() {
	addCmd.Flags().Float64("amount", 0, "expense amount (e.g., 12.50)")
	addCmd.Flags().String("category", "", "category name")
	addCmd.Flags().String("merchant", "", "merchant name")
	addCmd.Flags().String("description", "", "description")
	addCmd.Flags().String("date", "", "date (YYYY-MM-DD, defaults to today)")
	addCmd.MarkFlagRequired("amount")
	addCmd.MarkFlagRequired("category")

	rootCmd.AddCommand(addCmd)
}

func loadTimezone(tz string) *time.Location {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.FixedZone("UTC+8", 8*60*60)
	}
	return loc
}
