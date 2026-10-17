package desktop

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Config is what you set on the setup page: which project is pinned to which
// key, the deck's layout and colours, the profiles they're saved in, its logo,
// whether the stick scrolls and whether the office hires and fires. Saved as
// JSON next to the paired phones, in the Mac app's format.
type Config struct {
	// A project folder per key, or nil for a key that takes any session.
	Pins []*string `json:"pins"`
	// Only the colours that differ from the default theme.
	Colours map[string]string `json:"colours"`
	Layout  Layout            `json:"layout"`
	// Saved looks, besides Default, and the one the deck was last switched to.
	Profiles      []Profile `json:"profiles"`
	ActiveProfile string    `json:"activeProfile"`
	Logo          string    `json:"logo"`
	// Whether the stick scrolls tmux and kitty panes. Off until you turn it
	// on, so a newly paired phone can do no more than the deck's buttons do.
	ScrollEnabled bool `json:"scrollEnabled"`
	// Whether the office may fire: stop an agent and close its pane. Off until
	// you turn it on, for the same reason. Hiring is the Mac app's for now,
	// but the folder and agent are kept as it keeps them.
	HiringEnabled     bool   `json:"hiringEnabled"`
	HireFolder        string `json:"hireFolder"`
	HireAgent         string `json:"hireAgent"`
	HasCompletedSetup bool   `json:"hasCompletedSetup"`
}

// The logos to choose from: the Sauzze mark, or the six keys the deck
// started out with.
var logos = []string{"sauzze", "keys"}

func loadConfig() *Config {
	config := &Config{Colours: map[string]string{}, Logo: "sauzze", Layout: standardLayout(), ActiveProfile: defaultProfile, HireAgent: string(Claude)}
	if data, err := os.ReadFile(configFile); err == nil {
		_ = json.Unmarshal(data, config)
	}
	// Layouts are checked again as they load: their buttons type into sessions.
	config.Layout = config.Layout.checked()
	for i := range config.Profiles {
		config.Profiles[i].Layout = config.Profiles[i].Layout.checked()
	}
	if config.Profiles == nil {
		config.Profiles = []Profile{}
	}
	if !contains(logos, config.Logo) {
		config.Logo = "sauzze"
	}
	if config.Colours == nil {
		config.Colours = map[string]string{}
	}
	pins := make([]*string, mostKeys)
	copy(pins, config.Pins)
	config.Pins = pins
	return config
}

func (c *Config) save() {
	if data, err := json.MarshalIndent(c, "", "  "); err == nil {
		_ = os.WriteFile(configFile, data, 0o600)
	}
}

// Pin pins folder to key index, taking it off any other key it was on.
func (c *Config) Pin(folder string, index int) {
	for i, pin := range c.Pins {
		if pin != nil && *pin == folder {
			c.Pins[i] = nil
		}
	}
	c.Pins[index] = &folder
	c.save()
}

func (c *Config) Unpin(index int) {
	c.Pins[index] = nil
	c.save()
}

// SwapPins puts first on key b and second on key a, each taken off any other
// key it was on: two desks swapped in the office. A nil project is an empty
// desk, whose key is left free.
func (c *Config) SwapPins(first *string, a int, second *string, b int) {
	for i, pin := range c.Pins {
		if pin != nil && ((first != nil && *pin == *first) || (second != nil && *pin == *second)) {
			c.Pins[i] = nil
		}
	}
	c.Pins[b] = first
	c.Pins[a] = second
	c.save()
}

func contains(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

// existingFolder is path as a folder that's there, with ~ for home.
func existingFolder(path string) (string, bool) {
	path = strings.TrimSpace(path)
	if path == "~" || strings.HasPrefix(path, "~/") || strings.HasPrefix(path, `~\`) {
		path = filepath.Join(homeDir, path[1:])
	}
	if !filepath.IsAbs(path) {
		return "", false
	}
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return "", false
	}
	return filepath.Clean(path), true
}
