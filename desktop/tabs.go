package desktop

import (
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// A Tab is where a session runs, and how its keys are pressed: the Mac app
// drives Terminal.app; here each kind of tab is driven its own way. The hook
// names a session's tab with a string:
//
//	launcher:<id>              a terminal `sauzzedeck run` started the agent in
//	tmux:<pane>@<socket>       a tmux pane: $TMUX_PANE and $TMUX
//	wezterm:<pane>@<socket>    a WezTerm pane: $WEZTERM_PANE and $WEZTERM_UNIX_SOCKET
//	kitty:<window>@<socket>    a kitty window: $KITTY_WINDOW_ID and $KITTY_LISTEN_ON
//
// The tab commands run the terminal's own program with arguments, never
// through a shell, so nothing from an event is ever read as a command.
type Tab interface {
	Press(Keystroke) error
	// Type types text and presses Enter.
	Type(text string) error
	// Focus brings the tab forward, as far as its terminal allows.
	Focus() error
	// Scroll moves the view of the scrollback by lines, up when negative.
	Scroll(lines int) error
	ScrollToBottom() error
}

var errUnsupported = errors.New("not possible in this terminal")

// keyGap separates repeated keys. Two Escapes sent back to back read as one
// Alt+Escape; OpenCode's double Esc needs a beat between them.
const keyGap = 120 * time.Millisecond

// splitTab is a tab's name in parts.
func splitTab(name string) (kind, id, socket string) {
	kind, rest, _ := strings.Cut(name, ":")
	id, socket, _ = strings.Cut(rest, "@")
	return kind, id, socket
}

// commandTab drives a terminal through its command-line interface.
type commandTab struct {
	kind, id, socket string
}

func (t commandTab) run(args ...string) error {
	var cmd *exec.Cmd
	switch t.kind {
	case "tmux":
		cmd = exec.Command("tmux", append([]string{"-S", t.socket}, args...)...)
	case "wezterm":
		cmd = exec.Command("wezterm", append([]string{"cli"}, args...)...)
		if t.socket != "" {
			cmd.Env = append(cmd.Environ(), "WEZTERM_UNIX_SOCKET="+t.socket)
		}
	case "kitty":
		cmd = exec.Command("kitty", append([]string{"@", "--to", t.socket}, args...)...)
	default:
		return errUnsupported
	}
	if output, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("%s: %s", t.kind, strings.TrimSpace(string(output)))
	}
	return nil
}

// tmux names keys; WezTerm and kitty take the bytes the key sends.
var (
	tmuxKeys = map[Key]string{Enter: "Enter", Escape: "Escape", Space: "Space", Up: "Up", Down: "Down", CtrlC: "C-c"}
	keyBytes = map[Key]string{Enter: "\r", Escape: "\x1b", Space: " ", Up: "\x1b[A", Down: "\x1b[B", CtrlC: "\x03"}
)

func (t commandTab) Press(k Keystroke) error {
	for i := 0; i < max(k.Times, 1); i++ {
		if i > 0 {
			time.Sleep(keyGap)
		}
		if err := t.sendKey(k.Key); err != nil {
			return err
		}
	}
	return nil
}

func (t commandTab) sendKey(key Key) error {
	switch t.kind {
	case "tmux":
		return t.run("send-keys", "-t", t.id, tmuxKeys[key])
	case "wezterm":
		return t.run("send-text", "--pane-id", t.id, "--no-paste", keyBytes[key])
	case "kitty":
		return t.run("send-text", "--match", "id:"+t.id, kittyEscaped(keyBytes[key]))
	}
	return errUnsupported
}

func (t commandTab) Type(text string) error {
	switch t.kind {
	case "tmux":
		if err := t.run("send-keys", "-t", t.id, "-l", text); err != nil {
			return err
		}
	case "wezterm":
		if err := t.run("send-text", "--pane-id", t.id, "--no-paste", text); err != nil {
			return err
		}
	case "kitty":
		if err := t.run("send-text", "--match", "id:"+t.id, kittyEscaped(text)); err != nil {
			return err
		}
	}
	return t.sendKey(Enter)
}

func (t commandTab) Focus() error {
	switch t.kind {
	case "tmux":
		if err := t.run("select-window", "-t", t.id); err != nil {
			return err
		}
		return t.run("select-pane", "-t", t.id)
	case "wezterm":
		return t.run("activate-pane", "--pane-id", t.id)
	case "kitty":
		return t.run("focus-window", "--match", "id:"+t.id)
	}
	return errUnsupported
}

// Scroll uses tmux's copy mode, which -e leaves by itself once scrolled back
// to the bottom, and kitty's own scrolling. WezTerm's CLI has none.
func (t commandTab) Scroll(lines int) error {
	switch t.kind {
	case "tmux":
		if err := t.run("copy-mode", "-e", "-t", t.id); err != nil {
			return err
		}
		command := "scroll-down"
		if lines < 0 {
			command = "scroll-up"
		}
		return t.run("send-keys", "-t", t.id, "-X", "-N", fmt.Sprint(abs(lines)), command)
	case "kitty":
		amount := fmt.Sprintf("%dl", abs(lines))
		if lines < 0 {
			amount += "-"
		}
		return t.run("scroll-window", "--match", "id:"+t.id, amount)
	}
	return errUnsupported
}

func (t commandTab) ScrollToBottom() error {
	switch t.kind {
	case "tmux":
		// Outside copy mode there is nothing to leave, and that's fine.
		_ = t.run("send-keys", "-t", t.id, "-X", "cancel")
		return nil
	case "kitty":
		return t.run("scroll-window", "--match", "id:"+t.id, "end")
	}
	return errUnsupported
}

// alive asks the terminal whether the pane is still there. Unknown counts as
// alive: a session is only dropped when its tab is known to be gone.
func (t commandTab) alive() bool {
	switch t.kind {
	case "tmux":
		output, err := exec.Command("tmux", "-S", t.socket, "display-message", "-p", "-t", t.id, "#{pane_id}").Output()
		var answered *exec.ExitError
		if errors.As(err, &answered) {
			return false // tmux is there, and says the pane isn't
		}
		return err != nil || strings.TrimSpace(string(output)) == t.id
	}
	return true
}

// kittyEscaped writes control characters the way kitty's send-text reads
// them: Python escapes, so a backslash itself must be doubled.
func kittyEscaped(text string) string {
	var b strings.Builder
	for _, r := range text {
		switch {
		case r == '\\':
			b.WriteString(`\\`)
		case r < 0x20:
			fmt.Fprintf(&b, `\x%02x`, r)
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}
