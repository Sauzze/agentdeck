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

func TestTheRoomKeepsOnlyChoicesItHas(t *testing.T) {
	var room Room
	if err := json.Unmarshal([]byte(`{"floor": "lava", "pet": "cat", "sky": 5, "team": {
		"api": {"skin": "green", "hair": "blue", "extra": "monocle", "name": "  a nickname far longer than sixteen\n"},
		"web": "a person", "": {"hair": "pink"}}}`), &room); err != nil {
		t.Fatal(err)
	}
	if room.Floor != "wood" || room.Pet != "cat" || room.Sky != "live" {
		t.Errorf("floor %q, pet %q, sky %q; want wood, cat and live", room.Floor, room.Pet, room.Sky)
	}
	want := TeamMember{Skin: "auto", Hair: "blue", Hairstyle: "auto", Extra: "none", Outfit: "auto", Colour: "auto", Desk: "auto",
		Name: "a nickname far l"}
	if got := room.Team["api"]; got != want {
		t.Errorf("api's agent is %+v, want %+v", got, want)
	}
	// A member that isn't an object looks as standard; one with no project is dropped.
	if got := room.Team["web"]; got != (TeamMember{}.checked()) || len(room.Team) != 2 {
		t.Errorf("team %+v, want api, and web as standard", room.Team)
	}
	for _, team := range []string{`"everyone"`, `[{"skin": "fair"}]`, `5`, `null`} {
		var room Room
		if err := json.Unmarshal([]byte(`{"team": `+team+`}`), &room); err != nil || room.Team == nil || len(room.Team) != 0 {
			t.Errorf("a team of %s gave %v, %v; want an empty team", team, room.Team, err)
		}
	}
}

func TestATeamRemembersFiftyProjectsAtMost(t *testing.T) {
	team := map[string]TeamMember{}
	for i := range 60 {
		team[fmt.Sprintf("p%02d", i)] = TeamMember{Hair: "blue"}
	}
	checked := Room{Team: team}.checked().Team
	if len(checked) != teamLimit || checked["p00"].Hair != "blue" || checked["p49"].Hair != "blue" {
		t.Fatalf("kept %d projects, want the first %d by name", len(checked), teamLimit)
	}
	if _, kept := checked["p50"]; kept {
		t.Fatal("kept p50, past the first fifty by name")
	}
}

func TestTheDressCodeKeepsOnlyChoicesItHas(t *testing.T) {
	var room Room
	if err := json.Unmarshal([]byte(`{"team": {"api": {"outfit": "waistcoat", "colour": "teal"}}, "dress": {
		"sizes": {"small": {"outfit": "toga", "colour": "chartreuse"}, "large": {"outfit": "hawaiian", "colour": "red"}, "huge": {"outfit": "suit"}},
		"agents": {"codex": {"outfit": "overalls"}, "grok": {"colour": 5}}}}`), &room); err != nil {
		t.Fatal(err)
	}
	if got := room.Team["api"]; got.Outfit != "waistcoat" || got.Colour != "teal" {
		t.Errorf("api's agent wears %q in %q, want a teal waistcoat", got.Outfit, got.Colour)
	}
	auto := Attire{Outfit: "auto", Colour: "auto"}
	want := Dress{
		// An unknown outfit or colour is auto, and a size or agent left out is there, as auto.
		Sizes:  DressSizes{Small: auto, Medium: auto, Large: Attire{Outfit: "hawaiian", Colour: "red"}, Top: auto},
		Agents: DressAgents{Claude: auto, Codex: Attire{Outfit: "overalls", Colour: "auto"}, Gemini: auto, OpenCode: auto, Grok: auto},
		Rules:  []DressRule{},
	}
	if got, _ := json.Marshal(room.Dress); string(got) != string(must(json.Marshal(want))) {
		t.Errorf("dress code kept as\n%s\nwant\n%s", got, must(json.Marshal(want)))
	}
	for _, outfit := range []string{"polo", "cardigan", "hawaiian", "tracksuit", "overalls", "waistcoat"} {
		if got := (Attire{Outfit: outfit}).checked().Outfit; got != outfit {
			t.Errorf("the dress code's %s became %s", outfit, got)
		}
		if got := (TeamMember{Outfit: outfit}).checked().Outfit; got != outfit {
			t.Errorf("a team member's %s became %s", outfit, got)
		}
	}
}

