#!/bin/bash
# E2E: Client-side delete pushed to server should soft-delete the record.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db
start_test_server

pull_response=$(api_curl "$EXPENSE_API/api/sync/pull?since=0")
food_id=$(echo "$pull_response" | jq -r '.categories[] | select(.name == "Food & Dining") | .id')
expense_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
updated_at=$(date +%s)

after_create=$(api_curl -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"expenses\": [{
            \"id\": \"$expense_id\",
            \"amount\": 1234,
            \"currency\": \"SGD\",
            \"category_id\": \"$food_id\",
            \"merchant\": \"Delete Me\",
            \"date\": $updated_at,
            \"updated_at\": $updated_at
        }],
        \"categories\": []
    }")

assert_json_contains "$after_create" '.expenses | length' "1"

# Re-push the same record as deleted.
delete_marker=$((updated_at + 1))
after_delete=$(api_curl -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"expenses\": [{
            \"id\": \"$expense_id\",
            \"amount\": 1234,
            \"currency\": \"SGD\",
            \"category_id\": \"$food_id\",
            \"merchant\": \"Delete Me\",
            \"date\": $updated_at,
            \"updated_at\": $delete_marker,
            \"deleted_at\": $delete_marker
        }],
        \"categories\": []
    }")

deleted_at=$(echo "$after_delete" | jq -r '.expenses[0].deleted_at')
if [[ "$deleted_at" == "null" || -z "$deleted_at" ]]; then
    echo "FAIL: expected pushed delete to set deleted_at"
    exit 1
fi

cli_list=$($EXPENSE list --json)
assert_json_contains "$cli_list" '.count' "0"

pull_after_delete=$(api_curl "$EXPENSE_API/api/sync/pull?since=0")
deleted=$(echo "$pull_after_delete" | jq --arg expense_id "$expense_id" '[.expenses[] | select(.id == $expense_id)] | length')
assert_equals "$deleted" "1"

deleted_pull_value=$(echo "$pull_after_delete" | jq -r --arg expense_id "$expense_id" '[.expenses[] | select(.id == $expense_id)][0].deleted_at')
if [[ "$deleted_pull_value" == "null" || -z "$deleted_pull_value" ]]; then
    echo "FAIL: expected deleted expense in pull response"
    exit 1
fi

echo "PASS: sync push delete"
