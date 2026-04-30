package cli

import (
	"context"
	"fmt"
	"io"
	"math"
	"time"

	dbsqlc "expense-tracker/internal/repository/sqlc"
	"expense-tracker/internal/service"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// AddInput is the JSON shape accepted by `expense add --json`.
// Tags drive both JSON parsing and the auto-generated --schema output.
type AddInput struct {
	Amount      float64 `json:"amount" jsonschema:"required,exclusiveMinimum=0,description=Amount in major units (e.g. 12.50)."`
	Currency    string  `json:"currency,omitempty" jsonschema:"description=Currency code; defaults to user preference."`
	Category    string  `json:"category" jsonschema:"required,description=Category name (must already exist)."`
	Merchant    string  `json:"merchant,omitempty"`
	Description string  `json:"description,omitempty"`
	Date        string  `json:"date,omitempty" jsonschema:"pattern=^\\d{4}-\\d{2}-\\d{2}$,description=YYYY-MM-DD; defaults to today."`
}

var addCmd = BulkCommand[AddInput, *service.Expense]{
	Use:   "add",
	Short: "Add a one-off expense, via flags or JSON",
	Long: `Add a one-off expense.

Two input modes (mutually exclusive):

  Flag mode:
    expense add --amount 12.50 --category food --merchant Starbucks

  JSON mode:
    expense add --json '{"amount":12.50,"category":"food"}'
    expense add --json @payments.json
    expense add --json -                          # read from stdin
    cat payments.json | expense add --json -

  --json accepts a single object or an array of objects.

Discovery:
    expense add --schema     # print the JSON Schema for --json input
    expense add --example    # print a sample document
    expense add --dry-run    # execute each row in a rolled-back transaction

For recurring expenses, see 'expense add-recurring'.`,
	SchemaTitle:       "AddExpenseInput",
	SchemaDescription: "Input for `expense add --json`. Provide a single object or an array of objects.",
	AddFlags: func(fs *pflag.FlagSet) {
		fs.Float64("amount", 0, "expense amount (e.g., 12.50)")
		fs.String("category", "", "category name")
		fs.String("merchant", "", "merchant name")
		fs.String("description", "", "description")
		fs.String("date", "", "date (YYYY-MM-DD, defaults to today)")
	},
	InputFromFlags: addInputFromFlags,
	Process:        processAddInput,
	FormatHumanRow: formatAddRow,
	Example: func() any {
		return []AddInput{
			{Amount: 12.50, Category: "food", Merchant: "Starbucks", Description: "morning coffee", Date: "2026-04-29"},
			{Amount: 8.00, Category: "transport", Merchant: "Grab"},
		}
	},
}.Build()

func addInputFromFlags(cmd *cobra.Command) (AddInput, error) {
	if !cmd.Flags().Changed("amount") || !cmd.Flags().Changed("category") {
		return AddInput{}, fmt.Errorf("--amount and --category are required (or use --json)")
	}
	amount, _ := cmd.Flags().GetFloat64("amount")
	category, _ := cmd.Flags().GetString("category")
	merchant, _ := cmd.Flags().GetString("merchant")
	description, _ := cmd.Flags().GetString("description")
	dateStr, _ := cmd.Flags().GetString("date")
	return AddInput{
		Amount:      amount,
		Category:    category,
		Merchant:    merchant,
		Description: description,
		Date:        dateStr,
	}, nil
}

func processAddInput(ctx context.Context, q *dbsqlc.Queries, in AddInput) (*service.Expense, error) {
	loc := loadTimezone(application.Preferences.Timezone)

	var date int64
	if in.Date != "" {
		t, err := time.ParseInLocation("2006-01-02", in.Date, loc)
		if err != nil {
			return nil, fmt.Errorf("invalid date %q (expected YYYY-MM-DD): %w", in.Date, err)
		}
		date = t.Unix()
	}

	return application.ExpenseService.CreateInTx(ctx, q, service.ExpenseInput{
		Amount:      int64(math.Round(in.Amount * 100)),
		Currency:    in.Currency,
		Category:    in.Category,
		Description: in.Description,
		Merchant:    in.Merchant,
		Date:        date,
	})
}

func formatAddRow(w io.Writer, _ int, exp *service.Expense) {
	fmt.Fprintf(w, "Added expense %s: %s %.2f at %s\n",
		exp.ID, exp.Currency, float64(exp.Amount)/100, exp.Merchant)
}

func init() {
	rootCmd.AddCommand(addCmd)
}

func loadTimezone(tz string) *time.Location {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.FixedZone("UTC+8", 8*60*60)
	}
	return loc
}
