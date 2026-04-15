#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$SCRIPT_DIR/ExpenseTracker.xcodeproj"
SCHEME="ExpenseTracker"
DERIVED_DATA="$SCRIPT_DIR/.build/DerivedData"
APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphoneos/ExpenseTracker.app"

# Find connected iOS device
DEVICE_ID=""
DEVICE_NAME=""

DEVICES_JSON=$(mktemp -t devicectl_devices)
trap 'rm -f "$DEVICES_JSON"' EXIT

if xcrun devicectl list devices --json-output "$DEVICES_JSON" >/dev/null 2>&1; then
    DEVICE_INFO=$(python3 - "$DEVICES_JSON" <<'PY'
import json
import sys

with open(sys.argv[1]) as f:
    data = json.load(f)

devices = data.get("result", {}).get("devices", [])
for device in devices:
    if device.get("hardwareProperties", {}).get("platform") != "iOS":
        continue
    name = device.get("deviceProperties", {}).get("name", "")
    udid = device.get("hardwareProperties", {}).get("udid", "")
    if name and udid:
        print(f"{udid}\t{name}")
        break
PY
)

    if [ -n "$DEVICE_INFO" ]; then
        DEVICE_ID=$(printf '%s' "$DEVICE_INFO" | cut -f1)
        DEVICE_NAME=$(printf '%s' "$DEVICE_INFO" | cut -f2-)
    fi
fi

if [ -z "$DEVICE_ID" ]; then
    # Fallback: parse from xctrace
    DEVICE_LINE=$(xcrun xctrace list devices 2>&1 | grep -E ' \([0-9A-F]{8}-[0-9A-F]{16}\)' | grep -v Simulator | head -1 || true)
    DEVICE_ID=$(printf '%s' "$DEVICE_LINE" | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}' || true)
    DEVICE_NAME=$(printf '%s' "$DEVICE_LINE" | sed -E 's/ \([0-9A-F]{8}-[0-9A-F]{16}\)$//' | sed -E 's/ \([0-9.]+\)$//')
fi

if [ -z "$DEVICE_ID" ]; then
    echo "❌ No connected iOS device found."
    exit 1
fi

if [ -z "$DEVICE_NAME" ]; then
    DEVICE_NAME=$(xcrun xctrace list devices 2>&1 | grep "$DEVICE_ID" | sed "s/ (.*//" | head -1)
fi

echo "📱 Found device: $DEVICE_NAME ($DEVICE_ID)"

echo "🔨 Building..."
xcodebuild \
    -project "$PROJECT" \
    -scheme "$SCHEME" \
    -destination "id=$DEVICE_ID" \
    -derivedDataPath "$DERIVED_DATA" \
    -allowProvisioningUpdates \
    build \
    -quiet

echo "📲 Installing on $DEVICE_NAME..."
xcrun devicectl device install app \
    --device "$DEVICE_ID" \
    "$APP_PATH"

echo "✅ Done! ExpenseTracker is installed on $DEVICE_NAME."
