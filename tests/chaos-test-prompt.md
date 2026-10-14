# Chaos test: find what breaks in Switchboard

You are a chaos and monkey tester for Switchboard, the Electron app in this repository for managing Claude Code sessions. Your job is to break it, then log every way it misbehaves so it can be fixed. The goal is a very stable app, so anything that crashes, hangs, loses data, shows the wrong state or throws an error counts.

**You find and log. You do not fix.** Don't change app code, don't commit, don't push. The only files you write are the report, its artefacts, and additions to the harness in `scripts/chaos/` (new phases, checks, fakes or repro cases). Keep `npx tsc -p scripts/chaos` passing after every change to it.

## 0. Read first

1. `AGENTS.md` (architecture, conventions, the smoke test, safety) and `CLAUDE.md`.
2. `docs/chaos-testing.md`: the harness in `scripts/chaos/`, its sandbox and fakes, the phases, the repro cases and their verdicts, triage. Run `npm run chaos -- --list` to see every phase and case.
3. The last chaos hunt report, `tests/chaos-hunt-*.md` (the newest one), if it is there: its findings (IDs such as `CE1`, `CU9`), what it covered and what it couldn't reach. The repro cases in `scripts/chaos/cases/` carry the same IDs, so they are the record even without the report.
4. `docs/bug-hunt-2026-10-06.md`: an earlier code review. Its report format is the one you use. Its findings are marked fixed; if you hit one again, log it as a **regression** with its old ID.
5. What there is to poke at: the palette registry (`apps/ui/src/components/palette/commands.ts`), the shortcuts registry (`apps/ui/src/lib/shortcuts.ts`), the Settings index (`apps/ui/src/components/settingsSearch/settingsIndex.ts`), the `data-*` hooks in `apps/ui/src/components/`, the protocol contract (`packages/protocol/src/contract.ts`), deep links (`apps/desktop/src/main/deepLink.ts`) and the companion socket (`packages/engine/src/companion/`). Look at `git log` since the last hunt's commit: new features are where new bugs are.

## 1. Safety rules (never break these)

The harness enforces these (`docs/chaos-testing.md`, Safety). If you drive the app any other way, or add to the harness, you enforce them yourself:

- **Never run against real data.** The app runs with `SWITCHBOARD_DRIVEN=1`, `SWITCHBOARD_DRIVEN_PROFILE` inside the sandbox, `HOME`, `USERPROFILE`, `CLAUDE_CONFIG_DIR` and `TMPDIR` pointing into a fresh sandbox (`/private/tmp/sbc-*`) built from `createDemoWorld()`, and a whitelisted environment (no API keys, tokens or Claude Code session variables).
- **Nothing may cost money or reach the outside:** `claude` is a fake that never reaches a model (never link the real one), `gh` is a fake that never reaches GitHub, editors and `open` only log, no pushes, no update downloads. Native dialogs, URLs, Finder and the Trash are stubbed in the main process.
- Before the first action of every run and every 25 actions, the harness checks the window and the app profile for the real home folder, the real user name and `~/Library/Application Support/Switchboard`, and stops with exit code 3. If that happens, stop the hunt and say why.
- **Never use `open switchboard://…`** or anything that goes through Launch Services: it reaches the installed app with the user's real data. Links go to the driven instance only (`openLink` in `lib/ui.ts`).
- Never touch, kill or signal the installed Switchboard (it is probably running, and may be hosting your own session), the user's own `claude` processes, or this Claude Code session. Only kill processes that belong to the run (`childrenOf` the app, or a command line that names the sandbox).
- Filesystem chaos happens only inside the sandbox: call `c.assertInSandbox(path)` before you change anything.
- The test windows open on the user's screen. Tell the user, once, to leave them alone: closing one ends that run (that happened in the last hunt, and three windows closing in the same second looked like an app bug).
- At the end, no sandbox or stray process is left: `ls -d /private/tmp/sbc-*` finds nothing.

## 2. Baseline

1. `npm run check` and `npm run smoke:demo`. Record the results at the top of the report; if either fails, log that first, then carry on.
2. `npx tsc -p scripts/chaos`.
3. `npm run chaos -- --phase repro --fresh` (every case in its own app; 20 to 30 minutes). Its verdicts are the report's **Since the last hunt** section: a case for a chaos finding that now **passes** is fixed; one that still **fails** is still open (don't log it again as new, list it there); a check or an older fixed ID (`D1`, `E2`, `H2`, `check`) that **fails** is a **regression**. A case that fails for a reason other than its finding (a hook it uses is gone, the UI changed) is a harness problem: fix the case, rerun it, and say so.

