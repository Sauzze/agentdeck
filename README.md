# SauzzeDeck Pro

A control pad for [Claude Code](https://claude.com/claude-code), on your phone.

Six keys light up to show what each of your Claude sessions is doing. You can
approve a permission request from across the room, turn a dial to change how
hard Claude thinks, or hold a button and talk to it. SauzzeDeck Pro runs in
your Mac's menu bar. Your phone connects to it over your Wi-Fi, so there's
nothing to install from an app store.

SauzzeDeck Pro was called AgentDeck up to version 1.0.1.

<p align="center">
  <img src="docs/deck-portrait.png" alt="The deck on a phone: six session keys, a dial and a stick" width="300">
</p>

> SauzzeDeck Pro is an independent project. It is not made by or affiliated with Anthropic.

## What's on the deck

| Control | What it does |
|---|---|
| **6 session keys** | One per Claude session. The colour shows its state. Tap a key to select that session and bring its Terminal window to the front. |
| **Dial** | Thinking effort: low, medium, high, extra high, max. If Claude is mid-task, the change waits until it finishes. |
| **Stick** | When Claude asks you something, slide up or down to choose an answer and tap to confirm. The rest of the time it's a scroll wheel for that session's Terminal window: roll it to scroll, tap to jump back to the bottom. Scrolling is off until you turn on **Let the stick scroll Terminal** on the setup page. Tap the stick's SCROLL / CHOICES label to switch by hand. |
| **✓ and ✕** | Accept or reject a permission request. |
| **🎙 (hold)** | Talk to Claude. Release, and Claude sends what you said once it's three words or more. |
| **esc · send · /clear** | Interrupt Claude, press Return, or start a fresh conversation. `/clear` asks you to tap twice, and waits until Claude isn't busy. |

What the key colours mean:

| | |
|---|---|
| ⚪ White | Idle |
| 🔵 Blue, pulsing | Working |
| 🟠 Orange, blinking | Waiting on you: a permission request or a question |
| 🟢 Green | Done, and you haven't looked yet |
| 🔴 Red | Stopped on an error |

Each session keeps its key until it ends. You can pin projects to specific keys and change every colour:

<p align="center">
  <img src="docs/themes.png" alt="The deck in five colour schemes: Default, Midnight, Moonlight, Light and High contrast" width="100%">
</p>

Four of these are built-in presets. Moonlight is a custom palette, made in the
colour editor in a minute.

## What you need

- A Mac running macOS 13 or later
- [Claude Code](https://docs.claude.com/en/docs/claude-code) running in the **Terminal** app. Sessions in
  other terminal apps (iTerm, Ghostty, VS Code…) don't appear on the deck, because
  its buttons can only reach Terminal.
- A phone on the same Wi-Fi as your Mac

## Install

There are two ways. Both give you the same app.

### Download the app

1. Download **SauzzeDeck-Pro.zip** from the
   [latest release](https://github.com/Sauzze/agentdeck/releases/latest) and open it.
2. Drag **SauzzeDeck Pro** into your Applications folder, then open it.
3. macOS will say it can't check SauzzeDeck Pro for malicious software, because
   the app isn't notarised by Apple. Click **Done**, then go to
   **System Settings → Privacy & Security**, scroll down, and click
   **Open Anyway** next to SauzzeDeck Pro. You only do this once.

To check that your download is the one that was published, run
`shasum -a 256 SauzzeDeck-Pro.zip` in Terminal and compare the result with the
SHA-256 in the release notes.

Updating from AgentDeck? Quit it, delete **AgentDeck** from Applications and
install as above. Your settings carry over, but pair your phone again, add it
to your Home Screen again, and turn the app back on under Accessibility (see
[Set up](#set-up)).

### Or build it yourself

You need Apple's free developer tools. The installer offers to install them if
you don't have them. A copy you build yourself opens without the warning.

```bash
git clone https://github.com/Sauzze/agentdeck.git
cd agentdeck
./install.sh
```

This builds SauzzeDeck Pro, puts it in your Applications folder and opens it.
It also replaces an older copy named AgentDeck.

Either way, you'll see an S in a circle in the menu bar, and the setup page
opens in your browser.

## Set up

The setup page walks you through four steps:

<p align="center">
  <img src="docs/setup.png" alt="The setup page: a four-step checklist, the keys, and a pairing code with its QR code for your phone" width="720">
</p>

1. **Connect Claude Code.** This lets your Claude sessions tell SauzzeDeck Pro
   what they're doing. Restart any Claude sessions that were already open.
2. **Allow SauzzeDeck Pro to use your keyboard.** System Settings opens. Turn
   on **SauzzeDeck Pro** in the list. The buttons, the mic and scrolling need
   this.
3. **Let the stick scroll Terminal** (optional). Turns the stick into a scroll
   wheel for the selected session's Terminal window.
4. **Open at login** (optional). Keeps the deck ready whenever your Mac is on.

The first time you press a button, macOS asks whether SauzzeDeck Pro may
control Terminal. Click **Allow**.

## Pair your phone

1. On your Mac, click the SauzzeDeck Pro icon in the menu bar and choose
   **Pair a Phone…**. The setup page opens with a six-digit code and a QR code.
2. Scan the QR code with your phone's camera. Or open Safari, go to the address
   shown with the code (for example `192.168.1.20:7710`) and type the code.
3. Tap **Share → Add to Home Screen**. SauzzeDeck Pro now opens full screen and
   stays paired.

Each phone you pair appears under **Paired phones** on the setup page, with
when it was last used. **Revoke** cuts one phone off straight away;
**Unpair All Phones** does it for every phone, and is also in the menu bar
menu. A phone you've cut off shows the pairing page again. To use it once
more, pair it with a new code, then remove the old Home Screen icon and add
the deck again: the icon keeps the old pairing.

<p align="center">
  <img src="docs/deck-landscape.png" alt="The deck sideways: keys on the left, controls on the right" width="640">
</p>

## Make it yours

The setup page also has:

- **Keys.** Drag a running session onto a key to keep that project on it.
  Keys you don't pin go to the next session that starts.
- **Logo.** The Sauzze logo or the original six keys, in the menu bar, on the
  setup page and on your phone's Home Screen. A phone picks up a new logo the
  next time you add the deck to its Home Screen.
- **Colours.** Pick any colour for the background, keys, text and each state,
  or start from a preset (Default, Midnight, High contrast, Light). Your
  phone updates as you pick.

Open the setup page any time from the menu bar (**Open Setup…**), or by opening
SauzzeDeck Pro again from Applications.

## Voice

The mic button uses Claude Code's own voice input (`/voice`), in *tap* mode.
Connecting Claude Code sets that up, unless you had already set voice up
yourself. In that case, make sure `~/.claude/settings.json` contains:

```json
"voice": { "enabled": true, "mode": "tap" }
```

Voice input needs Claude Code signed in with a Claude.ai account. Claude Code
sends your audio to Anthropic to be transcribed. SauzzeDeck Pro itself never
hears it.

## Privacy and security

- **SauzzeDeck Pro sends nothing off your network.** It talks only to your
  phone and to Claude Code on your Mac. It has no accounts, no analytics and
  no cloud service.
- **Each phone has its own key.** Every request carries a long random key that
  only that phone has. The key is never typed: pairing hands it over. Your Mac
  keeps only a fingerprint of each key (a SHA-256 hash), so you can revoke one
  phone without touching the others.
- **Pairing codes are short-lived.** A code exists only after you ask for one.
  It works once and expires after five minutes. Five wrong tries from one
  device lock that device out until you get a new code, and twenty wrong tries
  in all withdraw the code. The QR code holds the same one-time code, never a
  key, and disappears once the code is used.
- **Claude Code has a key of its own.** The hook script uses a separate key,
  read from a file only you can read, so it never shows up in the list of
  running processes. It works only from your Mac, and only for reporting what
  Claude is doing. A phone's key can't pose as Claude Code, and Claude Code's
  key can't drive the deck.
- **Scrolling is off until you turn it on.** Out of the box, a paired phone
  can only use the deck's buttons, dial and choices.
- **SauzzeDeck Pro listens on port 7710 on your network,** so your phone can
  reach it. Without a key, all another device gets is the pairing page. Its
  pages can't be shown inside other websites, and it turns away connections
  beyond a fixed limit, so a misbehaving device can't swamp it.
- **The setup page only opens on your Mac.** Other devices can't reach it, and
  other websites can't press its buttons.
- **Use a network you trust.** The connection is plain HTTP on your local
  network. Use SauzzeDeck Pro on home or office Wi-Fi, not public hotspots.

## Troubleshooting

**The keys stay empty.** Click **Connect** on the setup page, then restart your
Claude sessions. Claude needs to run in the Terminal app.

**Buttons, the mic or scrolling do nothing, or the phone says keyboard access
is off.** Turn SauzzeDeck Pro on in System
Settings → Privacy & Security → Accessibility. Updating SauzzeDeck Pro clears
that permission, because macOS treats each version as a new app. Click
**Open Settings** on the setup page again afterwards, and turn SauzzeDeck Pro
back on.

**The stick says SCROLL OFF.** Turn on **Let the stick scroll Terminal** on the
setup page.

**The phone shows the pairing page instead of the deck.** It was revoked, or
it was paired with AgentDeck 1.0. Pair it again, then add it to your Home
Screen again: see [Pair your phone](#pair-your-phone).

**The mic types a space instead of listening.** Claude's input box has to be
empty, and voice has to be in tap mode: see [Voice](#voice).

**The phone can't connect.** Check that both devices are on the same Wi-Fi.
If macOS asked whether SauzzeDeck Pro may accept incoming connections, allow
it.

**"Port 7710 is in use."** Another copy of SauzzeDeck Pro, or another app, is
using that port. Quit it and open SauzzeDeck Pro again.

## Uninstall

1. On the setup page, click **Disconnect** next to Claude Code, and turn off
   **Open at login**.
2. Quit SauzzeDeck Pro from the menu bar.
3. Delete **SauzzeDeck Pro** from Applications, and the folder
   `~/Library/Application Support/AgentDeck`. It kept the app's original name.

Connecting Claude Code also turned on its voice input, if it was off, and left a
backup of your Claude settings at `~/.claude/settings.json.agentdeck.bak`.
Disconnecting leaves voice as it is. Remove the `voice` entry from
`~/.claude/settings.json` if you don't want it, and delete the backup once you
no longer need it.

## How it works

Claude Code runs a small script ([`Resources/report.sh`](Resources/report.sh))
at each step of a session, through its
[hooks](https://docs.claude.com/en/docs/claude-code/hooks). The script tells
SauzzeDeck Pro what happened and which Terminal tab it happened in. SauzzeDeck
Pro works out each session's state and streams it to your phone.

Controls work in one of two ways:

- **Typed commands** such as `/effort` and `/clear` are typed into the tab
  through Terminal's scripting.
- **Keys and scrolling** are sent as ordinary keystrokes. Scrolling uses
  Terminal's own View → Line Up and Line Down, so it moves the window's view
  and Claude receives nothing.

The app is plain Swift with no dependencies. The phone side is a single web
page.

```
Sources/AgentDeck/   the Mac app
Resources/web/       the phone page, the pairing page and the setup page
Resources/report.sh  the Claude Code hook
install.sh           build and install
scripts/             the build itself, and the release download
docs/                screenshots for this page
```

## Windows

A Windows version is planned.

## License

[MIT](LICENSE)
