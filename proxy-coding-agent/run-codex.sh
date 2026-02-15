#!/usr/bin/env sh
set -eu

export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:8080}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:8080}"
export ALL_PROXY="${ALL_PROXY:-http://127.0.0.1:8080}"
export http_proxy="$HTTP_PROXY"
export https_proxy="$HTTPS_PROXY"
export all_proxy="$ALL_PROXY"

# Codex's Rust backend (Contents/Resources/codex) uses rustls and ignores the
# macOS keychain; it reads a custom CA bundle from CODEX_CA_CERTIFICATE.
export CODEX_CA_CERTIFICATE="${CODEX_CA_CERTIFICATE:-$HOME/.mitmproxy/mitmproxy-ca-cert.pem}"

# For any Node-based code inside Codex (the Electron extension host etc.).
# The Chromium main process uses the macOS keychain — make sure
# ~/.mitmproxy/mitmproxy-ca-cert.pem is trusted as a root in System.keychain.
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$HOME/.mitmproxy/mitmproxy-ca-cert.pem}"

CODEX_HOME=$(mktemp -d) exec codex "$@"
