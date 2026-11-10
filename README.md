<p align="center">
  <img src="build/icon.png" alt="Whitebox" width="96" height="96">
</p>

<h1 align="center">Whitebox</h1>

<p align="center">
  <b>Run several AI agents side by side in real terminals,<br>and see exactly what each one did, right next to it.</b>
</p>

<p align="center">
  <a href="https://github.com/minjund/Whitebox/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/minjund/Whitebox?style=flat-square&label=release"></a>
  <a href="https://github.com/minjund/Whitebox/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/minjund/Whitebox/total?style=flat-square"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS-555?style=flat-square">
  <a href="https://www.npmjs.com/package/whitebox-ai"><img alt="npm" src="https://img.shields.io/npm/v/whitebox-ai?style=flat-square"></a>
  <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
</p>

<p align="center">
  <b>English</b> · <a href="README.ko.md">한국어</a> · <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="#install"><b>Install</b></a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#features">Features</a> ·
  <a href="#whitebox-cli">CLI</a> ·
  <a href="#development">Development</a>
</p>

<p align="center">
  <img src="docs/assets/readme/en/workspace.png" alt="Whitebox workspace: project and panel tree on the left, Claude and Codex in split terminals, Understand · Review on the right" width="100%">
</p>

## What is Whitebox?

With several AI CLIs such as Claude Code and Codex open at once, it is easy to lose track of which terminal is doing what, and whether a finished task really did what you asked. Whitebox groups those terminals into panels per project and, for every request, lays out **what was actually done and what is left** beside the terminal that did it.

