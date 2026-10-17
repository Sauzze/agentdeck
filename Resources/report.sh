#!/bin/bash
# SauzzeDeck Pro's hook, run by every coding agent it follows. Forwards each
# hook event to the app.
#
#   report.sh [agent]   claude (the default), codex, gemini or opencode
#
# The event JSON arrives on stdin and is passed on as it is. The hook's key
# comes from hook-header, which the app writes next to this script: curl
# reads it from the file, so it never appears on a command line, where any
# process on the Mac could see it with `ps`. Four more things are added as
# headers:
#   - the agent, so the app reads the event in that agent's terms.
#   - the time the event was raised. Hooks run in the background, so two events
#     a few milliseconds apart can arrive in either order.
#   - the agent's tty. Hooks have no terminal of their own, so this walks up
#     the process tree to the first ancestor that has one. The app uses it to
#     find the Terminal tab.
#   - the folder the agent was started in, where the agent says. The event's
#     cwd follows the agent into subfolders; the app names the session's
#     project from this instead.
#
# It never blocks or fails the session. If the app isn't running, the event
# is simply dropped.
#
# Only sessions in Terminal report in. The deck's buttons can only reach
# Terminal's tabs, so a session in any other terminal would be a key that
# lights up but can't be controlled.

# Some agents run hooks with a pared-down environment.
PATH=/usr/bin:/bin:/usr/sbin:/sbin

AGENT="${1:-claude}"
AT="$(perl -MTime::HiRes=time -e 'printf "%d", time * 1000')"
DIR="$(cd "$(dirname "$0")" && pwd)"

tty=""
pid=$PPID
while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
  t="$(ps -o tty= -p "$pid" 2>/dev/null | tr -d ' ')"
  if [ -n "$t" ] && [ "$t" != "??" ]; then
    tty="/dev/$t"
    break
  fi
  pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
done

# A session in another terminal says so in TERM_PROGRAM. Where an agent has
# dropped that variable, Terminal itself is found further up the tree.
in_terminal() {
  [ "$TERM_PROGRAM" = "Apple_Terminal" ] && return 0
  [ -n "$TERM_PROGRAM" ] && return 1
  while [ -n "$pid" ] && [ "$pid" -gt 1 ]; do
    case "$(ps -o comm= -p "$pid" 2>/dev/null)" in
      */Terminal.app/*) return 0 ;;
    esac
    pid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')"
  done
  return 1
}

# No tty at all means the hook runs outside the session's process tree, as
# Codex's do, in a shared background service. The app finds the tab itself.
if [ -n "$tty" ]; then
  in_terminal || exit 0
fi

curl -s -m 2 -o /dev/null \
  -H 'Content-Type: application/json' \
  -H @"$DIR/hook-header" \
  -H "X-AgentDeck-Agent: $AGENT" \
  -H "X-AgentDeck-TTY: $tty" \
  -H "X-AgentDeck-Project: ${CLAUDE_PROJECT_DIR:-$GEMINI_PROJECT_DIR}" \
  -H "X-AgentDeck-At: $AT" \
  --data-binary @- \
  "http://127.0.0.1:{{PORT}}/hook"

exit 0
