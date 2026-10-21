# New session: a "Run as" chip for pipelines

Read AGENTS.md and CLAUDE.md first. Then build option A of Round 45 on the Design canvas (`PipelineEntry.dc.html`, with its sticky notes).

## Goal

Pipelines are hidden today. You only find them under Start ▾ › Run pipeline ›.

Add a **Run as** chip right before the Start button in New session. It shows "One session" by default. Pick a pipeline, and:

- Start becomes **Run pipeline**
- the pipeline's steps show under the message box

You see what Start will do every time, before you press it.

Run the related tests, the typecheck and `npm run smoke:demo -- --only "<step label>"` after each step. The full `npm run check` and `npm run smoke:demo` run once, at the end.

## Where it is today

- **`apps/ui/src/components/newSession/startMenu.ts`:** `startButtonState` builds the ▾ items. That includes `{ action: 'pipeline', label: 'Run pipeline' }` when `canPipeline` is set.
- **`apps/ui/src/components/newSession/StartButton.tsx`:** turns that item into a submenu with `pipelineEntries` (`components/pipelines/pipelineMenu.tsx`).
- **`apps/ui/src/components/newSession/NewSessionView.tsx`** (around line 900):
  - `projectPipelines` comes from `pipelinesFor(allPipelines, pipelineRoot)`.
  - `runPipelineWith(pipelineId, text)` calls `runPipeline` with the text as the task.
  - `canPipeline: canWorktree && !fromLater`.

Reuse all of this. Don't add a second way to start a run.

## Step 1: the state

1. In New session's draft state, add `runAs: string | null`: the pipeline id, or null for one session.
   - It's kept with the unsent draft, like the model and mode, so switching away and back keeps it.
   - It resets to null after a run starts, when the project changes to one where that pipeline doesn't exist, and when the pipeline is deleted.
2. **The last choice per project.** Remember the last pipeline used in each project in the UI prefs, in localStorage inside try/catch. A new draft in that project starts with "One session" anyway. Only the menu's order uses it: the last used pipeline comes first.
3. **`startButtonState`** gets `runAs: { id, name } | null`. When it's set:
   - `main` is `'pipeline'`, the label is "Run pipeline" ("Starting…" while sending), and the shortcut is `new-session.start`. ⌘↵ runs the pipeline.
   - The reason when empty is "Type the task first".
   - The ▾ items start with "Start one session", which clears `runAs` and starts. Leave out the "Run pipeline ›" item, since the chip covers it.
   - Keep Add to queue, Schedule…, Start when… and Start in a new worktree as they are. They ignore `runAs`. A queued item is one session.
4. **When `runAs` is null,** remove the "Run pipeline ›" item from the ▾ as well. The chip is the one place to pick a pipeline.
5. **Tests** in `startMenu.test.ts`:
   - the label, shortcut and reason with `runAs`
   - "Start one session" first
   - no Run pipeline item in either state
   - question mode and `editingSchedule` never show pipeline things

## Step 2: the chip

1. **A new `RunAsChip` component** in `components/newSession/`. It goes in the message box footer, right before the Start button.
   - It only shows when `canPipeline` and the project has at least one pipeline.
2. **Look:** the same size and style as the model and mode chips.
   - The pipeline icon (`PipelineIcon`) in the `pipeline` color.
   - The label "One session", or the pipeline's name, cut with an ellipsis at about 150px. The full name is in the tooltip.
   - A chevron.
   - When a pipeline is picked, the chip gets a light `pipeline` tint and border, so it stands out from the other chips.
3. **The menu** uses the existing `Menu` component, and opens upward when there's no room below:
   - **"One session"**, with "default" on the right, and a check when picked.
   - A divider, then the heading "Run as a pipeline".
   - **Each pipeline** in two lines:
     - its name
     - a meta line with what each step uses, built from its steps: "Opus plans · Sonnet builds · Opus checks · you push". Put that summary in a pure function in `state/pipelines.ts`, with tests. Use the step names and models, for example "Plan: Opus · Execute: Sonnet · Validate: Opus · Push", and keep it to one line.
     - a check on the picked one
     - Order: the last used in this project, then built-ins, then the rest by name.
   - A divider, then **"Edit pipelines…"**, which opens Settings › Pipelines.
4. **Keyboard:** the chip is a button with `aria-haspopup="menu"`. Its label is "Run as: One session" or "Run as: Plan, execute, validate, push".

## Step 3: the steps under the box

1. When a pipeline is picked, show a line under the message box, in the space the hint uses today, with the same width as the box:
   - the pipeline icon and "Runs as"
   - one small pill per step, with its name and its model in muted text (the push step shows "you"), and → between them
   - "Change" on the right, which opens the chip's menu
   - A dashed border in `pipeline` at about 35%, so it reads as a preview, not a control.
2. With many steps, the pills wrap to a second line. Never cut a step.
3. Hide it while the box is empty, and show "Type the task first" in the Start button's reason instead.

## Step 4: the other chips while a pipeline is picked

The model, effort and mode chips only apply to steps that don't set their own. Make that clear:

- When a pipeline is picked and every Claude step sets its own model, effort and mode, dim those three chips. Give them the tooltip "The pipeline sets this for each step." They stay usable.
- When some steps don't set them, keep the chips as they are. Give them the tooltip "Used by steps without their own: Execute."
- Put the "which steps use the box's choices" check in a pure function with tests.

