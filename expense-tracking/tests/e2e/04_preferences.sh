#!/bin/bash
# E2E: User preferences
# Verify defaults, change them, verify persistence across commands.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db

# --- Default currency should be SGD ---
config=$($EXPENSE config get currency)
assert_contains "$config" "SGD"

# --- Change currency ---
$EXPENSE config set currency USD
config=$($EXPENSE config get currency)
assert_contains "$config" "USD"

# --- New expense should use the new default currency ---
$EXPENSE add --amount 10.00 --category "Food & Dining" --merchant "McDonalds"
expenses=$($EXPENSE list --json)
assert_json_contains "$expenses" '.expenses[0].currency' "USD"

# --- Change timezone ---
$EXPENSE config set timezone "America/New_York"
config=$($EXPENSE config get timezone)
assert_contains "$config" "America/New_York"

# --- Preferences should survive a "restart" (they're persisted to disk) ---
config_all=$($EXPENSE config get --json)
assert_json_contains "$config_all" '.currency' "USD"
assert_json_contains "$config_all" '.timezone' "America/New_York"

echo "PASS: preferences"
