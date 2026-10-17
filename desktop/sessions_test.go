package desktop

import (
	"os"
	"path/filepath"
	"testing"
)

const tab = "tmux:%1@/tmp/tmux-501/default"

// event is a hook event from session s1, in Claude Code's words.
func event(name string, fields ...any) map[string]any {
	e := map[string]any{"hook_event_name": name, "session_id": "s1", "cwd": "/work/api-server"}
	for i := 0; i+1 < len(fields); i += 2 {
		e[fields[i].(string)] = fields[i+1]
	}
	return e
}

func stateAfter(t *testing.T, s *Sessions) SessionState {
	t.Helper()
	session := s.Get("s1")
	if session == nil {
		t.Fatal("the session isn't on the deck")
	}
	return session.State
}

func TestATurnFromStartToFinish(t *testing.T) {
	s := NewSessions()
	for i, step := range []struct {
		event map[string]any
		want  SessionState
	}{
		{event("SessionStart", "source", "startup"), Idle},
		{event("UserPromptSubmit"), Thinking},
		{event("PreToolUse", "tool_name", "Bash"), Thinking},
		{event("PermissionRequest"), Asking},
		{event("PostToolUse"), Thinking},
		{event("PreToolUse", "tool_name", "AskUserQuestion"), Asking},
		{event("PostToolUse"), Thinking},
		{event("Stop"), Unread},
	} {
		s.Apply(step.event, Claude, tab, "", float64(100*(i+1)))
		if got := stateAfter(t, s); got != step.want {
			t.Fatalf("after %s, the key is %s, want %s", step.event["hook_event_name"], got, step.want)
		}
	}
	if !s.MarkSeen(tab) || stateAfter(t, s) != Idle {
		t.Fatal("looking at a finished session didn't turn its key white")
	}
}

func TestEndingsOtherThanDone(t *testing.T) {
	for name, want := range map[string]SessionState{"StopFailure": Failed, "Interrupt": Idle} {
		s := NewSessions()
		s.Apply(event("UserPromptSubmit"), Claude, tab, "", 100)
		s.Apply(event(name), Claude, tab, "", 200)
		if got := stateAfter(t, s); got != want {
			t.Errorf("after %s, the key is %s, want %s", name, got, want)
		}
	}
}

func TestOnlyNotificationsThatWaitOnYouAsk(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, "", 100)
	s.Apply(event("Notification", "notification_type", "idle_prompt"), Claude, tab, "", 200)
	if got := stateAfter(t, s); got != Thinking {
		t.Fatalf("an idle reminder turned the key %s", got)
	}
	s.Apply(event("Notification", "notification_type", "permission_prompt"), Claude, tab, "", 300)
	if got := stateAfter(t, s); got != Asking {
		t.Fatalf("a permission prompt turned the key %s, want %s", got, Asking)
	}
}

func TestAResumedConversationKeepsItsState(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, "", 100)
	s.Apply(event("SessionStart", "source", "compact"), Claude, tab, "", 200)
	if got := stateAfter(t, s); got != Thinking {
		t.Fatalf("compacting reset the key to %s", got)
	}
}

func TestAnOlderEventArrivingLateIsIgnored(t *testing.T) {
	s := NewSessions()
	s.Apply(event("Stop"), Claude, tab, "", 200)
	if s.Apply(event("UserPromptSubmit"), Claude, tab, "", 100) {
		t.Fatal("an event older than the last one applied changed the session")
	}
	if got := stateAfter(t, s); got != Unread {
		t.Fatalf("the key is %s, want %s", got, Unread)
	}
}

func TestAnEndedSessionStaysEndedUnlessResumed(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, "", 100)
	s.Apply(event("SessionEnd"), Claude, tab, "", 300)
	if s.Apply(event("Stop"), Claude, tab, "", 250) || s.Get("s1") != nil {
		t.Fatal("a straggler brought an ended session back")
	}
	s.Apply(event("UserPromptSubmit"), Claude, tab, "", 400)
	if s.Get("s1") == nil {
		t.Fatal("a resumed session didn't come back")
	}
}

