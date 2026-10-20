---
paths:
  - "apps/ui/**"
---

# UI rules

The rules for the Switchboard UI (`apps/ui`). Claude Code loads this file when you work on a file there; other agents read it before they change the UI ([AGENTS.md](../../AGENTS.md#ui) points here). The detail for each area is in [docs/ui-patterns.md](../../docs/ui-patterns.md).

**Copy.** Plain, short sentences. Say what something does ("Allow", "Start session"), not how. No em dashes.

## UI conventions

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

## Design system

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

**Components.** Use the ones in `components/ui/` (`Button`, `Kbd`, `Pill`, `Meter`, `Dialog`, `ConfirmDialog`, `SplitButton`, `SegmentedControl`, `Notice`, `SectionHeader`, `Stepper`, form controls) instead of writing their class strings by hand; `npm run check` fails on a hand-written `btn-secondary`, raw `<kbd>`, `bg-scrim` or `role="radiogroup"` outside `components/ui/`. `className` is for layout; to change a component's look, change the component. Variants, sizes and props: [docs/ui-patterns.md](../../docs/ui-patterns.md#components).

**Surfaces and borders.** Cards (`rounded-xl border border-border bg-card`) are for things that need a decision or hold input: your prompt, a plan, a permission or question card, the message box. Tool runs, agent reports and to-do lists in the conversation are a quiet timeline without borders. Floating things (menus, popovers, dialogs, sheets) use the `overlay` utility. A picked project shows in its own colour (`useProjectColor` in `components/ProjectIcon.tsx`, the colour of its icon): in New session, its tile's border and the message box's frame, with a faint 4px ring.

**Layout.** Group lists by what needs attention first (Needs you, Working), then by time (Today, Yesterday, Earlier). Centre focused views (New session, Home) in the window with a `max-w-3xl` column. Side panels that show content (Changes, terminal) can be resized by dragging, and from the keyboard. The terminal panel is always dark (`theme-dark` on its root, which swaps every token to the dark theme), in light mode too, on `bg-terminal` (darker than the conversation) with `terminal-edge-top`/`terminal-edge-left` for its shadow. It docks below or on the right (`effectiveDock` in `terminal/terminalLayout.ts`: below while Changes holds the right or the view is too narrow). Outside a session, ⌘J opens the window's own terminal (`AppTerminalFrame`, keyed `APP_TERMINAL` in the terminals store, engine terminals without a session), shared by Home, project pages, Projects, Usage, New session and Settings (it docks next to the Settings sheet, which covers only the view); `terminalOwner` (`terminal/appTerminal.ts`) says whose panel a key or palette command works on. Never float controls over xterm: put them in the panel's layout, before the terminal in the DOM, because xterm keeps Tab for the shell (see the action run strip).


**Per area.** The detailed rules for these parts of the UI are in [docs/ui-patterns.md](../../docs/ui-patterns.md). Open the section when you change that area:

- [Components](../../docs/ui-patterns.md#components): variants, sizes and props of `Button`, `Kbd`, `KeyCombo`, `Pill`, `Meter`, `SplitButton`, `Dialog`, `ConfirmDialog`, `Stepper`, `SegmentedControl`, `Notice`, `SectionHeader`.
- [Message box chips](../../docs/ui-patterns.md#message-box-chips): the profile, model, effort and mode chips under the message box.
- [Pasted text](../../docs/ui-patterns.md#pasted-text): a long paste as a card in the context tray.
- [A message back in the box](../../docs/ui-patterns.md#a-message-back-in-the-box): Edit in Up next, Undo after Remove: restoring a message as it was written.
- [Ask about this session](../../docs/ui-patterns.md#ask-about-this-session): the Ask panel and `/btw`, never part of the conversation.
- [Catch-up](../../docs/ui-patterns.md#catch-up): the briefing banner and strip on a finished turn.
- [Sidebar states](../../docs/ui-patterns.md#sidebar-states): open, minimal and closed sidebar, its widths and keys.
- [Split view](../../docs/ui-patterns.md#split-view): the tiling pane tree, drag and drop, dividers, pane keys.
- [Collapsible sections and the queue](../../docs/ui-patterns.md#collapsible-sections-and-the-queue): sidebar section headers, Up next.
- [Unsent messages](../../docs/ui-patterns.md#unsent-messages): the draft pen on rows and buttons.
- [Saved prompts](../../docs/ui-patterns.md#saved-prompts): `{{blanks}}`, the / picker, sharing.
- [Other computers](../../docs/ui-patterns.md#other-computers): a paired computer's sessions in the sidebar, the violet `remote` token.
- [Back and forward](../../docs/ui-patterns.md#back-and-forward): the mouse's back and forward buttons, `navHistoryStore`.
- [Settings search](../../docs/ui-patterns.md#settings-search): `settingsIndex.ts`, what search finds and how a result opens.
- [Claude Code mods](../../docs/ui-patterns.md#claude-code-mods): `ModFrame`, bands, panes, status, toasts.
- [Charts](../../docs/ui-patterns.md#charts): the Usage view's `chart-*` tokens, axes, tooltips.
- [Project page and tables](../../docs/ui-patterns.md#project-page-and-tables): a project's page, its tabs and tables.
- [Context menus and confirmations](../../docs/ui-patterns.md#context-menus-and-confirmations): right-click menus, Shift+F10, what asks before acting.

The design mockups these rules come from are in the Switchboard UI suggestions canvas; when a new view needs a pattern that isn't here, add it to docs/ui-patterns.md (or, if every change must follow it, to this section) in the same change.
