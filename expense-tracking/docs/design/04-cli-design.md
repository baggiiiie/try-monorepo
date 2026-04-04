# CLI Design

## Principles

- **Agent-friendly**: Commands are predictable, output is parseable. A coding agent should be able to drive the entire app through the CLI.
- **Human-friendly**: Default output is readable tables/text. JSON output available via `--json` flag.
- **Consistent**: All commands follow the same patterns for flags, output, and error handling.

## Command Structure

```
expense <resource> <action> [args] [flags]
```

### Expenses

```sh
# Add an expense
expense add --amount 12.50 --category groceries --merchant "Whole Foods" --description "Weekly groceries" --date 2025-04-01

# List expenses
expense list
expense list --from 2025-04-01 --to 2025-04-30
expense list --category groceries
expense list --json

# Show a single expense
expense show <id>

# Edit an expense
expense edit <id> --amount 15.00
expense edit <id> --category dining

# Delete an expense
expense delete <id>
```

### Categories

```sh
# Add a category
expense category add --name "Groceries" --icon "🛒" --budget 500.00

# List categories
expense category list

# Edit a category
expense category edit <id> --budget 600.00

# Delete a category (soft delete; existing expenses keep their category)
expense category delete <id>
```

### Reporting

```sh
# Monthly summary
expense summary
expense summary --month 2025-04

# By category
expense summary --by-category

# Budget status
expense budget
```

### Import

```sh
# Import from CSV
expense import --file transactions.csv --format csv
```

## Output Modes

### Default (human-readable)

```
$ expense list --from 2025-04-01
ID       Date        Amount   Category    Merchant       Description
a1b2c3   2025-04-01  $12.50   Groceries   Whole Foods    Weekly groceries
d4e5f6   2025-04-02  $45.00   Dining      Sushi Place    Dinner with friends
─────────────────────────────────────────────────────────────────────────
Total: $57.50 (2 expenses)
```

### JSON (agent-friendly)

```
$ expense list --from 2025-04-01 --json
{
  "expenses": [
    {
      "id": "a1b2c3",
      "date": "2025-04-01",
      "amount": 1250,
      "currency": "USD",
      "category": "Groceries",
      "merchant": "Whole Foods",
      "description": "Weekly groceries"
    }
  ],
  "total": 1250,
  "count": 1
}
```

## Error Handling

- Exit code 0 on success, non-zero on failure.
- Errors go to stderr, data goes to stdout.
- Error messages include actionable information:
  ```
  Error: category "foo" not found. Run 'expense category list' to see available categories.
  ```

## Agent Interaction Pattern

A coding agent can use the CLI to:

1. **Query state**: `expense list --json`, `expense category list --json`
2. **Make changes**: `expense add ...`, `expense edit ...`
3. **Verify changes**: `expense show <id> --json`
4. **Generate reports**: `expense summary --json`

The `--json` flag on every read command ensures agents can parse output reliably.
