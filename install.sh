#!/bin/bash
# Builds SauzzeDeck Pro and installs it in /Applications, then opens it.
#
#   ./install.sh
#
# Needs the Xcode Command Line Tools for the Swift compiler. Running it again
# updates an existing install; your pairing and settings are kept.

set -euo pipefail

cd "$(dirname "$0")"
APP_NAME="SauzzeDeck Pro"
BUNDLE_ID="io.github.sauzze.agentdeck"
DEST="/Applications/$APP_NAME.app"
BUILD="build/$APP_NAME.app" # made by scripts/build-app.sh
OLD_DEST="/Applications/AgentDeck.app" # its name up to 1.0.1

if ! xcrun --find swift >/dev/null 2>&1; then
  echo "SauzzeDeck Pro needs Apple's developer tools to build."
  echo "Installing them now. Run ./install.sh again when that finishes."
  xcode-select --install
  exit 1
fi

scripts/build-app.sh

if pgrep -x AgentDeck >/dev/null; then # the executable kept the old name
  echo "Closing the running copy…"
  osascript -e "quit app id \"$BUNDLE_ID\"" >/dev/null 2>&1 || true
  sleep 1
fi

echo "Installing in /Applications…"
rm -rf "$DEST" "$OLD_DEST"
cp -R "$BUILD" "$DEST"

# macOS ties the Accessibility permission to this exact build. Clear the
# entry the previous build left behind, so the setup page can ask afresh
# instead of showing a switch that is on but no longer counts.
tccutil reset Accessibility "$BUNDLE_ID" >/dev/null 2>&1 || true
open "$DEST"

echo
echo "Done. SauzzeDeck Pro is in your menu bar, and its setup page is opening."
