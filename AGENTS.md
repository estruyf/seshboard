# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Copilot and others) working on Switchboard, a macOS desktop app (that runs on Windows too, see [docs/windows-support.md](docs/windows-support.md)) for managing Claude Code sessions. People should start with [README.md](README.md); the design and roadmap are in [PLAN.md](PLAN.md).

## Architecture

Switchboard is an Electron app in four npm workspaces, plus its VS Code companion extension:

| Path | What it is | Rules |
|---|---|---|
| `packages/protocol` | zod contract and typed RPC over MessagePorts | The single source of truth for every request and event. Entry points: `.` (with zod, for the engine), `./client` (types and RPC client only, no zod, for the renderer), `./bridge` (IPC channels and preferences, plain TypeScript, for main and preload), `./companion-client` (the VS Code extension's client and socket transport, no zod). |
| `packages/engine` | Plain Node; runs in an Electron `utilityProcess` | **No Electron imports.** Owns the SQLite cache, the session index and search, Claude Code processes (through the Agent SDK), git, terminals, project actions and usage. |
| `apps/desktop` | Electron main process, preload, and the engine entry | Main does what needs Electron: windows, menus, dialogs, notifications, the Trash, preferences. The preload is sandboxed and exposes `window.switchboard`. |
| `apps/ui` | React 19 renderer, Tailwind 4, zustand | Talks to the engine only through the RPC client, and to main only through `window.switchboard`. |
| `apps/vscode-extension` | The VS Code companion, bundled with esbuild into `dist/extension.cjs` | Talks to the engine only over its Unix socket (`packages/engine/src/companion/`), through `@switchboard/protocol/companion-client` (no zod). Pure logic (payloads, exclusions, discovery, which session) lives in modules without `vscode` imports, with tests next to them. Released on its own (`release-vscode.yml`, tags `vscode-vX.Y.Z`); see [docs/vscode-companion.md](docs/vscode-companion.md). |

The path of a feature is usually: add the request or event to `packages/protocol/src/contract.ts`, handle it in `packages/engine/src/engine.ts` (logic in a module next to it), and call it from the UI with `client.call(...)` / `client.on(...)`.

### Claude Code

- Sessions run through `@anthropic-ai/claude-agent-sdk` (pinned), using the user's own `claude` binary and login. Only `packages/engine/src/host/sessionHost.ts` and `hostManager.ts` drive `query()`, plus one documented exception: `usageMonitor.ts`, whose helper sends `/usage` (see below). Keep it that way.
- Read transcripts through the SDK (`listSessions`, `getSessionMessages`, `forkSession`, …) in `packages/engine/src/claude/sessionSource.ts`. Parse Claude Code's on-disk formats only where the SDK has no answer (the live registry in `~/.claude/sessions`, `agent-*.meta.json`, `installed_plugins.json`), and degrade quietly when a format changes.
- Short-lived helper processes (command lists, Tools) never get a prompt. The usage helper is the one exception: it sends the local `/usage` command, which uses no tokens. All of them use `persistSession: false` and register their ids as ephemeral so they don't show up as sessions.
- The SDK can throw asynchronously after interrupts: every session is wrapped so one failing session can't take the engine down.
- **Claude profiles** (`packages/engine/src/profiles/`): each is a config folder with its own login. Anything that starts Claude Code gets the profile's environment (`envFor` in `engine.ts`); never set `CLAUDE_CONFIG_DIR` for the built-in profile. The SDK's transcript readers only read `process.env.CLAUDE_CONFIG_DIR`, so they go through `ConfigDirLane`; don't call them around it.

## Commands

```bash
npm install
npm run dev          # Electron + Vite with hot reload
npm run check        # typecheck every package + unit tests (Vitest)
npm run smoke        # build, launch the real app with a throwaway profile, drive the UI
npm run screenshots  # retake the README screenshots in a made-up demo home folder
npm run dev:vscode   # rebuild the VS Code companion on every change (F5 in VS Code runs it in a dev host)
npm run dist         # package the app for this OS: Switchboard.app and a .dmg, or the Windows installer
```

Run `npm run check` after every change, and `npm run smoke` after UI or engine changes. Both must pass before you report work as done.

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
  - `code` (`code-bg`) is the background of code blocks, tool output and diffs; `diff-added` / `diff-removed` are the line tints in diffs. `focus-ring` is the keyboard focus outline.
- **Themes** (`docs/themes.md`) replace every token: a theme is a JSON file validated in `packages/protocol/src/theme.ts`, resolved in `apps/ui/src/lib/themeResolve.ts` (generating what it leaves out, `themeGenerate.ts`) and applied as one generated `<style>` (`themeCss.ts`). So never hard-code a colour or assume Demo Time's: a new colour need is a new token, added to `THEME_TOKENS`, `styles.css`, `demo-time.json`, the generator and docs/themes.md in the same change. Built-in themes are in `apps/ui/src/themes/`; imported ones live in main (`apps/desktop/src/main/themes.ts`).
- **Both light and dark mode** must work; the Settings smoke step switches between them.
- **Narrow panes:** the session view is an `@container`; use `@max-[860px]:` variants to compact headers and bars (two sessions side by side).
- **Form controls and tooltips** come from `apps/ui/src/components/ui/`: `Select` (not `<select>`), `Checkbox`, `Radio`/`RadioGroup`, `Switch`/`Toggle`, `Choice`. `npm run check` fails on a native `<select>`, checkbox or radio elsewhere. For a tooltip, put `data-tooltip="…"` on the element (the `TooltipLayer` shows it) instead of `title`, and give icon-only buttons an `aria-label` too.
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

**Components.** Use `Button`, `Kbd`, `Pill` and `Meter` from `components/ui/` instead of writing these class strings by hand; `npm run check` fails on `btn-secondary` or a raw `<kbd>` elsewhere. `Button` variants: `primary` for the one yellow action in an area, `secondary` (the default) for Cancel, Close and Choose…, `quiet` for toolbar icons and inline controls (`selected` for an open panel or the current view), `danger` for deleting or reverting (`filled` only for the confirm button of a destructive dialog). Sizes are `sm` (24px), `md` (28px, toolbars and dialogs) and `lg` (32px, cards, the message box, a view's main action). Pass `shortcut="<registry id>"` (or `kbd="⌘↵"` for a dialog's own key) to show the shortcut and announce it, and `iconOnly` with an `aria-label` for an icon button (the label becomes its tooltip). `Kbd` shows a shortcut on its own, as glyphs, a stored `cmd+enter` or a registry `shortcut`; its `on-accent` tone is for inside a yellow button, `plain` drops the keycap and `cap` is one key on a 20px keycap. `KeyCombo` draws a shortcut's alternatives as keycaps, one per key, with "or", "then" and "to" between them and the keys spoken as words for screen readers. `Pill` is the small rounded chip above the message box (project actions, the task strip, background tasks with `tone="ok"`, `dashed` for "Add action"), and `CountBadge` is the count next to a group heading. `Meter` draws anything that fills up, as a bar or a ring, in the level colours; give it a `label` unless the control around it already says the number. `SplitButton` is a button with a ▾ beside it for related ways to do the same thing (New session's Start: Start session, Add to queue, Start in a new worktree), one shape with a 1px line between the halves; the main action's shortcut stays on the main part, the menu opens above, and a reason that only stops the main action leaves the ▾ usable. `Dialog` is the shell of every modal: scrim, panel on the overlay surface, header with `title`, optional `subtitle` and a close button, a scrolling body, and a footer (`footer` on the right for Cancel and the primary action, `footerStart` on the left for Delete or a status line). Widths are `sm` (420px, confirmations), `md` (560px), `palette` (640px, the command palette; `palette-wide`, 680px, for its prompt step), `sheet` (880px, the shortcuts sheet) and `lg` (900px); `placement="top"` keeps dialogs whose height changes as you type from jumping, `flush` drops the body padding for lists and panes, and `bare` drops the header for a search field (the `title` still names the dialog). It closes on Escape and on a click on the scrim (`dismissable={false}` to stop that), calls `onSubmit` on ⌘↵, and only the dialog on top reacts; a child that takes Escape itself (a shortcut recorder, a dropdown) marks the key handled with `preventDefault()`. Use `ConfirmDialog` for a yes or no question. `SegmentedControl` puts related choices in one track: `mode="radio"` for one value (arrow keys move and choose, one Tab stop), `mode="toggle"` for independent switches such as Changes | Terminal; each segment takes `label`, `icon`/`iconOnly`, `badge`, `dot`, `tooltip`, `kbd` and `data` hooks. Choices that need a description under them stay `RadioGroup` cards. `Notice` is a message box: `tone` `info`, `warn`, `error` (announced at once) or `success`, with an `icon`, `actions` (small Buttons) and `onDismiss`; `inline` makes it one quiet line without a box. Plain errors under a field stay text. `SectionHeader` is the small capitals over a group of rows, with `tone` (`neutral`, `needs-you`, `working`), a `count`, an `action` (Select all) and `toggle` for a collapsible group; `as="h2"` or `"h3"` when a section points at it with `aria-labelledby`. `className` is for layout (`ml-auto`, `w-full`, `min-w-0`); to change a component's look, change the component. `npm run check` also fails on a hand-written dialog scrim (`bg-scrim`) or `role="radiogroup"` outside `components/ui/`.

