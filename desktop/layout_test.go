package desktop

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestKeyCountsInJSON(t *testing.T) {
	for text, want := range map[string]KeyCount{`"auto"`: Auto, `6`: 6, `9`: 9, `7`: Auto, `"nine"`: Auto, `null`: Auto} {
		var got KeyCount
		if err := json.Unmarshal([]byte(text), &got); err != nil || got != want {
			t.Errorf("%s read as %d, want %d", text, got, want)
		}
	}
	if text, _ := json.Marshal(Auto); string(text) != `"auto"` {
		t.Errorf("Auto is written %s, want \"auto\"", text)
	}
}

func TestALayoutIsCheckedBeforeItsKept(t *testing.T) {
	layout, err := parseLayout([]byte(`{"keys": 7, "dial": false, "rows": [
		{"tall": true, "buttons": [
			{"id": "accept", "width": 9},
			{"id": "accept"},
			{"id": "rm-rf"},
			{"id": "custom-a1", "text": "  /compact  ", "label": "a label far longer than sixteen", "agents": ["claude", "skynet"]},
			{"id": "custom-b2", "text": "/compact\nrm -rf ~"},
			{"id": "custom-c3", "key": "f13"},
			{"id": "custom-d4", "key": "shift-tab", "agents": ["claude", "codex", "gemini", "opencode", "grok"]},
			{"id": "custom-e5", "text": "/review"}
		]},
		{"buttons": []}, {"buttons": [{"id": "up"}]}, {"buttons": [{"id": "down"}]}, {"buttons": [{"id": "esc"}]}, {"buttons": [{"id": "send"}]}
	]}`))
	if err != nil {
		t.Fatal(err)
	}
	want := Layout{Keys: Auto, Dial: false, Stick: true, Rows: []ButtonRow{
		{Tall: true, Buttons: []Button{
			{ID: "accept", Width: 1},
			{ID: "custom-a1", Width: 1, Label: "a label far long", Text: "/compact", Agents: []string{"claude"}},
			{ID: "custom-d4", Width: 1, Key: "shift-tab"},
			{ID: "custom-e5", Width: 1, Text: "/review"},
		}},
		// Four rows at most, the empty one among them.
		{Buttons: []Button{{ID: "up", Width: 1}}},
		{Buttons: []Button{{ID: "down", Width: 1}}},
	}}
	if !layout.sameAs(want) {
		got, _ := json.MarshalIndent(layout, "", "  ")
		t.Fatalf("kept\n%s", got)
	}
	if _, err := parseLayout([]byte(`{"rows": "lots"}`)); err == nil {
		t.Fatal("a layout of the wrong shape was kept")
	}
}

// running starts count sessions in their own tmux panes.
func running(d *Deck, count int) {
	for i := range count {
		e := map[string]any{"hook_event_name": "UserPromptSubmit", "session_id": fmt.Sprintf("s%d", i), "cwd": fmt.Sprintf("/work/p%d", i)}
		d.sessions.Apply(e, Claude, fmt.Sprintf("tmux:%%%d@/tmp/tmux", i), "", float64(100+i))
	}
}

func TestAutoShowsAKeyPerSessionUpToNine(t *testing.T) {
	for _, c := range []struct {
		sessions, pinned, want int
	}{
		{0, -1, 1}, {1, -1, 1}, {2, -1, 2}, {4, -1, 4}, {12, -1, 9},
		// A pinned project keeps its key even when it isn't running, and the
		// sessions running still get one each.
		{2, 6, 7}, {2, 0, 3}, {1, 0, 2},
	} {
		d := newTestDeck(t)
		running(d, c.sessions)
		if c.pinned >= 0 {
			d.config.Pin("/work/pinned", c.pinned)
		}
		keys, overflow := d.layout()
		if len(keys) != c.want || len(overflow) != max(0, c.sessions-c.want) {
			t.Errorf("%d sessions, pin at %d: %d keys and %d left over, want %d", c.sessions, c.pinned, len(keys), len(overflow), c.want)
		}
	}
}

