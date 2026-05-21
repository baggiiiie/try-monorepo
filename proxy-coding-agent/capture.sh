#!/usr/bin/env sh
# capture.sh <agent> [prompt-file-or-text]
#
# Boots mitmdump with the JSONL addon, runs the named coding agent
# non-interactively, then shuts mitmdump down. Writes:
#
#   captures/<agent>-<timestamp>.flow    (mitmproxy native, replayable)
#   captures/<agent>-<timestamp>.jsonl   (one LLM-host flow per line)
#   captures/<agent>-<timestamp>.log     (combined stdout/stderr of the agent)
#
# Usage:
#   ./capture.sh codex                                 # default smoke prompt
#   ./capture.sh codex prompts/github-mcp-smoke.txt    # explicit prompt file
#   ./capture.sh codex "List my open PRs in cli/cli."  # inline prompt
set -eu

AGENT="${1:-}"
if [ -z "$AGENT" ]; then
  echo "usage: $0 <agent> [prompt-file-or-text]" >&2
  exit 2
fi
shift

ROOT=$(cd "$(dirname "$0")" && pwd)
RUNNER="$ROOT/agents/$AGENT.sh"
if [ ! -x "$RUNNER" ]; then
  echo "no runner for agent '$AGENT' at $RUNNER" >&2
  exit 2
fi

# Resolve prompt: file path -> read file; otherwise treat as inline text.
PROMPT_ARG="${1:-$ROOT/prompts/github-mcp-smoke.txt}"
if [ -f "$PROMPT_ARG" ]; then
  AGENT_PROMPT=$(cat "$PROMPT_ARG")
else
  AGENT_PROMPT="$PROMPT_ARG"
fi
export AGENT_PROMPT

# Proxy + TLS plumbing (same as the original run-*.sh scripts).
PROXY_PORT="${PROXY_PORT:-8080}"
export HTTP_PROXY="http://127.0.0.1:$PROXY_PORT"
export HTTPS_PROXY="$HTTP_PROXY"
export ALL_PROXY="$HTTP_PROXY"
export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" all_proxy="$ALL_PROXY"
export CODEX_CA_CERTIFICATE="${CODEX_CA_CERTIFICATE:-$HOME/.mitmproxy/mitmproxy-ca-cert.pem}"
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$HOME/.mitmproxy/mitmproxy-ca-cert.pem}"

# GitHub token for the MCP server (works for agents that use it).
export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token -h github.com 2>/dev/null || true)}"
if [ -z "${GITHUB_TOKEN:-}" ]; then
  echo "warning: no GITHUB_TOKEN available; GitHub MCP calls will fail" >&2
fi

TS=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$ROOT/captures"
FLOW_FILE="$ROOT/captures/$AGENT-$TS.flow"
JSONL_FILE="$ROOT/captures/$AGENT-$TS.jsonl"
LOG_FILE="$ROOT/captures/$AGENT-$TS.log"
MITM_LOG="$ROOT/captures/$AGENT-$TS.mitm.log"

export CAPTURE_JSONL="$JSONL_FILE"
export CAPTURE_AGENT="$AGENT"

# Refuse to start if something is already on the proxy port.
if lsof -nP -iTCP:"$PROXY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "port $PROXY_PORT is already in use; stop the existing listener first" >&2
  exit 1
fi

echo "→ starting mitmdump on :$PROXY_PORT"
mitmdump \
  --listen-port "$PROXY_PORT" \
  --set "block_global=false" \
  -s "$ROOT/mitm/capture_addon.py" \
  -w "$FLOW_FILE" \
  >"$MITM_LOG" 2>&1 &
MITM_PID=$!

cleanup() {
  if kill -0 "$MITM_PID" 2>/dev/null; then
    kill "$MITM_PID" 2>/dev/null || true
    wait "$MITM_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Wait for the proxy to come up.
for _ in $(seq 1 50); do
  if lsof -nP -iTCP:"$PROXY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 0.1
done
if ! lsof -nP -iTCP:"$PROXY_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "mitmdump failed to start; see $MITM_LOG" >&2
  exit 1
fi

echo "→ running agent: $AGENT"
echo "  prompt: $(printf %s "$AGENT_PROMPT" | head -c 120)..."
set +e
"$RUNNER" >"$LOG_FILE" 2>&1
AGENT_RC=$?
set -e

echo "→ agent exited with code $AGENT_RC"
echo "  flow:  $FLOW_FILE"
echo "  jsonl: $JSONL_FILE"
echo "  log:   $LOG_FILE"

# Give mitmdump a moment to flush the last flow to disk.
sleep 0.3
exit "$AGENT_RC"
