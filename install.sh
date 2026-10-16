#!/bin/bash
# Builds AgentDeck and installs it in /Applications, then opens it.
#
#   ./install.sh
#
# Needs the Xcode Command Line Tools for the Swift compiler. Running it again
# updates an existing install; your pairing and settings are kept.

set -euo pipefail

cd "$(dirname "$0")"
APP_NAME="AgentDeck"
DEST="/Applications/$APP_NAME.app"
BUILD="build/$APP_NAME.app"

if ! xcrun --find swift >/dev/null 2>&1; then
  echo "AgentDeck needs Apple's developer tools to build."
  echo "Installing them now. Run ./install.sh again when that finishes."
  xcode-select --install
  exit 1
fi

echo "Building…"
mkdir -p build
if ! swift build -c release >build/build.log 2>&1; then
  cat build/build.log
  echo
  echo "The build failed. The messages above say why."
  exit 1
fi
BIN="$(swift build -c release --show-bin-path)/$APP_NAME"

rm -rf "$BUILD"
mkdir -p "$BUILD/Contents/MacOS" "$BUILD/Contents/Resources"
cp "$BIN" "$BUILD/Contents/MacOS/$APP_NAME"
cp Resources/Info.plist "$BUILD/Contents/"
cp Resources/AppIcon.icns Resources/report.sh "$BUILD/Contents/Resources/"
cp -R Resources/web "$BUILD/Contents/Resources/"
codesign --force --sign - "$BUILD"

if pgrep -x "$APP_NAME" >/dev/null; then
  echo "Closing the running copy…"
  osascript -e "quit app \"$APP_NAME\"" >/dev/null 2>&1 || true
  sleep 1
fi

echo "Installing in /Applications…"
rm -rf "$DEST"
cp -R "$BUILD" "$DEST"

# macOS ties the Accessibility permission to this exact build. Clear the
# entry the previous build left behind, so the setup page can ask afresh
# instead of showing a switch that is on but no longer counts.
tccutil reset Accessibility io.github.sauzze.agentdeck >/dev/null 2>&1 || true
open "$DEST"

echo
echo "Done. AgentDeck is in your menu bar, and its setup page is opening."
