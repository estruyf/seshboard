# Trigger editor: five clear sections

Read AGENTS.md and CLAUDE.md first. Then follow Round 46 on the Design canvas (`TriggerEditorSections.dc.html`, with its sticky notes).

## Goal

The New trigger and Edit trigger dialog (`apps/ui/src/components/triggers/TriggerEditor.tsx`) has the right fields, but its structure doesn't show:

- The first five rows have no heading, then "On GitHub" and "Then" appear in small caps that look like field labels.
- The name comes first, before you've chosen anything.
- "On GitHub" has an empty label column.
- "Then" mixes what to start with how many.

Rebuild the layout as five numbered sections, each titled with the question it answers, plus a live summary sentence at the top. The form's fields, rules and saving don't change. This is layout, copy and two pure functions.

Run the related tests, the typecheck and `npm run smoke:demo -- --only "<step label>"` after each step. The full `npm run check` and `npm run smoke:demo` run once, at the end.

## Step 1: the summary sentence

1. Add `triggerSummary(form, ctx)` to `apps/ui/src/state/triggers.ts`, next to `formSource` and `sharedRepoWarning`, with tests. It returns parts (plain text and bold values), so the UI can render the bold values without parsing.
   - **CI:** "When a workflow fails on **main**, start a **session** in a new worktree. Up to **3** at once." With workflows picked: "When **CI** or **Lint** fails on **main**, …". With no branch set, it says "the default branch".
   - **Issues, label only:** "When an issue gets the **switchboard** label, …"
   - **Issues, assignee only:** "When an issue is assigned to **@estruyf**, …"
   - **Issues, both:** "When an issue with the **switchboard** label is assigned to **@estruyf**, …"
   - **Starts:** "start a **session** in a new worktree" or "in the project's folder". For a pipeline: "run **Plan, execute, validate, push**".
   - **Limits:** "Up to **3** at once." When the limit is 1: "One at a time." Waiting isn't mentioned.
   - **While incomplete:** "Pick what starts it." (no source), or "Add a label, or pick Assigned to me."
2. Use the exact labels from the UI, plain short sentences and no em dashes.

## Step 2: the layout

1. **The title.** "New trigger: <name>", with the name editable in place: a text input styled as the title, with a dashed underline and a pencil icon. The project name follows in muted text ("· Seshboard").
   - The name is filled in from the source (as `defaultTriggerName` does) until you edit it.
   - Remove the Name row.
   - "Edit trigger: <name>" when editing.
2. **The summary** sits under the title, as a block with a light `accent` tint and border. It updates on every change and is a polite live region.
3. **Five section cards,** in a column with a 12px gap. Each card has a border and the card background, and its header has a number in an `accent` circle and the question as its title, at 14px semibold:
   1. **When should it start?** The four source cards, as today.
   2. **Which issues?** (issue triggers) or **Which runs?** (CI).
      - Issues: the segmented control, renamed to "With a label", "Assigned to me" and "Both". Under it, only the fields the choice needs: Label, Assigned to, or both side by side, each with a small label above the field. Then "Only from collaborators", with the reason under it.
      - CI: Branch and Workflows.
   3. **What happens on GitHub?** with "optional" in muted text, for issue triggers only. State labels with their pills and Rename, then "Assign the issue to me when work starts".
   4. **What does it start?** The Session or Pipeline choice, the prompt with its hint, and the Runs with chips. Keep the "from the project" hint.
   5. **Limits.** At once and Waiting, each stepper with its meaning on the same line: "sessions at once" with "A session counts while it works or waits for you", and "events waiting" with "Oldest first. Past 10, new ones are skipped." In the project folder, the first stepper is fixed at 1 with its reason, as today.
4. **Folding.**
   - Section 3 folds to one line when both of its options are off: "What happens on GitHub? Nothing: no labels, no assignee", with Change on the right. New issue triggers start with it folded.
   - Limits folds to "3 sessions at once, up to 10 events waiting", with Change. It's folded when both are at their defaults.
   - A section with a problem (`formProblem`) never folds, and opens if it was folded.
   - CI triggers number their sections 1, 2, 4 and 5 as 1 to 4. Number them by position, not with fixed numbers.
5. **The shared-repository warning** (`sharedRepoWarning`) moves inside section 2, under the fields. Its text points to the fix by section: "Pick Both, or turn on state labels in 3." Update the text in one place, with its test.
6. **The footer** stays the same: the seen line, Cancel with Esc, and Create trigger with ⌘↵.
7. **The dialog** scrolls inside its body. The title, the summary and the footer stay put. The summary scrolls with the body only when the window is short (under 700px).

## Step 3: tidy up

- Remove the old small-caps section headings and the empty label column.
- The left label column goes away inside the cards. Labels sit above their fields, which gives the prompt and the chips the full width.
- Keep every `data-*` hook the smoke steps use today, and add `data-trigger-section="when|which|github|start|limits"` and `data-trigger-summary`.

## Accessibility

- Each card is a `section` (or `fieldset`) labelled by its question.
- A folded section's Change button has `aria-expanded` and `aria-controls`.
- The editable title has a visible label for screen readers: "Trigger name".

## Tests and smoke

- **Unit tests:**
  - `triggerSummary` for CI with and without workflows, the three issue choices, session and pipeline, in the folder and in a worktree, the limit at 1, and incomplete forms
  - the fold rules
  - section numbering for CI and issues
- **Update the trigger smoke step:**
  1. Open New trigger and check the summary for Issues for you.
  2. Switch to With a label and check that the Assigned to field is hidden.
  3. Open section 3, turn on state labels, and create.

## Docs

- CHANGELOG.md, under `## [Unreleased]`: "The trigger editor is easier to follow: five numbered sections, and a sentence at the top that says what the trigger will do."
- Update the `features.json` entry for the trigger editor if its text describes the layout.
- Writing rules from AGENTS.md: plain short sentences, no em dashes, the exact labels from the UI.

## Done when

- New trigger and Edit trigger show the title with the name, the summary and the five sections, with the right ones folded.
- The summary always matches the form.
- Nothing about saving or validation changed.
- It works in light and dark, at the smallest window size, on macOS and Windows.
- `npm run check` and `npm run smoke:demo` pass.
