package desktop

import (
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
)

// Layout is how the phone's deck is laid out, as set up on the setup page: how
// many session keys, whether the office shows in their place and how it's
// furnished, whether the dial and stick show, and the rows of buttons under
// them, as the Mac app's Layout.swift. It is checked before it's kept:
// the phone draws it, and its buttons type into sessions.
type Layout struct {
	Keys KeyCount `json:"keys"`
	// The Agent Office in place of the keys: a desk for each, in the same order.
	Office bool        `json:"office"`
	Room   Room        `json:"room"`
	Dial   bool        `json:"dial"`
	Stick  bool        `json:"stick"`
	Rows   []ButtonRow `json:"rows"`
}

// KeyCount is how many session keys the deck shows: Auto, one for each
// running session, or always 3, 6 or 9. In JSON, Auto is "auto".
type KeyCount int

const (
	Auto KeyCount = 0
	// The most keys there can be, in a 3×3.
	mostKeys = 9
)

var fixedKeyCounts = []int{3, 6, 9}

func (k KeyCount) MarshalJSON() ([]byte, error) {
	if k == Auto {
		return []byte(`"auto"`), nil
	}
	return json.Marshal(int(k))
}

// UnmarshalJSON reads anything but a fixed count as Auto.
func (k *KeyCount) UnmarshalJSON(data []byte) error {
	var n int
	if json.Unmarshal(data, &n) == nil && slices.Contains(fixedKeyCounts, n) {
		*k = KeyCount(n)
	} else {
		*k = Auto
	}
	return nil
}

// Room is how the office is furnished: the microphone or a megaphone, what
// each of the back wall's five places holds, the floor, the walls' paint, the
// lounge's carpet and the piece in its corner, whether the sky keeps the
// computer's time or it's always day, its pet, whether the windows follow the
// seasons, and how loud it is, as the Mac app's Room. office.js draws it, with
// the same choices. Anything unknown, or of the wrong kind, is as
// standard: it only changes how the room looks.
type Room struct {
	Mic    string   `json:"mic"`
	Wall   []string `json:"wall"`
	Floor  string   `json:"floor"`
	Paint  string   `json:"paint"`
	Lounge string   `json:"lounge"`
	Corner string   `json:"corner"`
	Sky    string   `json:"sky"`
	Pet    string   `json:"pet"`
	Season string   `json:"season"`
	Sound  string   `json:"sound"`
}

var (
	// Each part's choices; the first is the standard one.
	roomChoices = map[string][]string{
		"mic":    {"mic", "megaphone"},
		"floor":  {"wood", "tiles", "concrete", "carpet"},
		"paint":  {"slate", "sage", "clay", "cream"},
		"lounge": {"navy", "teal", "plum", "sand"},
		"corner": {"arcade", "vending", "foosball", "fishtank", "books", "none"},
		"sky":    {"live", "day"},
		"pet":    {"none", "cat", "dog", "lizard", "monkey"},
		"season": {"calendar", "off"},
		"sound":  {"off", "quiet", "normal"},
	}
	wallChoices  = []string{"window", "whiteboard", "pinboard", "poster", "shelf", "plant", "bare"}
	standardWall = []string{"window", "whiteboard", "window", "pinboard", "window"}
)

// UnmarshalJSON keeps what it knows of the room it's given.
func (r *Room) UnmarshalJSON(data []byte) error {
	var raw map[string]json.RawMessage
	json.Unmarshal(data, &raw)
	text := func(data json.RawMessage) string {
		var s string
		json.Unmarshal(data, &s)
		return s
	}
	var wall []json.RawMessage
	json.Unmarshal(raw["wall"], &wall)
	*r = Room{Mic: text(raw["mic"]), Floor: text(raw["floor"]), Paint: text(raw["paint"]), Lounge: text(raw["lounge"]),
		Corner: text(raw["corner"]), Sky: text(raw["sky"]), Pet: text(raw["pet"]), Season: text(raw["season"]), Sound: text(raw["sound"])}
	for _, place := range wall {
		r.Wall = append(r.Wall, text(place))
	}
	*r = r.checked()
	return nil
}

// MarshalJSON writes the room as checked, so a layout kept before rooms had
// a furnishing still sends the standard one.
func (r Room) MarshalJSON() ([]byte, error) {
	type plain Room
	return json.Marshal(plain(r.checked()))
}

// checked is the room with anything unknown as standard.
func (r Room) checked() Room {
	choose := func(part, given string) string {
		if slices.Contains(roomChoices[part], given) {
			return given
		}
		return roomChoices[part][0]
	}
	checked := Room{Mic: choose("mic", r.Mic), Floor: choose("floor", r.Floor), Paint: choose("paint", r.Paint),
		Lounge: choose("lounge", r.Lounge), Corner: choose("corner", r.Corner), Sky: choose("sky", r.Sky),
		Pet: choose("pet", r.Pet), Season: choose("season", r.Season), Sound: choose("sound", r.Sound),
		Wall: slices.Clone(standardWall)}
	for i := range checked.Wall {
		if i < len(r.Wall) && slices.Contains(wallChoices, r.Wall[i]) {
			checked.Wall[i] = r.Wall[i]
		}
	}
	return checked
}

// ButtonRow is a row of buttons, tall or short, sharing its width by weight.
type ButtonRow struct {
	Tall    bool     `json:"tall"`
	Buttons []Button `json:"buttons"`
}