func TestADressCodeOfTheWrongKindIsStandard(t *testing.T) {
	standard := must(json.Marshal(Dress{}.checked()))
	for _, dress := range []string{`"formal"`, `[{"sizes": {}}]`, `5`, `null`, `{"sizes": "all suits", "agents": []}`,
		`{"sizes": {"small": "suit", "top": ["suit", "red"]}, "agents": {"claude": null, "codex": 5}}`} {
		var room Room
		if err := json.Unmarshal([]byte(`{"dress": `+dress+`}`), &room); err != nil {
			t.Fatal(err)
		}
		if got := must(json.Marshal(room.Dress)); string(got) != string(standard) {
			t.Errorf("a dress code of %s gave\n%s\nwant\n%s", dress, got, standard)
		}
	}
	var room Room
	if err := json.Unmarshal([]byte(`{"floor": "tiles"}`), &room); err != nil || string(must(json.Marshal(room.Dress))) != string(standard) {
		t.Errorf("a room without a dress code gave %+v, %v; want it standard", room.Dress, err)
	}
}

func TestDressRulesAreCheckedAndKeptInOrder(t *testing.T) {
	var dress Dress
	if err := json.Unmarshal([]byte(`{"rules": [
		{"contains": "  Qwen-MAX\n", "size": "large"},
		{"contains": "a part of a model's name far longer than thirty-two", "size": "top"},
		{"contains": " \t ", "size": "small"},
		{"contains": "mini", "size": "tiny"},
		{"contains": "mini"},
		{"size": "small"},
		"haiku", 5, null,
		{"contains": "Haiku", "size": "small"}
	]}`), &dress); err != nil {
		t.Fatal(err)
	}
	want := []DressRule{{"qwen-max", "large"}, {"a part of a model's name far lon", "top"}, {"haiku", "small"}}
	if got, _ := json.Marshal(dress.Rules); string(got) != string(must(json.Marshal(want))) {
		t.Errorf("rules kept as %s, want %s", got, must(json.Marshal(want)))
	}
	rules := make([]string, 25)
	for i := range rules {
		rules[i] = fmt.Sprintf(`{"contains": "model-%02d", "size": "medium"}`, i)
	}
	// One to drop first: twenty are kept of those left.
	if err := json.Unmarshal([]byte(`{"rules": [{"contains": "", "size": "top"}, `+strings.Join(rules, ", ")+`]}`), &dress); err != nil {
		t.Fatal(err)
	}
	if len(dress.Rules) != dressRuleLimit || dress.Rules[0].Contains != "model-00" || dress.Rules[19].Contains != "model-19" {
		t.Errorf("of 25 rules, kept %d, from %+v; want the first %d", len(dress.Rules), dress.Rules[0], dressRuleLimit)
	}
	for _, given := range []string{`"qwen: large"`, `{"contains": "qwen", "size": "large"}`, `5`, `null`} {
		var dress Dress
		if err := json.Unmarshal([]byte(`{"rules": `+given+`}`), &dress); err != nil || dress.Rules == nil || len(dress.Rules) != 0 {
			t.Errorf("rules of %s gave %v, %v; want none", given, dress.Rules, err)
		}
	}
}

func TestARoomIsWrittenInTheSameOrderEveryTime(t *testing.T) {
	text := string(must(json.Marshal(Room{}.checked())))
	order := func(keys ...string) bool {
		at := -1
		for _, key := range keys {
			i := strings.Index(text, `"`+key+`":`)
			if i <= at {
				return false
			}
			at = i
		}
		return true
	}
	if !order("staff", "team", "dress") || !order("sizes", "small", "medium", "large", "top", "agents", "rules") ||
		!order("agents", "claude", "codex", "gemini", "opencode", "grok", "rules") {
		t.Fatalf("a standard room is written\n%s\nwant the dress code after the team, sizes small to top, then the agents in order", text)
	}
}

// must is the value, for calls that can't fail here.
func must[T any](value T, err error) T {
	if err != nil {
		panic(err)
	}
	return value
}
