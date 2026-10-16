#!/bin/bash
# Builds the Windows and Linux downloads for a GitHub release, next to the
# Mac's, and prints their SHA-256s for the release notes:
#
#   build/SauzzeDeck-Pro-Windows-x86_64.zip    build/SauzzeDeck-Pro-Windows-arm64.zip
#   build/SauzzeDeck-Pro-Linux-x86_64.tar.gz   build/SauzzeDeck-Pro-Linux-arm64.tar.gz
#
#   scripts/release-desktop.sh
#
# Needs Go. The version is the Mac app's, from Resources/Info.plist, so the
# three platforms are released together.

set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="$(sed -n '/CFBundleShortVersionString/{n;s/.*<string>\(.*\)<\/string>.*/\1/p;}' Resources/Info.plist)"
STAGE="build/desktop"
rm -rf "$STAGE"
mkdir -p "$STAGE"

# -trimpath keeps the paths of this machine out of the programs.
build() { # GOOS GOARCH OUTPUT [extra linker flags]
  CGO_ENABLED=0 GOOS="$1" GOARCH="$2" go build -trimpath \
    -ldflags "-s -w -X main.version=$VERSION ${4:-}" -o "$3" ./cmd/sauzzedeck
}

for arch in amd64 arm64; do
  name="${arch/amd64/x86_64}"

  # Windows: the app, which has no console window, and the command line
  # that agents and terminals run.
  dir="$STAGE/SauzzeDeck-Pro-Windows-$name"
  mkdir -p "$dir"
  build windows "$arch" "$dir/SauzzeDeck Pro.exe" "-H windowsgui"
  build windows "$arch" "$dir/sauzzedeck.exe"
  cp LICENSE "$dir/LICENSE.txt"
  rm -f "build/SauzzeDeck-Pro-Windows-$name.zip"
  # -X leaves out this machine's user and group ids.
  (cd "$STAGE" && zip -qrX "../SauzzeDeck-Pro-Windows-$name.zip" "SauzzeDeck-Pro-Windows-$name")

  # Linux: one program, and an installer for your own account.
  dir="$STAGE/SauzzeDeck-Pro-Linux-$name"
  mkdir -p "$dir"
  build linux "$arch" "$dir/sauzzedeck"
  cp packaging/linux/install.sh LICENSE "$dir/"
  cp Resources/web/icon-sauzze.png "$dir/sauzzedeck-pro.png"
  # Owned by root, without the Mac's extended attributes: an archive made
  # here would otherwise carry this machine's user name and metadata.
  COPYFILE_DISABLE=1 tar --uid 0 --gid 0 --uname root --gname root --no-xattrs --no-mac-metadata \
    -czf "build/SauzzeDeck-Pro-Linux-$name.tar.gz" -C "$STAGE" "SauzzeDeck-Pro-Linux-$name"
done

echo "SauzzeDeck Pro $VERSION for Windows and Linux"
for file in build/SauzzeDeck-Pro-Windows-*.zip build/SauzzeDeck-Pro-Linux-*.tar.gz; do
  echo "SHA-256: $(shasum -a 256 "$file" | cut -d ' ' -f 1)  ${file#build/}"
done
