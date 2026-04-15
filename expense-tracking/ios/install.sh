#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$SCRIPT_DIR/ExpenseTracker.xcodeproj"
SCHEME="ExpenseTracker"
DERIVED_DATA="$SCRIPT_DIR/.build/DerivedData"
APP_PATH="$DERIVED_DATA/Build/Products/Debug-iphoneos/ExpenseTracker.app"

# Find connected iOS device
DEVICE_ID=$(xcrun devicectl list devices -j 2>/dev/null | plutil -extract result.devices raw -o - - 2>/dev/null | head -1 || true)
if [ -z "$DEVICE_ID" ]; then
    # Fallback: parse from xctrace
    DEVICE_ID=$(xcrun xctrace list devices 2>&1 | grep -E '\([0-9A-F]{8}-[0-9A-F]{16}\)' | head -1 | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}')
fi

if [ -z "$DEVICE_ID" ]; then
    echo "❌ No connected iOS device found."
    exit 1
fi

DEVICE_NAME=$(xcrun xctrace list devices 2>&1 | grep "$DEVICE_ID" | sed "s/ (.*//")
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
