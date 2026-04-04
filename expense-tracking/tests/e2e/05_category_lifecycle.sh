#!/bin/bash
# E2E: Category lifecycle
# Create, use, rename, delete a category. Verify expenses are handled correctly.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db

# --- Create a custom category ---
$EXPENSE category add --name "Bubble Tea" --icon "🧋" --budget 50.00

categories=$($EXPENSE category list --json)
bbt_id=$(echo "$categories" | jq -r '.categories[] | select(.name == "Bubble Tea") | .id')

if [[ -z "$bbt_id" || "$bbt_id" == "null" ]]; then
    echo "FAIL: custom category not created"
    exit 1
fi

# --- Add expenses to the custom category ---
$EXPENSE add --amount 6.50 --category "Bubble Tea" --merchant "Gong Cha"
$EXPENSE add --amount 7.00 --category "Bubble Tea" --merchant "LiHO"

expenses=$($EXPENSE list --json)
assert_json_contains "$expenses" '.count' "2"

# --- Rename the category ---
$EXPENSE category edit "$bbt_id" --name "Drinks"

# Expenses should still be listed and associated with the renamed category
expenses=$($EXPENSE list --json)
assert_json_contains "$expenses" '.count' "2"
assert_json_contains "$expenses" '.expenses[0].category' "Drinks"

# --- Delete the category ---
$EXPENSE category delete "$bbt_id"

# Category should not appear in list
categories=$($EXPENSE category list --json)
drinks=$(echo "$categories" | jq '[.categories[] | select(.name == "Drinks")] | length')
assert_equals "$drinks" "0"

# Expenses that used this category should still exist (soft delete doesn't cascade)
expenses=$($EXPENSE list --json)
assert_json_contains "$expenses" '.count' "2"

echo "PASS: category lifecycle"
