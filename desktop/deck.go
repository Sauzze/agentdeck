package desktop

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"sync"
	"time"
)

// Deck is the deck itself: the sessions, how they sit on the six keys, what
// the phone's controls do to them, and the live feed of all that to phones,
// as the Mac app's Deck.swift.
//
// One mutex guards it all. Keys are pressed one at a time on a worker of
// their own, outside the lock, so a slow terminal never holds up the server
// and two quick notches arrive in the order they were turned.
type Deck struct {
	mu        sync.Mutex
	access    *Access
	config    *Config
	sessions  *Sessions
	streams   map[*eventStream]string // each open stream, with the phone that opened it
	launchers map[string]*launcherTab
	// The key each session was given, so it keeps it.
	keyOf map[string]int
	// The tab recording started in, and when. One computer, one microphone.
	micPress *micPress
	work     chan func()
	// OnChange is called on every change, for the tray.
	OnChange func()
}

type micPress struct {
	tab string
	at  time.Time
}

const (
	// How often to ping idle event streams so they stay open.
	pingInterval = 20 * time.Second
	// How often to look for tabs that closed without their session ending.
	pruneInterval = 10 * time.Second
	// Claude stops listening by itself after two minutes.
	voiceLimit = 120 * time.Second
)

var effortLevels = []string{"low", "medium", "high", "xhigh", "max"}

func NewDeck() *Deck {
	d := &Deck{
		access: NewAccess(), config: loadConfig(), sessions: NewSessions(),
		streams: map[*eventStream]string{}, launchers: map[string]*launcherTab{},
		keyOf: map[string]int{}, work: make(chan func(), 64), OnChange: func() {},
	}
	go func() {
		for job := range d.work {
			job()
		}
	}()
	go func() {
		for range time.Tick(pingInterval) {
			d.mu.Lock()
			for stream := range d.streams {
				stream.send(nil)
			}
			d.mu.Unlock()
		}
	}()
	go func() {
		for range time.Tick(pruneInterval) {
			d.pruneClosedTabs()
		}
	}()
	return d
}

// MARK: Hook events

