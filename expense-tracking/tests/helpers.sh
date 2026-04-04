#!/bin/bash
# Shared test helpers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EXPENSE="$PROJECT_ROOT/server/bin/expense"

setup_test_db() {
    TEST_DIR=$(mktemp -d)
    export EXPENSE_DB="$TEST_DIR/test.db"
    export EXPENSE_CONFIG="$TEST_DIR/preferences.json"
    trap cleanup EXIT
}

start_test_server() {
    SERVER_PORT=$(shuf -i 10000-60000 -n 1 2>/dev/null || echo $((RANDOM % 50000 + 10000)))
    $EXPENSE serve --port "$SERVER_PORT" --db "$EXPENSE_DB" &
    SERVER_PID=$!
    export EXPENSE_API="http://localhost:$SERVER_PORT"
    for i in $(seq 1 50); do
        curl -s "$EXPENSE_API/api/health" > /dev/null 2>&1 && return
        sleep 0.1
    done
    echo "FAIL: server didn't start on port $SERVER_PORT"
    exit 1
}

cleanup() {
    [[ -n "${SERVER_PID:-}" ]] && kill "$SERVER_PID" 2>/dev/null || true
    [[ -n "${TEST_DIR:-}" ]] && rm -rf "$TEST_DIR" || true
}

# --- Assertions ---

assert_equals() {
    local actual="$1" expected="$2"
    if [[ "$actual" != "$expected" ]]; then
        echo "FAIL: expected '$expected', got '$actual'"
        echo "  at: ${BASH_SOURCE[1]}:${BASH_LINENO[0]}"
        exit 1
    fi
}

assert_contains() {
    local haystack="$1" needle="$2"
    if [[ "$haystack" != *"$needle"* ]]; then
        echo "FAIL: expected output to contain '$needle'"
        echo "  got: $haystack"
        echo "  at: ${BASH_SOURCE[1]}:${BASH_LINENO[0]}"
        exit 1
    fi
}

assert_json_contains() {
    local json="$1" path="$2" expected="$3"
    actual=$(echo "$json" | jq -r "$path" 2>/dev/null)
    if [[ "$actual" != "$expected" ]]; then
        echo "FAIL: expected $path = '$expected', got '$actual'"
        echo "  at: ${BASH_SOURCE[1]}:${BASH_LINENO[0]}"
        exit 1
    fi
}

assert_http_status() {
    local method="$1" url="$2" expected="$3"
    shift 3
    status=$(curl -s -o /dev/null -w '%{http_code}' -X "$method" "$@" "$EXPENSE_API$url")
    if [[ "$status" != "$expected" ]]; then
        echo "FAIL: $method $url returned $status, expected $expected"
        echo "  at: ${BASH_SOURCE[1]}:${BASH_LINENO[0]}"
        exit 1
    fi
}
