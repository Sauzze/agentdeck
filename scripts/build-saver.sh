#!/bin/bash
# Compiles the screen saver and assembles build/SauzzeDeck Office.saver.
#
#   scripts/build-saver.sh             for this Mac's processor
#   scripts/build-saver.sh universal   for Apple silicon and Intel, as released
#
# Used by build-app.sh, which puts it inside the app. SwiftPM can't make the
# loadable bundle a screen saver is, so this calls the compiler itself.

set -euo pipefail

cd "$(dirname "$0")/.."
SAVER="build/SauzzeDeck Office.saver"
EXECUTABLE="SauzzeDeckOffice" # named in ScreenSaver/Info.plist
MIN_MACOS="13.0"              # the app's, in Package.swift
WORK="build/saver"

ARCHS=("$(uname -m)")
[ "${1:-}" = "universal" ] && ARCHS=(arm64 x86_64)

rm -rf "$SAVER" "$WORK"
mkdir -p "$SAVER/Contents/MacOS" "$WORK"
SLICES=()
for ARCH in "${ARCHS[@]}"; do
  swiftc -O -swift-version 5 -parse-as-library -module-name "$EXECUTABLE" -target "$ARCH-apple-macos$MIN_MACOS" \
    -Xlinker -bundle -o "$WORK/$ARCH" ScreenSaver/*.swift
  SLICES+=("$WORK/$ARCH")
done
lipo -create "${SLICES[@]}" -output "$SAVER/Contents/MacOS/$EXECUTABLE"
# As for the app: no build folder in a download, and stripped before signing.
strip -S -no_code_signature_warning "$SAVER/Contents/MacOS/$EXECUTABLE"

# The app's version, so a release bumps it in one place.
cp ScreenSaver/Info.plist "$SAVER/Contents/"
for KEY in CFBundleShortVersionString CFBundleVersion; do
  VALUE="$(/usr/libexec/PlistBuddy -c "Print :$KEY" Resources/Info.plist)"
  /usr/libexec/PlistBuddy -c "Add :$KEY string $VALUE" "$SAVER/Contents/Info.plist"
done
codesign --force --sign - "$SAVER"