func TestAFixedNumberOfKeysStaysPut(t *testing.T) {
	d := newTestDeck(t)
	d.config.Pin("/work/pinned", 7)
	d.config.Layout = Layout{Keys: 3, Dial: true, Stick: true, Rows: []ButtonRow{}}
	running(d, 5)
	keys, overflow := d.layout()
	if len(keys) != 3 || len(overflow) != 2 {
		t.Fatalf("%d keys and %d left over, want 3 and 2", len(keys), len(overflow))
	}
	// A pin beyond the keys waits, and comes back when there's room again.
	d.config.Layout.Keys = Auto
	if keys, _ := d.layout(); len(keys) != 8 || keys[7].pin == nil {
		t.Fatalf("back on Auto, %d keys, want the pin on key 8 back", len(keys))
	}
	d.config.Layout.Keys = 3
	var snapshot struct {
		Keys   []any
		Layout struct{ Keys int }
	}
	if json.Unmarshal(d.snapshot(), &snapshot) != nil || len(snapshot.Keys) != 3 || snapshot.Layout.Keys != 3 {
		t.Fatal("the phone isn't sent three keys and the layout")
	}
}

func TestAutoKeepsTheKeysInOrderWhenOneGoes(t *testing.T) {
	d := newTestDeck(t)
	running(d, 3)
	d.layout()
	d.sessions.Apply(map[string]any{"hook_event_name": "SessionEnd", "session_id": "s0"}, Claude, "tmux:%0@/tmp/tmux", "", 200)
	keys, _ := d.layout()
	if len(keys) != 2 || keys[0].session.ID != "s1" || keys[1].session.ID != "s2" {
		t.Fatalf("after the first session ended, the keys hold %s and %s, want s1 then s2", keys[0].session.ID, keys[1].session.ID)
	}
}

// With nine keys taken, a session left without one doesn't claim its old
// key back from the session given it.
func TestAutoDoesntSwapKeysWhenSessionsOutnumberThem(t *testing.T) {
	d := newTestDeck(t)
	running(d, 9)
	d.config.Pin("/work/p0", 8) // s0 on key 9, the others on keys 1 to 8
	d.layout()
	d.config.Unpin(8)
	d.layout()
	d.config.Pin("/work/elsewhere", 0) // the others move up a key, and s0 has none
	d.layout()
	keys, overflow := d.layout()
	if keys[8].session == nil || keys[8].session.ID != "s8" || len(overflow) != 1 || overflow[0].ID != "s0" {
		t.Fatalf("key 9 went to %v, want s8 to keep it and s0 to wait", keys[8].session)
	}
}

func TestTheSetupPageKnowsWhichKeysAreOnThePhone(t *testing.T) {
	d := newTestDeck(t)
	running(d, 1)
	d.config.Pin("/work/pinned", 7)
	d.config.Layout.Keys = 6
	state := (&router{deck: d}).setupState()
	// Every key, so a pin beyond the six can still be undone.
	if pins := state["pins"].([]any); len(pins) != mostKeys || pins[7] == nil || state["phoneKeys"] != 6 {
		t.Fatalf("with six keys, %d to pin to and %v on the phone, want all %d and 6", len(pins), state["phoneKeys"], mostKeys)
	}
	d.config.Layout.Keys = Auto
	if keys := (&router{deck: d}).setupState()["phoneKeys"]; keys != 8 {
		t.Fatalf("with Auto and a pin on key 8, %v keys on the phone, want 8", keys)
	}
}

func TestTypingNeverTakesTextForAnOption(t *testing.T) {
	for _, c := range []struct {
		kind, text string
		want       []string
	}{
		{"tmux", "--continue", []string{"send-keys", "-t", "%1", "-l", "--", "--continue"}},
		{"tmux", "echo hi;", []string{"send-keys", "-t", "%1", "-l", "--", `echo hi\;`}},
		{"wezterm", "-y", []string{"send-text", "--pane-id", "%1", "--no-paste", "--", "-y"}},
		{"kitty", "-y", []string{"send-text", "--match", "id:%1", "--", "-y"}},
	} {
		if got := (commandTab{kind: c.kind, id: "%1"}).typeArgs(c.text); strings.Join(got, " | ") != strings.Join(c.want, " | ") {
			t.Errorf("%s typing %q: %q, want %q", c.kind, c.text, got, c.want)
		}
	}
}

func TestHugeTextIsCutQuickly(t *testing.T) {
	start := time.Now()
	if got := oneLine(strings.Repeat("é", 1<<20), commandLimit); len([]rune(got)) != commandLimit {
		t.Fatalf("cut to %d characters, want %d", len([]rune(got)), commandLimit)
	}
	if took := time.Since(start); took > time.Second {
		t.Fatalf("cutting a megabyte took %v", took)
	}
}

