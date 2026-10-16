// Package agentdeck holds what SauzzeDeck Pro's apps share: the phone,
// pairing and setup pages, and OpenCode's plugin. The Mac app copies them
// into its bundle; the Windows and Linux app builds them in.
package agentdeck

import "embed"

// Files is Resources/web and Resources/opencode-plugin.js.
//
//go:embed Resources/web Resources/opencode-plugin.js
var Files embed.FS
