package desktop

import (
	"net/url"
	"strings"
	"unicode/utf8"
)

// activityOf is what a tool call is doing, in a few words: "Editing deck.go",
// "Searching the web". The office shows it under the agent's desk. As the Mac
// app's Activity.swift.
//
// It's built only from the parts of a call that say what it's for: a file's
// name, a web page's host, the description the agent gave it, the end of a
// search's pattern. Never from a command or a path, which can hold anything,
// and goes to every paired phone.
// Each agent names its tools its own way, so they're matched in lower case,
// under each of their names.
func activityOf(tool string, input map[string]any) string {
	return cutActivity(activityLine(tool, input))
}

// mostActivityCharacters: room for "Editing ConfigurationLoader.swift", and
// still fits under a desk.
const mostActivityCharacters = 40

func activityLine(tool string, input map[string]any) string {
	text := func(key string) string {
		value, _ := input[key].(string)
		return strings.TrimSpace(value)
	}
	file := fileNameIn(input)
	// A glob can be a whole path: only its last part says what's looked for.
	pattern := afterLastSeparator(text("pattern"))

	if strings.HasPrefix(tool, "mcp__") {
		return "Using " + mcpServer(tool)
	}
	switch strings.ToLower(tool) {
	case "bash", "shell", "run_shell_command":
		if text("description") != "" {
			return text("description")
		}
		if program := programOf(input["command"]); program != "" {
			return "Running " + program
		}
		return "Running a command"
	case "edit", "multiedit", "write", "notebookedit", "replace", "write_file", "apply_patch":
		if file == "" {
			return "Editing files"
		}
		return "Editing " + file
	case "read", "notebookread", "read_file", "read_many_files":
		if file == "" {
			return "Reading files"
		}
		return "Reading " + file
	case "grep", "glob", "search_file_content":
		if pattern == "" {
			return "Searching"
		}
		return "Searching for " + pattern
	case "webfetch", "web_fetch":
		if host := hostOf(text("url")); host != "" {
			return "Reading " + host
		}
		return "Reading the web"
	case "websearch", "web_search", "google_web_search":
		return "Searching the web"
	case "task", "agent":
		if text("description") == "" {
			return "Briefing a subagent"
		}
		return text("description")
	case "todowrite":
		todos, _ := input["todos"].([]any)
		for _, todo := range todos {
			t, _ := todo.(map[string]any)
			if active, ok := t["activeForm"].(string); ok && t["status"] == "in_progress" {
				return active
			}
		}
		return "Planning"
	case "askuserquestion":
		return "Asking you a question"
	}
	if text("activeForm") != "" {
		return text("activeForm")
	}
	return "Using " + tool
}

// cutActivity makes one line, cut to fit.
func cutActivity(line string) string {
	flat := strings.Join(strings.Fields(line), " ")
	if utf8.RuneCountInString(flat) <= mostActivityCharacters {
		return flat
	}
	return strings.TrimRight(string([]rune(flat)[:mostActivityCharacters-1]), " ") + "…"
}

func fileNameIn(input map[string]any) string {
	for _, key := range []string{"file_path", "filePath", "absolute_path", "notebook_path", "path"} {
		if path, _ := input[key].(string); path != "" {
			return afterLastSeparator(path)
		}
	}
	return ""
}

// afterLastSeparator is what comes after a path's last separator, or nothing.
func afterLastSeparator(path string) string {
	parts := strings.FieldsFunc(path, func(r rune) bool { return r == '/' || r == '\\' })
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

// programOf is the program a command runs, without its arguments or its
// folder: `FOO=1 ./build.sh --fast` is "build.sh". Codex sends a command as a
// list.
func programOf(command any) string {
	var words []string
	switch c := command.(type) {
	case string:
		words = strings.Fields(c)
	case []any:
		for _, word := range c {
			if w, ok := word.(string); ok {
				words = append(words, w)
			}
		}
	}
	for _, word := range words {
		if !strings.Contains(word, "=") {
			parts := strings.Split(word, "/")
			return strings.Trim(parts[len(parts)-1], `"'`)
		}
	}
	return ""
}

func hostOf(address string) string {
	parsed, err := url.Parse(address)
	if err != nil {
		return ""
	}
	return strings.TrimPrefix(parsed.Hostname(), "www.")
}

// mcpServer: `mcp__claude_ai_Gmail__search` is "Gmail",
// `mcp__plugin_design_figma__…` is "figma": the server's name, without the
// prefixes its host adds.
func mcpServer(tool string) string {
	server, _, _ := strings.Cut(strings.TrimPrefix(tool, "mcp__"), "__")
	if strings.HasPrefix(server, "claude_ai_") {
		server = strings.TrimPrefix(server, "claude_ai_")
	} else if strings.HasPrefix(server, "plugin_") {
		server = server[strings.LastIndex(server, "_")+1:]
	}
	return strings.ReplaceAll(server, "_", " ")
}
