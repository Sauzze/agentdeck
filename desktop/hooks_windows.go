//go:build windows

package desktop

import (
	"path/filepath"
	"strings"

	"golang.org/x/sys/windows"
)

// shellPath is a path as a hook command names it. The agents run hooks
// through different shells on Windows — Codex through cmd, Gemini CLI and Grok
// through PowerShell, Claude Code through Git Bash or PowerShell — and no one
// way of quoting suits all three. The short form of the path has no spaces to
// quote, and forward slashes read the same in each.
func shellPath(path string) string {
	long, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return filepath.ToSlash(path)
	}
	short := make([]uint16, windows.MAX_LONG_PATH)
	n, err := windows.GetShortPathName(long, &short[0], uint32(len(short)))
	if err == nil && n > 0 {
		path = windows.UTF16ToString(short[:n])
	}
	path = filepath.ToSlash(path)
	// A drive with short names turned off keeps its spaces: quoted, the path
	// still works through cmd and Git Bash.
	if strings.Contains(path, " ") {
		return `"` + path + `"`
	}
	return path
}
