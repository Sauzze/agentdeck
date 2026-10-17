package desktop

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/aymanbagabas/go-pty"
	"golang.org/x/term"
)

// The launcher is `sauzzedeck run <agent> [arguments]`. It starts the agent
// in a terminal of its own, inside the one you typed the command in: your
// typing goes in and the agent's screen comes out exactly as before, and the
// deck can press keys in it too, with no window to find and no permission to
// ask for. It sets SAUZZEDECK_SESSION, so the agent's hooks can say which
// launcher they run in.
//
// The launcher holds a connection to the app open, and the app sends the
// deck's keys down it as JSON lines. Without the app, the agent runs as if
// started plainly, and the launcher keeps trying to reach the app.

// launcherCommand is one line down that connection.
type launcherCommand struct {
	Press *Keystroke `json:"press,omitempty"`
	Type  string     `json:"type,omitempty"`
	// Stop ends the agent: the office's firing.
	Stop bool `json:"stop,omitempty"`
}

// How long a fired agent is given to end before it's made to.
const stopGrace = 3 * time.Second

// How long the launcher waits before reaching for the app again.
const reconnectDelay = 3 * time.Second

// RunLauncher returns the agent's exit code.
func RunLauncher(args []string) int {
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "Usage: sauzzedeck run <agent> [arguments], for example: sauzzedeck run claude")
		return 2
	}
	program, programArgs, err := resolveProgram(args[0], args[1:])
	if err != nil {
		fmt.Fprintf(os.Stderr, "sauzzedeck: %v\n", err)
		return 127
	}

	terminal, err := pty.New()
	if err != nil {
		fmt.Fprintf(os.Stderr, "sauzzedeck: no pseudo-terminal: %v\n", err)
		return 1
	}
	defer terminal.Close()

	id := newID()
	folder, _ := os.Getwd()
	cmd := terminal.Command(program, programArgs...)
	cmd.Env = append(os.Environ(), "SAUZZEDECK_SESSION="+id)
	cmd.Dir = folder
	matchSize(terminal)
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "sauzzedeck: %v\n", err)
		return 127
	}

	stdin := int(os.Stdin.Fd())
	if term.IsTerminal(stdin) {
		if saved, err := term.MakeRaw(stdin); err == nil {
			defer term.Restore(stdin, saved)
		}
	}
	prepareConsole()

	input := &lockedWriter{w: terminal}
	cursor := &cursorMode{}
	go func() { _, _ = io.Copy(input, os.Stdin) }()
	go func() { _, _ = io.Copy(os.Stdout, io.TeeReader(terminal, cursor)) }()
	go followSize(terminal)
	go serveDeck(id, agentNamed(args[0]), folder, input, cursor, func() { stopProcess(cmd.Process) })

	if err := cmd.Wait(); err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return exit.ExitCode()
		}
		return 1
	}
	return 0
}

// resolveProgram finds the agent on PATH. On Windows, npm installs agents as
// .cmd scripts, which a pseudo-console can't start by themselves.
func resolveProgram(name string, args []string) (string, []string, error) {
	path, err := exec.LookPath(name)
	if err != nil {
		return "", nil, fmt.Errorf("%s isn't installed, or isn't on your PATH", name)
	}
	if runtime.GOOS == "windows" {
		if ext := strings.ToLower(filepath.Ext(path)); ext == ".cmd" || ext == ".bat" {
			shell := os.Getenv("ComSpec")
			if shell == "" {
				shell = `C:\Windows\System32\cmd.exe`
			}
			return shell, append([]string{"/c", path}, args...), nil
		}
	}
	return path, args, nil
}

// agentNamed is the agent a program name is, so the app can find Codex's
// launcher by folder: Codex runs its hooks elsewhere, without this
// launcher's variable.
func agentNamed(program string) Agent {
	base := strings.ToLower(strings.TrimSuffix(filepath.Base(program), filepath.Ext(program)))
	for _, a := range agents {
		if string(a) == base {
			return a
		}
	}
	return ""
}

func matchSize(terminal pty.Pty) {
	if width, height, err := term.GetSize(int(os.Stdout.Fd())); err == nil {
		_ = terminal.Resize(width, height)
	}
}

