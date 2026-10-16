package desktop

// Agent is a coding agent the deck follows, as in the Mac app's Agent.swift.
//
// Every agent reports through the same hook, each in its own dialect.
// canonical translates them all into Claude Code's, so one state machine in
// Sessions serves every agent.
type Agent string

const (
	Claude   Agent = "claude"
	Codex    Agent = "codex"
	Gemini   Agent = "gemini"
	OpenCode Agent = "opencode"
	Grok     Agent = "grok"
)

var agents = []Agent{Claude, Codex, Gemini, OpenCode, Grok}

func (a Agent) Name() string {
	return map[Agent]string{
		Claude: "Claude Code", Codex: "Codex", Gemini: "Gemini CLI", OpenCode: "OpenCode", Grok: "Grok",
	}[a]
}

// Key is a key the deck presses in a session.
type Key string

const (
	Enter  Key = "enter"
	Escape Key = "escape"
	Space  Key = "space"
	Up     Key = "up"
	Down   Key = "down"
	CtrlC  Key = "ctrl-c"
	// For buttons made in setup: Shift+Tab switches Claude Code's mode.
	TabKey   Key = "tab"
	ShiftTab Key = "shift-tab"
)

// Keystroke is a key pressed Times times in a row.
type Keystroke struct {
	Key   Key `json:"key"`
	Times int `json:"times"`
}

func press(key Key) Keystroke { return Keystroke{Key: key, Times: 1} }

// Interrupt stops a running turn. Grok cancels on Ctrl+C and ignores Esc;
// OpenCode asks for Esc twice, so a single stray press can't stop it.
func (a Agent) Interrupt() Keystroke {
	switch a {
	case Grok:
		return press(CtrlC)
	case OpenCode:
		return Keystroke{Key: Escape, Times: 2}
	}
	return press(Escape)
}

// Reject declines a permission prompt. In Grok, Esc only moves focus off the
// prompt; Ctrl+C is what cancels the request.
func (a Agent) Reject() Keystroke {
	if a == Grok {
		return press(CtrlC)
	}
	return press(Escape)
}

// NewConversation starts a fresh conversation in the same tab.
func (a Agent) NewConversation() string {
	if a == Claude || a == Gemini {
		return "/clear"
	}
	return "/new"
}

// Thinking effort set with /effort, and push-to-talk through /voice: both
// are Claude Code's own.
func (a Agent) HasEffortDial() bool { return a == Claude }
func (a Agent) HasVoice() bool      { return a == Claude }

// agentOf says which agent sent event. The hook names it, except for Grok:
// it also runs Claude Code's hooks, and tells itself apart by its camelCase
// envelope.
func agentOf(event map[string]any, reported string) Agent {
	if _, ok := event["hookEventName"]; ok {
		return Grok
	}
	for _, a := range agents {
		if string(a) == reported {
			return a
		}
	}
	return Claude
}

// canonical is event in Claude Code's words, or nil for one the deck
// should not act on.
func (a Agent) canonical(event map[string]any) map[string]any {
	switch a {
	case Gemini:
		return renaming(event, map[string]string{
			"BeforeAgent": "UserPromptSubmit", "AfterAgent": "Stop",
			"BeforeTool": "PreToolUse", "AfterTool": "PostToolUse",
			// Gemini CLI notifies only to ask for a tool's permission.
			"Notification": "PermissionRequest",
		})
	case Grok:
		// A subagent's events are not its session's.
		if _, ok := event["subagentType"]; ok {
			return nil
		}
		claude := map[string]any{}
		for k, v := range event {
			claude[k] = v
		}
		for camel, snake := range map[string]string{"sessionId": "session_id", "toolName": "tool_name", "notificationType": "notification_type"} {
			if v, ok := event[camel]; ok {
				claude[snake] = v
			}
		}
		// Grok also fires Stop as a session ends; only a turn's end counts.
		if claude["hook_event_name"] == "Stop" {
			if reason, ok := event["reason"].(string); ok && reason != "end_turn" {
				return nil
			}
		}
		return renaming(claude, map[string]string{"StopCancelled": "Interrupt"})
	}
	// Codex uses Claude Code's names, and OpenCode's plugin sends them.
	return event
}

func renaming(event map[string]any, names map[string]string) map[string]any {
	renamed := map[string]any{}
	for k, v := range event {
		renamed[k] = v
	}
	if name, ok := event["hook_event_name"].(string); ok {
		if claude, ok := names[name]; ok {
			renamed["hook_event_name"] = claude
		}
	}
	return renamed
}
