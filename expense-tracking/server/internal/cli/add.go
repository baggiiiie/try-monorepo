package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"strings"
	"time"

	"expense-tracker/internal/service"

	"github.com/spf13/cobra"
)

// AddInput is the JSON shape accepted by `expense add --json`.
// One source of truth for both schema generation and parsing.
type AddInput struct {
	Amount      float64 `json:"amount"`                 // in major units, e.g. 12.50
	Currency    string  `json:"currency,omitempty"`     // defaults to user preference
	Category    string  `json:"category"`               // category name
	Merchant    string  `json:"merchant,omitempty"`
	Description string  `json:"description,omitempty"`
	Date        string  `json:"date,omitempty"`         // YYYY-MM-DD; defaults to today
	Frequency   string  `json:"frequency,omitempty"`    // weekly|monthly|yearly; if set, creates a recurring expense
	DayOfMonth  *int64  `json:"day_of_month,omitempty"` // optional, for monthly/yearly
	EndDate     string  `json:"end_date,omitempty"`     // YYYY-MM-DD, optional, recurring only
}

var addCmd = &cobra.Command{
	Use:   "add",
	Short: "Add an expense (one-off or recurring), via flags or JSON",
	Long: `Add an expense.

Two input modes (mutually exclusive):

  Flag mode (interactive):
    expense add --amount 12.50 --category food --merchant Starbucks

  JSON mode (scripting / agents):
    expense add --json '{"amount":12.50,"category":"food"}'
    expense add --json @payments.json
    expense add --json -                          # read from stdin
    cat payments.json | expense add --json -

  --json accepts a single object or an array of objects.

Discovery:
    expense add --schema     # print the JSON Schema for --json input
    expense add --example    # print a sample document
    expense add --dry-run    # validate without writing (works in either mode)`,
	RunE: runAdd,
}

func runAdd(cmd *cobra.Command, args []string) error {
	if printSchema, _ := cmd.Flags().GetBool("schema"); printSchema {
		fmt.Println(addJSONSchema())
		return nil
	}
	if printExample, _ := cmd.Flags().GetBool("example"); printExample {
		fmt.Println(addJSONExample())
		return nil
	}

	dryRun, _ := cmd.Flags().GetBool("dry-run")
	output, _ := cmd.Flags().GetString("output")
	strict, _ := cmd.Flags().GetBool("strict")
	jsonArg, _ := cmd.Flags().GetString("json")

	var (
		inputs        []AddInput
		jsonModeArray bool // true if user provided a JSON array (controls output shape)
	)

	if jsonArg != "" {
		raw, err := readJSONArg(jsonArg)
		if err != nil {
			return err
		}
		inputs, jsonModeArray, err = parseAddInputs(raw)
		if err != nil {
			return fmt.Errorf("parsing --json: %w", err)
		}
	} else {
		input, err := addInputFromFlags(cmd)
		if err != nil {
			return err
		}
		inputs = []AddInput{input}
	}

	loc := loadTimezone(application.Preferences.Timezone)
	results := make([]addResult, 0, len(inputs))
	failures := 0

	for i, in := range inputs {
		res := processAddInput(cmd.Context(), in, loc, dryRun)
		res.Index = i
		if res.Error != "" {
			failures++
			if strict {
				results = append(results, res)
				break
			}
		}
		results = append(results, res)
	}

	useJSONOutput := output == "json" || jsonModeArray
	if useJSONOutput {
		return writeJSONOutput(cmd.OutOrStdout(), results, dryRun)
	}
	return writeHumanOutput(cmd.OutOrStdout(), results, loc, dryRun, failures)
}

type addResult struct {
	Index     int    `json:"index"`
	ID        string `json:"id,omitempty"`
	Recurring bool   `json:"recurring,omitempty"`
	Error     string `json:"error,omitempty"`
	// kept for human output, not serialized
	created any `json:"-"`
}

