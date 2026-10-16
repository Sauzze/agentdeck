package desktop

import (
	"os"

	"golang.org/x/sys/windows/registry"
)

// Opening at login, through the per-user Run key: what Windows starts for
// you when you sign in, and what Task Manager's Startup apps lists.
const (
	runKey   = `Software\Microsoft\Windows\CurrentVersion\Run`
	runValue = "SauzzeDeck Pro"
)

func isOpenAtLogin() bool {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.QUERY_VALUE)
	if err != nil {
		return false
	}
	defer key.Close()
	_, _, err = key.GetStringValue(runValue)
	return err == nil
}

func setOpenAtLogin(enabled bool) {
	key, err := registry.OpenKey(registry.CURRENT_USER, runKey, registry.SET_VALUE)
	if err != nil {
		return
	}
	defer key.Close()
	if !enabled {
		_ = key.DeleteValue(runValue)
		return
	}
	program, _ := os.Executable()
	_ = key.SetStringValue(runValue, `"`+program+`"`)
}
