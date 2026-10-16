//go:build windows

package desktop

import (
	"os"
	"time"

	"github.com/aymanbagabas/go-pty"
	"golang.org/x/sys/windows"
	"golang.org/x/term"
)

// How often to look at the console's size: Windows sends no signal when a
// console is resized.
const sizePoll = 300 * time.Millisecond

// followSize passes each change in the console's size on to the agent's.
func followSize(terminal pty.Pty) {
	width, height, _ := term.GetSize(int(os.Stdout.Fd()))
	for range time.Tick(sizePoll) {
		w, h, err := term.GetSize(int(os.Stdout.Fd()))
		if err == nil && (w != width || h != height) {
			width, height = w, h
			_ = terminal.Resize(w, h)
		}
	}
}

// prepareConsole lets the console show the agent's colours and cursor moves,
// which arrive as escape sequences.
func prepareConsole() {
	console := windows.Handle(os.Stdout.Fd())
	var mode uint32
	if windows.GetConsoleMode(console, &mode) == nil {
		_ = windows.SetConsoleMode(console, mode|windows.ENABLE_VIRTUAL_TERMINAL_PROCESSING|windows.DISABLE_NEWLINE_AUTO_RETURN)
	}
}
