# GitHub Copilot: adding it and starting with it (#199)

Read AGENTS.md and CLAUDE.md first. This work builds on the `feat/copilot-provider` branch, where profiles already pick the provider. Build Round 52 on the Design canvas: `ProvidersSetup.dc.html`, `ProvidersUse.dc.html` and their sticky notes.

## Goal

The branch works, but getting started takes guesswork:

- Nothing tells you Copilot is supported until you open Add profile.
- After adding, the dialog just closes.
- In New session, switching to a Copilot profile turns Worktree and Pipeline off without saying so.
- There's no quick way to make Copilot the tool for a project.

Make adding Copilot short and clear. Make switching to it in New session say what changed.

Keep what's decided in the issue: a profile is how a provider gets in, and there's no Settings › Providers page. Claude Code stays the default unless the user picks otherwise. Seshboard never handles a Copilot token.

Run the related tests, the typecheck and `npm run smoke:demo -- --only "<step label>"` after each step. The full `npm run check` and `npm run smoke:demo` run once, at the end.

## Step 1: tell the user Copilot CLI is here

1. **The engine can check a provider without a profile.** Add `providers.detect` (or extend `providers.list`) to return, for each provider:
   - whether its CLI is installed, and its version
   - its default folder (`~/.copilot`) and whether it exists
   - how many sessions that folder holds
   - whether it's signed in, and as whom
   Reuse the runtime that `providers.status` uses. Don't start anything heavier than the status check needs, and cache the result for the session.
2. **Settings › Profiles shows an offer** below the list when all of these are true:
   - the CLI is installed
   - no profile uses that provider yet
   - the user hasn't dismissed the offer
