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

// AddInput is the JSON shape accepted by `expense add --json`.
// One source of truth for both schema generation and parsing.
type AddInput struct {
	Amount      float64 `json:"amount"`             // major units, e.g. 12.50
	Currency    string  `json:"currency,omitempty"` // defaults to user preference
	Category    string  `json:"category"`           // category name
	Merchant    string  `json:"merchant,omitempty"`
	Description string  `json:"description,omitempty"`
	Date        string  `json:"date,omitempty"` // YYYY-MM-DD; defaults to today
}

var addCmd = &cobra.Command{
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
    expense add --dry-run    # validate without writing

For recurring expenses, see 'expense add-recurring'.`,
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
	jsonArg, _ := cmd.Flags().GetString("json")

	inputs, err := collectAddInputs(cmd, jsonArg)
	if err != nil {
		return err
	}

	loc := loadTimezone(application.Preferences.Timezone)
	results := make([]addResult, 0, len(inputs))
	var firstErr error
	for i, in := range inputs {
		res := processAddInput(cmd.Context(), i, in, loc, dryRun)
		results = append(results, res)
		if res.Error != "" {
			firstErr = fmt.Errorf("row %d: %s", i, res.Error)
			break
		}
	}

	if output == "json" {
		return writeAddJSONOutput(cmd.OutOrStdout(), results, dryRun, firstErr)
	}
	return writeAddHumanOutput(cmd.OutOrStdout(), results, dryRun, firstErr)
}

func collectAddInputs(cmd *cobra.Command, jsonArg string) ([]AddInput, error) {
	if jsonArg != "" {
		raw, err := readJSONArg(jsonArg)
		if err != nil {
			return nil, err
		}
		inputs, err := parseJSONInputs[AddInput](raw)
		if err != nil {
			return nil, fmt.Errorf("parsing --json: %w", err)
		}
		return inputs, nil
	}
	in, err := addInputFromFlags(cmd)
	if err != nil {
		return nil, err
	}
	return []AddInput{in}, nil
}

type addResult struct {
	Index   int              `json:"index"`
	Expense *service.Expense `json:"expense,omitempty"`
	Error   string           `json:"error,omitempty"`
}

func processAddInput(ctx context.Context, index int, in AddInput, loc *time.Location, dryRun bool) addResult {
	if ctx == nil {
		ctx = context.Background()
	}
	amountCents := int64(math.Round(in.Amount * 100))

	var date int64
	if in.Date != "" {
		t, err := time.ParseInLocation("2006-01-02", in.Date, loc)
		if err != nil {
			return addResult{Index: index, Error: fmt.Sprintf("invalid date %q (expected YYYY-MM-DD): %v", in.Date, err)}
		}
		date = t.Unix()
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
			return addResult{Index: index, Error: err.Error()}
		}
		return addResult{Index: index}
	}
	exp, err := application.ExpenseService.Create(ctx, expInput)
	if err != nil {
		return addResult{Index: index, Error: err.Error()}
	}
	return addResult{Index: index, Expense: exp}
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
	return AddInput{
		Amount:      amount,
		Category:    category,
		Merchant:    merchant,
		Description: description,
		Date:        dateStr,
	}, nil
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

func writeAddHumanOutput(w io.Writer, results []addResult, dryRun bool, firstErr error) error {
	for _, r := range results {
		switch {
		case r.Error != "":
			fmt.Fprintf(w, "row %d: error: %s\n", r.Index, r.Error)
		case dryRun:
			fmt.Fprintf(w, "row %d: ok (dry-run)\n", r.Index)
		case r.Expense != nil:
			v := r.Expense
			fmt.Fprintf(w, "Added expense %s: %s %.2f at %s\n", v.ID, v.Currency, float64(v.Amount)/100, v.Merchant)
		}
	}
	return firstErr
}

func writeAddJSONOutput(w io.Writer, results []addResult, dryRun bool, firstErr error) error {
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
					"date":        map[string]any{"type": "string", "pattern": `^\d{4}-\d{2}-\d{2}$`, "description": "YYYY-MM-DD; defaults to today."},
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
		{Amount: 8.00, Category: "transport", Merchant: "Grab"},
	}
	b, _ := json.MarshalIndent(example, "", "  ")
	return string(b)
}

func init() {
	addCmd.Flags().Float64("amount", 0, "expense amount (e.g., 12.50)")
	addCmd.Flags().String("category", "", "category name")
	addCmd.Flags().String("merchant", "", "merchant name")
	addCmd.Flags().String("description", "", "description")
	addCmd.Flags().String("date", "", "date (YYYY-MM-DD, defaults to today)")

	addCmd.Flags().String("json", "", "JSON input: inline string, @path/to/file, or - for stdin (object or array). Run with --schema or --example to discover the shape.")
	addCmd.Flags().Bool("schema", false, "print the JSON Schema for --json input and exit")
	addCmd.Flags().Bool("example", false, "print a sample JSON document and exit")
	addCmd.Flags().Bool("dry-run", false, "validate input without writing")
	addCmd.Flags().String("output", "", "output format: human (default) or json")

	for _, f := range []string{"amount", "category", "merchant", "description", "date"} {
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
