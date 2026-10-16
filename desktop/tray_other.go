//go:build !windows

package desktop

// trayIcon: Linux's tray takes a PNG as it is.
func trayIcon(png []byte) []byte { return png }
