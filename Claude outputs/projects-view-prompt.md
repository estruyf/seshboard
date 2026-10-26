# Projects: one view with the list and the project

Read AGENTS.md and CLAUDE.md first. Then build Round 47 on the Design canvas (`ProjectsOverview.dc.html`, `ProjectsSettings.dc.html` and `ProjectsParts.dc.html`, with their sticky notes).

## Goal

Today there are two separate views:

- **The projects list** (`ProjectManagerView.tsx`, view `projects`) has ✎, ⋯, ↑ and ↓ on every row.
- **One project's page** (`ProjectPage.tsx`, view `project`, tabs from `PROJECT_TABS` in `state/projectPageStore.ts`).

To reach the next project, you go back to the list. Make them one view:

- the projects list stays on the left, like the Settings nav, next to the session sidebar
- the open project is on the right
- switching projects, the Overview and the Settings tab are each one click or one key away

Run the related tests, the typecheck and `npm run smoke:demo -- --only "<step label>"` after each step. The full `npm run check` and `npm run smoke:demo` run once, at the end.

## Step 1: one view

1. **The `projects` and `project` views render one component,** `ProjectsView`, with two columns:
   - `ProjectList` on the left, 270px
   - `ProjectPage` on the right
   - The `projects` view opens it on the project you last had open (or the first one). The `project` view opens the given root.
   - Keep both view names, so deep links, `mainRequests.ts`, the palette (`paletteApi.ts`) and `openProject(root, tab)` keep working.
2. **The empty state.** With no projects, the right side shows "No projects yet", with Add a project folder.
3. **Navigation history** (`navHistoryStore`) records a project switch like a view change, so Back returns to the previous project and tab.
4. **Narrow windows.** Under about 1000px wide (measure the view, not the window), the list hides, and the header's ‹ shows it as an overlay. Put the breakpoint in one place.

## Step 2: the list

`ProjectList` replaces the rows of `ProjectManagerView`. Move what's worth keeping, and remove the rest.

1. **The header:** "Projects", a count, and + (Add a project folder, which opens `AddProjectDialog`).
2. **Search:** a "Find a project" field. ⌘F focuses it while the view is open. It filters on name and folder.
3. **Rows,** one per project, in the saved order:
   - the icon (`ProjectIcon`) and the name
   - a meta line with the profile dot and name, plus the worktree hint when there is one ("2 worktrees", "4 can go")
   - on the right, a status dot (working in `accent`, needs you in `warn`) and the last active time
   - The selected row has a light `accent` tint and an `accent` left edge.
   - On hover, the time is replaced by a gear button, "Settings", that opens that project on its Settings tab.