func TestASessionWithoutATabIsLeftOff(t *testing.T) {
	s := NewSessions()
	if s.Apply(event("UserPromptSubmit"), Claude, "", "", 100) || len(s.All()) != 0 {
		t.Fatal("a session the deck couldn't control got a key")
	}
}

func TestANewSessionInTheSameTabTakesOverItsPlace(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, "", 100)
	cleared := map[string]any{"hook_event_name": "SessionStart", "source": "clear", "session_id": "s2", "cwd": "/work/api-server"}
	s.Apply(cleared, Claude, tab, "", 200)
	if s.Get("s1") != nil {
		t.Fatal("the cleared conversation is still on the deck")
	}
	if s2 := s.Get("s2"); s2 == nil || s2.StartedAt != 100 {
		t.Fatalf("the new conversation is %+v, want it in the old one's place", s2)
	}
}

func TestSessionsWhoseTabIsGoneArePruned(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, "", 100)
	if s.Prune(func(string) bool { return true }, 200) || s.Get("s1") == nil {
		t.Fatal("a session with its tab still open was pruned")
	}
	if !s.Prune(func(string) bool { return false }, 300) || s.Get("s1") != nil {
		t.Fatal("a session whose tab closed is still on the deck")
	}
}

func TestEveryAgentReachesTheSameStates(t *testing.T) {
	for _, c := range []struct {
		agent  Agent
		events []map[string]any
	}{
		{Gemini, []map[string]any{
			{"hook_event_name": "BeforeAgent"}, {"hook_event_name": "Notification"}, {"hook_event_name": "AfterAgent"},
		}},
		{Grok, []map[string]any{
			{"hookEventName": "UserPromptSubmit", "hook_event_name": "UserPromptSubmit"},
			{"hookEventName": "Notification", "hook_event_name": "Notification", "notificationType": "permission_prompt"},
			{"hookEventName": "Stop", "hook_event_name": "Stop", "reason": "end_turn"},
		}},
	} {
		s := NewSessions()
		for i, e := range c.events {
			e["session_id"], e["sessionId"] = "s1", "s1"
			s.Apply(c.agent.canonical(e), c.agent, tab, "", float64(100*(i+1)))
			if want := []SessionState{Thinking, Asking, Unread}[i]; stateAfter(t, s) != want {
				t.Errorf("%s: after %s the key is %s, want %s", c.agent, e["hook_event_name"], stateAfter(t, s), want)
			}
		}
	}
}

