package desktop

import (
	"sort"
	"strings"
)

// SessionState is what a session is doing, as the keys show it.
type SessionState string

const (
	Idle     SessionState = "idle"     // white: nothing running, or finished and already seen
	Thinking SessionState = "thinking" // blue: a turn is running
	Asking   SessionState = "asking"   // orange: waiting on you — a permission prompt or a question
	Unread   SessionState = "unread"   // green: finished, not looked at yet
	Failed   SessionState = "error"    // red: the turn ended on an API error
)

type Session struct {
	ID     string
	Agent  Agent
	Folder string
	// Where it runs: see Tabs.
	Tab    string
	State  SessionState
	Effort string
	// An effort change waiting for the session to be free.
	PendingEffort string
	StartedAt     float64
	LastEventAt   float64
}

func (s *Session) Name() string {
	parts := strings.FieldsFunc(s.Folder, func(r rune) bool { return r == '/' || r == '\\' })
	if len(parts) == 0 {
		return s.Folder
	}
	return parts[len(parts)-1]
}

// IsBusy: typing into a busy session would land in the middle of its turn.
func (s *Session) IsBusy() bool { return s.State == Thinking || s.State == Asking }

// Sessions is every agent session reporting in, kept current from its hook
// events in Claude Code's words, as the Mac app's Sessions.swift.
//
// Hooks only say what just happened, so a session's state is whatever the
// last meaningful event implied. Hooks also run in the background, so two
// events a few milliseconds apart can arrive in either order; each carries
// the time it was raised, and an event older than the last one applied is
// ignored. The same goes for a session that has ended: its stragglers must
// not bring it back.
type Sessions struct {
	byID map[string]*Session
	// When each ended or replaced session ended. A resumed session raises
	// events after that time and is welcome back; a late one does not.
	endedAt map[string]float64
}

func NewSessions() *Sessions {
	return &Sessions{byID: map[string]*Session{}, endedAt: map[string]float64{}}
}

// All is oldest first, so a session keeps its place as others come and go.
func (s *Sessions) All() []*Session {
	all := make([]*Session, 0, len(s.byID))
	for _, session := range s.byID {
		all = append(all, session)
	}
	sort.Slice(all, func(i, j int) bool { return all[i].StartedAt < all[j].StartedAt })
	return all
}

func (s *Sessions) Get(id string) *Session { return s.byID[id] }

// Apply returns whether anything changed.
func (s *Sessions) Apply(event map[string]any, agent Agent, tab string, at float64) bool {
	id, _ := event["session_id"].(string)
	name, _ := event["hook_event_name"].(string)
	if id == "" || name == "" {
		return false
	}
	folder, _ := event["cwd"].(string)

	if end, ok := s.endedAt[id]; ok && at <= end {
		return false
	}
	if name == "SessionEnd" {
		s.end(id, at)
		return true
	}

	session := s.byID[id]
	if session == nil {
		// A session the deck can't find a tab for would be a key that
		// lights up but can't be controlled.
		if tab == "" {
			return false
		}
		session = s.adopt(id, agent, folder, tab, at)
	}
	if at < session.LastEventAt {
		return false
	}
	session.LastEventAt = at
	if folder != "" {
		session.Folder = folder
	}
	if tab != "" {
		session.Tab = tab
	}
	if effort, ok := event["effort"].(map[string]any); ok {
		if level, ok := effort["level"].(string); ok {
			session.Effort = level
		}
	}
	if next, ok := transition(name, event); ok {
		session.State = next
	}
	return true
}

// adopt: one tab runs one agent, so a new session on a tab that already has
// one is that agent after /clear, or a fresh one in the same tab: it replaces
// the old session and inherits its place on the deck.
func (s *Sessions) adopt(id string, agent Agent, folder, tab string, at float64) *Session {
	session := &Session{ID: id, Agent: agent, Folder: folder, Tab: tab, State: Idle, StartedAt: at}
	for _, previous := range s.byID {
		if previous.Tab == tab {
			session.StartedAt = previous.StartedAt
			session.Effort = previous.Effort
			s.end(previous.ID, at)
			break
		}
	}
	s.byID[id] = session
	return session
}

func (s *Sessions) end(id string, at float64) {
	delete(s.byID, id)
	s.endedAt[id] = at
	// Stragglers arrive within seconds; an hour is plenty to remember.
	cutoff := at - 3_600_000
	for other, when := range s.endedAt {
		if when <= cutoff {
			delete(s.endedAt, other)
		}
	}
}

func transition(name string, event map[string]any) (SessionState, bool) {
	switch name {
	case "SessionStart":
		// A resume or compaction is the same conversation carrying on.
		source, _ := event["source"].(string)
		return Idle, source == "startup" || source == "clear"
	case "UserPromptSubmit":
		return Thinking, true
	case "PreToolUse":
		if event["tool_name"] == "AskUserQuestion" {
			return Asking, true
		}
		return Thinking, true
	case "PermissionRequest":
		return Asking, true
	case "PostToolUse", "PostToolUseFailure":
		return Thinking, true
	case "Notification":
		return Asking, isWaitingOnUser(event)
	case "Stop":
		return Unread, true
	case "StopFailure":
		return Failed, true
	case "Interrupt":
		return Idle, true
	}
	return "", false
}

var waitingNotifications = map[string]bool{
	"permission_prompt": true, "elicitation_dialog": true, "elicitation_url_dialog": true, "agent_needs_input": true,
}

func isWaitingOnUser(event map[string]any) bool {
	if kind, ok := event["notification_type"].(string); ok {
		return waitingNotifications[kind]
	}
	message, _ := event["message"].(string)
	return strings.Contains(strings.ToLower(message), "permission")
}

// MarkSeen: looking at a finished session turns it from green back to white.
func (s *Sessions) MarkSeen(tab string) bool {
	changed := false
	for _, session := range s.byID {
		if session.Tab == tab && session.State == Unread {
			session.State = Idle
			changed = true
		}
	}
	return changed
}

// Prune drops sessions whose tab has gone: an agent killed along with its
// tab never sends SessionEnd.
func (s *Sessions) Prune(alive func(tab string) bool, now float64) bool {
	changed := false
	for _, session := range s.All() {
		if !alive(session.Tab) {
			s.end(session.ID, now)
			changed = true
		}
	}
	return changed
}
