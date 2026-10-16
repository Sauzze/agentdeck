# AgentDeck

A control pad for [Claude Code](https://claude.com/claude-code), on your phone.

Six keys light up to show what each of your Claude sessions is doing. You can
approve a permission request from across the room, turn a dial to change how
hard Claude thinks, or hold a button and talk to it. AgentDeck runs in your
Mac's menu bar. Your phone connects to it over your Wi-Fi, so there's nothing
to install from an app store.

> AgentDeck is an independent project. It is not made by or affiliated with Anthropic.

## What's on the deck

| Control | What it does |
|---|---|
| **6 session keys** | One per Claude session. The colour shows its state. Tap a key to select that session and bring its Terminal window to the front. |
| **Dial** | Thinking effort: low, medium, high, extra high, max. If Claude is mid-task, the change waits until it finishes. |
| **Stick** | When Claude asks you something, slide up or down to choose an answer and tap to confirm. The rest of the time it's a trackpad for your Mac: drag to move, tap to click, two-finger tap to right-click, two-finger drag to scroll. Tap its CURSOR / CHOICES label to switch by hand. |
| **✓ and ✕** | Accept or reject a permission request. |
| **🎙 (hold)** | Talk to Claude. Release to send. |
| **esc · send · /clear** | Interrupt Claude, press Return, or start a fresh conversation. `/clear` asks you to tap twice, and waits until Claude isn't busy. |

What the key colours mean:

| | |
|---|---|
| ⚪ White | Idle |
| 🔵 Blue, pulsing | Working |
| 🟠 Orange, blinking | Waiting on you: a permission request or a question |
| 🟢 Green | Done, and you haven't looked yet |
| 🔴 Red | Stopped on an error |

Each session keeps its key until it ends. You can pin projects to specific keys and change every colour.

## What you need

- A Mac running macOS 13 or later
- [Claude Code](https://docs.claude.com/en/docs/claude-code) running in the **Terminal** app. Sessions in
  other terminal apps (iTerm, Ghostty, VS Code…) don't appear on the deck, because
  its buttons can only reach Terminal.
- A phone on the same Wi-Fi as your Mac
- Apple's free developer tools, used to build the app. The installer offers to
  install them if you don't have them.

## Install

```bash
git clone https://github.com/Sauzze/agentdeck.git
cd agentdeck
./install.sh
```

This builds AgentDeck, puts it in your Applications folder and opens it.
You'll see a small grid icon in the menu bar, and the setup page opens in your
browser.

## Set up

The setup page walks you through three steps:

1. **Connect Claude Code.** This lets your Claude sessions tell AgentDeck what
   they're doing. Restart any Claude sessions that were already open.
2. **Allow AgentDeck to use your keyboard and mouse.** System Settings opens.
   Turn on **AgentDeck** in the list. The buttons, the mic and the cursor need
   this.
3. **Open at login** (optional). Keeps the deck ready whenever your Mac is on.

The first time you press a button, macOS asks whether AgentDeck may control
Terminal. Click **Allow**.

## Pair your phone

1. On your Mac, click the AgentDeck icon in the menu bar and choose
   **Pair a Phone…**. The setup page opens with a six-digit code.
2. On your phone, open Safari and go to the address shown with the code,
   for example `192.168.1.20:7710`.
3. Type the code.
4. Tap **Share → Add to Home Screen**. AgentDeck now opens full screen and stays
   paired.

You can also scan the QR code on the setup page with your phone's camera.

## Make it yours

The setup page also has:

- **Keys.** Drag a running session onto a key to keep that project on it.
  Keys you don't pin go to the next session that starts.
- **Colours.** Pick any colour for the background, keys, text and each state,
  or start from a preset (Default, Midnight, High contrast, Light). Your
  phone updates as you pick.

Open the setup page any time from the menu bar (**Open Setup…**), or by opening
AgentDeck again from Applications.

## Voice

The mic button uses Claude Code's own voice input (`/voice`). Connecting Claude
Code turns it on in *tap* mode, unless you had already set voice up. If you
had, run `/voice tap` once in Claude.

Voice input needs Claude Code signed in with a Claude.ai account. Claude Code
sends your audio to Anthropic to be transcribed. AgentDeck itself never hears it.

## Privacy and security

- **Nothing leaves your network.** AgentDeck talks only to your phone and to
  Claude Code on your Mac. It has no accounts, no analytics and no cloud service.
- **Your phone needs a key.** Every request carries a long random key that only
  your paired phone has. The key is never typed: the pairing code hands it
  over. A pairing code exists only after you ask for one. It works once, expires
  after five minutes, and stops working after five wrong tries.
- **AgentDeck listens on port 7710 on your network,** so your phone can reach it.
  Without the key, all another device gets is the pairing page.
- **The setup page only opens on your Mac.** Other devices can't reach it, and
  other websites can't press its buttons.
- **The QR code contains the key.** Anyone who scans it can use your deck, so
  don't share a screenshot of it.
- **Use a network you trust.** The connection is plain HTTP on your local
  network. Use AgentDeck on home or office Wi-Fi, not public hotspots.

## Troubleshooting

**The keys stay empty.** Click **Connect** on the setup page, then restart your
Claude sessions. Claude needs to run in the Terminal app.

**Buttons, the mic or the cursor do nothing.** Turn AgentDeck on in System
Settings → Privacy & Security → Accessibility. Updating with `./install.sh`
clears that permission, because macOS treats each build as a new app. Click
**Open Settings** on the setup page again afterwards, and turn AgentDeck back on.

**The mic types a space instead of listening.** Claude's input box has to be
empty, and voice has to be in tap mode: run `/voice tap` in Claude.

**The phone can't connect.** Check that both devices are on the same Wi-Fi.
If macOS asked whether AgentDeck may accept incoming connections, allow it.

**"Port 7710 is in use."** Another copy of AgentDeck, or another app, is using
that port. Quit it and open AgentDeck again.

## Uninstall

1. On the setup page, click **Disconnect** next to Claude Code, and turn off
   **Open at login**.
2. Quit AgentDeck from the menu bar.
3. Delete **AgentDeck** from Applications, and the folder
   `~/Library/Application Support/AgentDeck`.

Connecting Claude Code also turned on its voice input, if it was off, and left a
backup of your Claude settings at `~/.claude/settings.json.agentdeck.bak`.
Disconnecting leaves voice as it is. Run `/voice off` in Claude if you don't want
it, and delete the backup once you no longer need it.

## How it works

Claude Code runs a small script ([`Resources/report.sh`](Resources/report.sh))
at each step of a session, through its
[hooks](https://docs.claude.com/en/docs/claude-code/hooks). The script tells
AgentDeck what happened and which Terminal tab it happened in. AgentDeck works
out each session's state and streams it to your phone.

Controls work in one of two ways:

- **Typed commands** such as `/effort` and `/clear` are typed into the tab
  through Terminal's scripting.
- **Keys and the cursor** are sent as ordinary keyboard and mouse events.

The app is plain Swift with no dependencies. The phone side is a single web
page.

```
Sources/AgentDeck/   the Mac app
Resources/web/       the phone page, the pairing page and the setup page
Resources/report.sh  the Claude Code hook
install.sh           build and install
```

## Windows

A Windows version is planned.

## License

[MIT](LICENSE)
