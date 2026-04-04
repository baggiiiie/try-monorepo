#!/bin/bash
# E2E: Edit and delete lifecycle
# Add an expense, realize it's wrong, edit it, then delete it. Verify state at each step.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db

# --- Add an expense with a mistake (wrong amount) ---
$EXPENSE add --amount 120.00 --category "Food & Dining" --merchant "Din Tai Fung" --description "Dinner"

expenses=$($EXPENSE list --json)
id=$(echo "$expenses" | jq -r '.expenses[0].id')
assert_json_contains "$expenses" '.expenses[0].amount' "12000"

# --- Edit: fix the amount ---
$EXPENSE edit "$id" --amount 52.00

expenses=$($EXPENSE list --json)
assert_json_contains "$expenses" '.expenses[0].amount' "5200"
# Other fields should be unchanged
assert_json_contains "$expenses" '.expenses[0].merchant' "Din Tai Fung"
assert_json_contains "$expenses" '.expenses[0].description' "Dinner"

# --- Edit: change category ---
$EXPENSE edit "$id" --category "Entertainment"

expenses=$($EXPENSE list --json)
assert_json_contains "$expenses" '.expenses[0].category' "Entertainment"

# --- Delete the expense ---
$EXPENSE delete "$id"

# Should not appear in normal list
expenses=$($EXPENSE list --json)
assert_json_contains "$expenses" '.count' "0"

# --- Show should indicate it's deleted (or return error) ---
# The record still exists (soft delete) but shouldn't be in list output
assert_json_contains "$expenses" '.expenses | length' "0"

echo "PASS: edit and delete lifecycle"
