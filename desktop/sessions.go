package desktop

import (
	"os"
	"path/filepath"
	"slices"
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
	ID    string
	Agent Agent
	// Where the agent is now: it moves as the agent changes folders.
	Folder string
	// The project the session belongs to, settled when it starts: see
	// projectOf. Keys show its name and pins match it, so neither changes as
	// the agent moves into a subfolder.
	Project string
	// Where it runs: see Tabs.
	Tab    string
	State  SessionState
	Effort string
	// An effort change waiting for the session to be free.
	PendingEffort string
	StartedAt     float64
	LastEventAt   float64

	// Claude Code's subagents still running, oldest first.
	Subagents []Subagent
	// Subagents seen stopping this turn. Hooks can arrive out of order, and a
	// start that comes in after its stop must not bring the helper back.
	StoppedSubagents map[string]bool
	// The tool running, by name, and its call's id: with tools run side by
	// side, only the end of the one shown clears it.
	Tool      string
	ToolUseID string
	// What that tool call is doing, in a few words: see activityOf.
	ToolActivity string
	// The tool a permission prompt is asking about.
	WaitingFor string
	// When ☢ Max was last pressed for this session, in ms. Only the button
	// sets it, never the dial, so the office knows which one was used.
	MaxPressedAt  float64
	Compacting    bool
	TurnStartedAt float64
	// Why the last turn failed, as Claude Code names it: "rate_limit",
	// "overloaded"… Kept while the session shows the error.
	ErrorKind string
}

type Subagent struct {
	ID   string `json:"id"`
	Type string `json:"type"`
}

func (s *Session) Name() string        { return lastPart(s.Folder) }
func (s *Session) ProjectName() string { return lastPart(s.Project) }

func lastPart(path string) string {
	parts := strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' })
	if len(parts) == 0 {
		return path
	}
	return parts[len(parts)-1]
}

// IsBusy: typing into a busy session would land in the middle of its turn.
func (s *Session) IsBusy() bool { return s.State == Thinking || s.State == Asking }

// Activity is what the agent is doing right now, in a few words, or "" when
// it's doing nothing.
func (s *Session) Activity() string {
	if s.Compacting {
		return "Compacting the conversation"
	}
	switch s.State {
	case Thinking:
		if s.ToolActivity == "" {
			return "Thinking"
		}
		return s.ToolActivity
	case Asking:
		if s.WaitingFor != "" {
			return cutActivity("Waiting for you: " + s.WaitingFor)
		}
		if s.ToolActivity == "" {
			return "Waiting for you"
		}
		return s.ToolActivity
	}
	return ""
}

func (s *Session) clearTool() {
	s.Tool, s.ToolUseID, s.ToolActivity, s.WaitingFor = "", "", "", ""
}

// endTurn: a turn is over, so nothing runs any more, except subagents of the
// types still working in the background.
func (s *Session) endTurn(keepingSubagentsOf []string) {
	s.clearTool()
	s.Compacting = false
	s.TurnStartedAt = 0
	left := slices.Clone(keepingSubagentsOf)
	var kept []Subagent
	for _, subagent := range s.Subagents {
		if i := slices.Index(left, subagent.Type); i >= 0 {
			left = slices.Delete(left, i, i+1)
			kept = append(kept, subagent)
		}
	}
	s.Subagents = kept
}

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

// Apply returns whether anything changed. startedIn is the folder the agent
// was started in, when the hook knows it: an event's cwd is wherever the agent
// is now.
func (s *Sessions) Apply(event map[string]any, agent Agent, tab, startedIn string, at float64) bool {
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
		session = s.adopt(id, agent, folder, startedIn, tab, at)
	}
	// Subagents come and go by id, so the order their events arrive in
	// doesn't matter.
	subagentsChanged := trackSubagents(name, event, session)
	if at < session.LastEventAt {
		return subagentsChanged
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
	followDetails(name, event, session, at)
	if next, ok := transition(name, event); ok {
		session.State = next
		if next != Failed {
			session.ErrorKind = ""
		}
	}
	return true
}