## 3. Chaos to throw at it

The harness's phases already cover the list below. Run them in rounds with fresh seeds (`npm run chaos:round -- --seed <n> --targeted --parallel 3`: four monkeys, a mixed run and every targeted phase), and go further where they stop. The best bugs come from two things happening at once (`mix`), and from scale (`scale`, `burst`).

| Section | Phases |
|---|---|
| a. Monkey | `monkey`, `mix` |
| b. Speed and repetition | `speed` |
| c. Input fuzzing | `fuzz`, `editors` |
| d. The world changes underneath | `world`, `corrupt`, `scale` |
| e. Processes and timing | `process`, `mix`, `persist` |
| f. Window and environment | `window` |
| g. Edges of the app | `edges` |
| Memory | `leak` |

**a. Monkey.** A random walk over the palette commands, the shortcuts, and every visible clickable `data-*` hook, button, tab, menu item and context menu, weighted towards what is on screen, for thousands of actions per run: clicks, double and triple clicks, right-click and Shift+F10, drags, hover, scroll, shortcuts, Tab and arrows, Escape at random moments, typing in whatever field has focus.

**b. Speed and repetition.** Every shortcut 20 times fast; every dialog, menu, palette step and panel opened and closed 50 times; a button clicked again before its last click finished (Send, Start, Create, Delete, Archive, Revert, Stage, a queued item's Start); sessions, projects, tabs and Settings pages switched faster than they load; back and forward while views load; light, dark, the theme, the sidebar and split view toggled during animations.

**c. Input fuzzing.** In every text field (message box, `/btw`, palette, search, rename, Settings, project actions, theme import, memory): empty, spaces, new lines, one character; just under, at and over `MAX_PROMPT_LENGTH`, a 2 MB paste; emoji with joiners, RTL, combining marks, zero-width and bidi characters, null bytes, control characters, lone surrogates; `<script>`, `{{ }}`, `${}`, unclosed Markdown, a 5,000-line fence; paths that are relative, have `..`, spaces or unicode, are very long, don't exist or point at a file; `@` mentions and `/` commands that don't exist, half typed, or typed fast and deleted.

**d. The world changes underneath.** A project folder deleted, moved, without `.git`, replaced by a file; detached HEAD, a merge conflict, a rebase, no commits, `index.lock`, thousands of untracked files, `a*.txt` and `[id].tsx`, a submodule, a huge binary diff; transcripts added, deleted, cut mid-line, with invalid JSON, 50 MB, an unknown message type, a folder that no longer exists; Claude profile folders added and removed; the profile corrupted while the app is closed (`preferences.json`, a theme, `cache.sqlite` truncated, garbage, an older or newer schema). The app must start, and user choices must survive wherever the cache can be rebuilt.

**e. Processes and timing.** The engine SIGKILLed mid-action and paused with SIGSTOP (the UI must say what happened and recover); a shell and a project action killed while they run; the app quit in the middle of a save, a rename, a revert or an import, then started again; slow `git`; `gh` failing (exit codes, garbage, hanging); `claude` failing, hanging and printing garbage; several sessions started in one folder at once.

**f. Window and environment.** The smallest window, very wide, very short, maximised, full screen; zoom to the limits (set it with `webContents.setZoomLevel`: ⌘+ is a menu accelerator the page's keys don't reach); focus taken away and given back with dialogs, menus and drags open; light and dark, the built-in themes, an imported theme that leaves most tokens out.

**g. Edges.** Deep links well-formed, malformed, too long, with invisible characters, with `..`, `autostart` with every permission mode, at launch (`c.options.extraArgs`), during a reload, over a dialog; the companion socket with garbage, half a message, a huge message, many connections, connect and drop; imports and exports (settings, themes, memory) of empty, wrong, huge and vanishing files.

**Go where the last hunt couldn't.** Its Coverage section lists what stayed out of reach. In the 2026-10-13 hunt that was:

- Anything that needs Claude Code to answer: streaming, permission and question cards, plan cards, Up next draining, interrupts mid-turn, side questions on the engine's real path. The best next step is a fake `claude` that speaks the SDK's stream-json (`init`, an assistant message, a tool use that needs permission, a result), added as a `claude-mode` in `lib/world.ts`. It must still never reach a model.
- The memory editor's fields and the project page's Memory, Actions and Settings tabs.
- Two windows open at once (changes made in one, seen in the other).
- New features since then (`git log`).

## 4. Triage

Not every signal is a bug. Before you log one:

1. **Group** with `node scripts/chaos/triage.ts <runs> --quiet --first '<this round>'`: one group per likely root cause, first seen in the runs that match.
2. **Rule out the harness and the sandbox.** These looked like bugs in the last hunt and weren't:
   - "Not logged in", and sessions "open in another Claude Code window" (the demo's stand-in processes): expected (`--quiet` hides them);
   - toasts that are news ("Switched to Nord"): not failures;
   - focus on `body` after a dialog that was opened while focus was already on `body`: check where focus was before;
   - Escape not closing a shortcut recorder or an inline listbox: by design;
   - no sessions found, or a click that can't reach a row: the monkey left text in the sidebar's search, or a dialog open;
   - "pending for 15 s" right after an engine kill: the app's client rejects those calls when it reconnects.
3. **Reproduce it** with a minimal case in `scripts/chaos/cases/` (a finding ID, an `expect` sentence, a verdict that fails today), and run it three times with `--fresh`. If it doesn't come back, log it as **flaky** with how often you saw it, and give it no case.
4. **Find where it lives.** Read the code (read only) and point at the file and line you believe is at fault, saying how sure you are. Don't guess past what the code shows. Check the user could actually reach it (the real open dialog has file filters, for example): a finding only the harness can reach isn't one.
5. **Deduplicate.** One entry per root cause, with every way you hit it listed under it.

Number new findings after the highest IDs already used in `scripts/chaos/cases/` and the last report, by area: `CE` engine, `CD` desktop main, `CU` UI, `CG` git, `CS` sessions, `CT` terminal, `CX` settings, themes and memory, `CL` deep links and companion.

## 5. The report

Write it to `tests/chaos-hunt-YYYY-MM-DD.md` (today's date; git ignores `tests/chaos-hunt*`), in the format of `docs/bug-hunt-2026-10-06.md`:

- A header: commit, app version, seeds used, how long it ran (wall clock), number of runs and actions, and whether the stop rule or the time limit ended it.
- **Safety**: how the rules above held (what was faked, checked and never matched).
- **Baseline** table: check, smoke, the harness typecheck.
- **Since the last hunt**: the repro verdicts. Fixed, still open, and regressions, by ID.
- **Findings** (new ones only), grouped by area (Engine, Desktop main, UI, Git, Sessions, Terminal, Settings and themes, Deep links and companion), as tables with: ID, Sev, Where, Finding, Status (`open`, `flaky`, `regression of <old ID>`).
  - **H**: crash, hang, data loss, a write outside the sandbox, user choices lost, a security rule broken (for example a deep link that turns off permission prompts).
  - **M**: wrong state shown, a stuck spinner, an error the user can't get out of without restarting, a leak that grows with use, a race that loses an action.
  - **L**: console errors without visible effect, focus or Escape problems, layout that clips or overflows, slow interactions (over 200 ms), small accessibility gaps.
- **Details** under the tables, one section per finding: steps to reproduce (numbered, short enough for a person to follow), expected, actual, the console or log excerpt, the screenshot path, the seed and action log, and its repro case.
- **Coverage**: what you exercised, what you could not reach and why, what you added to the harness, and what you would try next.

Artefacts stay in `tests/chaos-hunt-YYYY-MM-DD/` (the harness's default), with no real paths or names in them: run `node scripts/chaos/scrub.ts` before you finish.

## 6. Pacing and when to stop

- Keep at most four app instances running at once. More makes timing signals (slow evaluates, timeouts) meaningless.
- Rounds take 15 to 30 minutes. To wait for one, poll for its summary files or the round's output with `until …; do sleep 20; done` in the background, and check `date`: background waits have a time limit, and the logs' timestamps are UTC.
- Stop when two full rounds in a row (randoms and targeted phases) find nothing new, or after about four hours, whichever comes first.
- Then: rerun `npm run chaos -- --phase repro --fresh` so the new cases are in the verdicts, finish the report, scrub, check nothing is left in `/private/tmp/sbc-*`, and give a short summary: the number of findings by severity, what got fixed since the last hunt, and the five you would fix first and why.
