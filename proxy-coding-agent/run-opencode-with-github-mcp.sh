#!/usr/bin/env sh
set -eu

# GITHUB_TOKEN is used to authenticate with GitHub MCP.
export GITHUB_TOKEN="${GITHUB_TOKEN:-$(gh auth token -h github.com)}"
export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:8080}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:8080}"
export ALL_PROXY="${ALL_PROXY:-http://127.0.0.1:8080}"
export http_proxy="$HTTP_PROXY"
export https_proxy="$HTTPS_PROXY"
export all_proxy="$ALL_PROXY"

# Bun/Node-compatible TLS trust for HTTPS interception.
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$HOME/.mitmproxy/mitmproxy-ca-cert.pem}"

exec opencode "$@"
