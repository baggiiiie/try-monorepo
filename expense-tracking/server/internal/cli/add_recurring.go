package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"time"

	"expense-tracker/internal/service"

	"github.com/spf13/cobra"
)

// AddRecurringInput is the JSON shape accepted by `expense add-recurring --json`.
type AddRecurringInput struct {
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency,omitempty"`
	Category    string  `json:"category"`
	Merchant    string  `json:"merchant,omitempty"`
	Description string  `json:"description,omitempty"`
	Frequency   string  `json:"frequency"`               // weekly|monthly|yearly
	DayOfMonth  *int64  `json:"day_of_month,omitempty"`  // optional, for monthly/yearly
	StartDate   string  `json:"start_date,omitempty"`    // YYYY-MM-DD; defaults to today
	EndDate     string  `json:"end_date,omitempty"`      // YYYY-MM-DD; optional
}

var addRecurringCmd = &cobra.Command{
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
	RunE: runAddRecurring,
}

func runAddRecurring(cmd *cobra.Command, args []string) error {
	if printSchema, _ := cmd.Flags().GetBool("schema"); printSchema {
		fmt.Println(addRecurringJSONSchema())
		return nil
	}
	if printExample, _ := cmd.Flags().GetBool("example"); printExample {
		fmt.Println(addRecurringJSONExample())
		return nil
	}

	dryRun, _ := cmd.Flags().GetBool("dry-run")
	output, _ := cmd.Flags().GetString("output")
	jsonArg, _ := cmd.Flags().GetString("json")

	inputs, err := collectAddRecurringInputs(cmd, jsonArg)
	if err != nil {
		return err
	}

	loc := loadTimezone(application.Preferences.Timezone)
	results := make([]addRecurringResult, 0, len(inputs))
	var firstErr error
	for i, in := range inputs {
		res := processAddRecurringInput(cmd.Context(), i, in, loc, dryRun)
		results = append(results, res)
		if res.Error != "" {
			firstErr = fmt.Errorf("row %d: %s", i, res.Error)
			break
		}
	}

	if output == "json" {
		return writeAddRecurringJSONOutput(cmd.OutOrStdout(), results, dryRun, firstErr)
	}
	return writeAddRecurringHumanOutput(cmd.OutOrStdout(), results, loc, dryRun, firstErr)
}

func collectAddRecurringInputs(cmd *cobra.Command, jsonArg string) ([]AddRecurringInput, error) {
	if jsonArg != "" {
		raw, err := readJSONArg(jsonArg)
		if err != nil {
			return nil, err
		}
		inputs, err := parseJSONInputs[AddRecurringInput](raw)
		if err != nil {
			return nil, fmt.Errorf("parsing --json: %w", err)
		}
		return inputs, nil
	}
	in, err := addRecurringInputFromFlags(cmd)
	if err != nil {
		return nil, err
	}
	return []AddRecurringInput{in}, nil
}

type addRecurringResult struct {
	Index     int                       `json:"index"`
	Recurring *service.RecurringExpense `json:"recurring,omitempty"`
	Error     string                    `json:"error,omitempty"`
}

