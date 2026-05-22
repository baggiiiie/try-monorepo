#!/bin/bash
# E2E: Web/PWA smoke checks
# Verifies the embedded web shell, PWA cache headers, cookie auth exchange,
# and wallet suggestion REST path used by the Apple Pay Shortcut/PWA review UI.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db
start_test_server

headers_file="$TEST_DIR/headers.txt"
body_file="$TEST_DIR/body.txt"

curl -s -D "$headers_file" -o "$body_file" "$EXPENSE_API/"
assert_contains "$(head -1 "$headers_file")" "200"
assert_contains "$(tr -d '\r' < "$headers_file")" "Cache-Control: no-cache"
assert_contains "$(cat "$body_file")" '<link rel="manifest" href="/manifest.webmanifest"'
assert_contains "$(cat "$body_file")" 'apple-mobile-web-app-capable'

asset_path=$(rg -o '/_app/immutable/[^" ]+\.js' "$body_file" | head -1)
if [[ -z "$asset_path" ]]; then
    echo "FAIL: expected index.html to reference an immutable JS asset"
    exit 1
fi

manifest=$(curl -s "$EXPENSE_API/manifest.webmanifest")
assert_json_contains "$manifest" ".display" "standalone"
assert_json_contains "$manifest" ".start_url" "/"

curl -s -D "$headers_file" -o /dev/null "$EXPENSE_API/manifest.webmanifest"
assert_contains "$(tr -d '\r' < "$headers_file")" "Content-Type: application/manifest+json"

curl -s -D "$headers_file" -o /dev/null "$EXPENSE_API/service-worker.js"
headers=$(tr -d '\r' < "$headers_file")
assert_contains "$headers" "Cache-Control: no-cache"
assert_contains "$headers" "Service-Worker-Allowed: /"

curl -s -D "$headers_file" -o /dev/null "$EXPENSE_API$asset_path"
assert_contains "$(tr -d '\r' < "$headers_file")" "Cache-Control: public, max-age=31536000, immutable"

curl -s -D "$headers_file" -o /dev/null \
    -X POST \
    -H "Authorization: Bearer $EXPENSE_SYNC_SECRET" \
    "$EXPENSE_API/api/auth/exchange"
headers=$(tr -d '\r' < "$headers_file")
assert_contains "$(head -1 "$headers_file")" "204"
assert_contains "$headers" "Set-Cookie: et_session=$EXPENSE_SYNC_SECRET"
assert_contains "$headers" "HttpOnly"
assert_contains "$headers" "Secure"
assert_contains "$headers" "SameSite=Strict"

preferences=$(curl -s -H "Cookie: et_session=$EXPENSE_SYNC_SECRET" "$EXPENSE_API/api/preferences")
assert_json_contains "$preferences" ".currency" "SGD"

captured_at=$(date +%s)
suggestion=$(api_curl -X POST "$EXPENSE_API/api/wallet-suggestions" \
    -H "Content-Type: application/json" \
    -d "{
        \"id\": \"ws-web-smoke\",
        \"merchant\": \"Shortcut Cafe\",
        \"amount\": 1299,
        \"currency\": \"SGD\",
        \"captured_at\": $captured_at,
        \"source\": \"shortcut\"
    }")
assert_json_contains "$suggestion" ".status" "pending"

suggestions=$(api_curl "$EXPENSE_API/api/wallet-suggestions?status=pending")
assert_json_contains "$suggestions" ".count" "1"
assert_json_contains "$suggestions" ".wallet_suggestions[0].id" "ws-web-smoke"

categories=$(api_curl "$EXPENSE_API/api/categories")
food_id=$(echo "$categories" | jq -r '.categories[] | select(.name == "Food & Dining") | .id')
if [[ -z "$food_id" || "$food_id" == "null" ]]; then
    echo "FAIL: expected seeded Food & Dining category"
    exit 1
fi

deleted_category=$(api_curl -X POST "$EXPENSE_API/api/categories" \
    -H "Content-Type: application/json" \
    -d '{"name":"Deleted Sync Error","icon":"x"}')
deleted_category_id=$(echo "$deleted_category" | jq -r '.id')
api_curl -X DELETE "$EXPENSE_API/api/categories/$deleted_category_id" > /dev/null
sync_error_status=$(curl -s -o "$body_file" -w '%{http_code}' \
    -H "Authorization: Bearer $EXPENSE_SYNC_SECRET" \
    -H "Content-Type: application/json" \
    -X POST \
    -d "{
        \"amount\": 999,
        \"currency\": \"SGD\",
        \"category_id\": \"$deleted_category_id\",
        \"merchant\": \"Deleted Category\",
        \"date\": $captured_at
    }" \
    "$EXPENSE_API/api/expenses")
assert_equals "$sync_error_status" "422"
assert_json_contains "$(cat "$body_file")" ".error" "category \"$deleted_category_id\" not found"

expense_id=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid)
confirm_response=$(api_curl -X POST "$EXPENSE_API/api/wallet-suggestions/ws-web-smoke/confirm" \
    -H "Content-Type: application/json" \
    -d "{
        \"id\": \"$expense_id\",
        \"amount\": 1299,
        \"currency\": \"SGD\",
        \"category_id\": \"$food_id\",
        \"merchant\": \"Shortcut Cafe\",
        \"description\": \"Confirmed from web smoke\",
        \"date\": $captured_at
    }")
assert_json_contains "$confirm_response" ".wallet_suggestion.status" "accepted"
assert_json_contains "$confirm_response" ".wallet_suggestion.linked_expense_id" "$expense_id"
assert_json_contains "$confirm_response" ".expense.id" "$expense_id"

pull_response=$(api_curl "$EXPENSE_API/api/sync/pull?since=0")
pulled_suggestion_count=$(echo "$pull_response" | jq '[.wallet_suggestions[] | select(.id == "ws-web-smoke" and .status == "accepted" and .linked_expense_id == "'"$expense_id"'")] | length')
assert_equals "$pulled_suggestion_count" "1"
pulled_expense_count=$(echo "$pull_response" | jq '[.expenses[] | select(.id == "'"$expense_id"'" and .merchant == "Shortcut Cafe")] | length')
assert_equals "$pulled_expense_count" "1"

echo "PASS: web pwa smoke"
