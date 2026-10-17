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
// seasons, how loud it is, the desks' finish and the chairs' colour, how many
// of its own staff hang about, your team, and the dress code, as the Mac app's
// Room. office.js draws it, with the same choices. Anything unknown, or of the wrong kind, is
// as standard: it only changes how the room looks.
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
	Desk   string   `json:"desk"`
	Chair  string   `json:"chair"`
	Staff  string   `json:"staff"`
	// How each project's agent looks, by the project's name.
	Team map[string]TeamMember `json:"team"`
	// What agents wear by their model's size and by agent. After the team, so
	// it's written in the same place as the Mac app's Room has it.
	Dress Dress `json:"dress"`
}

// TeamMember is how one project's agent looks in the office: skin, hair, a
// hairstyle, something extra such as glasses or a cap, an outfit and its
// colour, what's on its desk, and a nickname for it. "auto" is as the
// project's name picks it, and the clothes as its model's, as the Mac app's
// TeamMember.
type TeamMember struct {
	Skin      string `json:"skin"`
	Hair      string `json:"hair"`
	Hairstyle string `json:"hairstyle"`
	Extra     string `json:"extra"`
	Outfit    string `json:"outfit"`
	Colour    string `json:"colour"`
	Desk      string `json:"desk"`
	Name      string `json:"name"`
}

const (
	// The most projects a team remembers, and the most a nickname can be, in
	// characters.
	teamLimit     = 50
	nicknameLimit = 16
)

// Each part of a team member's choices; the first is the standard one.
var teamChoices = map[string][]string{
	"skin": {"auto", "porcelain", "fair", "light", "tan", "olive", "brown", "deep", "ebony"},
	"hair": {"auto", "black", "espresso", "brown", "chestnut", "auburn", "ginger", "blond", "platinum", "grey", "white",
		"pink", "blue", "green", "purple"},
	"hairstyle": {"auto", "short", "long", "spiky", "bun", "curly", "ponytail", "afro", "mohawk", "buzz", "bald"},
	"extra":     {"none", "glasses", "sunglasses", "headphones", "cap", "beanie", "beard", "moustache", "bow"},
	"outfit": {"auto", "tee", "hoodie", "collar", "sweater", "jacket", "suit", "labcoat", "polo", "cardigan", "hawaiian",
		"tracksuit", "overalls", "waistcoat"},
	"colour": {"auto", "orange", "red", "pink", "purple", "blue", "teal", "green", "yellow", "grey", "black", "white"},
	"desk":   {"auto", "plant", "papers", "lamp", "cactus", "duck", "trophy", "photo", "mug", "none"},
}

// checked is the member with anything unknown as standard, and the nickname
// on one line, cut to its limit.
func (m TeamMember) checked() TeamMember {
	choose := func(part, given string) string {
		if slices.Contains(teamChoices[part], given) {
			return given
		}
		return teamChoices[part][0]
	}
	return TeamMember{Skin: choose("skin", m.Skin), Hair: choose("hair", m.Hair), Hairstyle: choose("hairstyle", m.Hairstyle),
		Extra: choose("extra", m.Extra), Outfit: choose("outfit", m.Outfit), Colour: choose("colour", m.Colour),
		Desk: choose("desk", m.Desk), Name: oneLine(m.Name, nicknameLimit)}
}

// Dress is the office's dress code: what agents wear by the size of their
// model, and by which agent they are, and rules that give a model its size by
// part of its name, as the Mac app's Dress. Every size and every agent is
// always there, "auto" when it isn't set, so office.js never finds one
// missing. Anything unknown, or of the wrong kind, is as standard, as in the
// rest of the room.
type Dress struct {
	Sizes  DressSizes  `json:"sizes"`
	Agents DressAgents `json:"agents"`
	// In the order given.
	Rules []DressRule `json:"rules"`
}

// DressSizes is what agents wear by the size of their model. A struct rather
// than a map, which would be written in alphabetical order: this keeps the
// sizes small to top.
type DressSizes struct {
	Small  Attire `json:"small"`
	Medium Attire `json:"medium"`
	Large  Attire `json:"large"`
	Top    Attire `json:"top"`
}

// DressAgents is what each agent wears, in the deck's order of agents.
type DressAgents struct {
	Claude   Attire `json:"claude"`
	Codex    Attire `json:"codex"`
	Gemini   Attire `json:"gemini"`
	OpenCode Attire `json:"opencode"`
	Grok     Attire `json:"grok"`
}

// Attire is what the dress code puts on agents: an outfit and its colour,
// from a team member's choices. "auto" is as its model's, as for a team
// member.
type Attire struct {
	Outfit string `json:"outfit"`
	Colour string `json:"colour"`
}

// DressRule dresses a model whose name has Contains in it as Size. What it
// looks for is kept on one line, and lowercased.
type DressRule struct {
	Contains string `json:"contains"`
	Size     string `json:"size"`
}

const (
	// The most rules kept, and the most a rule's part of a name can be, in
	// characters.
	dressRuleLimit     = 20
	dressContainsLimit = 32
)