func processAddRecurringInput(ctx context.Context, index int, in AddRecurringInput, loc *time.Location, dryRun bool) addRecurringResult {
	if ctx == nil {
		ctx = context.Background()
	}
	amountCents := int64(math.Round(in.Amount * 100))

	var startDate int64
	if in.StartDate != "" {
		t, err := time.ParseInLocation("2006-01-02", in.StartDate, loc)
		if err != nil {
			return addRecurringResult{Index: index, Error: fmt.Sprintf("invalid start_date %q (expected YYYY-MM-DD): %v", in.StartDate, err)}
		}
		startDate = t.Unix()
	} else {
		startDate = time.Now().In(loc).Unix()
	}

	var endDate *int64
	if in.EndDate != "" {
		t, err := time.ParseInLocation("2006-01-02", in.EndDate, loc)
		if err != nil {
			return addRecurringResult{Index: index, Error: fmt.Sprintf("invalid end_date %q (expected YYYY-MM-DD): %v", in.EndDate, err)}
		}
		v := t.Unix()
		endDate = &v
	}

	currency := in.Currency
	if currency == "" {
		currency = application.Preferences.Currency
	}

	recInput := service.RecurringExpenseInput{
		Amount:      amountCents,
		Currency:    currency,
		Category:    in.Category,
		Description: in.Description,
		Merchant:    in.Merchant,
		Frequency:   in.Frequency,
		DayOfMonth:  in.DayOfMonth,
		StartDate:   startDate,
		EndDate:     endDate,
	}
	if dryRun {
		if err := validateRecurringInput(recInput); err != nil {
			return addRecurringResult{Index: index, Error: err.Error()}
		}
		return addRecurringResult{Index: index}
	}
	rec, err := application.RecurringService.Create(ctx, recInput)
	if err != nil {
		return addRecurringResult{Index: index, Error: err.Error()}
	}
	return addRecurringResult{Index: index, Recurring: rec}
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

func validateRecurringInput(in service.RecurringExpenseInput) error {
	if in.Amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	switch in.Frequency {
	case "weekly", "monthly", "yearly":
	default:
		return fmt.Errorf("frequency must be one of weekly, monthly, yearly")
	}
	if in.StartDate == 0 {
		return fmt.Errorf("start_date is required")
	}
	if in.EndDate != nil && *in.EndDate < in.StartDate {
		return fmt.Errorf("end_date must be on or after start_date")
	}
	if in.Category == "" && in.CategoryID == "" {
		return fmt.Errorf("category is required")
	}
	return nil
}

func writeAddRecurringHumanOutput(w io.Writer, results []addRecurringResult, loc *time.Location, dryRun bool, firstErr error) error {
	for _, r := range results {
		switch {
		case r.Error != "":
			fmt.Fprintf(w, "row %d: error: %s\n", r.Index, r.Error)
		case dryRun:
			fmt.Fprintf(w, "row %d: ok (dry-run)\n", r.Index)
		case r.Recurring != nil:
			v := r.Recurring
			fmt.Fprintf(w, "Added recurring expense %s (%s): %s %.2f at %s, next run %s\n",
				v.ID, v.Frequency, v.Currency, float64(v.Amount)/100, v.Merchant,
				time.Unix(v.NextRunDate, 0).In(loc).Format("2006-01-02"))
		}
	}
	return firstErr
}

func writeAddRecurringJSONOutput(w io.Writer, results []addRecurringResult, dryRun bool, firstErr error) error {
	out := map[string]any{
		"dry_run": dryRun,
		"results": results,
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		return err
	}
	return firstErr
}

func addRecurringJSONSchema() string {
	schema := map[string]any{
		"$schema":     "https://json-schema.org/draft/2020-12/schema",
		"title":       "AddRecurringExpenseInput",
		"description": "Input for `expense add-recurring --json`. Provide a single object or an array of objects.",
		"oneOf": []any{
			map[string]any{"$ref": "#/$defs/recurring"},
			map[string]any{"type": "array", "items": map[string]any{"$ref": "#/$defs/recurring"}},
		},
		"$defs": map[string]any{
			"recurring": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"amount", "category", "frequency"},
				"properties": map[string]any{
					"amount":       map[string]any{"type": "number", "exclusiveMinimum": 0, "description": "Amount in major units (e.g. 12.50)."},
					"currency":     map[string]any{"type": "string", "description": "Currency code; defaults to user preference."},
					"category":     map[string]any{"type": "string", "description": "Category name (must already exist)."},
					"merchant":     map[string]any{"type": "string"},
					"description":  map[string]any{"type": "string"},
					"frequency":    map[string]any{"type": "string", "enum": []string{"weekly", "monthly", "yearly"}},
					"day_of_month": map[string]any{"type": "integer", "minimum": 1, "maximum": 31, "description": "Optional; for monthly/yearly recurrence."},
					"start_date":   map[string]any{"type": "string", "pattern": `^\d{4}-\d{2}-\d{2}$`, "description": "YYYY-MM-DD; defaults to today."},
					"end_date":     map[string]any{"type": "string", "pattern": `^\d{4}-\d{2}-\d{2}$`, "description": "Optional."},
				},
			},
		},
	}
	b, _ := json.MarshalIndent(schema, "", "  ")
	return string(b)
}

func addRecurringJSONExample() string {
	example := []AddRecurringInput{
		{Amount: 1500.00, Category: "rent", Merchant: "Landlord", Frequency: "monthly", StartDate: "2026-05-01", DayOfMonth: int64Ptr(1)},
	}
	b, _ := json.MarshalIndent(example, "", "  ")
	return string(b)
}

func init() {
	addRecurringCmd.Flags().Float64("amount", 0, "expense amount (e.g., 12.50)")
	addRecurringCmd.Flags().String("category", "", "category name")
	addRecurringCmd.Flags().String("merchant", "", "merchant name")
	addRecurringCmd.Flags().String("description", "", "description")
	addRecurringCmd.Flags().String("frequency", "", "recurring frequency: weekly, monthly, or yearly")
	addRecurringCmd.Flags().String("start-date", "", "start date (YYYY-MM-DD, defaults to today)")
	addRecurringCmd.Flags().String("end-date", "", "end date (YYYY-MM-DD, optional)")
	addRecurringCmd.Flags().Int64("day-of-month", 0, "day of month for monthly/yearly recurrence (optional)")

	addRecurringCmd.Flags().String("json", "", "JSON input: inline string, @path/to/file, or - for stdin. Run with --schema or --example to discover the shape.")
	addRecurringCmd.Flags().Bool("schema", false, "print the JSON Schema for --json input and exit")
	addRecurringCmd.Flags().Bool("example", false, "print a sample JSON document and exit")
	addRecurringCmd.Flags().Bool("dry-run", false, "validate input without writing")
	addRecurringCmd.Flags().String("output", "", "output format: human (default) or json")

	for _, f := range []string{"amount", "category", "merchant", "description", "frequency", "start-date", "end-date", "day-of-month"} {
		addRecurringCmd.MarkFlagsMutuallyExclusive("json", f)
	}

	rootCmd.AddCommand(addRecurringCmd)
}
