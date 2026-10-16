//go:build !linux && !windows

package desktop

// Open at login is Windows' and Linux's here; the Mac has its own app.
func isOpenAtLogin() bool { return false }
func setOpenAtLogin(bool) {}