func processAddInput(ctx context.Context, in AddInput, loc *time.Location, dryRun bool) addResult {
	if ctx == nil {
		ctx = context.Background()
	}
	amountCents := int64(math.Round(in.Amount * 100))

	var date int64
	if in.Date != "" {
		t, err := time.ParseInLocation("2006-01-02", in.Date, loc)
		if err != nil {
			return addResult{Error: fmt.Sprintf("invalid date %q (expected YYYY-MM-DD): %v", in.Date, err)}
		}
		date = t.Unix()
	}

	if in.Frequency != "" {
		startDate := date
		if startDate == 0 {
			startDate = time.Now().In(loc).Unix()
		}
		var endDate *int64
		if in.EndDate != "" {
			t, err := time.ParseInLocation("2006-01-02", in.EndDate, loc)
			if err != nil {
				return addResult{Error: fmt.Sprintf("invalid end_date %q (expected YYYY-MM-DD): %v", in.EndDate, err)}
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
				return addResult{Error: err.Error(), Recurring: true}
			}
			return addResult{Recurring: true}
		}
		rec, err := application.RecurringService.Create(ctx, recInput)
		if err != nil {
			return addResult{Error: err.Error(), Recurring: true}
		}
		return addResult{ID: rec.ID, Recurring: true, created: rec}
	}

	expInput := service.ExpenseInput{
		Amount:      amountCents,
		Currency:    in.Currency,
		Category:    in.Category,
		Description: in.Description,
		Merchant:    in.Merchant,
		Date:        date,
	}
	if dryRun {
		if err := validateExpenseInput(expInput); err != nil {
			return addResult{Error: err.Error()}
		}
		return addResult{}
	}
	exp, err := application.ExpenseService.Create(ctx, expInput)
	if err != nil {
		return addResult{Error: err.Error()}
	}
	return addResult{ID: exp.ID, created: exp}
}

func addInputFromFlags(cmd *cobra.Command) (AddInput, error) {
	if !cmd.Flags().Changed("amount") || !cmd.Flags().Changed("category") {
		return AddInput{}, fmt.Errorf("--amount and --category are required (or use --json)")
	}
	amount, _ := cmd.Flags().GetFloat64("amount")
	category, _ := cmd.Flags().GetString("category")
	merchant, _ := cmd.Flags().GetString("merchant")
	description, _ := cmd.Flags().GetString("description")
	dateStr, _ := cmd.Flags().GetString("date")
	frequency, _ := cmd.Flags().GetString("frequency")
	endDateStr, _ := cmd.Flags().GetString("end-date")
	in := AddInput{
		Amount:      amount,
		Category:    category,
		Merchant:    merchant,
		Description: description,
		Date:        dateStr,
		Frequency:   frequency,
		EndDate:     endDateStr,
	}
	if cmd.Flags().Changed("day-of-month") {
		v, _ := cmd.Flags().GetInt64("day-of-month")
		in.DayOfMonth = &v
	}
	return in, nil
}

func parseAddInputs(raw []byte) ([]AddInput, bool, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil, false, fmt.Errorf("empty JSON input")
	}
	if strings.HasPrefix(trimmed, "[") {
		var arr []AddInput
		dec := json.NewDecoder(strings.NewReader(trimmed))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&arr); err != nil {
			return nil, true, err
		}
		return arr, true, nil
	}
	var single AddInput
	dec := json.NewDecoder(strings.NewReader(trimmed))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&single); err != nil {
		return nil, false, err
	}
	return []AddInput{single}, false, nil
}

func readJSONArg(arg string) ([]byte, error) {
	switch {
	case arg == "-":
		return io.ReadAll(os.Stdin)
	case strings.HasPrefix(arg, "@"):
		return os.ReadFile(arg[1:])
	default:
		return []byte(arg), nil
	}
}

