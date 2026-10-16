//go:build !windows

package desktop

import (
	"os"
	"os/signal"
	"syscall"

	"github.com/aymanbagabas/go-pty"
)

// followSize passes each change in the terminal's size on to the agent's.
func followSize(terminal pty.Pty) {
	changes := make(chan os.Signal, 1)
	signal.Notify(changes, syscall.SIGWINCH)
	for range changes {
		matchSize(terminal)
	}
}

// prepareConsole: a Unix terminal already reads escape sequences.
func prepareConsole() {}
