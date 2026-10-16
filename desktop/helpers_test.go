package desktop

import (
	"path/filepath"
	"testing"
)

// isolate points every file the package reads or writes, and the home folder
// agents keep their settings in, at fresh folders, so a test never touches
// the real paired phones or an agent's real settings. It returns the home.
func isolate(t *testing.T) string {
	t.Helper()
	saved := []string{supportDir, phonesFile, configFile, hookKeyFile, homeDir}
	t.Cleanup(func() {
		supportDir, phonesFile, configFile, hookKeyFile, homeDir = saved[0], saved[1], saved[2], saved[3], saved[4]
	})
	supportDir = t.TempDir()
	phonesFile = filepath.Join(supportDir, "phones.json")
	configFile = filepath.Join(supportDir, "config.json")
	hookKeyFile = filepath.Join(supportDir, "hook-key")
	homeDir = t.TempDir()
	return homeDir
}