// adopt: one tab runs one agent, so a new session on a tab that already has
// one is that agent after /clear, or a fresh one in the same tab: it replaces
// the old session and inherits its place on the deck, and its project when
// the hook doesn't say.
func (s *Sessions) adopt(id string, agent Agent, folder, startedIn, tab string, at float64) *Session {
	session := &Session{ID: id, Agent: agent, Folder: folder, Tab: tab, State: Idle, StartedAt: at}
	var previous *Session
	for _, other := range s.byID {
		if other.Tab == tab {
			previous = other
			break
		}
	}
	switch {
	case startedIn != "":
		session.Project = projectOf(startedIn)
	case previous != nil:
		session.Project = previous.Project
	default:
		session.Project = projectOf(folder)
	}
	if previous != nil {
		session.StartedAt = previous.StartedAt
		session.Effort = previous.Effort
		s.end(previous.ID, at)
	}
	s.byID[id] = session
	return session
}

// projectOf is the project of a session started in folder: the top folder of
// the git repository holding it, or the folder itself. The home folder is
// never a project's top, even when it holds a repository of its own.
func projectOf(folder string) string {
	for dir := filepath.Clean(folder); dir != homeDir; {
		if _, err := os.Stat(filepath.Join(dir, ".git")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return folder
}

// trackSubagents follows Claude Code's subagents, which the office shows at
// their agent's desk.
func trackSubagents(name string, event map[string]any, session *Session) bool {
	id, _ := event["agent_id"].(string)
	if id == "" || (name != "SubagentStart" && name != "SubagentStop") {
		return false
	}
	running := slices.IndexFunc(session.Subagents, func(s Subagent) bool { return s.ID == id })
	if name == "SubagentStop" {
		if session.StoppedSubagents == nil {
			session.StoppedSubagents = map[string]bool{}
		}
		session.StoppedSubagents[id] = true
		if running < 0 {
			return false
		}
		session.Subagents = slices.Delete(session.Subagents, running, running+1)
		return true
	}
	if running >= 0 || session.StoppedSubagents[id] {
		return false
	}
	kind, _ := event["agent_type"].(string)
	session.Subagents = append(session.Subagents, Subagent{ID: id, Type: kind})
	return true
}

// followDetails keeps what the office shows besides the state: the tool running and
// what it's doing, a compaction, when the turn started and why it failed.
func followDetails(name string, event map[string]any, session *Session, at float64) {
	// A subagent's tools are its own: its agent is still on the call that
	// started it.
	_, fromSubagent := event["agent_id"]
	switch name {
	case "UserPromptSubmit":
		session.TurnStartedAt = at
		session.StoppedSubagents = nil
		session.clearTool()
	case "PreToolUse":
		if fromSubagent {
			return
		}
		session.Tool, _ = event["tool_name"].(string)
		session.ToolUseID, _ = event["tool_use_id"].(string)
		input, _ := event["tool_input"].(map[string]any)
		session.ToolActivity = activityOf(session.Tool, input)
		session.WaitingFor = ""
	case "PostToolUse", "PostToolUseFailure":
		session.WaitingFor = ""
		call, _ := event["tool_use_id"].(string)
		if !fromSubagent && (call == "" || session.ToolUseID == "" || call == session.ToolUseID) {
			session.clearTool()
		}
	case "PermissionRequest":
		session.WaitingFor, _ = event["tool_name"].(string)
	case "PreCompact":
		session.Compacting = true
	case "PostCompact":
		session.Compacting = false
	case "SessionStart":
		source, _ := event["source"].(string)
		if source == "compact" {
			session.Compacting = false
		}
		if source == "startup" || source == "clear" {
			session.endTurn(nil)
		}
	case "Stop":
		// Subagents sent to the background outlive the turn.
		var background []string
		tasks, _ := event["background_tasks"].([]any)
		for _, task := range tasks {
			t, _ := task.(map[string]any)
			if kind, ok := t["agent_type"].(string); ok && t["type"] == "subagent" {
				background = append(background, kind)
			}
		}
		session.endTurn(background)
	case "StopFailure":
		session.endTurn(nil)
		session.ErrorKind, _ = event["error"].(string)
	case "Interrupt":
		session.endTurn(nil)
	}
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