- **Your terminal stays your terminal.** Run the CLIs you already use inside Whitebox terminals. No agent framework or prompt format required.
- **Checked per request.** Each review is attached to the terminal and request that produced it, so parallel agents never get mixed up.
- **A local desktop app.** Terminal output and records stay on your machine. What is sent for analysis, and where, is listed under [Data and privacy](#data-and-privacy).

## Install

### Windows 10/11 (x64)

Download `Whitebox-Setup-*.exe` from [Releases](https://github.com/minjund/Whitebox/releases/latest) and run it. In the NSIS installer, choose to install for the current user only; it installs into your user profile and needs no administrator rights. You can also change the install folder. Later updates are installed from inside the app (Settings → General). To run without installing, download `Whitebox-*-portable.exe`.

When the app updates itself, it verifies the downloaded file against the size and SHA-256 recorded in the GitHub release, but the Windows installer is not Authenticode-signed yet. If you download it in a browser, Microsoft Defender SmartScreen may warn about an unknown publisher. Make sure the file came from the official [minjund/Whitebox Releases](https://github.com/minjund/Whitebox/releases) URL, then choose **More info → Run anyway**.

### macOS

#### Install script

```sh
curl -fsSL https://raw.githubusercontent.com/minjund/Whitebox/main/scripts/install-macos.sh | bash
```

Downloads the DMG for your Mac (`arm64` for Apple Silicon, `x64` for Intel) from the latest release, checks it against the size and SHA-256 recorded in the release, copies it to `/Applications/Whitebox.app` and removes the quarantine attribute. Set `WHITEBOX_INSTALL_DIR` to install elsewhere:

```sh
curl -fsSL https://raw.githubusercontent.com/minjund/Whitebox/main/scripts/install-macos.sh \
  | WHITEBOX_INSTALL_DIR="$HOME/Applications" bash
```

#### Manual DMG

Download `Whitebox-*-arm64.dmg` (Apple Silicon) or `Whitebox-*-x64.dmg` (Intel) from [Releases](https://github.com/minjund/Whitebox/releases/latest), copy the app to Applications, then remove the quarantine attribute:

```sh
xattr -dr com.apple.quarantine /Applications/Whitebox.app
```

Whitebox is an ad-hoc signed build, not signed or notarized with an Apple Developer ID. The command above only removes Gatekeeper's quarantine flag; it does not change the app.

### npm launcher

With Node.js 18 or newer you can install from npm and open the app with the `whitebox` command.

```sh
npm install -g whitebox-ai
whitebox
```

### Prerequisites

Whitebox does not install AI CLIs for you. Install and sign in to the CLIs you want to use first, such as [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex CLI](https://github.com/openai/codex).

## Quick start

1. Click **Add project** in the left sidebar and pick a folder.
2. Click **Add panel** to open a terminal in that folder.
3. Run `claude` or `codex` and ask as usual.
4. Add another **Terminal** to the panel, or split with <kbd>⌘/Ctrl</kbd>+<kbd>D</kbd>, to run another agent alongside.
5. When a reply finishes, read **Understand · Review** on the right: what you asked, what was done, and what is left.

| Shortcut | Action |
| --- | --- |
| <kbd>⌘/Ctrl</kbd>+<kbd>T</kbd> | Add terminal |
| <kbd>⌘/Ctrl</kbd>+<kbd>D</kbd> | Split |
| <kbd>⌘/Ctrl</kbd>+<kbd>K</kbd> | Find a project |

## Features

### Projects, panels and split terminals

- Each project has panels, and each panel splits its terminals into an aligned grid. Drag terminals to view them together with terminals from other panels.
- The sidebar tells working terminals apart from those waiting for input or approval and those with a reply you have not read yet. Long-running background commands and monitors get their own badges.
- A terminal is named after a summary of its latest request, so you can tell many of them apart at a glance.
- Terminal sessions and output survive resizing, panel switches and app restarts. Korean and other IME input is supported.
- Moving a terminal to the trash stops its session and frees its slot. Output and review records are kept and can be restored read-only; deleting permanently removes them.

### Understand · Review

When an AI reply finishes, Whitebox lays out **the actual answer, what was checked and what is left, the evidence, and the next action needed** for that request. Statements from the conversation, results confirmed by tool output and inferences are labelled separately, and commands to re-check can be copied as is. Earlier requests stay under **History**.

Turn automatic analysis on or off with the switch at the top right. In Settings → Understand · Review, choose the AI used for analysis (**same service as the terminal**, Claude or Codex) and its model. Adding a Jev API key in Settings → Connections lets Jev pick out which requests need analysis first.

### Summary mode

<p align="center">
  <img src="docs/assets/readme/en/summary.png" alt="Summary mode: your request, the summarized AI answer and the next-request composer" width="100%">
</p>

Read summarized answers instead of the raw terminal, and send the next request straight to the same AI session. Switch with **Terminal / Summary** at the top; each terminal remembers its own view, conversation and draft.

- Requests sent while the AI is busy are queued and delivered when the reply finishes. Edit or cancel them before they go, or choose **Send anyway** to deliver at once.
- Type `/` in the composer to pick the AI's slash commands: built-in, custom, skills and plugin commands.
- Answer supported approval prompts right in the summary, and open the original reply in the terminal with **View original reply**.
- Play 2048 while a summary is being written; choose when it is available in Settings → Understand · Review.

### Question and approval popups

<p align="center">
  <img src="docs/assets/readme/en/popup-permission.png" alt="Permission request popup" width="320">
  &nbsp;&nbsp;
  <img src="docs/assets/readme/en/popup-question.png" alt="Question popup" width="320">
</p>

When an AI asks for permission to run a command or needs an answer, a small window appears at the bottom right even while you work in another app. Allow, deny or pick an answer there; several questions are paged. A response is delivered only after it is matched to the original terminal and request.

### Terminals working together

An AI inside a Whitebox terminal can use the `whitebox` CLI or the panel MCP tools to open more AI terminals in the same panel, send requests to other terminals and wait for their replies. Inside Whitebox terminals, commands that open tmux or external terminal apps are blocked and pointed to the Whitebox tools.

### Settings

<p align="center">
  <img src="docs/assets/readme/en/settings.png" alt="Settings: General, Terminal, Understand · Review, Connections, Shortcuts" width="100%">
</p>

Settings has **General** (theme, language, input request alerts, app updates), **Terminal** (font, size), **Understand · Review** (automatic analysis, analysis service and model, 2048), **Connections** (Codex · Claude, Jev API key) and **Shortcuts**. The interface is available in 한국어, English and 简体中文. The app checks for new versions at startup and every 15 minutes.

## whitebox CLI

The `whitebox` command, from the npm launcher or bundled with the app, controls the app and its terminals.

```sh
whitebox                                        # open the desktop app
whitebox run claude                             # run an AI through the app bridge (claude | codex | gemini | grok)
whitebox new-terminal codex --count 3           # open 3 AI terminals in the same panel
whitebox list-panels                            # list terminals in the same panel
whitebox ask codex "find why the test fails"    # send a request to another terminal
whitebox wait <job-id>                          # wait for that request's actual reply
whitebox read-screen --surface <terminal-id>    # read a terminal's output
```

Run `whitebox --help` for every command. `run` and the panel commands need the Whitebox app to be open.

## Data and privacy

- Terminal output, requests and review records are stored only on your machine. Finished records are removed after 30 days by default; see [Data retention](docs/DATA-RETENTION.md) to change that.
- Understand · Review and Summary send the request and related work evidence to the analysis service you chose (Claude or Codex). This uses that AI account's quota, and automatic analysis can be turned off at any time.
- With Jev screening on, the request and related work records are sent to TypeSafe; it is not a local-only analysis. The Jev API key is kept in the main process's protected key store.
- Report security issues as described in [SECURITY.md](SECURITY.md).

## Development

You need Node.js 22 or newer and your platform's build tools for `node-pty` (Xcode Command Line Tools on macOS, Visual Studio Build Tools on Windows).

```sh
git clone https://github.com/minjund/Whitebox.git
cd Whitebox
npm ci
npm start
```

Main checks:

```sh
npm run check:source      # source rules
npm test                  # regression tests
npm run test:workspace    # workspace UI and terminal integration
npm run test:terminal     # terminal engine and PTY
```

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for the structure, [terminal-workspace.md](docs/terminal-workspace.md) for workspace behavior and [RELEASING.md](docs/RELEASING.md) for releases. Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

Whitebox is available under the [MIT License](LICENSE). Icon provenance and notices are in [ICON-LICENSE.md](docs/ICON-LICENSE.md).

---

<p align="center">
  Built for people who run more than one AI agent and still want to know exactly what each one is doing.
</p>
