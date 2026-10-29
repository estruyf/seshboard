# Settings: group the menu

Read AGENTS.md and CLAUDE.md first. Then build Round 51 on the Design canvas (`SettingsNav.dc.html`, with its sticky notes).

## Goal

Settings lists its 19 pages in one column, in no clear order. Mods sits between Conversation and Notifications, and Backup sits next to Remote. Group the pages under four short headers, and move the rarely used ones to the bottom. Every page keeps its name, icon and id. Only the order and the headers change.

Run the related tests, the typecheck and `npm run smoke:demo -- --only "<step label>"` after each step. The full `npm run check` and `npm run smoke:demo` run once, at the end.

## Step 1: the groups

In `apps/ui/src/components/SettingsView.tsx`, give each entry in `SECTIONS` a `group`, and order the list like this:

| Group | Pages |
| --- | --- |
| App | General, Theme, Sidebar, Notifications, Focus |
| Claude | Conversation, Claude profiles, Usage, Memory |
| Your work | Projects, Sessions, Prompts, Pipelines |
| Connect | VS Code, Remote, Mods |
| (bottom, no header) | Backup, Diagnostics, About |

- Type the groups: `type SettingsGroup = 'app' | 'claude' | 'work' | 'connect' | 'bottom'`, with a label map for the four headers: "App", "Claude", "Your work", "Connect".
- Add a pure helper, `navGroups(sections)`, that returns the pages grouped in this order. Put it next to `SECTIONS`, or in its own small file if that's easier to test.
- Anything else that walks `SECTIONS` in order keeps working, since the ids don't change. Check the palette's Settings commands (`palette/commands.ts`) and keep their order the same as the menu's.

## Step 2: draw the menu

In `SettingsNav`:

1. **Headers:** above each group, a small header in the same style as other section headers (`SectionHeader`, or the 11px uppercase faint label it uses). Add 12px of space above every header except the first.
2. **The bottom block:** Backup, Diagnostics and About sit in the existing `mt-auto` block at the bottom, above `SettingsVersion`. Put a 1px top border over them, with no header.
   - When the window is too short, the nav scrolls as one list, and the bottom block comes right after Connect with the border. It never overlaps.
3. **The rows** stay as they are: the same height, icon, current style and `data-settings-section`.
4. **Keyboard:** Tab and the arrow keys move through the pages in the new order. The headers aren't focusable.

## Step 3: search

- **While searching, the headers stay.** Pages without a match dim and pages with one show their count, as now.
- **The results on the right** follow the menu's order. Sort `groupByPage` in `settingsSearch/searchSettings.ts` by the page's place in `SECTIONS` instead of the order the matches came in, and add a test for it.

## Accessibility

- Each group is a `role="group"` with `aria-labelledby` pointing at its header. The bottom block is a group labelled "More".
- The nav keeps `aria-label="Settings sections"`, and the current page keeps `aria-current="page"`.

## Tests and smoke

- **Unit tests:**
  - `navGroups`: the order, every page in exactly one group, and no page left out. Compare the result against the `SettingsSection` union, so a new page without a group fails the test.
  - `groupByPage` sorted in the menu's order.
- **Smoke (demo):**
  1. Open Settings, and check the four headers show in order, with Backup, Diagnostics and About at the bottom.
  2. Click Pipelines, and check its page opens.
  3. Type "archive", and check the headers stay and the results follow the menu's order.
- The existing smoke steps click pages by `data-settings-section`, so they keep working. Run them to be sure.
- **`data-*` hooks:** `data-settings-group="app|claude|work|connect|bottom"`.

## Docs

- CHANGELOG.md, under `## [Unreleased]`: "Settings groups its pages under App, Claude, Your work and Connect, with Backup, Diagnostics and About at the bottom."
- `website/src/content/features.json`: update the Settings entry if it lists the pages.
- Writing rules from AGENTS.md: plain short sentences, no em dashes, the exact labels from the UI.

## Done when

- The menu shows the four groups and the bottom block, in light and dark.
- Search keeps the groups, and its results follow the same order.
- A short window scrolls without overlap.
- `npm run check` and `npm run smoke:demo` pass.
