//go:build !windows

package desktop

// shellPath is a path as a hook command names it: quoted, for the shell the
// agent runs it through.
func shellPath(path string) string { return `"` + path + `"` }
