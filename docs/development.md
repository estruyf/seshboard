# Development

Running Switchboard from source, testing it, and how the code is organised. See [PLAN.md](../PLAN.md) for the roadmap and design decisions, and [spike/FINDINGS.md](../spike/FINDINGS.md) for what the Phase 0 spike verified about the Agent SDK.

[← Back to the README](../README.md)

## Requirements

- macOS, Node 24+, npm 11+
- Claude Code installed and signed in (`claude` on your PATH)

On Windows 10 or 11 the same commands work, with [Git for Windows](https://gitforwindows.org) and PowerShell 7 recommended (Windows PowerShell 5.1 works). `node-pty` ships prebuilt binaries, so no Visual Studio build tools are needed. A few tests make symbolic links and are skipped unless Developer Mode is on (Settings › System › For developers). Run `npm run check` and `npm run smoke` on both platforms before a change goes in: see [Windows support](windows-support.md) for what differs.

## Commands

```bash
npm install
npm run dev        # Electron + Vite dev server with hot reload
npm run check      # typecheck every package + unit tests
npm run smoke      # build, launch, drive the UI, kill the engine once, verify it recovers
npm run build      # production bundles in apps/desktop/out
npm run icon -w @switchboard/desktop   # regenerate the app icon from its SVG
npm run dist       # package Switchboard.app and a .dmg (signed when a Developer ID is available)
npm run dist:notarized   # sign, notarise and staple
npm run smoke:packaged   # run the smoke test against the packaged app
npm run dev:vscode       # rebuild the VS Code companion on every change
npm run build:vscode     # build it once (apps/vscode-extension/dist)
npm run package:vscode   # a .vsix in apps/vscode-extension
```

To run the VS Code companion, open the repository in VS Code and press F5 (**Run Extension**): it starts the *Watch extension* task (bundle and typecheck) and opens this repository in an Extension Development Host. See [VS Code companion](vscode-companion.md#developing-the-extension).

Packaging and signing are covered in [Building, signing and notarisation](building-and-signing.md).

### Next to the installed app

Development builds (`npm run dev`, `npm start`) keep their data in `~/Library/Application Support/Switchboard Dev` instead of the installed app's `Switchboard` folder. They have their own single-instance lock and their own database, so a dev build runs side by side with the installed app, and its migrations never touch the installed app's cache or your saved choices. The first launch copies the installed app's `preferences.json`. To run a second dev build at the same time (another worktree), give it its own folder:

```bash
SWITCHBOARD_DATA_DIR="$HOME/Library/Application Support/Switchboard Dev 2" npm run dev
```

## Tests

`npm run check` runs the TypeScript checks and the unit tests (Vitest).

`npm run smoke` launches the real app with a throwaway profile and drives it. It checks:

- startup time and the first session list
- the transcript, and that it opens scrolled to the end
- summarised tool activity, the Changes panel (read-only), search (⌘⇧F), the command palette (⌘K, ⌘⇧P and ⌘P, its modes, and New session up to the prompt without starting anything; ⌘K in the terminal clears it), the Tools window and two panes side by side
- the ⌘Q prompt, Settings (theme, sidebar style, tool activity, quit prompt), the terminal, project actions and syntax highlighting
- the app's own controls: resizing the sidebar, the themed dropdowns (keyboard and Escape), tooltips and pointer cursors
- the drop target on the message box while files are dragged over a session: images to attach, other files to mention (synthetic drag events, nothing is dropped)
- the usage band
- recovery after the engine process is killed

Each check is a step run by `SmokeRun` (`apps/desktop/src/main/smokeRunner.ts`): it is timed, a throw becomes a failed result, and a dialog or menu the step left open is closed before the next one. A step has 30 seconds; one that takes longer stops the run, and the steps after it are reported as not run, instead of failing one by one on a page in an unknown state. The output lists every step with its time and the slowest ones. The page runs with Chromium's focus emulation, so it behaves as the focused window (toasts count down, focus moves as with a person at the keyboard) even when macOS keeps the window in the background; you can keep working while it runs. When you add a step, wait for something on the page (`waitInPage`, or `settle` for an animation to finish) rather than for a fixed time: `shot` already settles before it takes a picture.

Screenshots and `result.json` go to `apps/desktop/.smoke`. Set `SWITCHBOARD_COLOR_SCHEME=light` or `dark` to force a colour scheme for a run without saving it.

### README screenshots

```bash
npm run screenshots
```

Builds the app and takes the screenshots in the README, in light and dark mode, into `docs/screenshots`. It runs against a made-up home folder (`apps/desktop/scripts/screenshot-demo.ts`): a few small git projects, their Claude Code sessions, and two sleeping processes in the live registry that stand in for sessions working and waiting in a terminal. `HOME` and `CLAUDE_CONFIG_DIR` both point there, so your own projects and transcripts never show up, and Claude Code finds no login, so nothing is sent. `apps/desktop/src/main/screenshotTour.ts` walks through the views; `scripts/screenshot-frame.mjs` puts each one in a window frame on a backdrop. The unframed captures stay in `apps/desktop/.screenshots`.

Run it again after a visible UI change, and always before a release (it is a step in [Releasing](building-and-signing.md#releasing-automated-in-github-actions)). The tour waits for each view's `data-` hooks and fails when one is gone, so a failing run means the tour is out of date with the UI. To add a view, add a step to the tour and the image to the README.

From VS Code's terminal it needs Node 24 on the PATH (the script itself unsets `ELECTRON_RUN_AS_NODE` for Electron).

Tests that call the real Claude Code (a few cents of Haiku each) are opt-in and need a throwaway git repo:

```bash
SWITCHBOARD_LIVE_CWD=/path/to/throwaway-repo npx vitest run claude.live
SWITCHBOARD_SMOKE_LIVE_CWD=/path/to/throwaway-repo npm run smoke
```

The live smoke step drives the real window. It starts a session in that folder, attaches an image, approves a permission prompt, waits for the reply, runs a `/` command, checks the live Tools window, previews undoing file changes, forks from the reply, opens the Claude Code terminal tab and deletes the session. It refuses to submit if the folder field shows anything else.

## Layout

| Path | What it is |
|---|---|
| `apps/desktop` | Electron main process, preload, and the engine utilityProcess entry |
| `apps/ui` | React 19 renderer |
| `packages/engine` | The engine: plain Node, no Electron imports. Cache DB and search index, Claude Code sessions, git, terminals, project actions, usage |
| `packages/protocol` | zod contract + typed RPC over MessagePorts, shared by engine and UI |
| `apps/vscode-extension` | The VS Code companion, which talks to the engine over a Unix socket. See [VS Code companion](vscode-companion.md) |
| `spike/` | Phase 0 throwaway experiments against the Agent SDK |
| `docs/` | These pages |

`@switchboard/protocol` has four main entry points:

- `.` has everything, including the zod schemas. The engine uses it.
- `./client` is the RPC client only, so the renderer bundle stays free of zod.
- `./bridge` holds the IPC constants and preferences types for main and preload.
- `./companion-client` is the VS Code companion's: its RPC client, the line transport for the socket and the companion contract's types, without zod.

## Preferences

Main keeps the app's preferences (theme, sidebar style, quit prompt) in `preferences.json` in the app's data folder (`~/Library/Application Support/Switchboard`, or `Switchboard Dev` for a development build). The preload reads them synchronously at page load, so the first paint already has the right theme and layout. Changes go through main, which saves them and broadcasts them to every window.

The colours are the [Demo Time theme](https://github.com/estruyf/vscode-demo-time-theme)'s, as CSS variables in [`apps/ui/src/styles.css`](../apps/ui/src/styles.css). Code blocks use its syntax colours from [`apps/ui/src/lib/themes`](../apps/ui/src/lib/themes).

## App icon

The icon is a patch panel with two cables hanging between its jacks. Its source is [`apps/desktop/build/icon.svg`](../apps/desktop/build/icon.svg). Edit that, then run `npm run icon -w @switchboard/desktop` to regenerate:

| File | Used for |
|---|---|
| `apps/desktop/build/icon.png` | 1024×1024; the Dock icon while developing, and the About panel |
| `apps/desktop/build/icon.icns` | Every macOS size, for the packaged app |
| `apps/ui/src/assets/app-icon.png` | 64×64, without the macOS margin, for the sidebar header |

The SVG is rendered with Electron (Chromium), and the `.icns` is built with macOS's `sips` and `iconutil`, so nothing extra needs installing.
