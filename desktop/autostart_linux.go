package desktop

import (
	"fmt"
	"os"
	"path/filepath"
)

// Opening at login, through an XDG autostart entry: GNOME, KDE and most
// other desktops start what ~/.config/autostart lists.
func autostartFile() string {
	base, _ := os.UserConfigDir()
	return filepath.Join(base, "autostart", "sauzzedeck-pro.desktop")
}

func isOpenAtLogin() bool {
	_, err := os.Stat(autostartFile())
	return err == nil
}

func setOpenAtLogin(enabled bool) {
	if !enabled {
		_ = os.Remove(autostartFile())
		return
	}
	program, _ := os.Executable()
	entry := fmt.Sprintf("[Desktop Entry]\nType=Application\nName=SauzzeDeck Pro\nExec=%q\nIcon=sauzzedeck-pro\nX-GNOME-Autostart-enabled=true\n", program)
	_ = os.MkdirAll(filepath.Dir(autostartFile()), 0o755)
	_ = os.WriteFile(autostartFile(), []byte(entry), 0o644)
}