**Message box chips.** The chips under the message box (`ComposerChipRow`: profile, model, effort, mode) are quiet buttons without borders or dividers that show only the value, with the full meaning ("Effort: Medium") in their label and tooltip; the attach buttons come first, then a thin line. When the row runs out of room it steps through fixed levels (`footerLevel` in `composer/chipFaces.ts`: effort and mode icon-only, then the model without its version, then the profile dot-only) and never truncates a chip.

**Surfaces and borders.** Cards (`rounded-xl border border-border bg-card`) are for things that need a decision or hold input: your prompt, a plan, a permission or question card, the message box. Tool runs, agent reports and to-do lists in the conversation are a quiet timeline without borders. Floating things (menus, popovers, dialogs, sheets) use the `overlay` utility. A picked project shows in its own colour (`useProjectColor` in `components/ProjectIcon.tsx`, the colour of its icon): in New session, its tile's border and the message box's frame, with a faint 4px ring.

**Layout.** Group lists by what needs attention first (Needs you, Working), then by time (Today, Yesterday, Earlier). Centre focused views (New session, Home) in the window with a `max-w-3xl` column. Side panels that show content (Changes, terminal) can be resized by dragging, and from the keyboard. The terminal panel is always dark (`theme-dark` on its root, which swaps every token to the dark theme), in light mode too, on `bg-terminal` (darker than the conversation) with `terminal-edge-top`/`terminal-edge-left` for its shadow. It docks below or on the right (`effectiveDock` in `terminal/terminalLayout.ts`: below while Changes holds the right or the view is too narrow). Never float controls over xterm: put them in the panel's layout, before the terminal in the DOM, because xterm keeps Tab for the shell (see the action run strip).

