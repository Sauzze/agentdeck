package desktop

import "testing"

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
		s.Apply(step.event, Claude, tab, float64(100*(i+1)))
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
		s.Apply(event("UserPromptSubmit"), Claude, tab, 100)
		s.Apply(event(name), Claude, tab, 200)
		if got := stateAfter(t, s); got != want {
			t.Errorf("after %s, the key is %s, want %s", name, got, want)
		}
	}
}

func TestOnlyNotificationsThatWaitOnYouAsk(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, 100)
	s.Apply(event("Notification", "notification_type", "idle_prompt"), Claude, tab, 200)
	if got := stateAfter(t, s); got != Thinking {
		t.Fatalf("an idle reminder turned the key %s", got)
	}
	s.Apply(event("Notification", "notification_type", "permission_prompt"), Claude, tab, 300)
	if got := stateAfter(t, s); got != Asking {
		t.Fatalf("a permission prompt turned the key %s, want %s", got, Asking)
	}
}

func TestAResumedConversationKeepsItsState(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, 100)
	s.Apply(event("SessionStart", "source", "compact"), Claude, tab, 200)
	if got := stateAfter(t, s); got != Thinking {
		t.Fatalf("compacting reset the key to %s", got)
	}
}

func TestAnOlderEventArrivingLateIsIgnored(t *testing.T) {
	s := NewSessions()
	s.Apply(event("Stop"), Claude, tab, 200)
	if s.Apply(event("UserPromptSubmit"), Claude, tab, 100) {
		t.Fatal("an event older than the last one applied changed the session")
	}
	if got := stateAfter(t, s); got != Unread {
		t.Fatalf("the key is %s, want %s", got, Unread)
	}
}

func TestAnEndedSessionStaysEndedUnlessResumed(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, 100)
	s.Apply(event("SessionEnd"), Claude, tab, 300)
	if s.Apply(event("Stop"), Claude, tab, 250) || s.Get("s1") != nil {
		t.Fatal("a straggler brought an ended session back")
	}
	s.Apply(event("UserPromptSubmit"), Claude, tab, 400)
	if s.Get("s1") == nil {
		t.Fatal("a resumed session didn't come back")
	}
}

func TestASessionWithoutATabIsLeftOff(t *testing.T) {
	s := NewSessions()
	if s.Apply(event("UserPromptSubmit"), Claude, "", 100) || len(s.All()) != 0 {
		t.Fatal("a session the deck couldn't control got a key")
	}
}

func TestANewSessionInTheSameTabTakesOverItsPlace(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, 100)
	cleared := map[string]any{"hook_event_name": "SessionStart", "source": "clear", "session_id": "s2", "cwd": "/work/api-server"}
	s.Apply(cleared, Claude, tab, 200)
	if s.Get("s1") != nil {
		t.Fatal("the cleared conversation is still on the deck")
	}
	if s2 := s.Get("s2"); s2 == nil || s2.StartedAt != 100 {
		t.Fatalf("the new conversation is %+v, want it in the old one's place", s2)
	}
}

func TestSessionsWhoseTabIsGoneArePruned(t *testing.T) {
	s := NewSessions()
	s.Apply(event("UserPromptSubmit"), Claude, tab, 100)
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
			s.Apply(c.agent.canonical(e), c.agent, tab, float64(100*(i+1)))
			if want := []SessionState{Thinking, Asking, Unread}[i]; stateAfter(t, s) != want {
				t.Errorf("%s: after %s the key is %s, want %s", c.agent, e["hook_event_name"], stateAfter(t, s), want)
			}
		}
	}
}