3. **The offer** is a dashed card with:
   - the Copilot mark
   - "GitHub Copilot CLI is on this Mac" (use the platform's word for the computer, as elsewhere)
   - "Add it as a profile to see its 38 sessions here and start new ones." Leave the count out when it's 0.
   - two buttons: Add Copilot profile, which opens the add dialog with Copilot already picked, and Not now
4. **Not now** hides the offer for good. Store this in the UI prefs, per provider. Nothing else in the app mentions Copilot until a Copilot profile exists.

## Step 2: the add dialog

`ProfilesSettings.tsx`, the add form:

1. **First screen: "Which tool runs its sessions?"** Each tool is a large choice with its mark and one line:
   - Claude Code: "Another Claude account, in its own folder."
   - GitHub Copilot: "Uses your Copilot CLI. Found copilot 1.0.4", from `providers.detect`.
   - This replaces the "Runs with" segmented control.
2. **If the Copilot CLI is missing,** its choice says so. Show the install command with a copy button, plus Check again, which re-runs detect. Next stays off until the CLI is found.
3. **Second screen:** name, colour and folder, as now.
   - Fill the name with "Copilot".
   - Fill the folder with the provider's own folder (`~/.copilot`) while no profile uses it. Below it: "Copilot CLI's own folder: its login, settings and the sessions you ran in the terminal."
4. **Sign-in only when it's needed:**
   - Already signed in: show a green line, "Already signed in as estruyf in Copilot CLI. Nothing to do.", and the button reads "Add profile".
   - Not signed in: the button reads "Add and sign in". It runs `signInProvider` as now, in Seshboard's terminal with `COPILOT_HOME` set.
5. **Claude Code** keeps its current flow on the second screen.

## Step 3: "Copilot is ready"

After a Copilot profile is added and signed in, the dialog doesn't just close. It shows a last screen:

- **The Copilot mark, "Copilot is ready",** and "Signed in as estruyf · Copilot Pro+".
- **"38 sessions from Copilot CLI now show in the sidebar, marked with Copilot. Claude Code stays your default."** If the sidebar hides sessions from other apps, add: "Turn on Show sessions from other apps to see them", with a link to that setting.
- **Three rows:**
  - **Start a Copilot session:** opens New session with this profile picked, for this session only.
  - **Use Copilot for a project…:** opens the project list. Picking one calls `projects.setProfile`.
  - **Make it the default:** sets the profile as default, after a confirm that names what changes: "New sessions in projects without their own profile start on GitHub Copilot."
- **Done** closes it.

## Step 4: New session

`NewSessionView.tsx` and `ComposerChips.tsx`:

1. **The profile menu groups profiles by tool,** with a small header per tool ("Claude Code", "GitHub Copilot"), and ends with "Add profile…". Leave out the headers when every profile uses the same tool.
2. **Switching to a Copilot profile keeps the prompt and attachments.** Model and mode move to the profile's defaults (its own lists), and effort goes away, as the branch already does.
3. **Say what was turned off.** When the switch turns off something the user had on, show one notice inside the box, above the chips:
   - Worktree: "Worktree turned off. GitHub Copilot can't run in a worktree yet."
   - A branch to check out: the same, for the branch.
   - Run as › Pipeline: "Pipeline turned off. GitHub Copilot can't run pipelines yet."
   - Later or a schedule: the same, for those.
   - The notice ends with "Back to <previous profile>", which restores the profile and the choices it turned off.
   - It goes away on the next change, or when the user switches back.
   - Put the "what turns off" logic in a pure function in `newSession/`, with tests.
4. **Off controls say why.** While a Copilot profile is picked, Worktree, the branch picker, Pipeline and Later are disabled. Their tooltip reads "Not with GitHub Copilot yet", using `PROVIDER_NAMES`. Don't hide them.
5. **The placeholder** reads "What should Copilot work on?". Reuse `agent`.
6. **Make it stick for the project.** The hint under the box ("Changes here are for this session only.") gets a link when the picked profile differs from the project's: "Use Copilot for seshboard from now on". It calls `projects.setProfile`. Afterwards the hint reads "From seshboard's defaults." as for other project defaults.
7. **The usage line** under the box shows the Copilot profile's premium requests ("Copilot · Premium requests 14% · resets Nov 1") in place of the 5-hour and weekly bars.

## Step 5: inside a Copilot session

- **The ⋯ menu** shows only what works for Copilot: Compact, Tools, Copy the last reply, Open in Copilot CLI and Archive. Under a divider, one line in faint text: "Fork, Rewind, Rename and Ask about this session work with Claude Code only, for now." Build the line from the provider's capabilities, so it shrinks as phases ship.
- **The header's status line** starts with the Copilot mark and "GitHub Copilot".
- **The footer** shows "Context 18% · Premium requests 212 of 1,500".

## On the phone

- The Options sheet's Profile row shows the provider's mark.
- Switching to a Copilot profile there shows the same notice as Step 4.3 when it turns something off.

## Accessibility

- The tool choices in the add dialog are a radio group labelled "Which tool runs its sessions?".
- The notice in the box is a polite live region, and its "Back to …" is a button.
- The ⋯ menu's faint line is plain text, not a disabled item, so screen readers don't land on it as an action.

## Tests and smoke

- **Unit tests:**
  - when the offer shows (installed, no profile, not dismissed)
  - what turns off when switching to Copilot, and what "Back" restores
  - the hint link, which shows only when the profile differs from the project's
  - the capability line in ⋯
- **Smoke (demo, with the faked Copilot SDK):**
  1. Open Profiles, and check the offer shows.
  2. Click Add Copilot profile, and check Copilot is picked and the folder reads `~/.copilot`.
  3. Add it while already signed in, and check there's no sign-in step and Copilot is ready shows.
  4. Click Start a Copilot session, and check New session opens on the Copilot profile.
  5. Turn on Worktree with a Claude profile, switch to Copilot, and check the notice. Click Back, and check Worktree is on again.
  6. Click "Use Copilot for <project> from now on", and check the project's profile changed.
- **`data-*` hooks:** `data-provider-offer`, `data-new-profile-tool`, `data-profile-ready`, `data-provider-switch-notice`, `data-use-profile-for-project`.

## Docs

- CHANGELOG.md, under `## [Unreleased]`: "When Seshboard finds Copilot CLI, Profiles offers to add it. Adding a Copilot profile skips sign-in when you're already signed in, and ends with ways to start using it. New session says what it turned off when you switch to Copilot."
- `website/src/content/features.json`: update the GitHub Copilot entry.
- `docs/providers.md`: add `providers.detect`, and say a new provider needs its capability list for the ⋯ line.
- Writing rules from AGENTS.md: plain short sentences, no em dashes, the exact labels from the UI.

## Done when

- A user with Copilot CLI installed sees the offer, adds a profile in two screens, and lands on Copilot is ready.
- Already signed in means no sign-in step.
- Switching to Copilot in New session never turns something off quietly.
- A project can be set to Copilot from New session.
- It works in light and dark, on macOS and Windows.
- `npm run check` and `npm run smoke:demo` pass.
