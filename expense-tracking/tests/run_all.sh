#!/bin/bash
# Build the binary and run all E2E tests
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "=== Building expense binary ==="
cd "$PROJECT_ROOT/server"
go build -o bin/expense ./cmd/expense/
echo "Built: server/bin/expense"

echo ""
echo "=== Running E2E tests ==="

passed=0
failed=0
failures=()

for test_file in "$SCRIPT_DIR"/e2e/*.sh; do
    test_name=$(basename "$test_file")
    printf "  %-40s " "$test_name"

    if output=$(bash "$test_file" 2>&1); then
        echo "✓"
        passed=$((passed + 1))
    else
        echo "✗"
        failures+=("$test_name")
        echo "$output" | sed 's/^/    /'
        failed=$((failed + 1))
    fi
done

echo ""
echo "=== Results: $passed passed, $failed failed ==="

if [[ $failed -gt 0 ]]; then
    echo "Failed tests:"
    for f in "${failures[@]}"; do
        echo "  - $f"
    done
    exit 1
fi
