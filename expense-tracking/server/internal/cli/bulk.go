package cli

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	dbsqlc "expense-tracker/internal/repository/sqlc"

	"github.com/invopop/jsonschema"
	"github.com/spf13/cobra"
	"github.com/spf13/pflag"
)

// BulkCommand is a generic scaffold for CLI commands that ingest one or
// more typed inputs (via flags or --json) and execute them per-row.
//
// Each row runs in its own SQLite transaction. In dry-run mode, the
// transaction is rolled back after a successful Process call so callers
// learn whether the row would succeed without persisting changes.
//
// Dry-run is therefore a real round-trip: it exercises the same service
// code paths (category lookups, currency rules, FK constraints) as a
// live run, just without the commit.
type BulkCommand[I any, O any] struct {
	Use   string
	Short string
	Long  string

	// AddFlags registers the per-command flags. They are automatically
	// marked mutually exclusive with --json.
	AddFlags func(*pflag.FlagSet)

	// InputFromFlags reads an input from the per-command flags when --json
	// is not used.
	InputFromFlags func(*cobra.Command) (I, error)

	// Tx provides the transaction runner used to wrap each row.
	Tx txRunnerProvider

	// Process executes one row against the provided transactional queries.
	// The runner handles the surrounding transaction, dry-run rollback,
	// and result aggregation.
	Process func(ctx context.Context, q *dbsqlc.Queries, in I) (O, error)

	// FormatHumanRow renders one successful row to the writer. The runner
	// renders error and dry-run rows itself.
	FormatHumanRow func(w io.Writer, index int, output O)

	// Example returns a value used to build the --example output.
	Example func() any

	// SchemaTitle and SchemaDescription customize the wrapped schema.
	SchemaTitle       string
	SchemaDescription string
}

// BulkResult is the per-row outcome reported by a BulkCommand run.
type BulkResult[O any] struct {
	Index  int    `json:"index"`
	Output O      `json:"output,omitempty"`
	Error  string `json:"error,omitempty"`
}

// errDryRunRollback is returned from inside the per-row transaction in
// dry-run mode to force a rollback. It is swallowed by the runner.
var errDryRunRollback = errors.New("dry-run rollback")

// frameworkFlags lists the flag names BulkCommand owns. Per-command
// flags are anything else registered via AddFlags.
var frameworkFlags = map[string]bool{
	"json":    true,
	"schema":  true,
	"example": true,
	"dry-run": true,
	"output":  true,
}

func (b BulkCommand[I, O]) Build() *cobra.Command {
	cmd := &cobra.Command{
		Use:   b.Use,
		Short: b.Short,
		Long:  b.Long,
		RunE:  b.run,
	}
	// Per-row failures are rendered inline; the final RunE error is just
	// a summary so cobra exits non-zero. SilenceUsage prevents the usage
	// dump after row errors; SilenceErrors stays off so flag-parsing
	// errors (e.g. mutually-exclusive flags) still print.
	cmd.SilenceUsage = true

	// Snapshot any flags that may have been set by parent commands so we
	// only mark the genuinely per-command flags as mutually exclusive.
	preExisting := map[string]bool{}
	cmd.Flags().VisitAll(func(f *pflag.Flag) { preExisting[f.Name] = true })

	if b.AddFlags != nil {
		b.AddFlags(cmd.Flags())
	}

	var perCmd []string
	cmd.Flags().VisitAll(func(f *pflag.Flag) {
		if !preExisting[f.Name] && !frameworkFlags[f.Name] {
			perCmd = append(perCmd, f.Name)
		}
	})

	cmd.Flags().String("json", "", "JSON input: inline string, @path/to/file, or - for stdin (object or array). Run with --schema or --example to discover the shape.")
	cmd.Flags().Bool("schema", false, "print the JSON Schema for --json input and exit")
	cmd.Flags().Bool("example", false, "print a sample JSON document and exit")
	cmd.Flags().Bool("dry-run", false, "execute each row inside a rolled-back transaction; reports what would succeed without writing")
	cmd.Flags().String("output", "", "output format: human (default) or json")

	for _, f := range perCmd {
		cmd.MarkFlagsMutuallyExclusive("json", f)
	}

	return cmd
}