// Ingest takes an event from the hook. reported is the agent the hook was
// set up for; see agentOf for why that isn't always the sender.
func (d *Deck) Ingest(event map[string]any, reported, tab, startedIn string, at float64) {
	agent := agentOf(event, reported)
	canonical := agent.canonical(event)
	if canonical == nil {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if tab == "" {
		tab = d.launcherFor(canonical, agent)
	}
	if d.sessions.Apply(canonical, agent, tab, startedIn, at) {
		d.changed()
	}
}

// launcherFor finds a session's launcher when its hook couldn't say: Codex
// runs its hooks in a shared background service, and Gemini CLI can hide
// the launcher's variable. It's the launcher running that agent in the
// session's folder, when exactly one does and no other session holds it.
// A session the deck knows keeps the tab it was found in.
func (d *Deck) launcherFor(event map[string]any, agent Agent) string {
	id, _ := event["session_id"].(string)
	folder, _ := event["cwd"].(string)
	if id == "" || folder == "" || d.sessions.Get(id) != nil {
		return ""
	}
	taken := map[string]bool{}
	for _, session := range d.sessions.All() {
		taken[session.Tab] = true
	}
	match := ""
	for launcherID, launcher := range d.launchers {
		name := "launcher:" + launcherID
		if launcher.agent == agent && launcher.folder == folder && !taken[name] {
			if match != "" {
				return "" // several fit: a guess would put a session on the wrong key
			}
			match = name
		}
	}
	return match
}

// changed re-sends the state, with the lock held.
func (d *Deck) changed() {
	d.applyQueuedEffort()
	state := d.snapshot()
	for stream := range d.streams {
		stream.send(state)
	}
	go d.OnChange()
}

// Refresh re-sends the state, for changes the sessions don't see (the setup
// page's).
func (d *Deck) Refresh() {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.changed()
}

// MARK: Keys

type deckKey struct {
	pin     *string
	session *Session
}

// layout: a pinned key shows its project's session when one is running and
// stays reserved when none is. Every other session gets a free key. With a
// fixed number of keys, a session keeps its key until it ends, so keys don't
// shuffle as sessions come and go. With Auto, the keys grow and shrink with
// the sessions, and those still running keep their order when one ends.
// Sessions beyond the last key have none until one frees up.
func (d *Deck) layout() ([]deckKey, []*Session) {
	remaining := d.sessions.All()
	live := map[string]bool{}
	for _, s := range remaining {
		live[s.ID] = true
	}
	for id := range d.keyOf {
		if !live[id] {
			delete(d.keyOf, id)
		}
	}
	fixed := d.config.Layout.Keys != Auto
	keys := make([]deckKey, mostKeys)
	if fixed {
		keys = keys[:d.config.Layout.Keys]
	}
	for i := range keys {
		keys[i].pin = d.config.Pins[i]
	}
	place := func(s *Session, i int) {
		keys[i].session = s
		d.keyOf[s.ID] = i
		remaining = slices.DeleteFunc(remaining, func(r *Session) bool { return r.ID == s.ID })
	}
	for i := range keys {
		if keys[i].pin == nil {
			continue
		}
		var candidates []*Session
		for _, s := range remaining {
			if s.Project == *keys[i].pin {
				candidates = append(candidates, s)
			}
		}
		if len(candidates) > 0 {
			match := candidates[0]
			for _, c := range candidates {
				if index, ok := d.keyOf[c.ID]; ok && index == i {
					match = c
				}
			}
			place(match, i)
		}
	}
	if fixed {
		for _, s := range slices.Clone(remaining) {
			if i, ok := d.keyOf[s.ID]; ok && i < len(keys) && keys[i].pin == nil && keys[i].session == nil {
				place(s, i)
			}
		}
	} else {
		// Every pinned key, and a free one for each other session.
		pinned, last := 0, 0
		for i, k := range keys {
			if k.pin != nil {
				pinned, last = pinned+1, i+1
			}
		}
		keys = keys[:min(max(1, last, pinned+len(remaining)), mostKeys)]
		// In the order their keys had, so the grid shrinks without shuffling.
		slices.SortStableFunc(remaining, func(a, b *Session) int { return d.previousKey(a) - d.previousKey(b) })
	}
	for _, s := range slices.Clone(remaining) {
		free := slices.IndexFunc(keys, func(k deckKey) bool { return k.pin == nil && k.session == nil })
		if free < 0 {
			break
		}
		place(s, free)
	}
	// A session left without a key forgets the one it had, or it would claim
	// it back from the session that has it now.
	for _, s := range remaining {
		delete(d.keyOf, s.ID)
	}
	return keys, remaining
}

// previousKey is the key a session last had, or one past the last for a
// session new to the deck.
func (d *Deck) previousKey(s *Session) int {
	if i, ok := d.keyOf[s.ID]; ok {
		return i
	}
	return mostKeys
}

// snapshot is what the phone draws: the keys, the theme and the layout. No
// tabs or paths.
func (d *Deck) snapshot() []byte {
	keys, overflow := d.layout()
	entries := make([]map[string]any, len(keys))
	for i, key := range keys {
		entry := map[string]any{"pin": nil}
		if key.pin != nil {
			entry["pin"] = lastPathComponent(*key.pin)
		}
		if s := key.session; s != nil {
			effort := s.Effort
			if s.PendingEffort != "" {
				effort = s.PendingEffort
			}
			entry["session"] = map[string]any{
				"id": s.ID, "name": s.Name(), "project": s.ProjectName(), "state": s.State, "effort": effort,
				"pending": s.PendingEffort != "", "agent": s.Agent, "agentName": s.Agent.Name(),
				"dial": s.Agent.HasEffortDial(), "mic": s.Agent.HasVoice(),
				"activity": orNull(s.Activity()), "tool": orNull(s.Tool), "subagents": append([]Subagent{}, s.Subagents...),
				"maxPressedAt": millisOrNull(s.MaxPressedAt), "compacting": s.Compacting,
				"turnStartedAt": millisOrNull(s.TurnStartedAt), "errorKind": orNull(s.ErrorKind),
			}
		}
		entries[i] = entry
	}
	state, _ := json.Marshal(map[string]any{
		"keys": entries, "overflow": len(overflow), "theme": currentTheme(d.config), "scroll": d.config.ScrollEnabled,
		// What the office's held desks offer: firing here; hiring is the Mac app's for now.
		"hiring": map[string]bool{"fire": d.config.HiringEnabled, "hire": false},
		"layout": d.config.Layout,
	})
	return state
}

// orNull and millisOrNull write nothing as null, as the Mac app does.
func orNull(text string) any {
	if text == "" {
		return nil
	}
	return text
}

func millisOrNull(at float64) any {
	if at == 0 {
		return nil
	}
	return int64(at)
}

// MARK: Phones

func (d *Deck) attach(phone string) *eventStream {
	d.mu.Lock()
	defer d.mu.Unlock()
	stream := newEventStream()
	d.streams[stream] = phone
	stream.send(d.snapshot())
	return stream
}

func (d *Deck) detach(stream *eventStream) {
	d.mu.Lock()
	defer d.mu.Unlock()
	delete(d.streams, stream)
}

func (d *Deck) isConnected(phone string) bool {
	for _, owner := range d.streams {
		if owner == phone {
			return true
		}
	}
	return false
}

// unpair forgets a phone, or every phone when id is "", and hangs up on it
// now rather than at its next request. The lock is held.
func (d *Deck) unpair(id string) {
	if id == "" {
		d.access.Phones.RemoveAll()
	} else {
		d.access.Phones.Remove(id)
	}
	for stream, owner := range d.streams {
		if id == "" || owner == id {
			stream.close()
		}
	}
}

// MARK: Launchers

func (d *Deck) launcherConnected(id string, agent Agent, folder string) *launcherTab {
	d.mu.Lock()
	defer d.mu.Unlock()
	tab := &launcherTab{agent: agent, folder: folder, commands: make(chan launcherCommand, 32)}
	d.launchers[id] = tab
	return tab
}

// launcherGone ends the sessions in it: the agent has exited, or its
// terminal has closed.
func (d *Deck) launcherGone(id string, tab *launcherTab) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.launchers[id] != tab {
		return // a newer connection from the same launcher has taken over
	}
	delete(d.launchers, id)
	if d.sessions.Prune(func(name string) bool { return name != "launcher:"+id }, nowMillis()) {
		d.changed()
	}
}

