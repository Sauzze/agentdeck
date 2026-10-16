package desktop

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// The hook is `sauzzedeck hook [agent]`, which every agent runs at each step
// of a session: the counterpart of the Mac app's report.sh, built in because
// Windows has no bash or curl. The event JSON arrives on stdin and is passed
// on as it is, with headers for the agent, the time the event was raised,
// and the session's tab: see Tab. The key is read from its file, so it never
// appears on a command line.
//
// It never blocks or fails the session. If the app isn't running, the event
// is simply dropped.

const (
	hookKeyHeader = "X-AgentDeck-Token"
	hookTimeout   = 2 * time.Second
	// Far more than any event; a runaway stdin is cut off here.
	maxEventSize = 4 << 20
)

// RunHook always returns 0: a hook that fails would hold up the agent.
func RunHook(args []string) int {
	agent := string(Claude)
	if len(args) > 0 {
		agent = args[0]
	}
	event, _ := io.ReadAll(io.LimitReader(os.Stdin, maxEventSize))
	key, err := os.ReadFile(hookKeyFile)
	if err != nil {
		return 0
	}
	request, err := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/hook", Port), bytes.NewReader(event))
	if err != nil {
		return 0
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set(hookKeyHeader, strings.TrimSpace(string(key)))
	request.Header.Set("X-AgentDeck-Agent", agent)
	request.Header.Set("X-AgentDeck-At", strconv.FormatInt(time.Now().UnixMilli(), 10))
	request.Header.Set("X-AgentDeck-Tab", tabFromEnvironment(Agent(agent)))
	client := http.Client{Timeout: hookTimeout}
	if response, err := client.Do(request); err == nil {
		response.Body.Close()
	}
	return 0
}

// tabFromEnvironment names the session's tab from the variables the launcher
// and the terminals set, or "" when there is none to drive.
func tabFromEnvironment(agent Agent) string {
	// Codex runs its hooks in a shared background service, which keeps the
	// variables of whichever terminal started it: they name the wrong tab.
	// The app finds Codex's launcher by folder instead.
	if agent == Codex {
		return ""
	}
	if id := os.Getenv("SAUZZEDECK_SESSION"); id != "" {
		return "launcher:" + id
	}
	if pane := os.Getenv("TMUX_PANE"); pane != "" {
		socket, _, _ := strings.Cut(os.Getenv("TMUX"), ",")
		return "tmux:" + pane + "@" + socket
	}
	if pane := os.Getenv("WEZTERM_PANE"); pane != "" {
		return "wezterm:" + pane + "@" + os.Getenv("WEZTERM_UNIX_SOCKET")
	}
	if window := os.Getenv("KITTY_WINDOW_ID"); window != "" {
		if socket := os.Getenv("KITTY_LISTEN_ON"); socket != "" {
			return "kitty:" + window + "@" + socket
		}
	}
	return ""
}
