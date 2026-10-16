package desktop

import (
	"reflect"
	"testing"
)

func TestWhoSentAnEvent(t *testing.T) {
	for _, c := range []struct {
		event    map[string]any
		reported string
		want     Agent
	}{
		{map[string]any{"hook_event_name": "Stop"}, "", Claude},
		{map[string]any{"hook_event_name": "Stop"}, "codex", Codex},
		{map[string]any{"hook_event_name": "Stop"}, "gemini", Gemini},
		{map[string]any{"hook_event_name": "Stop"}, "opencode", OpenCode},
		{map[string]any{"hook_event_name": "Stop"}, "an agent we don't know", Claude},
		// Grok runs Claude Code's hooks too, and gives itself away by its camelCase.
		{map[string]any{"hookEventName": "Stop"}, "", Grok},
	} {
		if got := agentOf(c.event, c.reported); got != c.want {
			t.Errorf("agentOf(%v, %q) = %q, want %q", c.event, c.reported, got, c.want)
		}
	}
}

func TestGeminiEventsInClaudeCodesWords(t *testing.T) {
	for gemini, claude := range map[string]string{
		"BeforeAgent": "UserPromptSubmit", "AfterAgent": "Stop", "BeforeTool": "PreToolUse",
		"AfterTool": "PostToolUse", "Notification": "PermissionRequest", "SessionStart": "SessionStart",
	} {
		event := Gemini.canonical(map[string]any{"hook_event_name": gemini, "session_id": "g1"})
		if event["hook_event_name"] != claude || event["session_id"] != "g1" {
			t.Errorf("Gemini's %s became %v, want %s", gemini, event, claude)
		}
	}
}

func TestGrokEventsInClaudeCodesWords(t *testing.T) {
	event := Grok.canonical(map[string]any{
		"hookEventName": "PreToolUse", "hook_event_name": "PreToolUse",
		"sessionId": "x1", "toolName": "Bash", "notificationType": "permission_prompt",
	})
	for name, want := range map[string]any{"session_id": "x1", "tool_name": "Bash", "notification_type": "permission_prompt"} {
		if event[name] != want {
			t.Errorf("Grok's event has %s = %v, want %v", name, event[name], want)
		}
	}
	cancelled := Grok.canonical(map[string]any{"hookEventName": "StopCancelled", "hook_event_name": "StopCancelled"})
	if cancelled["hook_event_name"] != "Interrupt" {
		t.Errorf("StopCancelled became %v, want Interrupt", cancelled["hook_event_name"])
	}
}

func TestGrokEventsTheDeckIgnores(t *testing.T) {
	for _, event := range []map[string]any{
		// A subagent's events are not its session's.
		{"hookEventName": "PreToolUse", "hook_event_name": "PreToolUse", "subagentType": "explore"},
		// Stop also fires as a session ends; only a turn's end counts.
		{"hookEventName": "Stop", "hook_event_name": "Stop", "reason": "session_end"},
	} {
		if got := Grok.canonical(event); got != nil {
			t.Errorf("Grok.canonical(%v) = %v, want it ignored", event, got)
		}
	}
	turnEnd := map[string]any{"hookEventName": "Stop", "hook_event_name": "Stop", "reason": "end_turn"}
	if Grok.canonical(turnEnd) == nil {
		t.Error("a turn's end was ignored")
	}
}

func TestCodexAndOpenCodeSpeakClaudeCodeAlready(t *testing.T) {
	event := map[string]any{"hook_event_name": "Interrupt", "session_id": "c1"}
	for _, agent := range []Agent{Codex, OpenCode} {
		if got := agent.canonical(event); !reflect.DeepEqual(got, event) {
			t.Errorf("%s changed %v into %v", agent, event, got)
		}
	}
}

func TestEachAgentsOwnKeys(t *testing.T) {
	for _, c := range []struct {
		agent             Agent
		interrupt, reject Keystroke
		fresh             string
	}{
		{Claude, press(Escape), press(Escape), "/clear"},
		{Codex, press(Escape), press(Escape), "/new"},
		{Gemini, press(Escape), press(Escape), "/clear"},
		// OpenCode wants Esc twice, so a single stray press can't stop it.
		{OpenCode, Keystroke{Key: Escape, Times: 2}, press(Escape), "/new"},
		// In Grok, Esc only moves focus; Ctrl+C cancels.
		{Grok, press(CtrlC), press(CtrlC), "/new"},
	} {
		if c.agent.Interrupt() != c.interrupt || c.agent.Reject() != c.reject || c.agent.NewConversation() != c.fresh {
			t.Errorf("%s: interrupt %v, reject %v, fresh %q; want %v, %v, %q", c.agent,
				c.agent.Interrupt(), c.agent.Reject(), c.agent.NewConversation(), c.interrupt, c.reject, c.fresh)
		}
	}
}
