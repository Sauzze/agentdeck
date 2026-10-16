package desktop

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Where requests come from: this computer, and a phone on the same Wi-Fi.
const (
	thisComputer = "127.0.0.1:50000"
	aPhone       = "192.168.1.20:50000"
	deckOnWiFi   = "192.168.1.10:7710"
)

type call struct {
	method, target, host, from string
	headers                    map[string]string
	body                       string
}

func serve(t *testing.T, d *Deck, c call) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(c.method, c.target, strings.NewReader(c.body))
	r.Host, r.RemoteAddr = c.host, c.from
	for name, value := range c.headers {
		r.Header.Set(name, value)
	}
	w := httptest.NewRecorder()
	(&router{deck: d}).ServeHTTP(w, r)
	return w
}

func newTestDeck(t *testing.T) *Deck {
	t.Helper()
	isolate(t)
	return NewDeck()
}

// pair asks for a code on this computer and pairs a phone with it, as the
// setup page and the pairing page do.
func pair(t *testing.T, d *Deck) string {
	t.Helper()
	asked := serve(t, d, call{method: "POST", target: "/setup/pair", host: "localhost:7710", from: thisComputer,
		headers: map[string]string{setupHeader: "1"}})
	var state struct{ Pairing struct{ Code string } }
	if err := json.Unmarshal(asked.Body.Bytes(), &state); err != nil || state.Pairing.Code == "" {
		t.Fatalf("asking for a code gave %d %s", asked.Code, asked.Body)
	}
	paired := serve(t, d, call{method: "POST", target: "/pair", host: deckOnWiFi, from: aPhone,
		headers: map[string]string{"User-Agent": iPhone}, body: `{"code": "` + state.Pairing.Code + `"}`})
	var answer struct{ Key string }
	if err := json.Unmarshal(paired.Body.Bytes(), &answer); err != nil || answer.Key == "" {
		t.Fatalf("pairing gave %d %s", paired.Code, paired.Body)
	}
	return answer.Key
}

func TestTheSetupPageOpensOnlyOnThisComputer(t *testing.T) {
	d := newTestDeck(t)
	for _, c := range []struct {
		host, from string
		want       int
	}{
		{"localhost:7710", thisComputer, http.StatusOK},
		{deckOnWiFi, aPhone, http.StatusNotFound},
		// A web page whose name was pointed at this computer, to read the page through your browser.
		{"evil.example:7710", thisComputer, http.StatusNotFound},
	} {
		if got := serve(t, d, call{method: "GET", target: "/setup", host: c.host, from: c.from}).Code; got != c.want {
			t.Errorf("GET /setup for %s from %s: %d, want %d", c.host, c.from, got, c.want)
		}
	}
}

func TestSetupButtonsNeedTheSetupPagesHeader(t *testing.T) {
	d := newTestDeck(t)
	// What a form on another website could send: the browser adds no custom header.
	forged := serve(t, d, call{method: "POST", target: "/setup/unpair?all=1", host: "localhost:7710", from: thisComputer})
	if forged.Code != http.StatusForbidden {
		t.Fatalf("a setup button pressed without the header: %d, want %d", forged.Code, http.StatusForbidden)
	}
}

func TestAPairedPhoneGetsTheDeck(t *testing.T) {
	d := newTestDeck(t)
	key := pair(t, d)
	page := serve(t, d, call{method: "GET", target: "/?t=" + key, host: deckOnWiFi, from: aPhone})
	if !strings.Contains(page.Body.String(), `id="keys"`) {
		t.Fatal("a paired phone didn't get the deck")
	}
	if page.Header().Get("X-Frame-Options") != "DENY" {
		t.Error("the deck can be shown inside another site's page")
	}
	act := serve(t, d, call{method: "POST", target: "/act?action=send&session=nobody&t=" + key, host: deckOnWiFi, from: aPhone})
	if act.Code != http.StatusNotFound {
		t.Errorf("a paired phone's control for a session that isn't there: %d, want %d", act.Code, http.StatusNotFound)
	}
}

func TestAPhoneWithoutAKeyGetsOnlyThePairingPage(t *testing.T) {
	d := newTestDeck(t)
	pair(t, d)
	if page := serve(t, d, call{method: "GET", target: "/", host: deckOnWiFi, from: aPhone}); !strings.Contains(page.Body.String(), "Pair with your computer") {
		t.Error("a phone without a key didn't get the pairing page")
	}
	for _, target := range []string{"/act?action=send&session=s1", "/act?action=send&session=s1&t=a-made-up-key", "/focus?session=s1"} {
		if got := serve(t, d, call{method: "POST", target: target, host: deckOnWiFi, from: aPhone}).Code; got != http.StatusUnauthorized {
			t.Errorf("POST %s: %d, want %d", target, got, http.StatusUnauthorized)
		}
	}
}

func TestAPhonesKeyWorksOnlyAtTheDecksOwnAddress(t *testing.T) {
	d := newTestDeck(t)
	key := pair(t, d)
	got := serve(t, d, call{method: "GET", target: "/?t=" + key, host: "evil.example:7710", from: aPhone}).Code
	if got != http.StatusForbidden {
		t.Fatalf("the deck answered a page that rebound its own name to it: %d, want %d", got, http.StatusForbidden)
	}
}

func TestOnlyTheHookReportsEvents(t *testing.T) {
	d := newTestDeck(t)
	phoneKey := pair(t, d)
	report := func(from, key string) int {
		return serve(t, d, call{method: "POST", target: "/hook", host: "127.0.0.1:7710", from: from,
			headers: map[string]string{hookKeyHeader: key, "X-AgentDeck-Tab": tab, "X-AgentDeck-At": "100"},
			body:    `{"hook_event_name": "UserPromptSubmit", "session_id": "s1", "cwd": "/work/api-server"}`}).Code
	}
	if got := report(thisComputer, ""); got != http.StatusUnauthorized {
		t.Errorf("an event with no key: %d, want %d", got, http.StatusUnauthorized)
	}
	if got := report(thisComputer, phoneKey); got != http.StatusUnauthorized {
		t.Errorf("an event with a phone's key: %d, want %d", got, http.StatusUnauthorized)
	}
	if got := report(aPhone, d.access.HookKey); got != http.StatusNotFound {
		t.Errorf("an event from another device: %d, want %d", got, http.StatusNotFound)
	}
	if d.sessions.Get("s1") != nil {
		t.Fatal("a refused event reached the deck")
	}
	if got := report(thisComputer, d.access.HookKey); got != http.StatusNoContent || d.sessions.Get("s1") == nil {
		t.Fatalf("the hook's own event: %d, and the session isn't on the deck", got)
	}
}