// lockedWriter keeps your typing and the deck's keys from interleaving.
type lockedWriter struct {
	mu sync.Mutex
	w  io.Writer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

// cursorMode watches the agent's screen for the switch between the two ways
// a terminal sends arrow keys (DECCKM). An agent in application mode expects
// ESC O A for Up, not ESC [ A.
type cursorMode struct {
	mu          sync.Mutex
	application bool
	tail        []byte // the end of the last chunk, for a switch split across two
}

var (
	applicationMode = []byte("\x1b[?1h")
	normalMode      = []byte("\x1b[?1l")
)

func (c *cursorMode) Write(p []byte) (int, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	seen := append(c.tail, p...)
	if on, off := bytes.LastIndex(seen, applicationMode), bytes.LastIndex(seen, normalMode); on != off {
		c.application = on > off
	}
	c.tail = append([]byte(nil), seen[max(0, len(seen)-len(applicationMode)+1):]...)
	return len(p), nil
}

func (c *cursorMode) bytesFor(key Key) string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.application && (key == Up || key == Down) {
		return "\x1bO" + keyBytes[key][2:]
	}
	return keyBytes[key]
}

// serveDeck connects to the app and carries out its commands until the
// agent exits, reconnecting whenever the connection drops.
func serveDeck(id string, agent Agent, folder string, input io.Writer, cursor *cursorMode, stop func()) {
	query := url.Values{"id": {id}, "agent": {string(agent)}, "folder": {folder}}
	address := fmt.Sprintf("http://127.0.0.1:%d/launcher?%s", Port, query.Encode())
	for {
		if key, err := os.ReadFile(hookKeyFile); err == nil {
			request, _ := http.NewRequest(http.MethodGet, address, nil)
			request.Header.Set(hookKeyHeader, strings.TrimSpace(string(key)))
			if response, err := http.DefaultClient.Do(request); err == nil {
				follow(response.Body, input, cursor, stop)
				response.Body.Close()
			}
		}
		time.Sleep(reconnectDelay)
	}
}

// stopProcess asks the agent to end, and makes it after a moment. Windows
// can only make it.
func stopProcess(process *os.Process) {
	if process.Signal(syscall.SIGTERM) != nil {
		_ = process.Kill()
		return
	}
	time.AfterFunc(stopGrace, func() { _ = process.Kill() })
}

func follow(commands io.Reader, input io.Writer, cursor *cursorMode, stop func()) {
	lines := bufio.NewScanner(commands)
	for lines.Scan() {
		var command launcherCommand
		if json.Unmarshal(lines.Bytes(), &command) != nil {
			continue
		}
		switch {
		case command.Stop:
			stop()
		case command.Press != nil:
			for i := 0; i < max(command.Press.Times, 1); i++ {
				if i > 0 {
					time.Sleep(keyGap)
				}
				_, _ = io.WriteString(input, cursor.bytesFor(command.Press.Key))
			}
		case command.Type != "":
			_, _ = io.WriteString(input, command.Type)
			// A beat before Enter, or a TUI can take the text as a paste
			// and the Enter as part of it.
			time.Sleep(keyGap)
			_, _ = io.WriteString(input, keyBytes[Enter])
		}
	}
}

// launcherTab is the app's side: a launcher connected to it.
type launcherTab struct {
	agent    Agent
	folder   string
	commands chan launcherCommand
}

func (t *launcherTab) send(command launcherCommand) error {
	select {
	case t.commands <- command:
		return nil
	default:
		return errors.New("the launcher isn't keeping up")
	}
}

func (t *launcherTab) Press(k Keystroke) error { return t.send(launcherCommand{Press: &k}) }
func (t *launcherTab) Type(text string) error  { return t.send(launcherCommand{Type: text}) }

// Focus does nothing: the launcher can't tell which window it runs in, so
// selecting the key on the phone is all a tap can do.
func (t *launcherTab) Focus() error { return nil }

// Close ends the agent. The window it runs in is the terminal's own, which
// the launcher can't reach, so that stays open.
func (t *launcherTab) Close() error { return t.send(launcherCommand{Stop: true}) }

// Scrolling belongs to the terminal around the launcher, which it can't reach.
func (t *launcherTab) Scroll(int) error      { return errUnsupported }
func (t *launcherTab) ScrollToBottom() error { return errUnsupported }
