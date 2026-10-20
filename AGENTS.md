# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Copilot and others) working on Switchboard, a macOS desktop app (that runs on Windows too, see [docs/windows-support.md](docs/windows-support.md)) for managing Claude Code sessions. People should start with [README.md](README.md); the design and roadmap are in [PLAN.md](PLAN.md).

## Architecture

Switchboard is an Electron app in four npm workspaces, plus its VS Code companion extension, its website and the remote app for phones:

| Path | What it is | Rules |
|---|---|---|
| `packages/protocol` | zod contract and typed RPC over MessagePorts | The single source of truth for every request and event. Entry points: `.` (with zod, for the engine), `./client` (types and RPC client only, no zod, for the renderer), `./bridge` (IPC channels and preferences, plain TypeScript, for main and preload), `./companion-client` (the VS Code extension's client and socket transport, no zod). |
| `packages/engine` | Plain Node; runs in an Electron `utilityProcess` | **No Electron imports.** Owns the SQLite cache, the session index and search, Claude Code processes (through the Agent SDK), git, terminals, project actions and usage. |
| `apps/desktop` | Electron main process, preload, and the engine entry | Main does what needs Electron: windows, menus, dialogs, notifications, the Trash, preferences. The preload is sandboxed and exposes `window.switchboard`. |
| `apps/ui` | React 19 renderer, Tailwind 4, zustand | Talks to the engine only through the RPC client, and to main only through `window.switchboard`. |
| `website` | The website and docs (Astro + Starlight), published to GitHub Pages by `website.yml` | Pages are MDX in `website/src/content/docs/`. Colours come from the app's `--sb-*` tokens (`website/src/styles/switchboard.css`); keys use `<Kbd shortcut="…">` from the shortcuts registry, which renders them for macOS and Windows (the reader picks in the header), and `<Os>`/`<OnlyOn>` hold words and passages that differ by platform. Every feature is listed in `website/src/content/features.json`, which a test checks against the palette commands, shortcuts, Settings sections and project tabs. |
| `apps/remote` | The remote app (React, Tailwind), built into the website at `/remote/` | A paired phone's view of the sessions, over an end-to-end encrypted channel through a tunnel ([docs/remote-access.md](docs/remote-access.md)). Talks to the engine only through `@switchboard/protocol/remote-client` (no zod) and the remote contract, never the app's. Transcripts are rendered as text, never HTML. Pure logic (links, transcript merging, the layout's breakpoints, the thresholds of swipes, the drawer and pull to refresh) lives in `src/lib` with tests next to it. Overlays the back gesture closes (sheets, the sessions drawer) go through `useOverlayHistory`. |
| `apps/vscode-extension` | The VS Code companion, bundled with esbuild into `dist/extension.cjs` | Talks to the engine only over its Unix socket (`packages/engine/src/companion/`), through `@switchboard/protocol/companion-client` (no zod). Pure logic (payloads, exclusions, discovery, which session) lives in modules without `vscode` imports, with tests next to them. Released on its own (`release-vscode.yml`, tags `vscode-vX.Y.Z`); see [docs/vscode-companion.md](docs/vscode-companion.md). |

The path of a feature is usually: add the request or event to `packages/protocol/src/contract.ts`, handle it in `packages/engine/src/engine.ts` (logic in a module next to it), and call it from the UI with `client.call(...)` / `client.on(...)`.

### Claude Code

- Sessions run through `@anthropic-ai/claude-agent-sdk` (pinned), using the user's own `claude` binary and login. Only `packages/engine/src/host/sessionHost.ts` and `hostManager.ts` drive `query()`, plus one documented exception: `usageMonitor.ts`, whose helper sends `/usage` (see below). Keep it that way.
- Read transcripts through the SDK (`listSessions`, `getSessionMessages`, `forkSession`, …) in `packages/engine/src/claude/sessionSource.ts`. Parse Claude Code's on-disk formats only where the SDK has no answer (the live registry in `~/.claude/sessions`, `agent-*.meta.json`, `installed_plugins.json`), and degrade quietly when a format changes.
- Short-lived helper processes (command lists, Tools) never get a prompt. Two exceptions: the usage helper sends the local `/usage` command, which uses no tokens, and Ask about this session (`HostManager.askAbout`) sends the question to a fork of the session, behind a read-only PreToolUse hook, and records its tokens itself. All of them use `persistSession: false` and register their ids as ephemeral so they don't show up as sessions.
- The SDK can throw asynchronously after interrupts: every session is wrapped so one failing session can't take the engine down.
- **Claude profiles** (`packages/engine/src/profiles/`): each is a config folder with its own login. Anything that starts Claude Code gets the profile's environment (`envFor` in `engine.ts`); never set `CLAUDE_CONFIG_DIR` for the built-in profile. The SDK's transcript readers only read `process.env.CLAUDE_CONFIG_DIR`, so they go through `ConfigDirLane`; don't call them around it.

## Commands

```bash
npm install
npm run dev          # Electron + Vite with hot reload
npm run check        # typecheck every package + unit tests (Vitest)
npm run smoke        # build, launch the real app with a throwaway profile, drive the UI
npm run smoke -- --only "pop-out"   # the same, but only the steps whose label matches (repeat --only for more)
npm run screenshots  # retake the README screenshots in a made-up demo home folder
npm run dev:vscode   # rebuild the VS Code companion on every change (F5 in VS Code runs it in a dev host)
npm run dev:remote   # the remote app at http://localhost:5199/remote/ (start the app with SWITCHBOARD_REMOTE_APP_URL set to it)
npm run website:dev  # the website and docs with hot reload
npm run website:build          # build the website; fails on a broken internal link
npm run website:screenshots    # retake the website's screenshots in a made-up demo home folder
npm run chaos -- --phase repro # chaos testing in a sandbox (macOS; docs/chaos-testing.md)
npm run dist         # package the app for this OS: Switchboard.app and a .dmg, or the Windows installer
```

`npm run check` and, after UI or engine changes, the full `npm run smoke` must pass before you report work as done. While you build, run the cheap checks instead (see Working on a feature).

## Working on a feature

Most of the time in a feature goes into rerunning slow checks and re-reading the same code. Keep each run small:

- **Check only what you touched while you build.** After a change, run the tests next to it (`npx vitest run <files>`) and `npm run typecheck` (or one workspace's: `npm run typecheck -w @switchboard/ui`). Run the smoke steps for your area with `npm run smoke -- --only "<part of the step label>"` (the labels are the `step(...)` lines in `runSmokeStep`; repeat `--only` for more, and steps inside "projects" run with it). Leave the full `npm run check` and the full `npm run smoke` for the end of the feature, once each.
- **The full smoke belongs in a terminal with no Claude session in this repository.** Started from Claude Code, some steps fail by design: the agent's own session and its folder are off limits to them (see Smoke test), and the script says so. Don't look into those failures; rerun from a plain terminal, or with `--only` for the steps you changed.
- **One agent per feature.** An agent that already read this file and the code it needs keeps that: continue it (SendMessage) for the next step instead of starting a fresh one, which reads everything again.
- **Small specs.** Split a spec that is several features (a view, its actions, its sidebar entry) into a core that ships first and follow-ups. Each run stays short and is less likely to hit a rate limit.
- **Features side by side** go in their own git worktree (the Agent tool's `isolation: "worktree"`). A new worktree has no `node_modules` of its own and would resolve packages from the main checkout, on another branch: run `npm install` in it first (if npm skips install scripts, run `node node_modules/electron/install.js` for Electron). Full smoke runs take turns; use `--only` in each worktree.
- **Node 24 or later** (`engines`). If `node -v` says otherwise, put a newer Node first on the `PATH` (on a Mac with Homebrew, `/opt/homebrew/bin`).
- **Docs and screenshots wait for the release** ([docs/releasing.md](docs/releasing.md)). Per feature, add its `CHANGELOG.md` line and its `website/src/content/features.json` entry (`npm run check` needs it); the pages and screenshots are written at release time.
- **Read the detail only for your area**: [docs/ui-patterns.md](docs/ui-patterns.md) for the UI (see Design system, Per area), and the subsystem docs in `docs/` (remote access, session linking, mods, themes, Windows) when you change that subsystem.

## Conventions

- **TypeScript strict, ESM, Node 24+.** Files import each other with explicit `.ts`/`.tsx` extensions. There is no formatter or linter: match the surrounding code (2-space indent, single quotes, semicolons, long lines are fine).
- **Comments** explain why, in plain sentences, at the density of the surrounding code. JSDoc on exported functions and on non-obvious fields.
- **Testable logic lives in pure modules.** Unit tests must not import modules that touch `window` or `localStorage` at load time; put pure helpers in their own file (see `toolSummary.ts`, `agentRuns.ts`, `lib/fuzzy.ts`, `lib/unifiedDiff.ts`). Tests sit next to the code (`*.test.ts`).
- **Engine tests** use real temporary directories, real git repositories and a real SQLite file, not mocks. The SDK is injected (`SdkRuntime`), so host tests fake Claude Code.
- **macOS and Windows.** Code that differs per platform goes through one helper for each question, never a path or key written for macOS:
  - paths: `isAbsolutePath`, `isSameOrInside`, `pathInside`, `joinPath` (`packages/protocol/src/paths.ts`) and `basename` (`apps/ui/src/lib/format.ts`), never `split('/')` or `startsWith('/')`; the zod `AbsolutePath` takes only this platform's form;
  - the shell: `userShell()` (`packages/engine/src/system/shell.ts`), for the file, its arguments, `quote` and `sequence`;
  - starting a `.cmd`: `viaCmd()` (`system/windowsCommand.ts`);
  - keys: `mod` in the registry, `modKey(event)` in handlers;
  - wording: `fileManagerName()` and `trashName()` (`apps/ui/src/lib/platform.ts`).

  Pure helpers take the platform as a parameter, so the macOS tests run on Windows and the other way round.
- **Schema changes** go through a new migration appended to `packages/engine/src/db/migrations.ts`. The cache is derived from `~/.claude` and may be dropped and rebuilt; `owned_sessions`, `session_flags`, `project_settings` and `project_actions` hold user choices and must survive.

### UI

- **Colours only through theme tokens** (Demo Time's values in `apps/ui/src/styles.css`, overridden by the active theme): `bg`, `sidebar`, `card`, `border`, `edge` (a border that stays visible on dialogs and popovers, for fields, chips and cards inside them), `text`, `muted`, `faint`, `ok`, `warn`, `error`, `link`, and three accents:
  - `accent` is the yellow fill (buttons, tints such as `bg-accent/15`);
  - `accent-ink` is the readable accent for text, icons, dots, spinners and borders (dark mustard in light mode);
  - `on-accent` is text on a yellow fill. Never put `text-white` on `bg-accent`.
  - `profile-<colour>` (yellow, blue, green, purple, red, orange, gray) tells Claude profiles apart; use it through `PROFILE_DOT` / `PROFILE_TEXT` in `components/profiles/ProfileBadge.tsx`.
  - `remote` (violet, `#b197fc` dark, `#7048e8` light; 4.5:1 on `bg`, `sidebar` and `card`) is only for things on another computer: `ComputerChip`, the badge on `ProjectIcon`, the line over a remote session. No state uses violet, so it never reads as needs you, working or unread.
  - `code` (`code-bg`) is the background of code blocks, tool output and diffs; `diff-added` / `diff-removed` are the line tints in diffs. `focus-ring` is the keyboard focus outline.
- **Themes** (`docs/themes.md`) replace every token: a theme is a JSON file validated in `packages/protocol/src/theme.ts`, resolved in `apps/ui/src/lib/themeResolve.ts` (generating what it leaves out, `themeGenerate.ts`) and applied as one generated `<style>` (`themeCss.ts`). So never hard-code a colour or assume Demo Time's: a new colour need is a new token, added to `THEME_TOKENS`, `styles.css`, `demo-time.json`, the generator and docs/themes.md in the same change. Built-in themes are in `apps/ui/src/themes/`; imported ones live in main (`apps/desktop/src/main/themes.ts`).
- **Both light and dark mode** must work; the Settings smoke step switches between them.
- **Narrow panes:** the session view is an `@container`; use `@max-[860px]:` variants to compact headers and bars (sessions side by side in split view).
- **Form controls and tooltips** come from `apps/ui/src/components/ui/`: `Select` (not `<select>`), `Checkbox`, `Radio`/`RadioGroup`, `Switch`/`Toggle`, `Choice`, `Slider` (a themed range, such as the sound volume, that reports its value once it is let go). `Select` takes `onHighlight` to preview the option under the pointer or the keys (Settings › Notifications plays the sound). `npm run check` fails on a native `<select>`, checkbox or radio elsewhere. For a tooltip, put `data-tooltip="…"` on the element (the `TooltipLayer` shows it) instead of `title`, and give icon-only buttons an `aria-label` too.
- **Dialogs** use `role="dialog"` / `role="alertdialog"` and close on Escape. Escape in the message box stops Claude, except while a dialog, menu, listbox or popover is open; keep new overlays inside those roles.
- **Long lists are virtualised** (`@tanstack/react-virtual`): rows outside the viewport aren't in the DOM.
- **Command palette** (`components/palette/`): every command is one entry in the registry in `commands.ts` (`id`, `title`, `group`, `keywords`, `shortcut`, `when(ctx)`, and `run`, `next` for a step that asks for more, or `mode`). `when()` reads only the `PaletteContext` (built from the stores in `usePaletteContext.ts`); a command whose `when()` is false is left out, never shown disabled. `run` goes through `PaletteApi` (`paletteApi.ts`). A command that opens a dialog or menu another view owns sends a request through `state/paletteBus.ts` (`useSessionRequests` in the session view); dialogs that outlive the palette are in `PaletteDialogs.tsx`. New features that people run add a command there. Starting a new session, anywhere, goes through `startNewSession` (`newSession/startSession.ts`).
- **Keyboard shortcuts** live in one registry, `SHORTCUTS` in `apps/ui/src/lib/shortcuts.ts`: `id`, `keys` (stored form, `mod` for ⌘ on macOS and Ctrl elsewhere; `mod+1..9` a range, `mod+q mod+q` a sequence, `alt+click` a click), `action`, `section`, `context`, `note`, `when(ctx)` and `where` (the focus it needs). Handlers check `matches(event, id)`; buttons take `shortcut="terminal.toggle"` (or `kbd={keysFor(id)}`), palette commands `shortcut: keysFor(id)`, and text uses `formatKeys(keysFor(id))`. Never write a key out by hand (glyphs typed for a `kbd` or a menu `hint` go through `localizeKeys`, and handlers that check keys themselves use `modKey(event)`, never `metaKey`): `reservedShortcuts()` (the keys project actions can't take), the shortcuts sheet (⌘/, `components/shortcuts/`) and the README table are built from the registry. After changing it, run `npm run docs:shortcuts`; a test fails while the README is out of date, and another when two shortcuts share keys where both work (add an intended overlap to `INTENDED_OVERLAPS` in `shortcuts.test.ts`, with the reason).
- **Preferences** (theme, sidebar style, tool activity, quit prompt) live in main (`apps/desktop/src/main/preferences.ts`); the preload reads them synchronously so the first paint is right. Add new ones to `Preferences` in `packages/protocol/src/bridge.ts`.

### Design system

Every screen follows the same few rules. New UI uses them; don't invent new sizes, colours or patterns for a single spot.

**Type scale.** Four sizes (plus one hero size), as Tailwind tokens from `styles.css`. Use these instead of `text-[12.5px]`-style arbitrary values:

| Token | Size | For |
|---|---|---|
| `text-meta` | 11px | ages, branches, counts, usage, hints under a control |
| `text-ui` | 12px | buttons, chips, menus, list rows, form fields |
| `text-body` | 13.5px | messages in the conversation, the message box, session titles in the sidebar |
| `text-title` | 15px | view and dialog titles (`font-semibold`) |
| `text-hero` | 20px | only the single heading of a focused view (Home, New session) |
| `text-display` | 34px | a headline number in a stat card (the Usage view's % left and total tokens), never a heading |

Monospace (`font-mono`) is for paths, commands, branches in menus and diffs, at `text-ui` or `text-meta`.

**Status colours.** Each colour means one thing, everywhere: the sidebar, headers, cards and notifications.

| State | Token | Shape |
|---|---|---|
| Needs you (a permission or a question) | `warn` (pink) | 3px rail on the row, pulsing dot, pink frame on the card |
| Working | `accent-ink` (yellow) | rail, spinner or the three working dots |
| Running in the background | `ok` (green) | slow spinner |
| Finished, unread | `unread` (blue) | rail and dot, bold title |
| Failed | `error` | `!` badge |
| Idle | `faint` | no rail |

With more than one Claude profile, the rail on a session row shows the profile's colour instead (`PROFILE_DOT`), on every row; the status then shows through the age's colour, the bold title and the group. Yellow is never used for "unread". Green, orange (`caution`) and red (`error`) are only for levels: use `levelOf()` and `LEVEL_FILL` / `LEVEL_TEXT` / `LEVEL_COLOR` from `lib/levels.ts` (green under 60%, orange to 85%, red from 85%) for usage bars, the context ring and anything else that fills up.

**Selection and hover.** A selected row is `bg-selected` (a neutral fill) plus its status rail; hover is `hover:bg-border/45`. Don't use `bg-accent/15` for selection: it vanishes on the light sidebar. A yellow tint is fine for a pressed toggle or a highlighted menu option.

**Buttons.** One primary action per area, as a yellow fill (`bg-accent text-on-accent font-semibold`, 28px high in toolbars, 30-32px in cards and the message box). A secondary action next to it (Cancel, Close, Choose…) is the `btn-secondary` utility: a bordered button that stays visible on dialogs and popovers. Never a bare text link, and not `border border-border`, which disappears on overlay surfaces. Toolbar icons and inline controls are quiet: `text-muted`, `hover:bg-border/50 hover:text-text`. Related toggles sit together in one segmented control (see Changes | Terminal in the session header). Put actions people use less often in the `⋯` menu rather than adding another icon. Things people run all the time stay one click away: project actions are pills above the message box (the first three, then "N more"; icon only in a narrow pane), and every action is also in the `⋯` menu.

**Keyboard first.** Every primary action has a shortcut, and the button shows it in a `<kbd>` (`⌘↵`, `Esc`, `⌘1`). Choices in a list can be picked with number keys.

**Components.** Use the ones in `components/ui/` (`Button`, `Kbd`, `Pill`, `Meter`, `Dialog`, `ConfirmDialog`, `SplitButton`, `SegmentedControl`, `Notice`, `SectionHeader`, `Stepper`, form controls) instead of writing their class strings by hand; `npm run check` fails on a hand-written `btn-secondary`, raw `<kbd>`, `bg-scrim` or `role="radiogroup"` outside `components/ui/`. `className` is for layout; to change a component's look, change the component. Variants, sizes and props: [docs/ui-patterns.md](docs/ui-patterns.md#components).

**Surfaces and borders.** Cards (`rounded-xl border border-border bg-card`) are for things that need a decision or hold input: your prompt, a plan, a permission or question card, the message box. Tool runs, agent reports and to-do lists in the conversation are a quiet timeline without borders. Floating things (menus, popovers, dialogs, sheets) use the `overlay` utility. A picked project shows in its own colour (`useProjectColor` in `components/ProjectIcon.tsx`, the colour of its icon): in New session, its tile's border and the message box's frame, with a faint 4px ring.

**Layout.** Group lists by what needs attention first (Needs you, Working), then by time (Today, Yesterday, Earlier). Centre focused views (New session, Home) in the window with a `max-w-3xl` column. Side panels that show content (Changes, terminal) can be resized by dragging, and from the keyboard. The terminal panel is always dark (`theme-dark` on its root, which swaps every token to the dark theme), in light mode too, on `bg-terminal` (darker than the conversation) with `terminal-edge-top`/`terminal-edge-left` for its shadow. It docks below or on the right (`effectiveDock` in `terminal/terminalLayout.ts`: below while Changes holds the right or the view is too narrow). Outside a session, ⌘J opens the window's own terminal (`AppTerminalFrame`, keyed `APP_TERMINAL` in the terminals store, engine terminals without a session), shared by Home, project pages, Projects, Usage, New session and Settings (it docks next to the Settings sheet, which covers only the view); `terminalOwner` (`terminal/appTerminal.ts`) says whose panel a key or palette command works on. Never float controls over xterm: put them in the panel's layout, before the terminal in the DOM, because xterm keeps Tab for the shell (see the action run strip).

**Copy.** Plain, short sentences. Say what something does ("Allow", "Start session"), not how. No em dashes.

**Per area.** The detailed rules for these parts of the UI are in [docs/ui-patterns.md](docs/ui-patterns.md). Open the section when you change that area:

- [Components](docs/ui-patterns.md#components): variants, sizes and props of `Button`, `Kbd`, `KeyCombo`, `Pill`, `Meter`, `SplitButton`, `Dialog`, `ConfirmDialog`, `Stepper`, `SegmentedControl`, `Notice`, `SectionHeader`.
- [Message box chips](docs/ui-patterns.md#message-box-chips): the profile, model, effort and mode chips under the message box.
- [Pasted text](docs/ui-patterns.md#pasted-text): a long paste as a card in the context tray.
- [A message back in the box](docs/ui-patterns.md#a-message-back-in-the-box): Edit in Up next, Undo after Remove: restoring a message as it was written.
- [Ask about this session](docs/ui-patterns.md#ask-about-this-session): the Ask panel and `/btw`, never part of the conversation.
- [Catch-up](docs/ui-patterns.md#catch-up): the briefing banner and strip on a finished turn.
- [Sidebar states](docs/ui-patterns.md#sidebar-states): open, minimal and closed sidebar, its widths and keys.
- [Split view](docs/ui-patterns.md#split-view): the tiling pane tree, drag and drop, dividers, pane keys.
- [Collapsible sections and the queue](docs/ui-patterns.md#collapsible-sections-and-the-queue): sidebar section headers, Up next.
- [Unsent messages](docs/ui-patterns.md#unsent-messages): the draft pen on rows and buttons.
- [Saved prompts](docs/ui-patterns.md#saved-prompts): `{{blanks}}`, the / picker, sharing.
- [Other computers](docs/ui-patterns.md#other-computers): a paired computer's sessions in the sidebar, the violet `remote` token.
- [Back and forward](docs/ui-patterns.md#back-and-forward): the mouse's back and forward buttons, `navHistoryStore`.
- [Settings search](docs/ui-patterns.md#settings-search): `settingsIndex.ts`, what search finds and how a result opens.
- [Claude Code mods](docs/ui-patterns.md#claude-code-mods): `ModFrame`, bands, panes, status, toasts.
- [Charts](docs/ui-patterns.md#charts): the Usage view's `chart-*` tokens, axes, tooltips.
- [Project page and tables](docs/ui-patterns.md#project-page-and-tables): a project's page, its tabs and tables.
- [Context menus and confirmations](docs/ui-patterns.md#context-menus-and-confirmations): right-click menus, Shift+F10, what asks before acting.

The design mockups these rules come from are in the Switchboard UI suggestions canvas; when a new view needs a pattern that isn't here, add it to docs/ui-patterns.md (or, if every change must follow it, to this section) in the same change.

### Smoke test

`apps/desktop/src/main/index.ts` holds the smoke steps (`run…Step` functions); `runSmokeStep` runs each through `smokeRun.step(label, …)` (`smokeRunner.ts`: timed, 30s limit, cleaned up after), and `apps/desktop/scripts/smoke.ts` prints their results and times. A new step is one `step(...)` line there, returning `ok: …` or what went wrong; `npm run smoke -- --only "<label>"` runs it with the two steps that open the session (`always: true`) and nothing else. A step that needs an earlier one's state says so in a comment, so `--only` can name both. Wait for conditions (`waitInPage`, `until`, `settle`), never for a fixed time, except to show that something did *not* happen. Steps find elements by `data-*` attributes, so give new UI a `data-` hook when you add it. Steps must be **read-only on real data**: the app runs against the user's real `~/.claude` and projects, with a throwaway app profile. Never stage, revert, delete or send anything outside the sandbox. Never type into, or run anything in the folder of, a session that is running in Claude Code right now (often the agent's own session, which started the run): steps that pick a session skip `runningSessions()`, and the one whose folder later steps use also skips sessions in a running session's folder or inside it (`inRunningFolder`).

### Live tests (real Claude Code, costs a little)

Opt-in and only in a throwaway git repository:

```bash
SWITCHBOARD_LIVE_CWD=/path/to/throwaway-repo npx vitest run claude.live
SWITCHBOARD_SMOKE_LIVE_CWD=/path/to/throwaway-repo npm run smoke
```

**Never point these at a real project.** The live smoke step refuses to submit unless the folder field shows the sandbox; keep that guard.

## Documentation

- `README.md` is for people using the app: what it does, how to install it, shortcuts, settings. No implementation details.
- Technical material goes in `docs/` (`development.md`, `building-and-signing.md`, `project-actions.md`) and is linked from the README.
- Update `PLAN.md` when a phase or roadmap item changes status.
- The website (`website/`) documents every feature for people using the app. A change people can see gets its `features.json` entry with the change; its page and screenshots are updated before the release (the [docs checklist](docs/releasing.md#docs-checklist)).
- Keep `CHANGELOG.md` up to date: when a change is visible to people using the app, add a line to the `## [Unreleased]` section at the top (create it if it's missing), written for them, not about the implementation. At release time that section becomes `## [X.Y.Z] - YYYY-MM-DD` (see Releases).

## Releases

### Branches

- **`dev`**: where work lands, by commit or pull request. Betas are tagged here.
- **`main`**: what is released, nothing else. It only moves when a release is merged into it (or for a hotfix), and the website deploys from it, so the docs go live with the release that has the feature.

The release workflow fails when a release is tagged off `main` or a beta off `dev` (`.github/scripts/release-branch.sh`).

### Release

The steps to prepare and publish a release, a hotfix or a beta, the release workflow, the VS Code companion's release and the docs checklist are in [docs/releasing.md](docs/releasing.md). Read it only when the user asks for a release.

## Safety

- Commit, push, tag or publish only when the user asks.
- Never handle passwords, certificates or app-specific passwords, and never change keychain or system settings. The user runs `notarytool store-credentials` and adds CI secrets themselves.
- Deleting is always to the Trash (`shell.trashItem` in main), guarded by `apps/desktop/src/main/trashGuard.ts`: session files only, or new files inside a git repository for a revert.