**Sidebar states.** The sidebar is open, minimal (an 80px rail, wide enough for the traffic lights) or closed (`state/sidebarStore.ts`; snapping and keyboard steps are pure helpers in `state/sidebarWidth.ts`). The rail, ⌃⇥ / ⌘⇧U and ⌘P all list sessions through `sidebarGroups` (`state/sidebarOrder.ts`), so their order never differs from the open sidebar's; anything new that walks sessions uses it too. A session row's context menu comes from `useSessionMenu`, shared by both lists. Every view's header starts with `SidebarToggle`, which also makes room for the traffic lights and shows the needs-you pill while the sidebar is closed (in split view only the left pane has it). Rows in the rail use the tooltip's card form (`data-tooltip-title`, `-meta`, `-status`, `-tone`, `-hint`) with `data-tooltip-placement="right"`; use the same for anything else that only shows an icon in a narrow column. A short confirmation of where a keyboard jump landed is the `SessionHud` (top centre, 1.2s, a polite live region), not a toast.

**Collapsible sections and the queue.** Every sidebar section but Needs you closes from its header (`SectionHeader` with `toggle.leading`: the chevron always shows in the gutter, `faint` (`muted` on hover and focus) whatever the section's tone, and turns 90° when open; `data-section-toggle`). Closed, Archived is docked under the list (`data-archived-dock`), outside the scroll area, so a short list never scrolls; opened, its header slides into the list right under the last active row (`data-archived-header`, FLIP) and the list scrolls it near the top only when it lands below the middle (`archivedRevealTop`). A closed header keeps its count and a summary in the state's colour (`headerSummary`: "2 unread" in `unread`, the Queue's "1 ready" in `ok`). A queued item that is ready has a light `ok` tint and an `ok` inset ring (`QUEUE_SURFACE`) with a primary Start; waiting items show a clock and what they wait for, with a secondary Start on hover. The queue's menu and keys (`useQueueMenu`) are shared by the sidebar and Home.

**Unsent messages.** A draft is marked with an 11px pen (`PencilLine`, `text-faint`, never a status colour) in the row's corner after the pin and before the age; on an icon or button (the rail, the + button) it is a `PenBadge` (`components/drafts/`). Its text shows as `Draft:` (muted) and the start of it in italics at `text-text/80`, only where no status line (needs you, working) takes the place. Drafts live in `state/draftsStore.ts` (keys: a session id, or `newDraftKey(root)` for New session); anything that lists them uses `useUnsent()`, and opening one goes through `openDraft`.

**Project page and tables.** A project's page (`components/projects/ProjectPage.tsx`) has a breadcrumb, the project's icon at 34px with its name in `text-hero`, and tabs: a `role="tablist"` row whose active tab has a 2px `accent-ink` underline, ← → moving between them. Wide data (the Worktrees and Branches tabs) is a table in a card with sticky column headers, grouped by `SectionHeader` in the group's tone (worktrees: `ok` safe, `info` probably done, `caution` keep, `error` stale; branches: `ok` safe to delete, `info` deleted on the remote, `caution` inactive); `Pill` has `caution` (look before it goes, such as uncommitted files) and `link` (an open pull request) for its cells. Rows that can't be picked show a lock with the reason as a tooltip instead of a checkbox.

**Context menus and confirmations.** Right-click and Shift+F10 open the same `Menu` (`isContextMenuKey` and `contextMenuPoint` in `lib/contextMenu.ts`); an item in another menu that has its own context menu sets `contextMenu` on its `MenuEntry`. After a save or delete that closes a dialog, confirm it with an inline `Notice tone="success"` next to what changed, cleared by `useFlash` (`components/ui/useFlash.ts`). Toasts (`toast()` in `state/toastStore.ts`, bottom right) are for news that isn't next to anything on screen: an Undo after a quick action, a queued item that turned ready. They go by themselves after five seconds (paused on hover and while the window is in the background). Updates to Switchboard and Claude Code are toasts too (`components/updates/UpdateToasts.tsx`, built on `ToastFrame`), but stay until they're dealt with. Anything floated over a terminal sits outside the xterm host, which is `isolate` so xterm's own z-indexed layers can't cover it.

**Copy.** Plain, short sentences. Say what something does ("Allow", "Start session"), not how. No em dashes.

The design mockups these rules come from are in the Switchboard UI suggestions canvas; when a new view needs a pattern that isn't here, add it to this section in the same change.

### Smoke test

`apps/desktop/src/main/index.ts` holds the smoke steps (`run…Step` functions); `runSmokeStep` runs each through `smokeRun.step(label, …)` (`smokeRunner.ts`: timed, 30s limit, cleaned up after), and `apps/desktop/scripts/smoke.ts` prints their results and times. A new step is one `step(...)` line there, returning `ok: …` or what went wrong. Wait for conditions (`waitInPage`, `until`, `settle`), never for a fixed time, except to show that something did *not* happen. Steps find elements by `data-*` attributes, so give new UI a `data-` hook when you add it. Steps must be **read-only on real data**: the app runs against the user's real `~/.claude` and projects, with a throwaway app profile. Never stage, revert, delete or send anything outside the sandbox. Never type into, or run anything in the folder of, a session that is running in Claude Code right now (often the agent's own session, which started the run): steps that pick a session skip `runningSessions()`, and the one whose folder later steps use also skips sessions in a running session's folder or inside it (`inRunningFolder`).

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
- Keep `CHANGELOG.md` up to date: when a change is visible to people using the app, add a line to the `## [Unreleased]` section at the top (create it if it's missing), written for them, not about the implementation. At release time that section becomes `## [X.Y.Z] - YYYY-MM-DD` (see Releases).

## Releases

Releases are built by `.github/workflows/release.yml`, which runs when a release is published on GitHub:

1. Rename the `## [Unreleased]` section of `CHANGELOG.md` to `## [X.Y.Z] - YYYY-MM-DD` (or add that section, written for people using the app), and set `version` in `apps/desktop/package.json` to match.
2. Retake the README screenshots with `npm run screenshots` and look at every image in `docs/screenshots` against the README's alt text and the CHANGELOG section. If the tour fails, a view it drives has changed: fix `apps/desktop/src/main/screenshotTour.ts` (or the demo world in `scripts/screenshot-demo.ts`) rather than skipping it. If a released feature belongs in a picture that doesn't show it yet, update the demo world or add a view. Commit the new images with the release.
3. Publish a GitHub release with tag `vX.Y.Z` (only when the user asks). The notes may be left empty; the workflow fills them from the CHANGELOG section.

The workflow builds with the version from the tag, signs and notarises the app, checks Gatekeeper accepts it, and attaches the `.dmg` to the release. A second job, once the repository variable `WINDOWS_RELEASES` is `true`, builds the Windows installer, signs it (Azure Trusted Signing or a `.pfx`), checks the signatures and their publisher, and attaches it with `latest.yml`. It never attaches an unsigned build. For a Stable release it then pushes the stamped cask (`homebrew/switchboard.rb`) to `estruyf/homebrew-tap`; edit the cask here, never in the tap (see `docs/homebrew.md`). `npm run dist:notarized` is for checking a signed build locally.

The VS Code companion is released separately by `.github/workflows/release-vscode.yml`, to the Visual Studio Marketplace and Open VSX: a GitHub release tagged `vscode-vX.Y.Z` (which `release.yml` skips), a commit on `main` whose message has both `#release` and `#vscode`, or a manual run. Bump `version` in `apps/vscode-extension/package.json` and add a section to `apps/vscode-extension/CHANGELOG.md` first; only release when the user asks. See [docs/vscode-companion.md](docs/vscode-companion.md#releasing-the-extension).

## Safety

- Commit, push, tag or publish only when the user asks.
- Never handle passwords, certificates or app-specific passwords, and never change keychain or system settings. The user runs `notarytool store-credentials` and adds CI secrets themselves.
- Deleting is always to the Trash (`shell.trashItem` in main), guarded by `apps/desktop/src/main/trashGuard.ts`: session files only, or new files inside a git repository for a revert.