func TestAProfileFileIsShownAsItWouldBeKept(t *testing.T) {
	d := newTestDeck(t)
	// Field names in another case, and a second "text" in another case: Go
	// reads both, so the page must be shown what Go keeps, not the file.
	file := `{"name": "Shared", "layout": {"rows": [{"buttons": [{"id": "accept"}], "Buttons": [{"id": "custom-x", "label": "compact", "text": "/compact", "TEXT": "/status"}]}]}}`
	checked := serve(t, d, call{method: "POST", target: "/setup/profiles?action=check", host: "localhost:7710", from: thisComputer,
		headers: map[string]string{setupHeader: "1"}, body: file})
	var profile Profile
	if err := json.Unmarshal(checked.Body.Bytes(), &profile); err != nil || len(profile.Layout.Rows) != 1 {
		t.Fatalf("checking gave %d %s", checked.Code, checked.Body)
	}
	if b := profile.Layout.Rows[0].Buttons; len(b) != 1 || b[0].ID != "custom-x" || b[0].Text != "/status" {
		t.Fatalf("shown %+v, want the button Go keeps, typing /status", b)
	}
	if len(d.config.Profiles) != 0 {
		t.Fatal("checking a file added it")
	}
}

// A profile file reads as the Mac app reads it: only its layout has to be right.
func TestAProfileFileReadsAsOnTheMac(t *testing.T) {
	profile, err := checkedProfile([]byte(`{"name": 5, "colours": "red", "layout": {"rows": [{"buttons": [{"id": "custom-a", "key": "", "text": "/compact"}]}]}}`))
	if err != nil || profile.Name != "Imported" || len(profile.Colours) != 0 {
		t.Fatalf("a name and colours of the wrong kind gave %+v, %v; want them left out", profile, err)
	}
	if rows := profile.Layout.Rows; len(rows) != 1 || rows[0].Buttons[0].Key != "" || rows[0].Buttons[0].Text != "/compact" {
		t.Fatalf("an empty key gave %+v, want a button typing /compact", rows)
	}
	for _, file := range []string{`{"layout": null}`, `{"layout": []}`, `{"layout": {"rows": 5}}`} {
		if _, err := checkedProfile([]byte(file)); err == nil {
			t.Errorf("%s was taken for a profile", file)
		}
	}
}

func TestAProfileIsntOfferedWithNoRoomForIt(t *testing.T) {
	d := newTestDeck(t)
	d.config.Profiles = make([]Profile, mostProfiles)
	checked := serve(t, d, call{method: "POST", target: "/setup/profiles?action=check", host: "localhost:7710", from: thisComputer,
		headers: map[string]string{setupHeader: "1"}, body: `{"name": "Shared", "layout": {}}`})
	if checked.Code != http.StatusBadRequest || !strings.Contains(checked.Body.String(), "most profiles") {
		t.Fatalf("checking with %d profiles saved gave %d %s, want no room", mostProfiles, checked.Code, checked.Body)
	}
}

// madeButtonDeck has one session, in a launcher whose commands the test reads,
// and a layout with buttons made in setup.
func madeButtonDeck(t *testing.T) (*Deck, *launcherTab) {
	t.Helper()
	d := newTestDeck(t)
	tab := d.launcherConnected("L1", Claude, "/work/api")
	d.sessions.Apply(map[string]any{"hook_event_name": "SessionStart", "source": "startup", "session_id": "s1", "cwd": "/work/api"},
		Claude, "launcher:L1", "", 100)
	layout, err := parseLayout([]byte(`{"rows": [{"buttons": [
		{"id": "custom-compact", "text": "/compact", "whenFree": true},
		{"id": "custom-mode", "key": "shift-tab"},
		{"id": "custom-codex", "text": "/status", "agents": ["codex"]},
		{"id": "custom-empty", "text": ""},
		{"id": "clear"}
	]}]}`))
	if err != nil {
		t.Fatal(err)
	}
	d.config.Layout = layout
	return d, tab
}

func tapped(d *Deck, button string) (int, string) {
	return d.Perform("button", "s1", url.Values{"button": {button}})
}

func sent(t *testing.T, tab *launcherTab) launcherCommand {
	t.Helper()
	select {
	case command := <-tab.commands:
		return command
	case <-time.After(time.Second):
		t.Fatal("nothing reached the session")
		return launcherCommand{}
	}
}

