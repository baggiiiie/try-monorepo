#!/bin/bash
# E2E: A pushed expense can reference a newly pushed category from the same request.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db
start_test_server

local_category_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
expense_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
client_updated_at=$(date +%s)

push_response=$(api_curl -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"categories\": [{
            \"id\": \"$local_category_id\",
            \"name\": \"Offline Category\",
            \"icon\": \"🧪\",
            \"client_updated_at\": $client_updated_at
        }],
        \"expenses\": [{
            \"id\": \"$expense_id\",
            \"amount\": 650,
            \"currency\": \"SGD\",
            \"category_id\": \"$local_category_id\",
            \"merchant\": \"Local First\",
            \"description\": \"Created offline\",
            \"date\": $client_updated_at,
            \"client_updated_at\": $client_updated_at
        }]
    }")

assert_json_contains "$push_response" '.categories | length' "1"
assert_json_contains "$push_response" '.expenses | length' "1"
assert_json_contains "$push_response" '.expenses[0].merchant' "Local First"
assert_json_contains "$push_response" '.expenses[0].category' "Offline Category"

server_category_id=$(echo "$push_response" | jq -r '.categories[0].id')
expense_category_id=$(echo "$push_response" | jq -r '.expenses[0].category_id')
assert_equals "$expense_category_id" "$server_category_id"

cli_list=$($EXPENSE list --json)
assert_json_contains "$cli_list" '.count' "1"
assert_json_contains "$cli_list" '.expenses[0].category' "Offline Category"
assert_json_contains "$cli_list" '.expenses[0].merchant' "Local First"

echo "PASS: sync new category reference"
