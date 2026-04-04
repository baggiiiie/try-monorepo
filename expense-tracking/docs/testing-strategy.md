# Testing Strategy

## Principle

Tests are **black-box and end-to-end**. They exercise the system through its public interfaces (CLI binary and HTTP API), never through internal Go functions. This ensures:

1. **Agent can't game them** — tests are written once by the human (or reviewed carefully), then the agent implements code to make them pass.
2. **Tests prove usability** — if the test passes, the feature actually works.
3. **Tests survive refactors** — internal restructuring doesn't break tests as long as behavior is preserved.

## Approach: Shell-Based E2E Tests

Tests are **bash scripts** that run the compiled `expense` binary and/or curl the HTTP API against a real SQLite database. Each test script:

1. Creates a fresh temp directory with a clean DB
2. Runs commands or HTTP requests
3. Asserts output using grep/jq/diff
4. Exits non-zero on failure

All tests live in `tests/` and are run via `make test` or a simple runner script.

## Test Structure

```
tests/
├── run_all.sh                  # runner: builds binary, runs all test scripts
├── helpers.sh                  # shared setup/teardown/assertion helpers
├── cli/
│   ├── 01_add_and_list.sh      # add an expense, list it, verify fields
│   ├── 02_categories.sh        # CRUD categories, verify defaults seeded
│   ├── 03_edit_and_delete.sh   # edit fields, soft delete, verify gone from list
│   ├── 04_summary.sh           # add expenses across categories, verify summary
│   ├── 05_budget.sh            # set budget, exceed it, verify warning
│   ├── 06_config.sh            # get/set preferences, verify persistence
│   └── 07_json_output.sh       # verify --json output is valid parseable JSON
├── api/
│   ├── 01_crud.sh              # create/read/update/delete via HTTP
│   ├── 02_sync_push.sh         # push records, verify server state via CLI
│   ├── 03_sync_pull.sh         # add via CLI, pull via HTTP, verify response
│   └── 04_sync_dedup.sh        # push same client_id twice, verify no duplicate
└── e2e/
    ├── 01_cli_to_api.sh        # add via CLI, fetch via API, verify match
    ├── 02_api_to_cli.sh        # create via API, list via CLI, verify match
    └── 03_full_sync_flow.sh    # simulate iOS sync: push → pull → modify → push
```

## Example Test

```bash
#!/bin/bash
# tests/cli/01_add_and_list.sh — Add an expense and verify it appears in list
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db

# Add an expense
$EXPENSE add --amount 12.50 --category "Food & Dining" --merchant "Hawker Centre" --description "Chicken rice"

# List and verify
output=$($EXPENSE list --json)

assert_json_contains "$output" '.expenses[0].merchant' "Hawker Centre"
assert_json_contains "$output" '.expenses[0].amount' 1250
assert_json_contains "$output" '.expenses[0].currency' "SGD"
assert_json_contains "$output" '.expenses[0].description' "Chicken rice"
assert_json_contains "$output" '.count' 1

echo "PASS: add and list"
```

## Example Helpers

```bash
# tests/helpers.sh
EXPENSE="./bin/expense"
SERVER_PORT=0  # assigned dynamically

setup_test_db() {
    export EXPENSE_DB="$(mktemp -d)/test.db"
    export EXPENSE_CONFIG="$(mktemp -d)/preferences.json"
}

start_test_server() {
    SERVER_PORT=$(shuf -i 10000-60000 -n 1)
    $EXPENSE serve --port $SERVER_PORT --db "$EXPENSE_DB" &
    SERVER_PID=$!
    export EXPENSE_API="http://localhost:$SERVER_PORT"
    # wait for server to be ready
    for i in $(seq 1 30); do
        curl -s "$EXPENSE_API/api/health" > /dev/null 2>&1 && return
        sleep 0.1
    done
    echo "FAIL: server didn't start"
    exit 1
}

cleanup() {
    [[ -n "${SERVER_PID:-}" ]] && kill $SERVER_PID 2>/dev/null || true
    rm -rf "$EXPENSE_DB" "$EXPENSE_CONFIG"
}
trap cleanup EXIT

assert_json_contains() {
    local json="$1" path="$2" expected="$3"
    actual=$(echo "$json" | jq -r "$path")
    if [[ "$actual" != "$expected" ]]; then
        echo "FAIL: expected $path = '$expected', got '$actual'"
        exit 1
    fi
}

assert_http_status() {
    local method="$1" url="$2" expected="$3"
    shift 3
    status=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$@" "$EXPENSE_API$url")
    if [[ "$status" != "$expected" ]]; then
        echo "FAIL: $method $url returned $status, expected $expected"
        exit 1
    fi
}
```

## What Each Test Category Proves

| Category    | Proves                                                            |
| ----------- | ----------------------------------------------------------------- |
| `cli/`      | The binary works as documented in 04-cli-design.md                |
| `api/`      | HTTP endpoints accept/return correct JSON, sync logic is correct  |
| `e2e/`      | CLI and API see the same data — the system is internally consistent |

## Rules

1. **Tests are written/reviewed by the human, not the agent.** The agent's job is to make them pass.
2. **Tests use only public interfaces** — CLI flags, HTTP endpoints, JSON output. No importing Go packages.
3. **Each test is independent** — fresh DB, no shared state between scripts.
4. **Tests are fast** — no sleeps, no network calls, local SQLite only.
5. **Failures are loud** — print what was expected vs actual, exit 1 immediately.

## Running

```bash
make test          # build + run all tests
make test-cli      # just CLI tests
make test-api      # just API tests
make test-e2e      # just E2E tests
```