func TestAMadeButtonTypesItsCommandOrPressesItsKey(t *testing.T) {
	d, tab := madeButtonDeck(t)
	if status, _ := tapped(d, "custom-compact"); status != http.StatusNoContent || sent(t, tab).Type != "/compact" {
		t.Fatal("the button didn't type /compact")
	}
	if status, _ := tapped(d, "custom-mode"); status != http.StatusNoContent || *sent(t, tab).Press != press(ShiftTab) {
		t.Fatal("the button didn't press Shift+Tab")
	}
}

func TestAMadeButtonKeepsToItsRules(t *testing.T) {
	d, tab := madeButtonDeck(t)
	d.sessions.Apply(map[string]any{"hook_event_name": "UserPromptSubmit", "session_id": "s1"}, Claude, "launcher:L1", "", 200)
	for button, want := range map[string]int{
		"custom-codex":   http.StatusBadRequest, // for Codex only, and this is Claude Code
		"custom-empty":   http.StatusBadRequest, // types nothing yet
		"custom-gone":    http.StatusNotFound,   // no longer in the layout
		"clear":          http.StatusNotFound,   // the deck's own buttons have actions of their own
		"custom-compact": http.StatusConflict,   // only when the agent isn't busy, and it is
	} {
		if status, _ := tapped(d, button); status != want {
			t.Errorf("%s: %d, want %d", button, status, want)
		}
	}
	select {
	case command := <-tab.commands:
		t.Fatalf("a refused button still sent %+v", command)
	default:
	}
}

func TestProfilesKeepALookToSwitchBackTo(t *testing.T) {
	isolate(t)
	c := loadConfig()
	if c.ActiveProfile != defaultProfile || c.profileEdited() {
		t.Fatal("a fresh deck isn't the Default profile, unchanged")
	}
	couch := Layout{Keys: 3, Dial: false, Stick: true, Rows: []ButtonRow{{Tall: true, Buttons: []Button{{ID: "max", Width: 3}}}}}
	c.Layout = couch
	c.Colours = map[string]string{"thinking": "#2f6bff"}
	if !c.profileEdited() {
		t.Fatal("a changed deck doesn't show as edited")
	}
	if err := c.SaveProfile("Couch"); err != nil || c.ActiveProfile != "Couch" || c.profileEdited() {
		t.Fatalf("saving gave %v, active %q", err, c.ActiveProfile)
	}
	if err := c.SwitchProfile(defaultProfile); err != nil || !c.Layout.sameAs(standardLayout()) || len(c.Colours) != 0 {
		t.Fatal("switching to Default didn't bring back the standard deck")
	}
	if err := loadConfig().SwitchProfile("Couch"); err != nil {
		t.Fatal(err)
	}
	if again := loadConfig(); !again.Layout.sameAs(couch) || again.Colours["thinking"] != "#2f6bff" || again.ActiveProfile != "Couch" {
		t.Fatal("switching back, after a restart, didn't bring the saved look")
	}
}

func TestDefaultCantBeTakenOver(t *testing.T) {
	isolate(t)
	c := loadConfig()
	for _, name := range []string{defaultProfile, "default", "  ", ""} {
		if c.SaveProfile(name) == nil {
			t.Errorf("a profile was saved as %q", name)
		}
	}
	if c.RenameProfile(defaultProfile, "Mine") == nil {
		t.Error("Default was renamed")
	}
	c.DeleteProfile(defaultProfile)
	if _, ok := c.profile(defaultProfile); !ok {
		t.Error("Default was deleted")
	}
}

func TestRenamingAndDeletingAProfile(t *testing.T) {
	isolate(t)
	c := loadConfig()
	_ = c.SaveProfile("Couch")
	_ = c.SaveProfile("Desk")
	if err := c.RenameProfile("Desk", "Couch"); err == nil {
		t.Fatal("two profiles ended up with one name")
	}
	if err := c.RenameProfile("Desk", "Office"); err != nil || c.ActiveProfile != "Office" {
		t.Fatalf("renaming the active profile gave %v, active %q", err, c.ActiveProfile)
	}
	layout := c.Layout
	c.DeleteProfile("Office")
	if c.profileIndex("Office") >= 0 || c.ActiveProfile != defaultProfile || !c.Layout.sameAs(layout) {
		t.Fatal("deleting the active profile didn't leave the deck as it was")
	}
}