func TestAProjectKeepsTheFolderTheSessionStartedIn(t *testing.T) {
	isolate(t)
	repo := filepath.Join(homeDir, "work", "api-server")
	if err := os.MkdirAll(filepath.Join(repo, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	s := NewSessions()
	s.Apply(event("SessionStart", "source", "startup", "cwd", filepath.Join(repo, "cmd")), Claude, tab, "", 100)
	s.Apply(event("PreToolUse", "cwd", filepath.Join(homeDir, "scratch", "preview")), Claude, tab, "", 200)
	session := s.Get("s1")
	if session.ProjectName() != "api-server" || session.Name() != "preview" {
		t.Fatalf("project %q, folder %q: want the repository the session started in, and where it is now",
			session.ProjectName(), session.Name())
	}

	// The folder the agent says it started in comes first.
	s.Apply(map[string]any{"hook_event_name": "SessionStart", "source": "startup", "session_id": "s2", "cwd": repo},
		Claude, "tmux:%2@/tmp/tmux-501/default", filepath.Join(homeDir, "notes"), 300)
	if name := s.Get("s2").ProjectName(); name != "notes" {
		t.Fatalf("project %q, want the folder the agent started in", name)
	}
}

func TestTheHomeFolderIsNeverAProject(t *testing.T) {
	isolate(t)
	if err := os.MkdirAll(filepath.Join(homeDir, ".git"), 0o755); err != nil {
		t.Fatal(err)
	}
	folder := filepath.Join(homeDir, "work", "site")
	if got := projectOf(folder); got != folder {
		t.Fatalf("projectOf(%q) = %q, want the folder itself", folder, got)
	}
}

func TestSubagentsComeAndGo(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, "", 100)
	s.Apply(event("SubagentStart", "agent_id", "a1", "agent_type", "Explore"), Claude, tab, "", 200)
	s.Apply(event("SubagentStart", "agent_id", "a2", "agent_type", "Plan"), Claude, tab, "", 300)
	s.Apply(event("SubagentStop", "agent_id", "a1", "agent_type", "Explore"), Claude, tab, "", 400)
	// Arriving late, after its stop, a start must not bring the helper back.
	if s.Apply(event("SubagentStart", "agent_id", "a1", "agent_type", "Explore"), Claude, tab, "", 150) {
		t.Fatal("a start that arrived after its stop changed the session")
	}
	if got := s.Get("s1").Subagents; len(got) != 1 || got[0] != (Subagent{ID: "a2", Type: "Plan"}) {
		t.Fatalf("subagents %+v, want only a2", got)
	}

	s.Apply(event("SubagentStart", "agent_id", "a3", "agent_type", "Explore"), Claude, tab, "", 500)
	tasks := []any{map[string]any{"id": "t1", "type": "subagent", "status": "running", "agent_type": "Explore"}}
	s.Apply(event("Stop", "background_tasks", tasks), Claude, tab, "", 600)
	if got := s.Get("s1").Subagents; len(got) != 1 || got[0].ID != "a3" {
		t.Fatalf("subagents %+v, want only the one still working in the background", got)
	}
	s.Apply(event("StopFailure"), Claude, tab, "", 700)
	if got := s.Get("s1").Subagents; len(got) != 0 {
		t.Fatalf("subagents %+v after the turn failed, want none", got)
	}
}

func TestWhatTheAgentIsDoing(t *testing.T) {
	s := NewSessions()
	for i, step := range []struct {
		event          map[string]any
		tool, activity string
	}{
		{event("UserPromptSubmit"), "", "Thinking"},
		{event("PreToolUse", "tool_name", "Edit", "tool_use_id", "t1", "tool_input", map[string]any{"file_path": "/work/api-server/main.go"}), "Edit", "Editing main.go"},
		// A subagent's tools are its own.
		{event("PreToolUse", "agent_id", "a1", "tool_name", "Read", "tool_input", map[string]any{"file_path": "/x/notes.md"}), "Edit", "Editing main.go"},
		{event("PostToolUse", "tool_use_id", "t0"), "Edit", "Editing main.go"},
		{event("PostToolUse", "tool_use_id", "t1"), "", "Thinking"},
		{event("PreToolUse", "tool_name", "Bash", "tool_use_id", "t2", "tool_input", map[string]any{"command": "make deploy"}), "Bash", "Running make"},
		{event("PermissionRequest", "tool_name", "Bash"), "Bash", "Waiting for you: Bash"},
		{event("PostToolUse", "tool_use_id", "t2"), "", "Thinking"},
		{event("PreCompact", "trigger", "auto"), "", "Compacting the conversation"},
		{event("SessionStart", "source", "compact"), "", "Thinking"},
		{event("Stop"), "", ""},
	} {
		s.Apply(step.event, Claude, tab, "", float64(100*(i+1)))
		session := s.Get("s1")
		if session.Tool != step.tool || session.Activity() != step.activity {
			t.Fatalf("step %d: tool %q, activity %q; want %q, %q", i, session.Tool, session.Activity(), step.tool, step.activity)
		}
	}
}

func TestATurnsTimeAndWhyItFailed(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, "", 100)
	if s.Get("s1").TurnStartedAt != 100 {
		t.Fatal("the turn's start wasn't kept")
	}
	s.Apply(event("StopFailure", "error", "rate_limit"), Claude, tab, "", 200)
	if session := s.Get("s1"); session.TurnStartedAt != 0 || session.ErrorKind != "rate_limit" {
		t.Fatalf("turn started at %v, error %q: want no turn and the rate limit", session.TurnStartedAt, session.ErrorKind)
	}
	s.Apply(event("UserPromptSubmit"), Claude, tab, "", 300)
	if session := s.Get("s1"); session.ErrorKind != "" {
		t.Fatalf("error %q kept into the next turn", session.ErrorKind)
	}
}
