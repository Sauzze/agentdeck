package desktop

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	agentdeck "github.com/Sauzze/agentdeck"
)

// Hooks is where each coding agent is told to run the hook, as the Mac app's
// Hooks.swift: the same files, the same entries, with `sauzzedeck hook` in
// place of report.sh.
//
// User-level, so every session reports to the deck, whatever folder it
// starts in. Only agents with a settings folder are connected; one installed
// later is picked up by connecting again. Claude Code, Codex and Gemini CLI
// read hooks from a settings file they share with everything else: the
// deck's entries are added to it, the rest is kept as it was, and the file is
// backed up to <file>.agentdeck.bak before each change. Grok and OpenCode
// load whole files from a folder, so the deck has one of its own there.

// hookEntries are the deck's entries in an agent's settings, in the layout
// Claude Code set and the others follow: event → matcher groups → handlers.
type hookEntries struct {
	file      string
	events    []string
	handler   map[string]any
	isOwnFile bool // the file holds nothing but these entries
}

func agentFolder(agent Agent) string {
	return filepath.Join(homeDir, map[Agent]string{
		Claude: ".claude", Codex: ".codex", Gemini: ".gemini", OpenCode: filepath.Join(".config", "opencode"), Grok: ".grok",
	}[agent])
}

func openCodePlugin() string {
	return filepath.Join(agentFolder(OpenCode), "plugins", "sauzzedeck-pro.js")
}

// hookCommand is the command an agent runs. Grok's entries match Claude
// Code's to the letter: Grok also reads Claude Code's hooks, and runs a
// handler it finds twice only once.
func hookCommand(agent Agent) string {
	command := shellPath(commandLineProgram()) + " hook"
	if agent == Claude || agent == Grok {
		return command
	}
	return command + " " + string(agent)
}

// commandLineProgram is the program agents run: on Windows, the console
// build next to the app's, since the app itself has no console.
func commandLineProgram() string {
	program, _ := os.Executable()
	if resolved, err := filepath.EvalSymlinks(program); err == nil {
		program = resolved
	}
	if runtime.GOOS == "windows" {
		return filepath.Join(filepath.Dir(program), "sauzzedeck.exe")
	}
	return program
}

func entriesFor(agent Agent) *hookEntries {
	command := hookCommand(agent)
	switch agent {
	case Claude:
		return &hookEntries{file: filepath.Join(agentFolder(Claude), "settings.json"), events: []string{
			"SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse",
			"PostToolUseFailure", "Notification", "Stop", "StopFailure", "SessionEnd",
			"SubagentStart", "SubagentStop", "PreCompact", "PostCompact",
		}, handler: map[string]any{"type": "command", "command": command, "async": true}}
	case Codex:
		return &hookEntries{file: filepath.Join(agentFolder(Codex), "hooks.json"), events: []string{
			"SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse",
			"Stop", "Interrupt", "SessionEnd",
		}, handler: map[string]any{"type": "command", "command": command, "async": true, "timeout": 5}}
	case Gemini:
		// Gemini CLI waits for its hooks, and counts their timeout in milliseconds.
		return &hookEntries{file: filepath.Join(agentFolder(Gemini), "settings.json"), events: []string{
			"SessionStart", "BeforeAgent", "BeforeTool", "AfterTool", "Notification", "AfterAgent", "SessionEnd",
		}, handler: map[string]any{"type": "command", "command": command, "name": "sauzzedeck-pro", "timeout": 5000}}
	case Grok:
		return &hookEntries{file: filepath.Join(agentFolder(Grok), "hooks", "sauzzedeck-pro.json"), events: []string{
			"SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "PostToolUseFailure",
			"Notification", "Stop", "StopFailure", "StopCancelled", "SessionEnd",
		}, handler: map[string]any{"type": "command", "command": command}, isOwnFile: true}
	}
	return nil // OpenCode: a plugin, see writePlugin
}

// foundAgents are the agents with a settings folder here.
func foundAgents() []Agent {
	var found []Agent
	for _, agent := range agents {
		if _, err := os.Stat(agentFolder(agent)); err == nil {
			found = append(found, agent)
		}
	}
	return found
}

func isConnected(agent Agent) bool {
	entries := entriesFor(agent)
	if entries == nil {
		_, err := os.Stat(openCodePlugin())
		return err == nil
	}
	settings, err := readSettings(entries.file)
	if err != nil {
		return false
	}
	hooks, _ := settings["hooks"].(map[string]any)
	for _, event := range entries.events {
		if !hasOurs(hooks[event]) {
			return false
		}
	}
	return true
}

// allConnected: every agent found is connected.
func allConnected() bool {
	found := foundAgents()
	for _, agent := range found {
		if !isConnected(agent) {
			return false
		}
	}
	return len(found) > 0
}

var errNoAgents = errors.New("No coding agent found on this computer. Install one, open it once, then connect again.")

// connectAgents connects every agent found. One whose settings can't be read
// is left alone, and named in the error once the others are done.
func connectAgents() error {
	found := foundAgents()
	if len(found) == 0 {
		return errNoAgents
	}
	var unreadable []string
	for _, agent := range found {
		if err := connect(agent, true); errors.Is(err, errUnreadable) {
			unreadable = append(unreadable, entriesFor(agent).file)
		} else if err != nil {
			return err
		}
	}
	if len(unreadable) > 0 {
		return unreadableError(unreadable)
	}
	return nil
}

var errUnreadable = errors.New("settings aren't valid JSON")