func TestAnImportedProfileIsCheckedAndNamedApart(t *testing.T) {
	isolate(t)
	c := loadConfig()
	_ = c.SaveProfile("Couch")
	file := `{"name": "Couch", "layout": {"keys": 99, "rows": [{"buttons": [{"id": "custom-a1", "text": "/compact\nrm -rf ~"}, {"id": "custom-b2", "text": "/review"}]}]}, "colours": {"body": "red", "ink": "#FFFFFF"}}`
	if err := c.ImportProfile([]byte(file)); err != nil {
		t.Fatal(err)
	}
	imported := c.Profiles[len(c.Profiles)-1]
	if imported.Name != "Couch (2)" {
		t.Errorf("imported as %q, want Couch (2)", imported.Name)
	}
	if buttons := imported.Layout.Rows[0].Buttons; len(buttons) != 1 || buttons[0].Text != "/review" {
		t.Errorf("kept %+v, want only /review", buttons)
	}
	if len(imported.Colours) != 1 || imported.Colours["ink"] != "#ffffff" {
		t.Errorf("kept colours %v, want only the text colour", imported.Colours)
	}
	if c.ImportProfile([]byte(`{"name": "Nothing to lay out"}`)) == nil || c.ImportProfile([]byte(`not json`)) == nil {
		t.Error("a file that isn't a profile was added")
	}
}

func TestThePreviewIsTheOnlyPageAFrameMayShow(t *testing.T) {
	d := newTestDeck(t)
	key := pair(t, d)
	preview := serve(t, d, call{method: "GET", target: "/setup/preview", host: "localhost:7710", from: thisComputer})
	if preview.Header().Get("X-Frame-Options") != "SAMEORIGIN" || !strings.Contains(preview.Header().Get("Content-Security-Policy"), "'self'") {
		t.Errorf("the preview is framed by %q", preview.Header().Get("X-Frame-Options"))
	}
	deck := serve(t, d, call{method: "GET", target: "/?t=" + key, host: deckOnWiFi, from: aPhone})
	if deck.Header().Get("X-Frame-Options") != "DENY" {
		t.Errorf("the phone's deck is framed by %q, want no one", deck.Header().Get("X-Frame-Options"))
	}
	if serve(t, d, call{method: "GET", target: "/setup/preview", host: deckOnWiFi, from: aPhone}).Code != http.StatusNotFound {
		t.Error("the preview opened for another device")
	}
}

func TestTheSetupPageLaysOutTheDeck(t *testing.T) {
	d := newTestDeck(t)
	send := func(body string, headers map[string]string) int {
		return serve(t, d, call{method: "POST", target: "/setup/layout", host: "localhost:7710", from: thisComputer, headers: headers, body: body}).Code
	}
	layout := `{"keys": 6, "dial": false, "stick": true, "rows": [{"tall": true, "buttons": [{"id": "max", "width": 3}]}]}`
	if got := send(layout, nil); got != http.StatusForbidden {
		t.Errorf("a layout sent without the setup page's header: %d, want %d", got, http.StatusForbidden)
	}
	if got := send(layout, map[string]string{setupHeader: "1"}); got != http.StatusNoContent || d.config.Layout.Keys != 6 || d.config.Layout.Dial {
		t.Fatalf("the setup page's layout: %d, and the deck has %+v", got, d.config.Layout)
	}
	if got := send(`[1, 2, 3]`, map[string]string{setupHeader: "1"}); got != http.StatusBadRequest {
		t.Errorf("a layout of the wrong shape: %d, want %d", got, http.StatusBadRequest)
	}
	switched := serve(t, d, call{method: "POST", target: "/setup/profiles?action=switch&name=Default", host: "localhost:7710",
		from: thisComputer, headers: map[string]string{setupHeader: "1"}})
	var state struct{ ActiveProfile string }
	if json.Unmarshal(switched.Body.Bytes(), &state) != nil || state.ActiveProfile != defaultProfile || d.config.Layout.Keys != Auto {
		t.Fatalf("switching to Default gave %d %s", switched.Code, switched.Body)
	}
}

func TestOnlyMaxSaysItWasPressed(t *testing.T) {
	d, _ := madeButtonDeck(t)
	d.Perform("effort", "s1", url.Values{"level": {"max"}})
	if d.sessions.Get("s1").MaxPressedAt != 0 {
		t.Fatal("the dial reaching max counted as a press of ☢ Max")
	}
	d.Perform("effort", "s1", url.Values{"level": {"max"}, "source": {"max"}})
	if d.sessions.Get("s1").MaxPressedAt == 0 {
		t.Fatal("a press of ☢ Max wasn't kept")
	}
}
