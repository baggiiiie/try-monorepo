#!/bin/bash
# E2E: Full sync roundtrip
# Simulates the iOS app sync cycle: push local changes, pull remote changes,
# verify both sides are consistent.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db
start_test_server

# ============================================================
# Scenario 1: CLI adds data, "iOS" pulls it
# ============================================================

# Add expense via CLI (server-side)
$EXPENSE add --amount 10.00 --category "Food & Dining" --merchant "Ya Kun"

# Simulate iOS pull — fetch everything since epoch
pull_response=$(api_curl "$EXPENSE_API/api/sync/pull?since=0")

# Should contain the expense
assert_json_contains "$pull_response" '.expenses | length' "1"
assert_json_contains "$pull_response" '.expenses[0].merchant' "Ya Kun"
assert_json_contains "$pull_response" '.expenses[0].amount' "1000"
client_clock=$(echo "$pull_response" | jq -r '.expenses[0].client_updated_at')
if [[ "$client_clock" == "null" || -z "$client_clock" || "$client_clock" == "0" ]]; then
    echo "FAIL: expected pulled expense to include client_updated_at"
    exit 1
fi

# Should also contain seeded categories
category_count=$(echo "$pull_response" | jq '.categories | length')
if [[ "$category_count" -lt 1 ]]; then
    echo "FAIL: expected categories in pull response"
    exit 1
fi

# ============================================================
# Scenario 2: "iOS" pushes data, CLI sees it
# ============================================================

# Simulate iOS push — send a new expense with an id
expense_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
food_id=$(echo "$pull_response" | jq -r '.categories[] | select(.name == "Food & Dining") | .id')
client_updated_at=$(date +%s)

push_response=$(api_curl -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"expenses\": [{
            \"id\": \"$expense_id\",
            \"amount\": 2500,
            \"currency\": \"SGD\",
            \"category_id\": \"$food_id\",
            \"merchant\": \"Toast Box\",
            \"description\": \"Kaya toast set\",
            \"date\": $client_updated_at,
            \"client_updated_at\": $client_updated_at
        }],
        \"categories\": []
    }")

# Verify push response acknowledges the new expense
assert_json_contains "$push_response" '.expenses | length' "1"
assert_json_contains "$push_response" '.expenses[0].client_updated_at' "$client_updated_at"

# Verify CLI can see the pushed expense
cli_list=$($EXPENSE list --json)
assert_json_contains "$cli_list" '.count' "2"
toast_box=$(echo "$cli_list" | jq '[.expenses[] | select(.merchant == "Toast Box")] | length')
assert_equals "$toast_box" "1"

# ============================================================
# Scenario 3: Deduplication — push same id again
# ============================================================

push_again=$(api_curl -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"expenses\": [{
            \"id\": \"$expense_id\",
            \"amount\": 2500,
            \"currency\": \"SGD\",
            \"category_id\": \"$food_id\",
            \"merchant\": \"Toast Box\",
            \"description\": \"Kaya toast set\",
            \"date\": $client_updated_at,
            \"client_updated_at\": $client_updated_at
        }],
        \"categories\": []
    }")

# Should still be 2 total, not 3
cli_list=$($EXPENSE list --json)
assert_json_contains "$cli_list" '.count' "2"

# ============================================================
# Scenario 4: Delete on server, iOS pulls the delete
# ============================================================

# Get the ID of the Ya Kun expense
yakun_id=$(echo "$cli_list" | jq -r '[.expenses[] | select(.merchant == "Ya Kun")][0].id')
$EXPENSE delete "$yakun_id"

# Pull since a recent timestamp — should include the soft-deleted record
pull_response=$(api_curl "$EXPENSE_API/api/sync/pull?since=0")
deleted=$(echo "$pull_response" | jq '[.expenses[] | select(.merchant == "Ya Kun")][0].deleted_at')

if [[ "$deleted" == "null" || "$deleted" == "0" ]]; then
    echo "FAIL: expected Ya Kun expense to have deleted_at set"
    exit 1
fi

echo "PASS: sync roundtrip"
