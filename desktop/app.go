package desktop

import (
	"embed"
	"fmt"
	"os"
	"runtime"
	"strings"

	"fyne.io/systray"
)

//go:embed tray-sauzze.png tray-keys.png
var trayIcons embed.FS

// RunApp is the app: the deck's server, with an icon in the tray, the
// counterpart of the Mac app's menu bar item. It returns when you quit.
func RunApp() int {
	deck := NewDeck()
	refreshHooks()
	failed := make(chan error, 1)
	go func() { failed <- Serve(deck) }()

	deck.mu.Lock()
	firstRun := !deck.config.HasCompletedSetup
	deck.mu.Unlock()
	if firstRun {
		openURL(setupURL)
	}
	if !hasDesktop() {
		return reportFailure(<-failed)
	}
	systray.Run(func() { newTray(deck, failed) }, nil)
	return 0
}

// RunServer is the server alone, for a computer without a desktop to show a
// tray on, such as a Linux machine you reach over SSH.
func RunServer() int {
	deck := NewDeck()
	refreshHooks()
	return reportFailure(Serve(deck))
}

func reportFailure(err error) int {
	fmt.Fprintf(os.Stderr, "sauzzedeck: %v\n", err)
	return 1
}

// hasDesktop: a tray needs a graphical session to sit in.
func hasDesktop() bool {
	return runtime.GOOS != "linux" || os.Getenv("DISPLAY") != "" || os.Getenv("WAYLAND_DISPLAY") != ""
}

type tray struct {
	deck                              *Deck
	count, setup, pair, unpair, login *systray.MenuItem
	quit                              *systray.MenuItem
	logo                              string
}

func newTray(deck *Deck, failed <-chan error) {
	t := &tray{deck: deck}
	systray.SetTooltip("SauzzeDeck Pro")
	t.count = systray.AddMenuItem("", "")
	t.count.Disable()
	systray.AddSeparator()
	t.setup = systray.AddMenuItem("Open Setup…", "")
	t.pair = systray.AddMenuItem("Pair a Phone…", "")
	t.unpair = systray.AddMenuItem("Unpair All Phones…", "")
	systray.AddSeparator()
	t.login = systray.AddMenuItemCheckbox("Open at Login", "", isOpenAtLogin())
	systray.AddSeparator()
	t.quit = systray.AddMenuItem("Quit SauzzeDeck Pro", "")

	deck.mu.Lock()
	deck.OnChange = t.update
	deck.mu.Unlock()
	t.update()
	go t.listen(failed)
}

// update shows the sessions, and how many are waiting on you, the way the
// Mac's menu bar title does.
func (t *tray) update() {
	d := t.deck
	d.mu.Lock()
	all := d.sessions.All()
	waiting := 0
	for _, s := range all {
		if s.State == Asking {
			waiting++
		}
	}
	phones := len(d.access.Phones.All)
	logo := d.config.Logo
	d.mu.Unlock()

	if len(all) == 1 {
		t.count.SetTitle("1 agent session")
	} else {
		t.count.SetTitle(fmt.Sprintf("%d agent sessions", len(all)))
	}
	title := ""
	if waiting > 0 {
		title = fmt.Sprint(waiting)
	}
	systray.SetTitle(title)
	systray.SetTooltip(strings.TrimSpace("SauzzeDeck Pro " + map[bool]string{true: "· " + title + " waiting on you"}[waiting > 0]))
	if phones > 0 {
		t.unpair.Show()
	} else {
		t.unpair.Hide()
	}
	if logo != t.logo {
		if icon, err := trayIcons.ReadFile("tray-" + logo + ".png"); err == nil {
			systray.SetIcon(trayIcon(icon))
			t.logo = logo
		}
	}
}

func (t *tray) listen(failed <-chan error) {
	for {
		select {
		case <-t.setup.ClickedCh:
			openURL(setupURL)
		case <-t.pair.ClickedCh:
			// The setup page has a code ready when it opens on #pair.
			openURL(setupURL + "#pair")
		case <-t.unpair.ClickedCh:
			// The setup page asks you to confirm, then unpairs every phone.
			openURL(setupURL + "#unpair")
		case <-t.login.ClickedCh:
			setOpenAtLogin(!isOpenAtLogin())
			if isOpenAtLogin() {
				t.login.Check()
			} else {
				t.login.Uncheck()
			}
		case <-t.quit.ClickedCh:
			systray.Quit()
			return
		case <-failed:
			t.count.SetTitle(fmt.Sprintf("Port %d is in use. Is SauzzeDeck Pro already running?", Port))
		}
	}
}
