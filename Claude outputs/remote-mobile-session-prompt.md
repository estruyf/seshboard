# Remote app on a phone: a session and New session in the new style

Read AGENTS.md and CLAUDE.md first. This work is in `apps/remote`. It follows the phone redesign that's already on `dev` (commit `5ea17e39`). Build the second board of Round 48 on the Design canvas (`RemoteMobileSession.dc.html`, with its sticky notes 5 and 6). Keep the rules for `apps/remote` in AGENTS.md.

## Goal

Home and the drawer now have round buttons, full width and a floating pill. Two screens still have the old look:

- **A session** (`SessionView.tsx`, `CatchUpCard.tsx`):
  - a separate ? button in the header
  - a catch-up card that shows the prompt as raw Markdown ("# Remote app on a phone: …")
  - a message box with three chips under it, outside the box
- **New session** (`NewSession.tsx`, `OptionChips.tsx`, `ChoiceChip.tsx`):
  - a plain back arrow
  - a row of project cards that scrolls sideways
  - seven chips in three rows
  - a full-width Start bar

Align both with the new style. No changes to the remote contract.

Run the related tests, the typecheck and `npm run smoke:demo -- --only "<step label>"` after each step. The full `npm run check` and `npm run smoke:demo` run once, at the end.

## Step 1: a session's header

- The round menu button (`DrawerButton`) on the left, then the title (one line, cut with an ellipsis) and the status line ("Idle · switchboard · dev · ● Personal"), then a round ⋯ button.
- **Remove the ? button.** "Ask about this session" moves to the top of ⋯.
- **⋯ holds:**
  - Ask about this session
  - Changes, with the file count, opening `ChangesSheet`
  - Rename…
  - Copy the last reply
  - a divider
  - Archive
  - Keep whatever the menu has today below these.

## Step 2: the catch-up card

`CatchUpCard.tsx`:

1. **The first line:** the state dot and word ("Finished"), the time ("5m ago"), and on the right the review hint ("Nothing to review").
2. **"You asked":** a small muted label, then the prompt's title as one bold line of up to two lines.
   - The title is the first Markdown heading without its `#`. With no heading, use the first sentence.
   - "Show the prompt" opens the whole prompt, rendered as Markdown (`Markdown.tsx`) in a sheet.
   - Put the title extraction in `src/lib` as a pure function, with tests: a heading, no heading, a heading after a blank line, and code fences.
3. **"What it did":** the bullets as now, with commit hashes in mono.
4. **Chips:** tests ("No tests run"), and the changed file count, which opens Changes.
5. **The card** has an 18px radius and a 16px gutter, like the usage card on Home.
6. **"Show the conversation · 101"** is a centered pill under the card.

## Step 3: the composer

- **One rounded box,** with a 24px radius, 12px from the screen edges, above the safe area:
  - The text field on top ("Message Claude").
  - A row under it, inside the box: a round + (attachments, as the paperclip does now), one chip with the model and the mode ("Opus 5.5 · Auto") that opens a sheet with Model, Effort and Mode as rows, and on the right a round send button.
- **The send button** is grey while empty and the accent color once there's text.
- **Remove the three chips** under the box. Their choices live in the chip's sheet.
- The box stays above the keyboard, with the existing `useVisualViewport` logic. Check that the docked prompt card still folds while typing.

## Step 4: New session

1. **The header:** a round × on the left (it closes, with the same history behavior as Back today) and the title "New session".
2. **The project** is one row, a card with:
   - the project icon
   - the name in bold
   - its state line ("● Idle 5m · on dev")
   - "Change ▾" on the right
   - Change opens a sheet with search and the projects list. The recent ones come first, with their state. That replaces the sideways cards and "All projects 7".
3. **The message box:** "What should Claude do?", with the paperclip as a round button inside, at the bottom left, as now.
4. **One Options row** under the box replaces the seven chips:
   - a sliders icon
   - two lines summing up the choices ("Personal · Default model · Auto" and "This folder on dev · one session")
   - "Options ▾"
   - When a choice differs from the project's defaults, the summary shows it in the accent color.
   - Put the summary in a pure function in `src/lib`, with tests.
5. **The Options sheet** has one row per choice, each with its value and › opening that choice's list:
   - Run as
   - Profile
   - Model
   - Effort
   - Mode
   - Where
   - Branch
   - The sheet ends with "Reset to <project>'s defaults", and Done closes it. Keep the existing pickers (`OptionChips`, `ChoiceChip`) as the lists behind the rows.
6. **The hint** "From switchboard's defaults. Changes here are for this session only." stays under the Options row.
7. **Start session** is the floating pill from Home, at the bottom center. It's dim and disabled while the box is empty, and the accent color once there's text.
   - With a pipeline picked in Run as, it reads "Run pipeline".
   - It stays above the keyboard.

## Accessibility

- The Options row is a button labelled with the whole summary.
- Each row in the sheet is a button labelled "Model: Default (recommended)".
- The composer's chip says "Model and mode: Opus 5.5, Auto".
- The send and Start buttons stay focusable when disabled, with the reason ("Type a message first").

## Tests and checks

- **Unit tests:** the prompt title, the Options summary, and the dim or ready state of Start.
- **Smoke (demo, phone size):**
  1. Open a finished session, and check the catch-up shows the title without `#`.
  2. Open ⋯, and check Ask about this session is there.
  3. Open New session, change the model in Options, and check the summary shows it in the accent color.
  4. Type a task, and check Start is enabled.
- **By hand,** on an iPhone and an Android phone, in light and dark:
  - the composer and Start above the keyboard
  - the Options sheet in landscape
  - long project names
- **`data-*` hooks:** `data-remote-session-more`, `data-remote-catchup-title`, `data-remote-composer`, `data-remote-new-project`, `data-remote-new-options`.

## Docs

- CHANGELOG.md, under `## [Unreleased]`: "On a phone, sessions and New session match the new look: round buttons, a cleaner catch-up, one composer, and an Options sheet instead of seven chips."
- `website/src/content/features.json`: update the remote app entries if they describe these screens.
- Writing rules from AGENTS.md: plain short sentences, no em dashes, the exact labels from the UI.

## Done when

- A session and New session use the round buttons, the cleaner catch-up, one composer, the project row, the Options row and sheet, and the floating Start pill.
- Wide screens look as before.
- `npm run check` and `npm run smoke:demo` pass.