// tab is the Tab a session's tab name stands for, with the lock held.
func (d *Deck) tab(name string) Tab {
	kind, id, socket := splitTab(name)
	if kind == "launcher" {
		if tab, ok := d.launchers[id]; ok {
			return tab
		}
		return nil
	}
	return commandTab{kind: kind, id: id, socket: socket}
}

// pruneClosedTabs drops sessions whose pane has closed. Launchers say so
// themselves, as their connection drops.
func (d *Deck) pruneClosedTabs() {
	d.mu.Lock()
	panes := map[string]commandTab{}
	for _, s := range d.sessions.All() {
		if tab, ok := d.tab(s.Tab).(commandTab); ok {
			panes[s.Tab] = tab
		}
	}
	d.mu.Unlock()

	gone := map[string]bool{}
	for name, pane := range panes {
		if !pane.alive() {
			gone[name] = true
		}
	}
	if len(gone) == 0 {
		return
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.sessions.Prune(func(name string) bool { return !gone[name] }, nowMillis()) {
		d.changed()
	}
}

// MARK: Controls

// inTab runs op on the session's tab, on the key worker, and waits for it.
// A tab you have been shown counts as seen. Called without the lock.
func (d *Deck) inTab(name string, op func(Tab) error) (int, string) {
	d.mu.Lock()
	tab := d.tab(name)
	d.mu.Unlock()
	if tab == nil {
		return http.StatusNotFound, "Tab not found"
	}
	result := make(chan error, 1)
	d.work <- func() { result <- op(tab) }
	switch err := <-result; {
	case errors.Is(err, errUnsupported):
		return http.StatusNotFound, "This terminal can't do that"
	case err != nil:
		return http.StatusNotFound, "Tab not found"
	}
	d.mu.Lock()
	if d.sessions.MarkSeen(name) {
		d.changed()
	}
	d.mu.Unlock()
	return http.StatusNoContent, ""
}

const hiringOff = "Hiring and firing are off. Turn them on in setup, on your computer."

// Perform runs one of the phone's controls on a session.
func (d *Deck) Perform(action, id string, query url.Values) (int, string) {
	// Releasing the mic stops recording where it started, whatever is
	// selected now — and even if that session has since gone.
	if action == "mic" && query.Get("phase") != "down" {
		return d.releaseMic()
	}
	d.mu.Lock()
	hiring := d.config.HiringEnabled
	d.mu.Unlock()
	if action == "hire" {
		if !hiring {
			return http.StatusForbidden, hiringOff
		}
		return http.StatusNotImplemented, "Hiring from the office needs the Mac app, for now."
	}
	d.mu.Lock()
	session := d.sessions.Get(id)
	if session == nil || session.Tab == "" {
		d.mu.Unlock()
		return http.StatusNotFound, "Session not found"
	}
	tab, agent, busy := session.Tab, session.Agent, session.IsBusy()
	d.mu.Unlock()

	// Accept and send are both Enter. They are separate controls on the phone
	// because they mean different things, as do reject and esc, which are
	// often both Escape but not in every agent.
	switch action {
	case "accept", "send":
		return d.press(tab, press(Enter))
	case "reject":
		return d.press(tab, agent.Reject())
	case "esc":
		return d.press(tab, agent.Interrupt())
	case "up":
		return d.press(tab, press(Up))
	case "down":
		return d.press(tab, press(Down))
	case "scroll":
		d.mu.Lock()
		enabled := d.config.ScrollEnabled
		d.mu.Unlock()
		if !enabled {
			return http.StatusForbidden, "Scrolling is off. Turn it on in setup, on your computer."
		}
		if query.Get("to") == "bottom" {
			return d.inTab(tab, func(t Tab) error { return t.ScrollToBottom() })
		}
		lines, err := strconv.Atoi(query.Get("lines"))
		if err != nil {
			return http.StatusBadRequest, "Unknown amount"
		}
		return d.inTab(tab, func(t Tab) error { return t.Scroll(clamp(lines, maxScroll)) })
	case "mic":
		if !agent.HasVoice() {
			return http.StatusBadRequest, agent.Name() + " has no voice input"
		}
		return d.pressMic(tab)
	case "fire":
		if !hiring {
			return http.StatusForbidden, hiringOff
		}
		return d.inTab(tab, func(t Tab) error { return t.Close() })
	case "clear":
		if busy {
			return http.StatusConflict, "Busy — clear it when " + agent.Name() + " is done"
		}
		return d.inTab(tab, func(t Tab) error { return t.Type(agent.NewConversation()) })
	case "button":
		d.mu.Lock()
		button, found := d.config.Layout.madeButton(query.Get("button"))
		d.mu.Unlock()
		switch {
		case !found:
			return http.StatusNotFound, "That button has gone. Your phone will catch up in a moment."
		case len(button.Agents) > 0 && !slices.Contains(button.Agents, string(agent)):
			return http.StatusBadRequest, "This button isn't for " + agent.Name()
		case button.WhenFree && busy:
			return http.StatusConflict, "Busy — try again when " + agent.Name() + " is done"
		case button.Key != "":
			return d.press(tab, buttonKeys[button.Key])
		case button.Text == "":
			return http.StatusBadRequest, "This button types nothing yet. Set it up in setup, on your computer."
		}
		return d.inTab(tab, func(t Tab) error { return t.Type(button.Text) })
	case "effort":
		if !agent.HasEffortDial() {
			return http.StatusBadRequest, agent.Name() + " has no effort setting"
		}
		level := query.Get("level")
		if !slices.Contains(effortLevels, level) {
			return http.StatusBadRequest, "Unknown level"
		}
		d.mu.Lock()
		defer d.mu.Unlock()
		if session = d.sessions.Get(id); session == nil {
			return http.StatusNotFound, "Session not found"
		}
		// ☢ Max says so, where the dial reaching max doesn't: the office only
		// sends its agent to the button for a press.
		if query.Get("source") == "max" && level == "max" {
			session.MaxPressedAt = nowMillis()
		}
		session.PendingEffort = level
		if level == session.Effort {
			session.PendingEffort = ""
		}
		queued := session.PendingEffort != "" && session.IsBusy()
		d.changed()
		if queued {
			return http.StatusAccepted, ""
		}
		return http.StatusNoContent, ""
	}
	return http.StatusBadRequest, "Unknown action"
}

// The most lines one request may scroll. A notch of the phone's wheel is a
// few; anything beyond is clamped, not obeyed.
const maxScroll = 200

func (d *Deck) press(tab string, keystroke Keystroke) (int, string) {
	return d.inTab(tab, func(t Tab) error { return t.Press(keystroke) })
}

// pressMic: push to talk through Claude's own /voice, in tap mode: Space
// starts listening, Space again stops and sends. Every start is matched by
// exactly one stop. A second press while recording, or a release with
// nothing recording, is ignored: an extra Space would flip Claude's state and
// leave the two out of step.
func (d *Deck) pressMic(tab string) (int, string) {
	d.mu.Lock()
	if d.micPress != nil && time.Since(d.micPress.at) < voiceLimit {
		d.mu.Unlock()
		return http.StatusNoContent, ""
	}
	d.micPress = &micPress{tab: tab, at: time.Now()}
	d.mu.Unlock()
	status, message := d.press(tab, press(Space))
	if status >= http.StatusBadRequest {
		// Nothing started, so the release must not send a Space either.
		d.mu.Lock()
		d.micPress = nil
		d.mu.Unlock()
	}
	return status, message
}

func (d *Deck) releaseMic() (int, string) {
	d.mu.Lock()
	started := d.micPress
	d.micPress = nil
	d.mu.Unlock()
	// After the limit Claude has stopped by itself, and a Space would start
	// it again.
	if started == nil || time.Since(started.at) >= voiceLimit {
		return http.StatusNoContent, ""
	}
	return d.press(started.tab, press(Space))
}

// Focus brings a session's tab forward, as far as its terminal allows.
func (d *Deck) Focus(id string) (int, string) {
	d.mu.Lock()
	session := d.sessions.Get(id)
	d.mu.Unlock()
	if session == nil || session.Tab == "" {
		return http.StatusNotFound, ""
	}
	return d.inTab(session.Tab, func(t Tab) error { return t.Focus() })
}

// applyQueuedEffort: typed into a running turn, /effort would be queued as a
// message, so it waits for the session to be free. No hook reports a slash
// command, so the new level is assumed; the next event's effort field
// corrects it. The lock is held.
func (d *Deck) applyQueuedEffort() {
	for _, session := range d.sessions.All() {
		if session.PendingEffort == "" || session.IsBusy() {
			continue
		}
		level, tab := session.PendingEffort, d.tab(session.Tab)
		session.PendingEffort = ""
		if tab == nil {
			continue
		}
		// Queued from a goroutine of its own: the lock is held here, and the
		// job takes it once done.
		go func() {
			d.work <- func() {
				if tab.Type("/effort "+level) != nil {
					return
				}
				d.mu.Lock()
				defer d.mu.Unlock()
				session.Effort = level
				d.changed()
			}
		}()
	}
}

func nowMillis() float64 { return float64(time.Now().UnixMilli()) }

func clamp(n, limit int) int { return max(-limit, min(n, limit)) }

func lastPathComponent(path string) string {
	return (&Session{Folder: path}).Name()
}
