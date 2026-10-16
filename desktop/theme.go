package desktop

import (
	"regexp"
	"strings"
)

// The deck's colours, as the Mac app's Theme.swift. Every colour on the phone
// is one of these or mixed from them, so these twelve are the whole theme.
type colour struct {
	name     string // the CSS variable, without its leading dashes
	label    string
	group    string
	standard string
}

var colours = []colour{
	{"body", "Background", "Interface", "#0e0e0e"},
	{"cap", "Keys", "Interface", "#1f1f1f"},
	{"cap-top", "Key highlight", "Interface", "#262626"},
	{"edge", "Borders", "Interface", "#2c2c2c"},
	{"ink", "Text", "Interface", "#ececec"},
	{"dim", "Secondary text", "Interface", "#6f6f6f"},
	{"faint", "Unlit", "Interface", "#3a3a3a"},
	{"idle", "Idle", "States", "#f2f2f2"},
	{"thinking", "Working", "States", "#3b82f6"},
	{"asking", "Waiting on you", "States", "#ff8a1f"},
	{"unread", "Done, unread", "States", "#22c55e"},
	{"error", "Error", "States", "#ef4444"},
}

var standardColours = func() map[string]string {
	standard := map[string]string{}
	for _, c := range colours {
		standard[c.name] = c.standard
	}
	return standard
}()

var presets = []struct {
	name    string
	colours map[string]string
}{
	{"Default", standardColours},
	{"Midnight", map[string]string{
		"body": "#050505", "cap": "#141414", "cap-top": "#1b1b1b", "edge": "#262626",
		"ink": "#f5f5f5", "dim": "#7c7c7c", "faint": "#333333",
		"idle": "#ffffff", "thinking": "#2f6bff", "asking": "#ff4fa3", "unread": "#2bd96b", "error": "#ff3b30",
	}},
	{"High contrast", map[string]string{
		"body": "#000000", "cap": "#111111", "cap-top": "#1a1a1a", "edge": "#5a5a5a",
		"ink": "#ffffff", "dim": "#b0b0b0", "faint": "#4d4d4d",
		"idle": "#ffffff", "thinking": "#4da3ff", "asking": "#ffb000", "unread": "#00e676", "error": "#ff1744",
	}},
	{"Light", map[string]string{
		"body": "#e9e9ec", "cap": "#f7f7f8", "cap-top": "#ffffff", "edge": "#c9c9cf",
		"ink": "#1c1c1e", "dim": "#6e6e73", "faint": "#c7c7cc",
		"idle": "#8e8e93", "thinking": "#007aff", "asking": "#ff9500", "unread": "#34c759", "error": "#ff3b30",
	}},
}

// currentTheme is every colour, with the saved ones over the defaults.
func currentTheme(config *Config) map[string]string {
	theme := map[string]string{}
	for name, value := range standardColours {
		theme[name] = value
	}
	for name, value := range config.Colours {
		theme[name] = value
	}
	return theme
}

var hexColour = regexp.MustCompile(`^#[0-9a-f]{6}$`)

// customisations keeps known names with #rrggbb values that differ from the
// default.
func customisations(input map[string]any) map[string]string {
	result := map[string]string{}
	for name, value := range input {
		text, _ := value.(string)
		hex := strings.ToLower(text)
		standard, known := standardColours[name]
		if known && hexColour.MatchString(hex) && hex != standard {
			result[name] = hex
		}
	}
	return result
}

// themeEditor is the editor's view of the theme, for the setup page.
func themeEditor(config *Config) map[string]any {
	tokens := make([][]string, len(colours))
	for i, c := range colours {
		tokens[i] = []string{c.name, c.label, c.group}
	}
	presetList := make([]map[string]any, len(presets))
	for i, p := range presets {
		presetList[i] = map[string]any{"name": p.name, "colours": p.colours}
	}
	return map[string]any{"colours": currentTheme(config), "tokens": tokens, "presets": presetList}
}
