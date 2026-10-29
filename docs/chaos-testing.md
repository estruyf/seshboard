# Chaos testing

`scripts/chaos/` drives the built app the way a careless, fast or unlucky person would, and logs everything that goes wrong: console errors, failed or hanging engine calls, error notices, stuck spinners, a window that stops answering, engine exits, memory growth, and broken invariants (Escape closes the top overlay, focus doesn't fall to `body`, header counts match their rows, the changed-file count matches `git status`, choices survive a restart). It also holds a set of repro cases with a verdict each, so a fix can be checked and kept fixed.

It runs on macOS only for now (it uses `ps`, `/usr/bin/git`, `/private/tmp` and shell-script fakes).

## Safety

Every run gets its own sandbox (`/private/tmp/sbc-*`): the README screenshots' demo home (`apps/desktop/scripts/screenshot-demo.ts`) with a remote, branches, worktrees and shared actions added, the app profile, and a temporary folder. Nothing outside it is touched:

- The app runs with `SESHBOARD_DRIVEN=1` and `SESHBOARD_DRIVEN_PROFILE` pointing into the sandbox, so a restart in the same run finds the same profile. `HOME`, `USERPROFILE`, `CLAUDE_CONFIG_DIR` and `TMPDIR` point there too, and the environment is a whitelist: no API keys, tokens or Claude Code session variables.
- `claude` is a fake that never reaches a model. By default it fails like Claude Code without a login; the timing phases make it hang, fail slowly or print garbage. `gh` is a fake that never reaches GitHub. `open`, `code` and other editors only log. A `git` wrapper passes through to the real git and can be slowed down.
- In the main process, open dialogs answer from a queue of sandbox files, save dialogs write into the sandbox, `shell.openExternal`, `openPath` and `showItemInFolder` only log, and the Trash is a folder in the sandbox. File choosers get no file.
- Before the first action and every 25 actions, the window's text and tooltips and every text file in the profile are checked for your home folder, your user name and `Library/Application Support/Seshboard`; a match stops the run (exit code 3) and a round. The real app data folders, `~/.claude/sessions`, `~/.claude/ide`, `~/.claude.json`, `~/.gitconfig` and `~/.zsh_history` are searched for the sandbox's path (anything the app wrote there would mention it).
- Deep links go to the driven instance only (`app.emit('open-url', …)`), never through Launch Services, so the installed app never sees them. Only processes that belong to the run are killed.
- The monkey never quits the app, never types into a terminal, and never presses Enter there.

The windows open on your screen while a run goes. Leave them alone: closing one ends that run.

## Running

```bash
npm run chaos -- --list                                   # the phases and the repro cases
npm run chaos -- --phase monkey --seed 1001 --actions 2500
npm run chaos -- --phase repro                            # every repro case in one app, with verdicts
npm run chaos -- --phase repro --case deadWarm,burst --fresh   # each case in its own app
npm run chaos:round -- --seed 7000 --targeted --parallel 3     # a round: 4 monkeys, a mixed run, every targeted phase
```

`npm run chaos` and `npm run chaos:round` build the app first; `node scripts/chaos/run.ts …` and `node scripts/chaos/round.ts …` skip the build. Every random choice comes from `--seed`, so a run can be replayed (as closely as the app's own timing allows; the action log is the exact record). Runs go to `tests/chaos-hunt-<today>/runs` (git ignores `tests/chaos-hunt*`), or `--out <dir>`.

| Phase | What it does |
|---|---|
| `monkey` | A random walk over everything on screen: clicks (mostly inside the top overlay), double and triple clicks, right-click and Shift+F10, drags, hover, scroll, shortcuts, palette commands, Tab and arrows, Escape, fuzz text. `--actions` steps. |
| `speed` | Every shortcut 20 times fast, dialogs 50 times, sessions and Settings pages switched faster than they load (the last click must win), mouse back and forward, double sends and starts. |
| `fuzz` | Odd text (blank, emoji, RTL, invisible and control characters, markup, paths, `@`, `/`) in every text field, and text around `MAX_PROMPT_LENGTH`, 2 MB and 5,000 lines, typed and pasted. |
| `editors` | The same in the project action editor and new memories, then the saved actions run. |
| `world` | Odd git states, project folders moved or replaced by a file, transcripts cut, invalid, huge or deleted, profile folders removed, all while the app shows them. |
| `process` | The engine SIGKILLed and paused, a shell and an action killed, slow git, `gh` failing four ways, Claude Code hanging and printing garbage. |
| `window` | Sizes down to the minimum, maximise, full screen, zoom, blur and focus with overlays open, the built-in themes, theme imports. |
| `edges` | Deep links of every kind, the companion socket (garbage, huge messages, wrong tokens, 400 connections), imports and exports of bad files. |
| `persist` | Pins, a rename, an archive, a draft, the sidebar and the theme across a restart, a quit right after a rename, and a SIGKILL of the app. |
| `corrupt` | The profile corrupted while the app is closed (preferences, window state, themes, the cache), each variant from the same good profile. |
| `leak` | The heap after GC, DOM nodes, listeners and the engine's RSS over 200 cycles. |
| `scale` | 3,000 sessions written while the app runs. |
| `mix` | The monkey, with the world, the engine, git, `gh`, `claude`, links and the window changing under it at random moments. |
| `repro` | The repro cases. |

A round prints each run's result and the signal groups first seen in that round. Stop when two rounds in a row find nothing new.

## Repro cases

Each case in `scripts/chaos/cases/` has the finding it shows (an ID from a chaos hunt report, an older bug-hunt ID it guards, or `check`), a sentence that says what the app should do, and a verdict: `PASS` when it does, `FAIL` while the problem is still there. The run exits 1 when a case fails and writes the verdicts, with what each case saw, to `repro-<seed>.results.json`. After fixing a finding, its case should pass; leave the case in so it stays fixed.

Cases run in one app in a fixed order: read-only ones first, then those that change the sandbox (`mutates: true`), then those that restart the app. `--fresh` gives each case its own app and sandbox, which is slower and never confused by an earlier case.

To add one, add an entry to the matching file in `cases/` (`overlays`, `ui`, `git`, `sessions`, `links`):

```ts
myCase: {
  finding: 'CU12',
  expect: 'What the app should do, in one sentence.',
  async run(c, note) {
    await openSessionByTitle(c, 'Add dark mode toggle');
    // …drive the page, call the engine with c.rpc(method, params), change the sandbox under c.world.root…
    note('what it saw', value);
    return { ok: /* the expectation holds */ true, saw: value };
  },
},
```

## Reading the results

Every run writes, by `<phase>-<seed>`: `actions.jsonl` (every action, before it runs), `signals.jsonl` (each failure signal once, with the action number), `stderr.log` (the main process and the engine), `summary.json` and `memory.json`. `shots/` has a screenshot and the last 50 actions for every new signal.

```bash
node scripts/chaos/triage.ts [runs-dir] --quiet                    # signals grouped by likely root cause
node scripts/chaos/triage.ts [runs-dir] --quiet --first 'monkey-12' # only groups first seen in those runs
node scripts/chaos/scrub.ts [dir]                                  # real paths and names out of the text artefacts
```

`--quiet` leaves out what the sandbox always produces: no Claude Code login, the demo's stand-in sessions that are "open in another window", news toasts. Not every signal is a bug: confirm each with a repro case or by replaying its seed before you report it, and read the code to find where it lives.

`tests/chaos-test-prompt.md` is the brief for an agent that runs a whole hunt (rounds, triage, a report in the format of `docs/bug-hunt-2026-10-06.md`). Reports and artefacts stay in `tests/`, out of git: they hold screenshots of a run.

## What it can't reach

- Anything that needs Claude Code to answer: streaming, permission and question cards, Up next draining, interrupts mid-turn. The fake `claude` only fails, hangs or prints garbage.
- Native menu accelerators (⌘+, ⌘−, ⌘,, ⌘Q): keys sent to the page don't reach the app menu, so zoom is set with `webContents.setZoomLevel`.
- `window-state.json`: driven mode doesn't save or read it.
- Windows.

## Layout

| Path | What it is |
|---|---|
| `run.ts` | One run: `--phase`, `--seed`, `--actions`, `--case`, `--fresh`, `--out`, `--list`. |
| `round.ts` | A round of runs in parallel, then what was new. |
| `triage.ts`, `scrub.ts` | Grouping signals; scrubbing artefacts. |
| `lib/world.ts` | The sandbox and its fakes (`claudeMode`, `ghMode`, `gitDelay`). |
| `lib/harness.ts` | `Chaos`: launch, restart and quit, the watchers, signals, the action log, `rpc()` on the window's own engine port, the native stubs, the safety checks. |
| `lib/ui.ts` | Page helpers: setup (the Work profile and the projects), overlays, opening sessions and palette commands, links. |
| `lib/monkey.ts`, `lib/checks.ts` | The monkey's step and fuzz inputs; the invariants. |
| `phases/` | One file per phase, registered in `phases/index.ts`. |
| `cases/` | The repro cases. |

Typecheck it with `npx tsc -p scripts/chaos`.
