#!/usr/bin/env sh
# Codex one-shot runner for the proxy-capture harness.
#
# Expects to be invoked by capture.sh with these env vars already set:
#   HTTP_PROXY / HTTPS_PROXY / ALL_PROXY     (mitmproxy listener)
#   CODEX_CA_CERTIFICATE / NODE_EXTRA_CA_CERTS
#   GITHUB_TOKEN                              (for the GitHub MCP server)
#   AGENT_PROMPT                              (text to send to the agent)
set -eu

CODEX_HOME=$(mktemp -d -t codex-capture-XXXXXX)
export CODEX_HOME

# Pull auth from the user's real ~/.codex so the temp home can talk to OpenAI.
REAL_CODEX_HOME="${REAL_CODEX_HOME:-$HOME/.codex}"
if [ -f "$REAL_CODEX_HOME/auth.json" ]; then
  cp "$REAL_CODEX_HOME/auth.json" "$CODEX_HOME/auth.json"
  chmod 600 "$CODEX_HOME/auth.json"
else
  echo "warning: $REAL_CODEX_HOME/auth.json not found; codex will likely fail to authenticate" >&2
fi

# Register the GitHub MCP server (streamable HTTP, remote).
codex mcp add github \
  --url https://api.githubcopilot.com/mcp/ \
  --bearer-token-env-var GITHUB_TOKEN \
  >/dev/null

# Force a known model so captures are comparable across runs.
: "${CODEX_MODEL:=gpt-5.5}"

exec codex exec \
  --model "$CODEX_MODEL" \
  --sandbox read-only \
  --skip-git-repo-check \
  "$AGENT_PROMPT"
