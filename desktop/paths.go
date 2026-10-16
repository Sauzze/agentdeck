// Package desktop is SauzzeDeck Pro for Windows and Linux: the counterpart of
// the Mac app in Sources/AgentDeck, file for file where the two can match.
//
// The phone sees the same deck, pairs the same way and follows the same
// agents. What differs is how a session's keys are pressed: the Mac drives
// Terminal.app, which nothing on Windows or Linux matches, so here agents are
// started through the app's launcher (`sauzzedeck run claude`), or found in a
// tmux, WezTerm or kitty pane, whose own commands reach them.
package desktop

import (
	"os"
	"path/filepath"
	"runtime"
)

// Port is where the deck listens on every platform.
const Port = 7710

// Where the app keeps its state, outside the program itself, so it can be
// moved or updated without losing the paired phones: ~/.config/sauzzedeck-pro
// on Linux, %APPDATA%\SauzzeDeck Pro on Windows.
var (
	supportDir  = makeSupportDir()
	phonesFile  = filepath.Join(supportDir, "phones.json")
	configFile  = filepath.Join(supportDir, "config.json")
	hookKeyFile = filepath.Join(supportDir, "hook-key")
	homeDir, _  = os.UserHomeDir()
)

func makeSupportDir() string {
	base, err := os.UserConfigDir()
	if err != nil {
		base = os.TempDir()
	}
	name := "sauzzedeck-pro"
	if runtime.GOOS == "windows" {
		name = "SauzzeDeck Pro"
	}
	dir := filepath.Join(base, name)
	_ = os.MkdirAll(dir, 0o700)
	return dir
}

// writePrivate writes a file only its owner can read, as the keys need.
func writePrivate(path string, data []byte) error {
	temp := path + ".tmp"
	if err := os.WriteFile(temp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temp, path)
}
