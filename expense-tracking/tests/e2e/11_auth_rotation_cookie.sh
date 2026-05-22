#!/bin/bash
# E2E: PWA cookie auth after sync-secret rotation
# Verifies that an old PWA session cookie stops working after secret rotation
# and that exchanging the new bearer secret restores cookie API access.
set -euo pipefail
source "$(dirname "$0")/../helpers.sh"

setup_test_db
unset EXPENSE_SYNC_SECRET

secret_file="$TEST_DIR/secret.json"
headers_file="$TEST_DIR/headers.txt"

start_file_secret_server() {
    SERVER_PORT=$(shuf -i 10000-60000 -n 1 2>/dev/null || echo $((RANDOM % 50000 + 10000)))
    export EXPENSE_API="http://localhost:$SERVER_PORT"
    $EXPENSE --db "$EXPENSE_DB" --config "$EXPENSE_CONFIG" --secret-file "$secret_file" serve --port "$SERVER_PORT" &
    SERVER_PID=$!
    for _ in $(seq 1 50); do
        curl -s "$EXPENSE_API/api/health" > /dev/null 2>&1 && return
        sleep 0.1
    done
    echo "FAIL: server didn't start on port $SERVER_PORT"
    exit 1
}

stop_file_secret_server() {
    [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
    wait "${SERVER_PID:-}" 2>/dev/null || true
    SERVER_PID=""
}

start_file_secret_server
old_secret=$(jq -r .secret "$secret_file")

curl -s -D "$headers_file" -o /dev/null \
    -X POST \
    -H "Authorization: Bearer $old_secret" \
    "$EXPENSE_API/api/auth/exchange"
assert_contains "$(head -1 "$headers_file")" "204"
assert_contains "$(tr -d '\r' < "$headers_file")" "Set-Cookie: et_session=$old_secret"

old_cookie_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Cookie: et_session=$old_secret" \
    "$EXPENSE_API/api/preferences")
assert_equals "$old_cookie_status" "200"

stop_file_secret_server
$EXPENSE --secret-file "$secret_file" secret rotate > /dev/null
new_secret=$(jq -r .secret "$secret_file")
if [[ "$new_secret" == "$old_secret" || -z "$new_secret" || "$new_secret" == "null" ]]; then
    echo "FAIL: expected secret rotation to write a new secret"
    exit 1
fi

start_file_secret_server

old_cookie_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Cookie: et_session=$old_secret" \
    "$EXPENSE_API/api/preferences")
assert_equals "$old_cookie_status" "401"

old_exchange_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $old_secret" \
    "$EXPENSE_API/api/auth/exchange")
assert_equals "$old_exchange_status" "401"

curl -s -D "$headers_file" -o /dev/null \
    -X POST \
    -H "Authorization: Bearer $new_secret" \
    "$EXPENSE_API/api/auth/exchange"
assert_contains "$(head -1 "$headers_file")" "204"
assert_contains "$(tr -d '\r' < "$headers_file")" "Set-Cookie: et_session=$new_secret"

new_cookie_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Cookie: et_session=$new_secret" \
    "$EXPENSE_API/api/preferences")
assert_equals "$new_cookie_status" "200"

new_bearer_status=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer $new_secret" \
    "$EXPENSE_API/api/preferences")
assert_equals "$new_bearer_status" "200"

echo "PASS: auth rotation cookie"
