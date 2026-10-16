#!/bin/bash
# Compiles AgentDeck and assembles build/AgentDeck.app.
#
#   scripts/build-app.sh             for this Mac's processor
#   scripts/build-app.sh universal   for Apple silicon and Intel, as released
#
# Used by install.sh and scripts/release.sh. Needs the Xcode Command Line Tools.

set -euo pipefail

cd "$(dirname "$0")/.."
APP_NAME="AgentDeck"
APP="build/$APP_NAME.app"

ARCHS=()
[ "${1:-}" = "universal" ] && ARCHS=(--arch arm64 --arch x86_64)

echo "Building…"
mkdir -p build
if ! swift build -c release ${ARCHS[@]+"${ARCHS[@]}"} >build/build.log 2>&1; then
  cat build/build.log
  echo
  echo "The build failed. The messages above say why."
  exit 1
fi
BIN="$(swift build -c release ${ARCHS[@]+"${ARCHS[@]}"} --show-bin-path)/$APP_NAME"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$APP_NAME"
cp Resources/Info.plist "$APP/Contents/"
cp Resources/AppIcon.icns Resources/report.sh "$APP/Contents/Resources/"
cp -R Resources/web "$APP/Contents/Resources/"
codesign --force --sign - "$APP"