## Step 5: running

- Start (or ⌘↵) with a pipeline picked calls `box.submitWith((text) => runPipelineWith(runAs, text))`, the same path the submenu uses now.
- After it starts, the box empties, `runAs` goes back to null, and the run's parent opens, as it does today.
- If `runPipeline` fails, keep the text and the choice, and show the error where Start errors show now.

## Step 6: archive and delete a run as one tree

Today a run's tree can't be cleaned up from the sidebar. A run row has no menu at all: `Sidebar.tsx` returns early for `isRunRowId` on the context menu (around line 1024), and middle-click skips it too. Only the sub-sessions have the session menu. After Stop the run, the parent and its steps stay in the list for good.

Treat a run as one thing in the sidebar: the parent (a session or a run row) and its sub-sessions together.

1. **A menu for run rows.** Right-click, the ⋯ button and middle-click work on a run row, like on any row. Its menu has:
   - Open
   - Stop the run (only while it's running or waiting)
   - Archive (the run and its steps)
   - Delete…
   - Leave out the session-only items: Rename, Fork, Run pipeline ›, Open in a new window.
2. **Archiving a parent archives its tree.**
   - Archive on a parent session, or on a run row, archives the parent and every sub-session under it in one go. The menu item says so: "Archive with its 4 steps".
   - Unarchive brings the whole tree back.
   - In the Archived group, the tree stays nested under its parent, closed.
   - Archiving one sub-session on its own still works. It leaves the tree, and the parent's progress line doesn't change.
3. **A running run.**
   - Archiving a tree whose run is still running or waiting asks first: "Stop the run and archive it?" The buttons are Stop and archive, and Cancel.
   - Stop and archive calls `runs.stop`, then archives.
   - Never archive a run that keeps going in the background.
4. **Deleting.** Delete… on a run row or a parent opens a confirm:
   - Title: "Delete <title>?"
   - Body: "The run and its 4 sub-sessions go away from Switchboard. Their Claude Code transcripts stay on disk."
   - The buttons are Delete, and Cancel.
   - A checkbox "Keep the sub-sessions" (off). With it on, the run row goes away and its sub-sessions stay as normal sessions on their own. That's what `PipelineRunner.remove` already does (`runner.ts`, `remove`).
   - Deleting a running run stops it first, without a second question.
5. **Auto-archive.** `archiveAfterDays` treats a tree as one unit. It archives the parent and its steps together, once the newest activity anywhere in the tree is older than the limit. A tree with a running or waiting run is never auto-archived.
6. **Engine.**
   - Add `runs.archive { runId, archived }`. It archives or unarchives the parent session, or the run row (an `archived_at` on `pipeline_runs` for rows), and every sub-session through the existing session archive path, in one call.
   - Add `runs.delete { runId, keepSubSessions }`.
   - Both emit the run and session change events, so the sidebar updates once, not per session.
7. **Keyboard.** The archive shortcut works on a selected run row or parent, with the same rules.
8. **Tests:**
   - the run row menu items in each run state
   - archiving and unarchiving a tree (the parent and every child together)
   - archiving one child alone
   - the confirm while running
   - delete with and without keeping the sub-sessions
   - auto-archive using the newest activity in the tree, and skipping running runs
9. **Smoke (demo):** run "Execute and validate", press Stop the run, archive the parent from its menu, and check that the parent and both steps moved to Archived.

## Accessibility

- The menu is a `menu` with `menuitemradio`s for "One session" and the pipelines, with `aria-checked`.
- The steps line is a list labelled "Runs as Plan, execute, validate, push: Plan with Opus, Execute with Sonnet, Validate with Opus, then Push".
- Changing the choice announces the new Start label politely ("Start button: Run pipeline").

## Tests and smoke

- **Unit tests:**
  - `startButtonState` with and without `runAs`
  - the step summary
  - the menu order (last used first)
  - which chips are dimmed
  - `runAs` resetting when the project changes
- **Smoke (demo):**
  1. Open New session in the demo project.
  2. Pick "Execute and validate" from the Run as chip.
  3. Check that the Start button says Run pipeline, and that the steps line shows two pills.
  4. Type a task and press ⌘↵.
  5. Check that a run parent opens with its first step.
  6. Open New session again and check that the chip says "One session".
- **`data-*` hooks:** `data-run-as`, `data-run-as-option`, `data-run-as-steps`.

## Docs

- CHANGELOG.md, under `## [Unreleased]`:
  - "New session has a Run as chip next to Start: pick a pipeline, and Start runs it, with its steps shown under the message box."
  - "Archive or delete a pipeline run as one: the parent and its sub-sessions go together."
- `website/src/content/features.json`: an entry for the Run as chip. The coverage test in `npm run check` needs it.
- Writing rules from AGENTS.md: plain short sentences, no em dashes, the exact labels from the UI.

## Done when

- The chip shows in New session when the project has pipelines.
- Picking one changes Start to Run pipeline and shows the steps.
- ⌘↵ runs it.
- The ▾ menu no longer has Run pipeline ›.
- It works in light and dark, at narrow widths (the chip label cuts, and the footer never wraps), on macOS and Windows.
- `npm run check` and `npm run smoke:demo` pass.
