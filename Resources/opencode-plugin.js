// SauzzeDeck Pro's OpenCode plugin. OpenCode has no command hooks, so this
// passes its session events to the hook the other agents run, named the way
// Claude Code names its hooks. The hook finds the session's tab and reports
// to the app; SauzzeDeck Pro writes this file when you connect your agents,
// and keeps it up to date.
const COMMAND = ["{{COMMAND}}"]

export const SauzzeDeckPro = async ({ directory }) => {
  // Subagent sessions run inside their parent's tab and are not its state.
  const children = new Set()
  // How a turn ended when it didn't finish. OpenCode follows an interrupt or
  // an error with the same session.idle as a finished turn.
  const endings = new Map()

  const report = (sessionID, name, extra = {}) => {
    if (!sessionID || children.has(sessionID)) return
    const event = JSON.stringify({ session_id: sessionID, hook_event_name: name, cwd: directory, ...extra })
    Bun.spawn(COMMAND, { stdin: new TextEncoder().encode(event), stdout: "ignore", stderr: "ignore" })
  }

  return {
    event: async ({ event }) => {
      const p = event.properties ?? {}
      switch (event.type) {
        case "session.created":
          if (p.info?.parentID) children.add(p.info.id)
          else report(p.info?.id, "SessionStart", { source: "startup" })
          break
        case "session.status":
          if (p.status?.type !== "busy") break
          endings.delete(p.sessionID)
          report(p.sessionID, "UserPromptSubmit")
          break
        case "session.idle":
          report(p.sessionID, endings.get(p.sessionID) ?? "Stop")
          endings.delete(p.sessionID)
          break
        case "permission.asked":
        case "permission.updated": // its name in older versions of OpenCode
          report(p.sessionID, "PermissionRequest")
          break
        case "permission.replied":
          report(p.sessionID, "PostToolUse")
          break
        case "session.error": {
          const ending = p.error?.name === "MessageAbortedError" ? "Interrupt" : "StopFailure"
          endings.set(p.sessionID, ending)
          report(p.sessionID, ending)
          break
        }
        case "session.deleted":
          report(p.info?.id, "SessionEnd")
          break
      }
    },
  }
}
