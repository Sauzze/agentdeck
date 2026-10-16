package desktop

import (
	"reflect"
	"testing"
)

func TestOnlyRealColourChangesAreKept(t *testing.T) {
	got := customisations(map[string]any{
		"thinking": "#2F6BFF",       // kept, in lower case
		"asking":   "#ff8a1f",       // the default already: nothing to keep
		"unread":   "green",         // not #rrggbb
		"error":    "#ff3b30; x: y", // not only a colour
		"body":     12,              // not text
		"shadow":   "#000000",       // not one of the theme's colours
	})
	if want := map[string]string{"thinking": "#2f6bff"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("kept %v, want %v", got, want)
	}
}

func TestTheThemeIsTheDefaultsWithYourChanges(t *testing.T) {
	theme := currentTheme(&Config{Colours: map[string]string{"thinking": "#2f6bff"}})
	if len(theme) != len(colours) || theme["thinking"] != "#2f6bff" || theme["body"] != standardColours["body"] {
		t.Fatalf("the theme is %v", theme)
	}
}

func TestAProjectIsPinnedToOneKeyAtATime(t *testing.T) {
	isolate(t)
	config := loadConfig()
	config.Pin("/work/api-server", 1)
	config.Pin("/work/api-server", 4)
	saved := loadConfig()
	if saved.Pins[1] != nil || saved.Pins[4] == nil || *saved.Pins[4] != "/work/api-server" {
		t.Fatalf("pins are %v, want the project on key 5 only", saved.Pins)
	}
	saved.Unpin(4)
	if loadConfig().Pins[4] != nil {
		t.Fatal("an unpinned key kept its project")
	}
}

func TestSettingsFromAnotherVersionStillLoad(t *testing.T) {
	isolate(t)
	writeFile(t, configFile, `{"pins": ["/work/a"], "logo": "a logo that went away", "colours": null, "somethingNew": true}`)
	config := loadConfig()
	if len(config.Pins) != keyCount || config.Pins[0] == nil || *config.Pins[0] != "/work/a" {
		t.Errorf("pins are %v, want the saved one and %d keys", config.Pins, keyCount)
	}
	if config.Logo != "sauzze" || config.Colours == nil {
		t.Errorf("logo %q and colours %v, want the defaults", config.Logo, config.Colours)
	}
}