// Button is one of the deck's own, named by what it does, or one made in
// setup, which types a command or presses a key. The phone knows a made
// button only by its id: what it types stays here.
type Button struct {
	ID    string `json:"id"`
	Width int    `json:"width"`
	Label string `json:"label,omitempty"`
	Text  string `json:"text,omitempty"`
	Key   string `json:"key,omitempty"`
	// Refused while the agent is busy, as /clear is.
	WhenFree bool `json:"whenFree,omitempty"`
	// Asks for a second tap, as /clear does.
	Confirm bool `json:"confirm,omitempty"`
	// The agents it is for; none means every agent.
	Agents []string `json:"agents,omitempty"`
}

const (
	maxRows      = 4
	maxPerRow    = 4
	maxWidth     = 3
	labelLimit   = 16
	commandLimit = 200
)

var (
	// The deck's own buttons. Max and the steps set Claude Code's effort, as
	// the dial does.
	builtInButtons = []string{"accept", "reject", "mic", "esc", "send", "clear", "up", "down", "max", "efforts"}
	// The keys a made button can press.
	buttonKeys = map[string]Keystroke{
		"enter": press(Enter), "escape": press(Escape), "tab": press(TabKey), "shift-tab": press(ShiftTab),
		"up": press(Up), "down": press(Down), "ctrl-c": press(CtrlC),
	}
	madeButtonID = regexp.MustCompile(`^custom-[a-z0-9]{1,16}$`)
	controlCode  = regexp.MustCompile(`[\x00-\x1f\x7f]`)
)

// standardLayout is today's deck: a key per session, the dial and stick,
// then ✓ ✕ and the mic over esc, send and /clear.
func standardLayout() Layout {
	row := func(tall bool, ids ...string) ButtonRow {
		buttons := make([]Button, len(ids))
		for i, id := range ids {
			buttons[i] = Button{ID: id, Width: 1}
		}
		return ButtonRow{Tall: tall, Buttons: buttons}
	}
	return Layout{Keys: Auto, Room: Room{}.checked(), Dial: true, Stick: true, Rows: []ButtonRow{
		row(true, "accept", "reject", "mic"), row(false, "esc", "send", "clear"),
	}}
}

// parseLayout reads a layout sent by the setup page or found in a profile's
// file. What it leaves out is the default: Auto keys, no office, a standard
// room, the dial and the stick showing, no buttons.
func parseLayout(data []byte) (Layout, error) {
	layout := Layout{Keys: Auto, Room: Room{}.checked(), Dial: true, Stick: true}
	if err := json.Unmarshal(data, &layout); err != nil {
		return Layout{}, errors.New("That isn't a layout this deck can use.")
	}
	return layout.checked(), nil
}

// checked keeps what the deck can draw and press: known buttons, each of
// the deck's own once, within the limits.
func (l Layout) checked() Layout {
	checked := Layout{Keys: l.Keys, Office: l.Office, Room: l.Room.checked(), Dial: l.Dial, Stick: l.Stick, Rows: []ButtonRow{}}
	seen := map[string]bool{}
	for _, row := range l.Rows[:min(len(l.Rows), maxRows)] {
		buttons := []Button{}
		for _, button := range row.Buttons {
			if b, ok := button.checked(); ok && !seen[b.ID] && len(buttons) < maxPerRow {
				seen[b.ID] = true
				buttons = append(buttons, b)
			}
		}
		if len(buttons) > 0 {
			checked.Rows = append(checked.Rows, ButtonRow{Tall: row.Tall, Buttons: buttons})
		}
	}
	return checked
}

func (b Button) checked() (Button, bool) {
	width := b.Width
	if width < 1 || width > maxWidth {
		width = 1
	}
	if slices.Contains(builtInButtons, b.ID) {
		return Button{ID: b.ID, Width: width}, true
	}
	if !madeButtonID.MatchString(b.ID) {
		return Button{}, false
	}
	// A command with a line break, or a key the deck can't press, is refused
	// whole: the editor can't make one, so it came from somewhere else.
	if _, known := buttonKeys[b.Key]; (b.Key != "" && !known) || controlCode.MatchString(b.Text) {
		return Button{}, false
	}
	checked := Button{ID: b.ID, Width: width, Label: oneLine(b.Label, labelLimit), Key: b.Key, WhenFree: b.WhenFree, Confirm: b.Confirm}
	if b.Key == "" {
		checked.Text = oneLine(b.Text, commandLimit)
	}
	for _, agent := range agents {
		if slices.Contains(b.Agents, string(agent)) {
			checked.Agents = append(checked.Agents, string(agent))
		}
	}
	if len(checked.Agents) == len(agents) {
		checked.Agents = nil
	}
	return checked, true
}

// oneLine is text without control characters or surrounding space, cut to
// limit characters.
func oneLine(text string, limit int) string {
	text = strings.TrimSpace(controlCode.ReplaceAllString(text, ""))
	if runes := []rune(text); len(runes) > limit {
		return string(runes[:limit])
	}
	return text
}

// madeButton is the button made in setup with id, if the layout has it.
func (l Layout) madeButton(id string) (Button, bool) {
	for _, row := range l.Rows {
		for _, b := range row.Buttons {
			if b.ID == id && !slices.Contains(builtInButtons, b.ID) {
				return b, true
			}
		}
	}
	return Button{}, false
}

// sameAs compares two layouts as the phone would see them.
func (l Layout) sameAs(other Layout) bool {
	a, _ := json.Marshal(l)
	b, _ := json.Marshal(other)
	return string(a) == string(b)
}
