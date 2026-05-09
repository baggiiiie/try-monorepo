#!/bin/bash
# E2E: If two pushes have the same client_updated_at, changed data should still be applied.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db
start_test_server

pull_response=$(api_curl "$EXPENSE_API/api/sync/pull?since=0")
food_id=$(echo "$pull_response" | jq -r '.categories[] | select(.name == "Food & Dining") | .id')
expense_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
client_updated_at=$(date +%s)

first_push=$(api_curl -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"expenses\": [{
            \"id\": \"$expense_id\",
            \"amount\": 1000,
            \"currency\": \"SGD\",
            \"category_id\": \"$food_id\",
            \"merchant\": \"Old Merchant\",
            \"date\": $client_updated_at,
            \"client_updated_at\": $client_updated_at
        }],
        \"categories\": []
    }")

same_timestamp=$client_updated_at

second_push=$(api_curl -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"expenses\": [{
            \"id\": \"$expense_id\",
            \"amount\": 1000,
            \"currency\": \"SGD\",
            \"category_id\": \"$food_id\",
            \"merchant\": \"New Merchant\",
            \"date\": $client_updated_at,
            \"client_updated_at\": $same_timestamp
        }],
        \"categories\": []
    }")

assert_json_contains "$second_push" '.expenses[0].merchant' "New Merchant"

cli_list=$($EXPENSE list --json)
assert_json_contains "$cli_list" '.count' "1"
assert_json_contains "$cli_list" '.expenses[0].merchant' "New Merchant"

echo "PASS: sync equal timestamp update"
