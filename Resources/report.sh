#!/bin/bash
# AgentDeck's Claude Code hook. Forwards each hook event to the AgentDeck app.
#
# The event JSON arrives on stdin and is passed on as it is. Two things are
# added as headers:
#   - the time the event was raised. Hooks run in the background, so two events
#     a few milliseconds apart can arrive in either order.
#   - claude's tty. Hooks have no terminal of their own, so this walks up the
#     process tree to the first ancestor that has one. AgentDeck uses it to
#     find the Terminal tab.
#
# It never blocks or fails the session. If AgentDeck isn't running, the
# event is simply dropped.
#
# Only sessions in Terminal report in. The deck's buttons can only reach
# Terminal's tabs, so a session in any other terminal would be a key that
# lights up but can't be controlled.
[ "$TERM_PROGRAM" = "Apple_Terminal" ] || exit 0

AT="$(perl -MTime::HiRes=time -e 'printf "%d", time * 1000')"
DIR="$(cd "$(dirname "$0")" && pwd)"
TOKEN="$(cat "$DIR/token" 2>/dev/null)"

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

curl -s -m 2 -o /dev/null \
  -H 'Content-Type: application/json' \
  -H "X-AgentDeck-Token: $TOKEN" \
  -H "X-AgentDeck-TTY: $tty" \
  -H "X-AgentDeck-At: $AT" \
  --data-binary @- \
  "http://127.0.0.1:{{PORT}}/hook"

exit 0