func (b BulkCommand[I, O]) run(cmd *cobra.Command, _ []string) error {
	if printSchema, _ := cmd.Flags().GetBool("schema"); printSchema {
		fmt.Fprintln(cmd.OutOrStdout(), b.schemaJSON())
		return nil
	}
	if printExample, _ := cmd.Flags().GetBool("example"); printExample {
		fmt.Fprintln(cmd.OutOrStdout(), b.exampleJSON())
		return nil
	}

	dryRun, _ := cmd.Flags().GetBool("dry-run")
	output, _ := cmd.Flags().GetString("output")
	jsonArg, _ := cmd.Flags().GetString("json")

	inputs, err := b.collectInputs(cmd, jsonArg)
	if err != nil {
		return err
	}

	ctx := cmd.Context()
	if ctx == nil {
		ctx = context.Background()
	}

	results := make([]BulkResult[O], 0, len(inputs))
	failureCount := 0
	for i, in := range inputs {
		res := b.processOne(ctx, i, in, dryRun)
		if res.Error != "" {
			failureCount++
		}
		results = append(results, res)
	}

	if output == "json" {
		if err := b.renderJSON(cmd.OutOrStdout(), results, dryRun); err != nil {
			return err
		}
	} else {
		b.renderHuman(cmd.OutOrStdout(), results, dryRun)
	}

	if failureCount > 0 {
		return fmt.Errorf("%d of %d row(s) failed", failureCount, len(results))
	}
	return nil
}

func (b BulkCommand[I, O]) collectInputs(cmd *cobra.Command, jsonArg string) ([]I, error) {
	if jsonArg != "" {
		raw, err := readJSONArg(jsonArg)
		if err != nil {
			return nil, err
		}
		inputs, err := parseJSONInputs[I](raw)
		if err != nil {
			return nil, fmt.Errorf("parsing --json: %w", err)
		}
		return inputs, nil
	}
	in, err := b.InputFromFlags(cmd)
	if err != nil {
		return nil, err
	}
	return []I{in}, nil
}

func (b BulkCommand[I, O]) processOne(ctx context.Context, index int, in I, dryRun bool) BulkResult[O] {
	if b.Tx == nil {
		return BulkResult[O]{Index: index, Error: "bulk command transaction runner is not configured"}
	}
	runner := b.Tx()
	if runner == nil {
		return BulkResult[O]{Index: index, Error: "cli runtime is not initialized"}
	}

	var out O
	err := runner.WithTx(ctx, func(q *dbsqlc.Queries) error {
		result, err := b.Process(ctx, q, in)
		if err != nil {
			return err
		}
		out = result
		if dryRun {
			return errDryRunRollback
		}
		return nil
	})
	if err != nil && !errors.Is(err, errDryRunRollback) {
		return BulkResult[O]{Index: index, Error: err.Error()}
	}
	return BulkResult[O]{Index: index, Output: out}
}

func (b BulkCommand[I, O]) renderHuman(w io.Writer, results []BulkResult[O], dryRun bool) {
	for _, r := range results {
		switch {
		case r.Error != "":
			fmt.Fprintf(w, "row %d: error: %s\n", r.Index, r.Error)
		case dryRun:
			fmt.Fprintf(w, "row %d: ok (dry-run)\n", r.Index)
		default:
			b.FormatHumanRow(w, r.Index, r.Output)
		}
	}
}

func (b BulkCommand[I, O]) renderJSON(w io.Writer, results []BulkResult[O], dryRun bool) error {
	out := map[string]any{
		"dry_run": dryRun,
		"results": results,
	}
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	return enc.Encode(out)
}

// schemaJSON reflects the input type via invopop/jsonschema and wraps it
// in a oneOf so callers can pass either a single object or an array of
// objects to --json.
func (b BulkCommand[I, O]) schemaJSON() string {
	var zero I
	reflector := &jsonschema.Reflector{
		ExpandedStruct: false,
	}
	schema := reflector.Reflect(&zero)

	innerRef := schema.Ref
	schema.Ref = ""
	schema.OneOf = []*jsonschema.Schema{
		{Ref: innerRef},
		{Type: "array", Items: &jsonschema.Schema{Ref: innerRef}},
	}
	if b.SchemaTitle != "" {
		schema.Title = b.SchemaTitle
	}
	if b.SchemaDescription != "" {
		schema.Description = b.SchemaDescription
	}

	out, _ := json.MarshalIndent(schema, "", "  ")
	return string(out)
}

func (b BulkCommand[I, O]) exampleJSON() string {
	out, _ := json.MarshalIndent(b.Example(), "", "  ")
	return string(out)
}

// readJSONArg fetches JSON bytes from an inline string, an @path/to/file
// reference, or stdin when arg is "-".
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

// parseJSONInputs decodes a single JSON object or an array of objects
// into []T, rejecting unknown fields. A single object is returned as a
// one-element slice so callers can use a single processing path.
func parseJSONInputs[T any](raw []byte) ([]T, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil, fmt.Errorf("empty JSON input")
	}
	dec := json.NewDecoder(strings.NewReader(trimmed))
	dec.DisallowUnknownFields()
	if strings.HasPrefix(trimmed, "[") {
		var arr []T
		if err := dec.Decode(&arr); err != nil {
			return nil, err
		}
		return arr, nil
	}
	var single T
	if err := dec.Decode(&single); err != nil {
		return nil, err
	}
	return []T{single}, nil
}