func validateExpenseInput(in service.ExpenseInput) error {
	if in.Amount <= 0 {
		return fmt.Errorf("amount must be positive")
	}
	if in.Category == "" && in.CategoryID == "" {
		return fmt.Errorf("category is required")
	}
	return nil
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

func writeHumanOutput(w io.Writer, results []addResult, loc *time.Location, dryRun bool, failures int) error {
	for _, r := range results {
		if r.Error != "" {
			fmt.Fprintf(w, "row %d: error: %s\n", r.Index, r.Error)
			continue
		}
		if dryRun {
			fmt.Fprintf(w, "row %d: ok (dry-run)\n", r.Index)
			continue
		}
		switch v := r.created.(type) {
		case *service.Expense:
			fmt.Fprintf(w, "Added expense %s: %s %.2f at %s\n", v.ID, v.Currency, float64(v.Amount)/100, v.Merchant)
		case *service.RecurringExpense:
			fmt.Fprintf(w, "Added recurring expense %s (%s): %s %.2f at %s, next run %s\n",
				v.ID, v.Frequency, v.Currency, float64(v.Amount)/100, v.Merchant,
				time.Unix(v.NextRunDate, 0).In(loc).Format("2006-01-02"))
		}
	}
	if failures > 0 {
		return fmt.Errorf("%d of %d row(s) failed", failures, len(results))
	}
	return nil
}

func writeJSONOutput(w io.Writer, results []addResult, dryRun bool) error {
	created := make([]addResult, 0, len(results))
	failed := make([]addResult, 0)
	for _, r := range results {
		if r.Error != "" {
			failed = append(failed, r)
		} else {
			created = append(created, r)
		}
	}
	out := map[string]any{
		"dry_run": dryRun,
		"created": created,
		"failed":  failed,
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	if err := enc.Encode(out); err != nil {
		return err
	}
	if len(failed) > 0 {
		return fmt.Errorf("%d of %d row(s) failed", len(failed), len(results))
	}
	return nil
}

func addJSONSchema() string {
	schema := map[string]any{
		"$schema":     "https://json-schema.org/draft/2020-12/schema",
		"title":       "AddExpenseInput",
		"description": "Input for `expense add --json`. Provide a single object or an array of objects.",
		"oneOf": []any{
			map[string]any{"$ref": "#/$defs/expense"},
			map[string]any{"type": "array", "items": map[string]any{"$ref": "#/$defs/expense"}},
		},
		"$defs": map[string]any{
			"expense": map[string]any{
				"type":                 "object",
				"additionalProperties": false,
				"required":             []string{"amount", "category"},
				"properties": map[string]any{
					"amount":      map[string]any{"type": "number", "exclusiveMinimum": 0, "description": "Amount in major units (e.g. 12.50)."},
					"currency":    map[string]any{"type": "string", "description": "Currency code; defaults to user preference."},
					"category":    map[string]any{"type": "string", "description": "Category name (must already exist)."},
					"merchant":    map[string]any{"type": "string"},
					"description": map[string]any{"type": "string"},
					"date":        map[string]any{"type": "string", "pattern": `^\d{4}-\d{2}-\d{2}$`, "description": "YYYY-MM-DD; defaults to today. Used as start date for recurring."},
					"frequency":   map[string]any{"type": "string", "enum": []string{"weekly", "monthly", "yearly"}, "description": "If set, creates a recurring expense."},
					"day_of_month": map[string]any{"type": "integer", "minimum": 1, "maximum": 31, "description": "Optional; for monthly/yearly recurrence."},
					"end_date":    map[string]any{"type": "string", "pattern": `^\d{4}-\d{2}-\d{2}$`, "description": "Optional; recurring only."},
				},
			},
		},
	}
	b, _ := json.MarshalIndent(schema, "", "  ")
	return string(b)
}

func addJSONExample() string {
	example := []AddInput{
		{Amount: 12.50, Category: "food", Merchant: "Starbucks", Description: "morning coffee", Date: "2026-04-29"},
		{Amount: 1500.00, Category: "rent", Merchant: "Landlord", Frequency: "monthly", Date: "2026-05-01", DayOfMonth: int64Ptr(1)},
	}
	b, _ := json.MarshalIndent(example, "", "  ")
	return string(b)
}

func int64Ptr(v int64) *int64 { return &v }

func init() {
	addCmd.Flags().Float64("amount", 0, "expense amount (e.g., 12.50)")
	addCmd.Flags().String("category", "", "category name")
	addCmd.Flags().String("merchant", "", "merchant name")
	addCmd.Flags().String("description", "", "description")
	addCmd.Flags().String("date", "", "date (YYYY-MM-DD, defaults to today; start date when --frequency is set)")
	addCmd.Flags().String("frequency", "", "recurring frequency: weekly, monthly, or yearly (omit for a one-off expense)")
	addCmd.Flags().String("end-date", "", "recurring end date (YYYY-MM-DD, optional)")
	addCmd.Flags().Int64("day-of-month", 0, "day of month for monthly/yearly recurrence (optional)")

	addCmd.Flags().String("json", "", "JSON input: inline string, @path/to/file, or - for stdin (object or array). Run with --schema or --example to discover the shape.")
	addCmd.Flags().Bool("schema", false, "print the JSON Schema for --json input and exit")
	addCmd.Flags().Bool("example", false, "print a sample JSON document and exit")
	addCmd.Flags().Bool("dry-run", false, "validate input without writing")
	addCmd.Flags().String("output", "", "output format: json (default: human; auto-json when --json is an array)")
	addCmd.Flags().Bool("strict", false, "stop on the first failed row in array mode (default: continue)")

	// --json is mutually exclusive with the per-field flags
	for _, f := range []string{"amount", "category", "merchant", "description", "date", "frequency", "end-date", "day-of-month"} {
		addCmd.MarkFlagsMutuallyExclusive("json", f)
	}

	rootCmd.AddCommand(addCmd)
}

func loadTimezone(tz string) *time.Location {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.FixedZone("UTC+8", 8*60*60)
	}
	return loc
}
