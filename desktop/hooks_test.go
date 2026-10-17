package desktop

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Where an installed copy lives, as its hooks name it.
const installedCommand = "/home/someone/.local/bin/sauzzedeck hook"

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func readJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		t.Fatalf("%s isn't valid JSON: %v", path, err)
	}
	return value
}

// commands are the hook commands an event runs, in a settings file's layout.
func commands(settings map[string]any, event string) []string {
	var found []string
	hooks, _ := settings["hooks"].(map[string]any)
	groups, _ := hooks[event].([]any)
	for _, group := range groups {
		handlers, _ := group.(map[string]any)["hooks"].([]any)
		for _, handler := range handlers {
			command, _ := handler.(map[string]any)["command"].(string)
			found = append(found, command)
		}
	}
	return found
}

func TestConnectingAddsTheDecksHooksAndKeepsTheRest(t *testing.T) {
	home := isolate(t)
	settings := filepath.Join(home, ".claude", "settings.json")
	original := `{
  "model": "opus",
  "cleanupPeriodDays": 30.50,
  "hooks": {
    "Stop": [
      {"hooks": [{"type": "command", "command": "say done"}]},
      {"hooks": [{"type": "command", "command": "` + installedCommand + `"}]}
    ]
  }
}`
	writeFile(t, settings, original)

	if err := connect(Claude, true); err != nil {
		t.Fatal(err)
	}
	saved := readJSON(t, settings)
	for _, event := range entriesFor(Claude).events {
		ours := 0
		for _, command := range commands(saved, event) {
			if command == hookCommand(Claude) {
				ours++
			}
		}
		if ours != 1 {
			t.Errorf("%s runs the deck's hook %d times, want once", event, ours)
		}
	}
	stop := commands(saved, "Stop")
	if len(stop) != 2 || stop[0] != "say done" {
		t.Errorf("Stop runs %q, want your own hook kept and the old copy's replaced", stop)
	}
	if saved["model"] != "opus" {
		t.Errorf("model is %v, want it left as it was", saved["model"])
	}
	if text, _ := os.ReadFile(settings); !strings.Contains(string(text), "30.50") {
		t.Error("a number in the settings came back written differently")
	}
	if voice, _ := saved["voice"].(map[string]any); voice["mode"] != "tap" || voice["enabled"] != true {
		t.Errorf("voice is %v, want it on in tap mode, as the mic needs", saved["voice"])
	}
	if backup, _ := os.ReadFile(settings + ".agentdeck.bak"); string(backup) != original {
		t.Error("the backup isn't the settings as they were")
	}
}

func TestConnectingLeavesVoiceSetUpYourWay(t *testing.T) {
	home := isolate(t)
	settings := filepath.Join(home, ".claude", "settings.json")
	writeFile(t, settings, `{"voice": {"enabled": false}}`)
	if err := connect(Claude, true); err != nil {
		t.Fatal(err)
	}
	if voice, _ := readJSON(t, settings)["voice"].(map[string]any); voice["enabled"] != false || voice["mode"] != nil {
		t.Errorf("voice is %v, want it as you set it", voice)
	}
}

func TestDisconnectingRemovesOnlyTheDecksHooks(t *testing.T) {
	home := isolate(t)
	settings := filepath.Join(home, ".codex", "hooks.json")
	writeFile(t, settings, `{"hooks": {
  "Stop": [{"hooks": [{"type": "command", "command": "notify-send done"}]}, {"hooks": [{"type": "command", "command": "`+installedCommand+` codex"}]}],
  "SessionStart": [{"hooks": [{"type": "command", "command": "`+installedCommand+` codex"}]}]
}}`)
	if err := disconnectAgents(); err != nil {
		t.Fatal(err)
	}
	saved := readJSON(t, settings)
	if stop := commands(saved, "Stop"); len(stop) != 1 || stop[0] != "notify-send done" {
		t.Errorf("Stop runs %q, want only your own hook", stop)
	}
	if hooks := saved["hooks"].(map[string]any); hooks["SessionStart"] != nil {
		t.Error("an event left with nothing to run is still listed")
	}
}

func TestGrokGetsAHooksFileOfItsOwn(t *testing.T) {
	home := isolate(t)
	if err := connect(Grok, true); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(home, ".grok", "hooks", "sauzzedeck-pro.json")
	if commands(readJSON(t, file), "Stop")[0] != hookCommand(Grok) {
		t.Fatal("Grok's hooks file doesn't run the deck's hook")
	}
	if err := disconnectAgents(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(file); !os.IsNotExist(err) {
		t.Fatal("disconnecting left Grok's hooks file behind")
	}
}

func TestOpenCodesPluginRunsTheWholeCommand(t *testing.T) {
	isolate(t)
	if err := writePlugin(); err != nil {
		t.Fatal(err)
	}
	plugin, err := os.ReadFile(openCodePlugin())
	if err != nil {
		t.Fatal(err)
	}
	command, _ := json.Marshal([]string{commandLineProgram(), "hook", "opencode"})
	if !strings.Contains(string(plugin), "const COMMAND = "+string(command)) || strings.Contains(string(plugin), "{{COMMAND}}") {
		t.Fatalf("the plugin doesn't run %s", command)
	}
}

func TestSettingsThatArentJSONAreLeftAlone(t *testing.T) {
	home := isolate(t)
	settings := filepath.Join(home, ".gemini", "settings.json")
	broken := `{"theme": "dark",`
	writeFile(t, settings, broken)
	err := connectAgents()
	if err == nil || !strings.Contains(err.Error(), "isn't valid JSON") {
		t.Fatalf("connecting gave %v, want it to name the broken file", err)
	}
	if text, _ := os.ReadFile(settings); string(text) != broken {
		t.Fatal("broken settings were rewritten")
	}
}

func TestOnlyAgentsWithASettingsFolderAreFound(t *testing.T) {
	home := isolate(t)
	if err := connectAgents(); err != errNoAgents {
		t.Fatalf("with no agents installed, connecting gave %v", err)
	}
	for _, folder := range []string{".claude", ".codex"} {
		if err := os.Mkdir(filepath.Join(home, folder), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if found := foundAgents(); len(found) != 2 || found[0] != Claude || found[1] != Codex {
		t.Fatalf("found %v, want Claude Code and Codex", found)
	}
}

func TestTheDecksHooksAreRecognisedWhereverTheyPoint(t *testing.T) {
	for command, ours := range map[string]bool{
		installedCommand:             true,
		installedCommand + " gemini": true,
		// On Windows, in the short form of C:\Program Files\SauzzeDeck Pro\sauzzedeck.exe.
		"C:/PROGRA~1/SAUZZE~1/SAUZZE~1.EXE hook codex": true,
		"say done":                       false,
		"/usr/local/bin/other-tool hook": false,
		"/home/someone/.local/bin/sauzzedeck run claude": false,
	} {
		if got := isOurs(map[string]any{"type": "command", "command": command}); got != ours {
			t.Errorf("isOurs(%q) = %v, want %v", command, got, ours)
		}
	}
}
