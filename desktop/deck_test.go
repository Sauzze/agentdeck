package desktop

import (
	"encoding/json"
	"net/http"
	"net/url"
	"testing"
	"time"
)

func swapped(d *Deck, from, to string) (int, string) {
	return d.Perform("swap", "", url.Values{"from": {from}, "to": {to}})
}

func TestSwappingDesksOfTheSameProjectChangesNothing(t *testing.T) {
	d := newTestDeck(t)
	for i, name := range []string{"tmux:%1@/tmp/tmux", "tmux:%2@/tmp/tmux"} {
		e := map[string]any{"hook_event_name": "UserPromptSubmit", "session_id": name, "cwd": "/work/api"}
		d.sessions.Apply(e, Claude, name, "", float64(100+i))
	}
	if status, _ := swapped(d, "0", "1"); status != http.StatusConflict {
		t.Fatalf("swapping two desks of one project: %d, want %d", status, http.StatusConflict)
	}
	for i, pin := range d.config.Pins {
		if pin != nil {
			t.Fatalf("key %d was pinned to %s by a swap that was refused", i+1, *pin)
		}
	}
}

func TestSwappingTwoEmptyDesksChangesNothing(t *testing.T) {
	d := newTestDeck(t)
	d.config.Layout.Keys = 3
	if status, _ := swapped(d, "0", "2"); status != http.StatusNoContent {
		t.Fatalf("swapping two empty desks: %d, want %d", status, http.StatusNoContent)
	}
	for i, pin := range d.config.Pins {
		if pin != nil {
			t.Fatalf("key %d was pinned to %s by swapping two empty desks", i+1, *pin)
		}
	}
	for _, desks := range [][2]string{{"0", "0"}, {"0", "3"}, {"-1", "1"}, {"one", "2"}} {
		if status, _ := swapped(d, desks[0], desks[1]); status != http.StatusBadRequest {
			t.Errorf("swapping desks %s and %s: %d, want %d", desks[0], desks[1], status, http.StatusBadRequest)
		}
	}
}

// A project pinned to a key beyond the three shown sits at a free desk; swapped,
// it's pinned where it went, and its old pin goes.
func TestASwappedProjectIsPinnedWhereItWent(t *testing.T) {
	d := newTestDeck(t)
	d.config.Layout.Keys = 3
	d.config.Pin("/work/p0", 7)
	running(d, 1)
	if keys, _ := d.layout(); keys[0].session == nil || keys[0].session.Project != "/work/p0" {
		t.Fatal("the project's session isn't at the first desk")
	}
	if status, _ := swapped(d, "0", "1"); status != http.StatusNoContent {
		t.Fatalf("swapping a project to an empty desk: %d, want %d", status, http.StatusNoContent)
	}
	if p := d.config.Pins; p[7] != nil || p[0] != nil || p[1] == nil || *p[1] != "/work/p0" {
		t.Fatalf("pins %v, want the project on key 2 only", p)
	}
}

func TestHiringAndFiringAreOffUntilTurnedOn(t *testing.T) {
	d, tab := madeButtonDeck(t)
	for _, action := range []string{"fire", "hire"} {
		if status, _ := d.Perform(action, "s1", url.Values{}); status != http.StatusForbidden {
			t.Errorf("%s with hiring off: %d, want %d", action, status, http.StatusForbidden)
		}
	}
	select {
	case command := <-tab.commands:
		t.Fatalf("firing while it's off sent %+v", command)
	default:
	}

	d.config.HiringEnabled = true
	for desk, want := range map[string]int{"": http.StatusNotImplemented, "0": http.StatusNotImplemented, "8": http.StatusBadRequest, "x": http.StatusBadRequest} {
		query := url.Values{}
		if desk != "" {
			query.Set("desk", desk)
		}
		if status, _ := d.Perform("hire", "", query); status != want {
			t.Errorf("hire at desk %q: %d, want %d", desk, status, want)
		}
	}
	if status, _ := d.Perform("fire", "s1", url.Values{}); status != http.StatusNoContent || !sent(t, tab).Stop {
		t.Fatalf("fire: %d, and the launcher wasn't told to stop the agent", status)
	}
}

func TestFiringAnAgentWhoseTabHasGone(t *testing.T) {
	d, _ := madeButtonDeck(t)
	d.config.HiringEnabled = true
	d.sessions.Apply(map[string]any{"hook_event_name": "SessionStart", "source": "startup", "session_id": "s2", "cwd": "/work/api"},
		Claude, "launcher:L2", "", 200)
	if status, message := d.Perform("fire", "s2", url.Values{}); status != http.StatusNotFound || message != "That agent's tab has gone." {
		t.Fatalf("firing an agent with no tab: %d %q", status, message)
	}
}

func TestTheSnapshotCarriesTheComputersClock(t *testing.T) {
	d := newTestDeck(t)
	var snapshot struct{ Now int64 }
	if err := json.Unmarshal(d.snapshot(), &snapshot); err != nil {
		t.Fatal(err)
	}
	if ago := time.Since(time.UnixMilli(snapshot.Now)); ago < 0 || ago > time.Minute {
		t.Fatalf("the snapshot's clock says %d, %v from now", snapshot.Now, ago)
	}
}
