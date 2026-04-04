#!/bin/bash
# E2E: Daily expense workflow
# Simulates a user's typical day — add expenses, check summary, stay within budget.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db

# --- Verify default categories are seeded ---
categories=$($EXPENSE category list --json)
assert_json_contains "$categories" '.categories | length | . > 0' "true"
assert_json_contains "$categories" '[.categories[] | select(.name == "Food & Dining")] | length' "1"
assert_json_contains "$categories" '[.categories[] | select(.name == "Groceries")] | length' "1"

# --- Set a budget on Food & Dining ---
food_id=$(echo "$categories" | jq -r '.categories[] | select(.name == "Food & Dining") | .id')
$EXPENSE category edit "$food_id" --budget 100.00

# --- Add a few expenses throughout the day ---
$EXPENSE add --amount 5.50 --category "Food & Dining" --merchant "Kopitiam" --description "Breakfast"
$EXPENSE add --amount 8.00 --category "Food & Dining" --merchant "Hawker Centre" --description "Lunch"
$EXPENSE add --amount 45.00 --category "Groceries" --merchant "FairPrice" --description "Weekly groceries"
$EXPENSE add --amount 15.00 --category "Transport" --merchant "Grab" --description "Ride to office"

# --- Verify all 4 expenses exist ---
expenses=$($EXPENSE list --json)
assert_json_contains "$expenses" '.count' "4"

# --- Verify summary by category ---
summary=$($EXPENSE summary --json)
food_total=$(echo "$summary" | jq -r '.categories[] | select(.name == "Food & Dining") | .total')
grocery_total=$(echo "$summary" | jq -r '.categories[] | select(.name == "Groceries") | .total')
transport_total=$(echo "$summary" | jq -r '.categories[] | select(.name == "Transport") | .total')

assert_equals "$food_total" "1350"      # 5.50 + 8.00 = 13.50 = 1350 cents
assert_equals "$grocery_total" "4500"   # 45.00 = 4500 cents
assert_equals "$transport_total" "1500" # 15.00 = 1500 cents

# --- Verify budget status ---
budget=$($EXPENSE budget --json)
food_budget=$(echo "$budget" | jq -r '.categories[] | select(.name == "Food & Dining")')
assert_json_contains "$food_budget" '.budget' "10000"  # 100.00 = 10000 cents
assert_json_contains "$food_budget" '.spent' "1350"
# Should not be over budget
assert_json_contains "$food_budget" '.over_budget' "false"

echo "PASS: daily expense workflow"
