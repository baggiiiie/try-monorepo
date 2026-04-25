#!/bin/bash
# E2E: syncing default categories from a fresh client should reconcile by name
# without duplicating server defaults or breaking expense references.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db
start_test_server

updated_at=$(date +%s)
local_category_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
local_category_client_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
expense_client_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)

initial_pull=$(api_curl "$EXPENSE_API/api/sync/pull?since=0")
assert_json_contains "$initial_pull" '.categories | length' "8"

server_food_id_before=$(echo "$initial_pull" | jq -r '.categories[] | select(.name == "Food & Dining") | .id')
if [[ -z "$server_food_id_before" || "$server_food_id_before" == "null" ]]; then
    echo "FAIL: expected seeded Food & Dining category"
    exit 1
fi

if [[ "$server_food_id_before" == "$local_category_id" ]]; then
    echo "FAIL: expected client local category ID to differ from server seeded ID"
    exit 1
fi

push_response=$(api_curl -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"categories\": [{
            \"id\": \"$local_category_id\",
            \"client_id\": \"$local_category_client_id\",
            \"name\": \"Food & Dining\",
            \"icon\": \"🍽️\",
            \"updated_at\": $updated_at
        }],
        \"expenses\": [{
            \"client_id\": \"$expense_client_id\",
            \"amount\": 1234,
            \"currency\": \"SGD\",
            \"category_id\": \"$local_category_id\",
            \"merchant\": \"Fresh Install Test\",
            \"description\": \"Default category reconciliation\",
            \"date\": $updated_at,
            \"updated_at\": $updated_at
        }]
    }")

assert_json_contains "$push_response" '.categories | length' "1"
assert_json_contains "$push_response" '.expenses | length' "1"
assert_json_contains "$push_response" '.expenses[0].merchant' "Fresh Install Test"
assert_json_contains "$push_response" '.expenses[0].category' "Food & Dining"

returned_category_id=$(echo "$push_response" | jq -r '.categories[0].id')
returned_expense_category_id=$(echo "$push_response" | jq -r '.expenses[0].category_id')
assert_equals "$returned_expense_category_id" "$returned_category_id"
assert_equals "$returned_category_id" "$local_category_id"

food_count=$(sqlite3 "$EXPENSE_DB" "SELECT COUNT(*) FROM categories WHERE name = 'Food & Dining' AND deleted_at IS NULL;")
assert_equals "$food_count" "1"

db_food_id=$(sqlite3 "$EXPENSE_DB" "SELECT id FROM categories WHERE name = 'Food & Dining' AND deleted_at IS NULL;")
db_food_client_id=$(sqlite3 "$EXPENSE_DB" "SELECT client_id FROM categories WHERE name = 'Food & Dining' AND deleted_at IS NULL;")
assert_equals "$db_food_id" "$local_category_id"
assert_equals "$db_food_client_id" "$local_category_client_id"

db_expense_category_id=$(sqlite3 "$EXPENSE_DB" "SELECT category_id FROM expenses WHERE client_id = '$expense_client_id';")
assert_equals "$db_expense_category_id" "$local_category_id"

final_pull=$(api_curl "$EXPENSE_API/api/sync/pull?since=0")
final_food_count=$(echo "$final_pull" | jq '[.categories[] | select(.name == "Food & Dining" and (.deleted_at == null))] | length')
assert_equals "$final_food_count" "1"

push_again=$(api_curl -X POST "$EXPENSE_API/api/sync/push" \
    -H "Content-Type: application/json" \
    -d "{
        \"categories\": [{
            \"id\": \"$local_category_id\",
            \"client_id\": \"$local_category_client_id\",
            \"name\": \"Food & Dining\",
            \"icon\": \"🍽️\",
            \"updated_at\": $updated_at
        }],
        \"expenses\": [{
            \"client_id\": \"$expense_client_id\",
            \"amount\": 1234,
            \"currency\": \"SGD\",
            \"category_id\": \"$local_category_id\",
            \"merchant\": \"Fresh Install Test\",
            \"description\": \"Default category reconciliation\",
            \"date\": $updated_at,
            \"updated_at\": $updated_at
        }]
    }")

assert_json_contains "$push_again" '.categories | length' "1"
assert_json_contains "$push_again" '.expenses | length' "1"

expense_count=$(sqlite3 "$EXPENSE_DB" "SELECT COUNT(*) FROM expenses WHERE merchant = 'Fresh Install Test';")
assert_equals "$expense_count" "1"

echo "PASS: sync reconcile default categories"
