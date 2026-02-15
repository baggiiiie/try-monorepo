#!/usr/bin/env sh
set -eu

export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:8080}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:8080}"
export ALL_PROXY="${ALL_PROXY:-http://127.0.0.1:8080}"
export http_proxy="$HTTP_PROXY"
export https_proxy="$HTTPS_PROXY"
export all_proxy="$ALL_PROXY"

# For the Node-based extension host / language servers inside Cursor.
# (The Chromium main process uses the macOS keychain instead — make sure
#  ~/.mitmproxy/mitmproxy-ca-cert.pem is trusted as a root in System.keychain.)
export NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$HOME/.mitmproxy/mitmproxy-ca-cert.pem}"

exec /Applications/Cursor.app/Contents/MacOS/Cursor "$@"
