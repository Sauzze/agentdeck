#!/bin/bash
# Builds the download for a GitHub release: build/AgentDeck.zip, a universal
# app for Apple silicon and Intel Macs.
#
#   scripts/release.sh
#
# The app is signed ad hoc, not notarised, so macOS asks people to approve it
# once in System Settings → Privacy & Security. The README explains how.

set -euo pipefail

cd "$(dirname "$0")/.."
scripts/build-app.sh universal

rm -f build/AgentDeck.zip
ditto -c -k --keepParent build/AgentDeck.app build/AgentDeck.zip
echo "build/AgentDeck.zip ($(lipo -archs build/AgentDeck.app/Contents/MacOS/AgentDeck))"