// connect adds the deck's entries for agent, replacing any it had. With
// turnOnVoice, Claude Code's voice input is turned on in tap mode — which the
// mic key needs — unless voice is already set up some other way.
func connect(agent Agent, turnOnVoice bool) error {
	entries := entriesFor(agent)
	if entries == nil {
		return writePlugin()
	}
	settings := map[string]any{}
	if !entries.isOwnFile {
		read, err := readSettings(entries.file)
		if err != nil {
			return errUnreadable
		}
		settings = read
	}
	hooks := withoutOurs(settings["hooks"])
	for _, event := range entries.events {
		groups, _ := hooks[event].([]any)
		hooks[event] = append(groups, map[string]any{"hooks": []any{entries.handler}})
	}
	settings["hooks"] = hooks
	if _, set := settings["voice"]; turnOnVoice && agent == Claude && !set {
		settings["voice"] = map[string]any{"enabled": true, "mode": "tap"}
	}
	return writeSettings(settings, entries.file, !entries.isOwnFile)
}

func disconnectAgents() error {
	for _, agent := range agents {
		entries := entriesFor(agent)
		switch {
		case entries == nil:
			_ = os.Remove(openCodePlugin())
		case entries.isOwnFile:
			_ = os.Remove(entries.file)
		default:
			if _, err := os.Stat(entries.file); err != nil {
				continue
			}
			settings, err := readSettings(entries.file)
			if err != nil {
				return unreadableError([]string{entries.file})
			}
			if hooks := withoutOurs(settings["hooks"]); len(hooks) > 0 {
				settings["hooks"] = hooks
			} else {
				delete(settings, "hooks")
			}
			if err := writeSettings(settings, entries.file, true); err != nil {
				return err
			}
		}
	}
	return nil
}

// refreshHooks rewrites the entries of the agents already connected, so they
// point at this copy of the program wherever it has been moved or updated to,
// and follow every event this version does, even those an earlier version
// didn't. Voice is left alone: only connecting turns it on.
func refreshHooks() {
	for _, agent := range foundAgents() {
		if hasEntries(agent) {
			_ = connect(agent, false)
		}
	}
}

// hasEntries: the deck is in agent's hooks for at least one event.
func hasEntries(agent Agent) bool {
	entries := entriesFor(agent)
	if entries == nil {
		return isConnected(agent)
	}
	settings, err := readSettings(entries.file)
	if err != nil {
		return false
	}
	hooks, _ := settings["hooks"].(map[string]any)
	for _, groups := range hooks {
		if hasOurs(groups) {
			return true
		}
	}
	return false
}

// writePlugin writes OpenCode's plugin, which runs the hook: OpenCode has no
// command hooks.
func writePlugin() error {
	template, err := fs.ReadFile(agentdeck.Files, "Resources/opencode-plugin.js")
	if err != nil {
		return err
	}
	command, _ := json.Marshal([]string{commandLineProgram(), "hook", string(OpenCode)})
	plugin := bytes.ReplaceAll(template, []byte(`["{{COMMAND}}"]`), command)
	if err := os.MkdirAll(filepath.Dir(openCodePlugin()), 0o755); err != nil {
		return err
	}
	return os.WriteFile(openCodePlugin(), plugin, 0o644)
}

// isOurs recognises the deck's handler by its command, wherever the program
// was when it was written. On Windows that path is in its short form, where
// sauzzedeck.exe reads SAUZZE~1.EXE.
func isOurs(handler any) bool {
	h, _ := handler.(map[string]any)
	command, _ := h["command"].(string)
	command = strings.ToLower(command)
	return strings.Contains(command, "sauzze") && strings.Contains(command, " hook")
}

func hasOurs(groups any) bool {
	list, _ := groups.([]any)
	for _, group := range list {
		g, _ := group.(map[string]any)
		handlers, _ := g["hooks"].([]any)
		for _, handler := range handlers {
			if isOurs(handler) {
				return true
			}
		}
	}
	return false
}

func withoutOurs(hooks any) map[string]any {
	result := map[string]any{}
	events, _ := hooks.(map[string]any)
	for event, groups := range events {
		var kept []any
		list, _ := groups.([]any)
		for _, group := range list {
			g, ok := group.(map[string]any)
			if !ok {
				kept = append(kept, group)
				continue
			}
			var handlers []any
			list, _ := g["hooks"].([]any)
			for _, handler := range list {
				if !isOurs(handler) {
					handlers = append(handlers, handler)
				}
			}
			if len(handlers) > 0 {
				copied := map[string]any{}
				for k, v := range g {
					copied[k] = v
				}
				copied["hooks"] = handlers
				kept = append(kept, copied)
			}
		}
		if len(kept) > 0 {
			result[event] = kept
		}
	}
	return result
}

func readSettings(file string) (map[string]any, error) {
	data, err := os.ReadFile(file)
	if err != nil {
		return map[string]any{}, nil
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.UseNumber() // numbers go back exactly as they were
	settings := map[string]any{}
	if err := decoder.Decode(&settings); err != nil {
		return nil, err
	}
	return settings, nil
}

func writeSettings(settings map[string]any, file string, backup bool) error {
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	mode := fs.FileMode(0o644)
	if info, err := os.Stat(file); err == nil {
		mode = info.Mode().Perm()
		if data, err := os.ReadFile(file); err == nil && backup {
			_ = os.WriteFile(file+".agentdeck.bak", data, mode)
		}
	}
	var out bytes.Buffer
	encoder := json.NewEncoder(&out)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(settings); err != nil {
		return err
	}
	return os.WriteFile(file, out.Bytes(), mode)
}

func unreadableError(files []string) error {
	names := make([]string, len(files))
	for i, file := range files {
		names[i] = trimmed(file)
	}
	return fmt.Errorf("%s isn't valid JSON. Fix it, then try again.", strings.Join(names, " and "))
}
