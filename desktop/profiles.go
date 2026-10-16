package desktop

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"strings"
)

// Profile is a look for the deck kept under a name: a layout and its
// colours, as the Mac app's Profile in Layout.swift. Default is always
// there, the standard deck, and can't be changed.
type Profile struct {
	Name    string            `json:"name"`
	Layout  Layout            `json:"layout"`
	Colours map[string]string `json:"colours"`
}

const (
	defaultProfile = "Default"
	nameLimit      = 24
	mostProfiles   = 20
)

var (
	errProfileName = errors.New("Give the profile a name of its own, up to 24 characters.")
	errNoProfile   = errors.New("There's no profile by that name.")
	errTooMany     = errors.New("That's the most profiles there can be. Delete one first.")
	errNotAProfile = errors.New("That isn't a profile this deck can add.")
)

// profileName is a name a profile may have: one line, not empty, and not
// Default's.
func profileName(name string) (string, error) {
	name = oneLine(name, nameLimit)
	if name == "" || strings.EqualFold(name, defaultProfile) {
		return "", errProfileName
	}
	return name, nil
}

func (c *Config) profile(name string) (Profile, bool) {
	if name == defaultProfile {
		return Profile{Name: defaultProfile, Layout: standardLayout(), Colours: map[string]string{}}, true
	}
	for _, p := range c.Profiles {
		if p.Name == name {
			return p, true
		}
	}
	return Profile{}, false
}

// profileEdited: the deck no longer matches the profile it was switched to.
func (c *Config) profileEdited() bool {
	active, ok := c.profile(c.ActiveProfile)
	return !ok || !active.Layout.sameAs(c.Layout) || !maps.Equal(active.Colours, c.Colours)
}

// SwitchProfile puts a saved profile's layout and colours on the deck.
func (c *Config) SwitchProfile(name string) error {
	p, ok := c.profile(name)
	if !ok {
		return errNoProfile
	}
	c.Layout = p.Layout
	c.Colours = maps.Clone(p.Colours)
	c.ActiveProfile = name
	c.save()
	return nil
}

// SaveProfile keeps the deck as it is under name, replacing a profile of
// that name.
func (c *Config) SaveProfile(name string) error {
	name, err := profileName(name)
	if err != nil {
		return err
	}
	saved := Profile{Name: name, Layout: c.Layout, Colours: maps.Clone(c.Colours)}
	if i := c.profileIndex(name); i >= 0 {
		c.Profiles[i] = saved
	} else if len(c.Profiles) >= mostProfiles {
		return errTooMany
	} else {
		c.Profiles = append(c.Profiles, saved)
	}
	c.ActiveProfile = name
	c.save()
	return nil
}

func (c *Config) RenameProfile(name, to string) error {
	i := c.profileIndex(name)
	if i < 0 {
		return errNoProfile
	}
	to, err := profileName(to)
	if err != nil {
		return err
	}
	if to != name && c.profileIndex(to) >= 0 {
		return errors.New("Another profile already has that name.")
	}
	c.Profiles[i].Name = to
	if c.ActiveProfile == name {
		c.ActiveProfile = to
	}
	c.save()
	return nil
}

// DeleteProfile leaves the deck as it is; it just no longer matches a saved
// profile.
func (c *Config) DeleteProfile(name string) {
	if i := c.profileIndex(name); i >= 0 {
		c.Profiles = append(c.Profiles[:i], c.Profiles[i+1:]...)
	}
	if c.ActiveProfile == name {
		c.ActiveProfile = defaultProfile
	}
	c.save()
}

// checkedProfile is a profile from a file as this deck would keep it,
// checked as a layout and colours made here are. The setup page shows its
// buttons from this, before it's added, so what you're asked about is what's
// kept.
func checkedProfile(data []byte) (Profile, error) {
	var file struct {
		Name    any             `json:"name"`
		Layout  json.RawMessage `json:"layout"`
		Colours any             `json:"colours"`
	}
	// Only the layout has to be right, as on the Mac: a name or colours that
	// aren't are left out.
	if json.Unmarshal(data, &file) != nil || len(file.Layout) == 0 || file.Layout[0] != '{' {
		return Profile{}, errNotAProfile
	}
	layout, err := parseLayout(file.Layout)
	if err != nil {
		return Profile{}, errNotAProfile
	}
	text, _ := file.Name.(string)
	name, err := profileName(text)
	if err != nil {
		name = "Imported"
	}
	colours, _ := file.Colours.(map[string]any)
	return Profile{Name: name, Layout: layout, Colours: customisations(colours)}, nil
}

// ImportProfile adds a profile from a file, under a name of its own.
func (c *Config) ImportProfile(data []byte) error {
	profile, err := checkedProfile(data)
	if err != nil {
		return err
	}
	if len(c.Profiles) >= mostProfiles {
		return errTooMany
	}
	profile.Name = c.unusedName(profile.Name)
	c.Profiles = append(c.Profiles, profile)
	c.save()
	return nil
}

func (c *Config) profileIndex(name string) int {
	for i, p := range c.Profiles {
		if p.Name == name {
			return i
		}
	}
	return -1
}

// unusedName is name, or name (2), (3)… when a profile already has it.
func (c *Config) unusedName(name string) string {
	candidate := name
	for n := 2; candidate == defaultProfile || c.profileIndex(candidate) >= 0; n++ {
		suffix := fmt.Sprintf(" (%d)", n)
		candidate = oneLine(name, nameLimit-len(suffix)) + suffix
	}
	return candidate
}
