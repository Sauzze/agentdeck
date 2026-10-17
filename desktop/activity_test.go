package desktop

import "testing"

func TestAnActivitySaysWhatAToolIsFor(t *testing.T) {
	for _, c := range []struct {
		tool  string
		input map[string]any
		want  string
	}{
		{"Bash", map[string]any{"command": "swift build -c release", "description": "Build the app"}, "Build the app"},
		// Never the command itself: it can hold anything.
		{"Bash", map[string]any{"command": "TOKEN=abc ./scripts/deploy.sh --key abc"}, "Running deploy.sh"},
		{"Write", map[string]any{"file_path": "/work/api-server/notes/todo.md"}, "Editing todo.md"},
		{"read_file", map[string]any{"absolute_path": `C:\work\site\index.html`}, "Reading index.html"},
		{"Grep", map[string]any{"pattern": "subagent"}, "Searching for subagent"},
		{"Glob", map[string]any{"pattern": "/home/someone/work/**/*.go"}, "Searching for *.go"},
		{"WebFetch", map[string]any{"url": "https://www.example.com/docs/page?q=1"}, "Reading example.com"},
		{"WebSearch", map[string]any{"query": "anything"}, "Searching the web"},
		{"Agent", map[string]any{"description": "Review the diff", "prompt": "…"}, "Review the diff"},
		{"TodoWrite", map[string]any{"todos": []any{
			map[string]any{"content": "Write tests", "status": "completed", "activeForm": "Writing tests"},
			map[string]any{"content": "Fix the bug", "status": "in_progress", "activeForm": "Fixing the bug"},
		}}, "Fixing the bug"},
		{"mcp__claude_ai_Calendar__list_events", nil, "Using Calendar"},
		{"mcp__plugin_design_figma__get_screenshot", nil, "Using figma"},
		{"Skill", nil, "Using Skill"},
		{"Grep", map[string]any{"pattern": "a very long pattern that goes on and on past the end"}, "Searching for a very long pattern that…"},
	} {
		if got := activityOf(c.tool, c.input); got != c.want {
			t.Errorf("activityOf(%s, %v) = %q, want %q", c.tool, c.input, got, c.want)
		}
	}
}
