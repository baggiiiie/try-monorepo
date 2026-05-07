package cli

import (
	"context"
	"fmt"
	"io"
	"math"
	"time"

	"expense-tracker/internal/ptr"
	dbsqlc "expense-tracker/internal/repository/sqlc"
	"expense-tracker/internal/service"

	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// AddRecurringInput is the JSON shape accepted by `expense add-recurring --json`.
type AddRecurringInput struct {
	Amount      float64 `json:"amount" jsonschema:"required,exclusiveMinimum=0,description=Amount in major units (e.g. 12.50)."`
	Currency    string  `json:"currency,omitempty" jsonschema:"description=Currency code; defaults to user preference."`
	Category    string  `json:"category" jsonschema:"required,description=Category name (must already exist)."`
	Merchant    string  `json:"merchant,omitempty"`
	Description string  `json:"description,omitempty"`
	Frequency   string  `json:"frequency" jsonschema:"required,enum=weekly,enum=monthly,enum=yearly"`
	DayOfMonth  *int64  `json:"day_of_month,omitempty" jsonschema:"minimum=1,maximum=31,description=Optional; for monthly/yearly recurrence."`
	StartDate   string  `json:"start_date,omitempty" jsonschema:"pattern=^\\d{4}-\\d{2}-\\d{2}$,description=YYYY-MM-DD; defaults to today."`
	EndDate     string  `json:"end_date,omitempty" jsonschema:"pattern=^\\d{4}-\\d{2}-\\d{2}$,description=Optional."`
}

func newAddRecurringCmd(tx txRunnerProvider, recurring recurringServiceProvider, prefs preferencesServiceProvider) *cobra.Command {
	return BulkCommand[AddRecurringInput, *service.RecurringExpense]{
		Use:   "add-recurring",
		Short: "Add a recurring expense, via flags or JSON",
		Long: `Add a recurring expense (weekly, monthly, or yearly).

Two input modes (mutually exclusive):

  Flag mode:
    expense add-recurring --amount 1500 --category rent --frequency monthly \
      --start-date 2026-05-01 --day-of-month 1

  JSON mode:
    expense add-recurring --json '{"amount":1500,"category":"rent","frequency":"monthly","start_date":"2026-05-01","day_of_month":1}'
    expense add-recurring --json @recurring.json
    expense add-recurring --json -

  --json accepts a single object or an array of objects.

Discovery:
    expense add-recurring --schema
    expense add-recurring --example
    expense add-recurring --dry-run`,
		SchemaTitle:       "AddRecurringExpenseInput",
		SchemaDescription: "Input for `expense add-recurring --json`. Provide a single object or an array of objects.",
		AddFlags: func(fs *pflag.FlagSet) {
			fs.Float64("amount", 0, "expense amount (e.g., 12.50)")
			fs.String("category", "", "category name")
			fs.String("merchant", "", "merchant name")
			fs.String("description", "", "description")
			fs.String("frequency", "", "recurring frequency: weekly, monthly, or yearly")
			fs.String("start-date", "", "start date (YYYY-MM-DD, defaults to today)")
			fs.String("end-date", "", "end date (YYYY-MM-DD, optional)")
			fs.Int64("day-of-month", 0, "day of month for monthly/yearly recurrence (optional)")
		},
		InputFromFlags: addRecurringInputFromFlags,
		Tx:             tx,
		Process: func(ctx context.Context, q *dbsqlc.Queries, in AddRecurringInput) (*service.RecurringExpense, error) {
			prefService := prefs()
			if prefService == nil {
				return nil, fmt.Errorf("cli runtime is not initialized")
			}
			recurringService := recurring()
			if recurringService == nil {
				return nil, fmt.Errorf("recurring service is not initialized")
			}

			preferences := prefService.GetPreferences()
			loc := loadTimezone(preferences.Timezone)

			var startDate int64
			if in.StartDate != "" {
				t, err := time.ParseInLocation("2006-01-02", in.StartDate, loc)
				if err != nil {
					return nil, fmt.Errorf("invalid start_date %q (expected YYYY-MM-DD): %w", in.StartDate, err)
				}
				startDate = t.Unix()
			} else {
				startDate = time.Now().In(loc).Unix()
			}

			var endDate *int64
			if in.EndDate != "" {
				t, err := time.ParseInLocation("2006-01-02", in.EndDate, loc)
				if err != nil {
					return nil, fmt.Errorf("invalid end_date %q (expected YYYY-MM-DD): %w", in.EndDate, err)
				}
				v := t.Unix()
				endDate = &v
			}

			currency := in.Currency
			if currency == "" {
				currency = preferences.Currency
			}

			return recurringService.CreateWithQueries(ctx, q, service.RecurringExpenseInput{
				Amount:      int64(math.Round(in.Amount * 100)),
				Currency:    currency,
				Category:    in.Category,
				Description: in.Description,
				Merchant:    in.Merchant,
				Frequency:   in.Frequency,
				DayOfMonth:  in.DayOfMonth,
				StartDate:   startDate,
				EndDate:     endDate,
			})
		},
		FormatHumanRow: func(w io.Writer, _ int, rec *service.RecurringExpense) {
			prefService := prefs()
			if prefService == nil {
				fmt.Fprintf(w, "Added recurring expense %s\n", rec.ID)
				return
			}
			loc := loadTimezone(prefService.GetPreferences().Timezone)
			fmt.Fprintf(w, "Added recurring expense %s (%s): %s %.2f at %s, next run %s\n",
				rec.ID, rec.Frequency, rec.Currency, float64(rec.Amount)/100, rec.Merchant,
				time.Unix(rec.NextRunDate, 0).In(loc).Format("2006-01-02"))
		},
		Example: func() any {
			return []AddRecurringInput{
				{Amount: 1500.00, Category: "rent", Merchant: "Landlord", Frequency: "monthly", StartDate: "2026-05-01", DayOfMonth: ptr.To[int64](1)},
			}
		},
	}.Build()
}

func addRecurringInputFromFlags(cmd *cobra.Command) (AddRecurringInput, error) {
	for _, req := range []string{"amount", "category", "frequency"} {
		if !cmd.Flags().Changed(req) {
			return AddRecurringInput{}, fmt.Errorf("--amount, --category, and --frequency are required (or use --json)")
		}
	}
	amount, _ := cmd.Flags().GetFloat64("amount")
	category, _ := cmd.Flags().GetString("category")
	merchant, _ := cmd.Flags().GetString("merchant")
	description, _ := cmd.Flags().GetString("description")
	frequency, _ := cmd.Flags().GetString("frequency")
	startDate, _ := cmd.Flags().GetString("start-date")
	endDate, _ := cmd.Flags().GetString("end-date")
	in := AddRecurringInput{
		Amount:      amount,
		Category:    category,
		Merchant:    merchant,
		Description: description,
		Frequency:   frequency,
		StartDate:   startDate,
		EndDate:     endDate,
	}
	if cmd.Flags().Changed("day-of-month") {
		v, _ := cmd.Flags().GetInt64("day-of-month")
		in.DayOfMonth = &v
	}
	return in, nil
}