4. **A click** opens the project on the tab it was last left on (`lastTab`). The first time, that's Overview.
5. **Reordering by dragging.** This order is the one the sidebar and New session use, so it's saved the same way the ↑ ↓ buttons save it today.
   - **The grip.** A grip shows on the left of a row on hover, and the whole row can be dragged. The cursor becomes a grab hand on the grip.
   - **While dragging:** the row lifts (a shadow, slightly transparent), and an `accent` line shows where it will drop. The list scrolls by itself near its top and bottom edges.
   - **Saving.** The order is saved on drop, with one call, and the sidebar and New session follow right away. Esc while dragging cancels.
   - **While searching,** dragging is off: the grip doesn't show, and a hover tooltip says "Clear the search to reorder".
   - **The keyboard:** ⌥⇧↑ and ⌥⇧↓ move the selected project one place. A polite announcement says "Seshboard moved to position 3 of 11".
   - **Errors.** If saving fails, the row goes back to where it was, with an error toast.
   - Remove the ↑ and ↓ buttons.
   - **Reuse code.** If the app already has a drag-to-reorder helper (the queue in the sidebar and the pipeline editor's steps both reorder by dragging), reuse it rather than writing a new one.
   - **Tests:** a pure `moveProject(order, from, to)` with tests, drag disabled while filtered, and the keyboard move with its announcement text.
   - **Smoke:** drag the third project to the top, and check the sidebar's project menu shows the same order.
6. **Right-click** on a row opens the row menu that's behind ⋯ today, so Rename… and Remove… stay reachable.
   - Remove the ✎ and ⋯ buttons from the row. Rename also moves into the Settings tab (step 4).
7. **The footer:** "Drag to reorder · ⌥↑↓ to switch".
8. **The intro paragraph** at the top of today's list goes into Settings, as the description of the "Remove" row, since that's what it explains.

## Step 3: the project header

1. **The project name** has a ▾ that opens a switcher:
   - a search field and the matching projects, with their profile
   - ↩ opens a project on the same tab, and ⌘↩ opens its Settings
   - The footer line says so.
   - This is how you switch when the list is hidden.
2. **‹ and ›** go to the previous and next project in list order, on the same tab. ⌥↑ and ⌥↓ do the same from anywhere in the view.
3. **Keep** the folder, profile and branch line, New session (primary) and ⋯.
4. **The tabs** stay as they are. ⌘1 to ⌘8 pick a tab while the view has focus.
   - Check every new key against `lib/shortcuts.ts` before adding it: ⌥↑↓, ⌥⇧↑↓, ⌘F, ⌘1 to ⌘8.
   - Leave ⌘, as the app's Settings.
   - Add the keys to the Shortcuts list with the `keys` and `Kbd` helpers.

## Step 4: Overview and Settings

1. **Overview** (`ProjectTabs.tsx`):
   - **A row of numbers** at the top: working now, sessions, last active, worktrees (with "4 can go"), queued and triggers. Each one opens its tab where there is one.
   - **"Recent sessions":** the last four, with "All 205 ›" opening Sessions.
   - **"Worktrees":** the in-use and suggested ones with their state badge, with "Clean up 4 ›". That uses the existing `pendingCleanup` path.
   - **"How sessions start here":** the profile and defaults as chips, with "Change in Settings ›".
   - Reuse the data the overview cards read today. Don't add new engine calls.
2. **Settings,** one row per setting, with labels on the left:
   - Name, editable here. This replaces the rename dialog for this path. Keep the dialog for the right-click menu.
   - Icon
   - Folder, with Show
   - Claude profile
   - Defaults (`ProjectDefaultsEditor`)
   - Remove, as "Remove from Seshboard…" in `error`, with the explanation from today's intro paragraph.

## Step 5: from the sidebar

- **The sidebar's project menu** ("All projects ▾") gets a › on each project row. It opens that project's page, and the row itself still filters the sidebar.
- **At the bottom of the menu:** "Manage projects…", which opens this view, then "Add a project folder…".
- **The project filter** keeps working as it does.

## Accessibility

- The list is a `listbox` labelled "Projects". The selected project has `aria-selected`.
- The gear is a button labelled "Settings for <name>".
- The switcher is a combobox with a listbox.
- ‹ and › are labelled "Previous project: <name>" and "Next project: <name>".
- When the project changes, focus stays where it was, and the tab panel's heading announces the new project.

## Tests and smoke

- **Unit tests:**
  - the previous and next project in list order, with a filter on
  - the search
  - the tab kept when switching
  - the narrow breakpoint function
  - drag reorder saving the same order as before
- **Smoke (demo):**
  1. Open Projects.
  2. Click the second project, and check its Overview shows.
  3. Hover a row and use the gear, and check the Settings tab shows.
  4. Press ⌥↓, and check the next project shows on Settings.
  5. Open the name's switcher, type part of a name, press ↩, and check that project opens.
- Update the existing project smoke steps for the new view.
- **`data-*` hooks:** `data-projects-view`, `data-project-row`, `data-project-row-settings`, `data-project-switcher`. Keep `data-project-open` and the `data-project-tab` hooks.

## Docs

- CHANGELOG.md, under `## [Unreleased]`: "Projects is one view: the list on the left, the project on the right. Switch with the name's menu, the arrows or ⌥↑↓, and open a project's Settings from its row."
- `website/src/content/features.json`: update the projects entries for the new view and the switcher.
- Writing rules from AGENTS.md: plain short sentences, no em dashes, the exact labels from the UI.

## Done when

- One view shows the list and the project.
- Switching projects (click, switcher, ‹ ›, ⌥↑↓) keeps the tab.
- Settings is one click from any row.
- Reordering works by dragging.
- Narrow windows fold the list into the switcher.
- It works in light and dark, on macOS and Windows.
- `npm run check` and `npm run smoke:demo` pass.
