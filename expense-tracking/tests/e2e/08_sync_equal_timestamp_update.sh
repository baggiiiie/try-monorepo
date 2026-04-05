#!/bin/bash
# E2E: If two pushes have the same updated_at, changed data should still be applied.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db
start_test_server

pull_response=$(curl -s "$EXPENSE_API/api/sync/pull?since=0")
food_id=$(echo "$pull_response" | jq -r '.categories[] | select(.name == "Food & Dining") | .id')
client_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
updated_at=$(date +%s)

first_push=$(curl -s -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"expenses\": [{
            \"client_id\": \"$client_id\",
            \"amount\": 1000,
            \"currency\": \"SGD\",
            \"category_id\": \"$food_id\",
            \"merchant\": \"Old Merchant\",
            \"date\": $updated_at,
            \"updated_at\": $updated_at
        }],
        \"categories\": []
    }")

same_timestamp=$(echo "$first_push" | jq -r '.expenses[0].updated_at')

second_push=$(curl -s -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"expenses\": [{
            \"client_id\": \"$client_id\",
            \"amount\": 1000,
            \"currency\": \"SGD\",
            \"category_id\": \"$food_id\",
            \"merchant\": \"New Merchant\",
            \"date\": $updated_at,
            \"updated_at\": $same_timestamp
        }],
        \"categories\": []
    }")

assert_json_contains "$second_push" '.expenses[0].merchant' "New Merchant"

cli_list=$($EXPENSE list --json)
assert_json_contains "$cli_list" '.count' "1"
assert_json_contains "$cli_list" '.expenses[0].merchant' "New Merchant"

echo "PASS: sync equal timestamp update"