var dressSizes = []string{"small", "medium", "large", "top"}

// UnmarshalJSON keeps what it knows of the dress code it's given. A dress
// code, an attire or a rule that isn't an object is as standard.
func (d *Dress) UnmarshalJSON(data []byte) error {
	object := func(data json.RawMessage) map[string]json.RawMessage {
		var o map[string]json.RawMessage
		json.Unmarshal(data, &o)
		return o
	}
	text := func(data json.RawMessage) string {
		var s string
		json.Unmarshal(data, &s)
		return s
	}
	attire := func(set map[string]json.RawMessage, name string) Attire {
		parts := object(set[name])
		return Attire{Outfit: text(parts["outfit"]), Colour: text(parts["colour"])}
	}
	raw := object(data)
	sizes, agents := object(raw["sizes"]), object(raw["agents"])
	*d = Dress{
		Sizes: DressSizes{Small: attire(sizes, "small"), Medium: attire(sizes, "medium"), Large: attire(sizes, "large"),
			Top: attire(sizes, "top")},
		Agents: DressAgents{Claude: attire(agents, string(Claude)), Codex: attire(agents, string(Codex)),
			Gemini: attire(agents, string(Gemini)), OpenCode: attire(agents, string(OpenCode)), Grok: attire(agents, string(Grok))},
	}
	var rules []json.RawMessage
	json.Unmarshal(raw["rules"], &rules)
	for _, rule := range rules {
		parts := object(rule)
		d.Rules = append(d.Rules, DressRule{Contains: text(parts["contains"]), Size: text(parts["size"])})
	}
	*d = d.checked()
	return nil
}

// checked is the dress code with anything unknown as auto, and the rules
// that name a part of a name and a size the office has, as many as it keeps.
func (d Dress) checked() Dress {
	checked := Dress{
		Sizes: DressSizes{Small: d.Sizes.Small.checked(), Medium: d.Sizes.Medium.checked(), Large: d.Sizes.Large.checked(),
			Top: d.Sizes.Top.checked()},
		Agents: DressAgents{Claude: d.Agents.Claude.checked(), Codex: d.Agents.Codex.checked(), Gemini: d.Agents.Gemini.checked(),
			OpenCode: d.Agents.OpenCode.checked(), Grok: d.Agents.Grok.checked()},
		Rules: []DressRule{},
	}
	for _, rule := range d.Rules {
		if len(checked.Rules) == dressRuleLimit {
			break
		}
		contains := oneLine(strings.ToLower(rule.Contains), dressContainsLimit)
		if contains != "" && slices.Contains(dressSizes, rule.Size) {
			checked.Rules = append(checked.Rules, DressRule{Contains: contains, Size: rule.Size})
		}
	}
	return checked
}

// checked is the attire with anything unknown as auto, by a team member's
// choices.
func (a Attire) checked() Attire {
	member := TeamMember{Outfit: a.Outfit, Colour: a.Colour}.checked()
	return Attire{Outfit: member.Outfit, Colour: member.Colour}
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
		"desk":   {"wood", "walnut", "white", "black"},
		"chair":  {"teal", "black", "red", "grey", "green"},
		"staff":  {"some", "none", "many"},
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
		Corner: text(raw["corner"]), Sky: text(raw["sky"]), Pet: text(raw["pet"]), Season: text(raw["season"]), Sound: text(raw["sound"]),
		Desk: text(raw["desk"]), Chair: text(raw["chair"]), Staff: text(raw["staff"])}
	for _, place := range wall {
		r.Wall = append(r.Wall, text(place))
	}
	var team map[string]json.RawMessage
	json.Unmarshal(raw["team"], &team)
	r.Team = map[string]TeamMember{}
	for project, given := range team {
		var parts map[string]json.RawMessage
		json.Unmarshal(given, &parts)
		r.Team[project] = TeamMember{Skin: text(parts["skin"]), Hair: text(parts["hair"]), Hairstyle: text(parts["hairstyle"]),
			Extra: text(parts["extra"]), Outfit: text(parts["outfit"]), Colour: text(parts["colour"]), Desk: text(parts["desk"]),
			Name: text(parts["name"])}
	}
	json.Unmarshal(raw["dress"], &r.Dress)
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
		Desk: choose("desk", r.Desk), Chair: choose("chair", r.Chair), Staff: choose("staff", r.Staff),
		Wall: slices.Clone(standardWall), Dress: r.Dress.checked()}
	for i := range checked.Wall {
		if i < len(r.Wall) && slices.Contains(wallChoices, r.Wall[i]) {
			checked.Wall[i] = r.Wall[i]
		}
	}
	// The first projects by name, as many as a team remembers.
	checked.Team = map[string]TeamMember{}
	projects := make([]string, 0, len(r.Team))
	for project := range r.Team {
		if project != "" {
			projects = append(projects, project)
		}
	}
	slices.Sort(projects)
	for _, project := range projects[:min(len(projects), teamLimit)] {
		checked.Team[project] = r.Team[project].checked()
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
