#!/bin/sh
# Installs SauzzeDeck Pro for you alone, with no root needed:
#
#   ~/.local/bin/sauzzedeck                         the app and its commands
#   ~/.local/share/applications/sauzzedeck-pro.desktop   its entry in your app menu
#
#   ./install.sh
#
# Running it again updates an existing install; your paired phones and
# settings are kept. Quit SauzzeDeck Pro from its tray menu first: agents you
# started with `sauzzedeck run` keep running either way.

set -eu
cd "$(dirname "$0")"
BIN="$HOME/.local/bin"
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"

mkdir -p "$BIN" "$DATA/applications" "$DATA/sauzzedeck-pro"
install -m 755 sauzzedeck "$BIN/sauzzedeck"
install -m 644 sauzzedeck-pro.png "$DATA/sauzzedeck-pro/icon.png"
cat > "$DATA/applications/sauzzedeck-pro.desktop" <<ENTRY
[Desktop Entry]
Type=Application
Name=SauzzeDeck Pro
Comment=A control pad for your coding agents, on your phone
Exec="$BIN/sauzzedeck"
Icon=$DATA/sauzzedeck-pro/icon.png
Categories=Development;
ENTRY

echo "Installed. Open SauzzeDeck Pro from your app menu, or run: sauzzedeck"
case ":$PATH:" in
  *":$BIN:"*) ;;
  *) echo "Add $BIN to your PATH to start agents with: sauzzedeck run claude" ;;
esac
