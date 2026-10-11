# Windows support

The plan for running Switchboard on Windows with the same features as on macOS. It is written for whoever does the work (a person or an agent); the README stays about using the app.

Status: **All three phases done, checked on Windows and macOS.** See the outcome of each phase below. The first Windows release needs Windows signing set up (decision 9).

## Where we start

Measured on Windows 11 (x64) with Node 24.13, Git for Windows 2.53 and the native Claude Code install (`%USERPROFILE%\.local\bin\claude.exe`), on commit `727ed7f`:

| Check | Result |
|---|---|
| `npm install` | Works. `node-pty` ships `win32-x64` and `win32-arm64` prebuilds. |
| `npm run typecheck` | Passes in every package. |
| `npm run build` | Passes. |
| `npm test` | 966 of 1049 pass. 78 fail in 19 files. |
| `npm run smoke` | 26 of 54 steps pass. The app starts, the engine reads real sessions, and the sidebar, transcripts, archive, rename, multi-select, the usage band and the quit prompt work. |

The failures come from a small number of causes:

1. **Paths must start with `/`.** Six zod schemas in `packages/protocol` (`contract.ts`, `backup.ts`, `companion.ts`, `context.ts`, `later.ts`, `sessions.ts`) and about ten checks in the UI treat "starts with `/`" as "is an absolute path". Adding a project, a profile, a queued item, an action, a quick question or a backup fails.
2. **`claude.exe` is not found.** `claudeBinary.ts` looks for `claude` without an extension, so nothing that starts Claude Code works.
3. **No `$SHELL`.** The terminal panel and project actions fall back to `/bin/zsh`.
4. **Unix socket.** The companion server listens on a socket file under a `0700` folder; on Windows it needs a named pipe.
5. **Paths with `\`.** File search returns `src\main.ts` while everything else (git, the UI) uses `/`.
6. **Renaming an open file.** The cache database is moved aside while SQLite still has it open, which Windows refuses.
7. **Test setup only:**
   - Git checks text files out with CRLF (`core.autocrlf=true`), which breaks tests that compare the README, `docs/themes.md` and the theme schema.
   - Temporary git repos get CRLF files.
   - Temporary folders can't be deleted while a SQLite file or a watcher in them is open.
   - Creating symlinks needs Developer Mode or admin rights.
   - Fixtures are POSIX (`/bin/sh` scripts, `/Users/me/...`, `:` as the PATH separator, `a*.txt`, which is not a valid file name).

What Claude Code does on Windows, which the plan relies on:

- The native installer puts a real `claude.exe` (not a link) in `%USERPROFILE%\.local\bin`, with versions in `%USERPROFILE%\.local\share\claude\versions`. npm installs add `claude.cmd` next to `npm`.
- The config folder is `%USERPROFILE%\.claude`. Project folders are named after the path with `:` and `\` replaced by `-` (`C--Users-me`, `E--repos-switchboard`).
- `bash.exe` on PATH may be WSL's (`C:\Windows\System32\bash.exe`), not Git Bash. Never take it as the user's shell.

## Principles

- **One place per platform question.** Shell choice, absolute-path checks, executable names and data folders each live in one module. Callers don't test `process.platform` themselves.
- **macOS stays exactly as it is.** Every change keeps the macOS code path and its tests unchanged in behaviour.
- **Pure helpers take the platform as a parameter** (`platform = process.platform`, using `path.posix` or `path.win32` to match). The existing macOS tests then run on Windows too, and new Windows cases run on a Mac. CI on either OS covers both.
- **Paths inside the app use the OS form; paths shown or matched against git use `/`.** Relative paths from the engine to the UI (file search, changes) always use `/`, as git does.
- **Skip only what can't run.** A test is skipped on Windows only for a real limit (symlinks without rights, `*` in a file name). The reason goes in the skip condition. A feature that isn't ported yet keeps its tests running and failing, unless it's tracked in this plan with a phase.

## Phase 1: usable on Windows

Goal: `npm run check` passes on Windows and macOS. On Windows you can add projects and profiles, start and continue sessions, use the terminal panel, run project actions, and @-mention files. Most smoke steps pass.

### 1.1 Line endings

- Add `.gitattributes` with `* text=auto eol=lf`, plus `binary` for images and fonts. Windows checkouts then match what the generators and tests write.
- Temporary repos in tests set `core.autocrlf=false` so a user's global Git config can't change what the tests read.

### 1.2 Absolute paths

- New `packages/protocol/src/paths.ts`, plain TypeScript, exported from `.` and `./client`:
  - `isAbsolutePath(path)` accepts `/…` and a drive path (`C:\…`, `C:/…`), and refuses UNC and relative paths.
- One shared zod `AbsolutePath` built on it replaces the six copies in the protocol.
- The UI's `startsWith('/')` checks call `isAbsolutePath`: actions, the palette context, project tiles, the project menu, the shortcuts sheet, context items, drafts and transcript file links.
- The profile dialog's message names both forms ("a full path to the folder, like /Users/you/… or C:\Users\you\…"); it says only the one for the current platform.

### 1.3 Finding Claude Code

- `claudeCandidates(env, home, platform)`:
  - on Windows, tries `claude.exe` on each PATH entry, then `%USERPROFILE%\.local\bin\claude.exe`;
  - drops the Homebrew and `/usr/local` locations.
  - npm's `claude.cmd` shim moved to 2.7: Node can't run a `.cmd` without a shell, and whether the SDK can is still to be checked.
- On Windows the variable is often spelled `Path` (an app started from the Start menu gets it that way). The engine renames it to `PATH` once, where it reads the environment (`withUpperCasePath` in `shellEnv.ts`), so every lookup finds it.
- `detectInstall` takes the platform:
  - On Windows, `%USERPROFILE%\.local\bin\claude.exe` is the native install (it's a copy, not a link), updated with `claude update`.
  - npm installs are found by `node_modules\@anthropic-ai\claude-code` and use the `npm.cmd` next to them.
- Tests pass `'darwin'` for the existing cases and add Windows cases.

### 1.4 Shell and terminals

- New `packages/engine/src/system/shell.ts`:
  - `userShell(env, platform)` returns the shell file and the arguments for "interactive", "run this command line" and "login".
  - macOS and Linux: `$SHELL` (default `/bin/zsh`), with `-l` and `-ilc <cmd>` as today.
  - Windows: `pwsh.exe` when it's on PATH, else `powershell.exe`, with `-NoLogo` and `-NoLogo -Command <cmd>`. A setting to choose cmd or Git Bash is phase 2.
- `TerminalManager` and the engine's action runner use it instead of `env.SHELL || '/bin/zsh'`.
- Stopping on Windows:
  - Ctrl+C goes in through ConPTY, as today.
  - The escalation skips `process.kill(-pid)` (no process groups) and calls node-pty's `kill()` without a signal, which ends the console's processes: the shell and what it started.
- `expandCommand` quotes variables for the shell in use:
  - POSIX: single quotes as today.
  - PowerShell: single quotes with `''` doubling.
  - The injection test runs for each shell that exists on the machine.
- `ensureSpawnHelperExecutable` already returns early on Windows.

### 1.5 File search and paths from the engine

- `walk` returns paths with `/` (`relative(...).split(sep).join('/')`), like `git ls-files`.
- `FileIndex.resolve` accepts `~\` as well as `~/`, and matches `/` and `\` in mentioned paths the same way.

### 1.6 Cache database

- `openAndMigrate` closes the connection before `moveAside` on Windows, where an open file can't be renamed.
- To keep the last commits, checkpoint the WAL into the main file before closing (`PRAGMA wal_checkpoint(TRUNCATE)`, ignoring errors on a corrupt file). Then the WAL is either merged or still there to move with it.
- The tests for "moves the WAL along" check both platforms' behaviour.

### 1.7 Tests

- Fixtures use `join`, `delimiter` and `tmpdir()` instead of `/Users/me`, `:` and `/tmp`. Pure helpers get `platform` arguments as above.
- Tests close databases, indexes and watchers before deleting their temporary folders. `rmSync` gets `maxRetries` for the short window after a close on Windows.
- A `canSymlink()` helper (it tries once, in a temp folder) gates the symlink tests with `it.skipIf`.
- `a*.txt` (invalid on Windows) is skipped there, with the reason.
- Shell-script fakes (`#!/bin/sh` that prints a version) get a `.cmd` twin on Windows.
- The companion tests stay red on Windows until 2.4. They are skipped there with `it.skipIf(win32)` and a pointer to this plan, so `npm run check` is green but the gap stays visible.

### 1.8 Smoke run

- Run `npm run smoke` on Windows. Fix what comes from 1.1 to 1.7. List the remaining failures here under the phase that owns them.
- The smoke script itself must run on Windows (paths, the `.smoke` folder, quitting the app).

### 1.9 Deep links (moved here from 2.3)

The queue's smoke step fills New session through a `switchboard://` link, so links had to take Windows folders in phase 1.
- `parseDeepLink(raw, platform)`: on Windows a folder is a drive path (`C:\…` or `C:/…`).
- Still refused there: `/…` (it means "the current drive"), `C:folder`, UNC and other network paths, `.` and `..` segments, and a colon after the drive (an alternate data stream).
- The macOS rules are unchanged.

**Done when:**
- `npm run check` passes on Windows and on macOS.
- On Windows you can add a project and a profile, start a session that answers (with `SWITCHBOARD_SMOKE_LIVE_CWD` on a throwaway repo), open the terminal, run an action, and @-mention a file.
- The remaining smoke failures are listed here.

### Phase 1 outcome

Measured on the same Windows 11 machine, with `main` of 10 October merged in (the project page, worktrees and branches):

| Check | Before | After |
|---|---|---|
| `npm run check` | 78 tests failed | Passes: 1115 passed, 23 skipped |
| `npm run smoke` | 26 of 54 steps | 58 of 59 steps |

On macOS 26.6 the branch passes `npm run check` (1129 passed) and the same smoke steps as `main`. The one step that fails there on every run, "action terminal" (Stop doesn't end `sleep 60`), fails on `main` too.

The skipped tests on Windows:
- the companion's socket tests (9), until 2.4;
- the updater suite (7), whose fake install is a shell script behind a symlink, until 2.7;
- one test that needs symlinks (it runs with Developer Mode);
- the `/bin/sh` quoting test (PowerShell has its own);
- the 5 that were already skipped everywhere.

The one smoke failure left is the VS Code companion (2.4).

Still open for phase 1:
- A live session through the SDK on Windows (`SWITCHBOARD_SMOKE_LIVE_CWD` on a throwaway repo).

Real bugs found and fixed on the way, beyond those in "Where we start":
- **Paths from git.** Git prints `C:/…` on Windows. `worktreeStatus` returned that form, and compared it with `C:\…`, so every checkout counted as a worktree. Git paths now go through `resolve` (`topLevel` in `gitChanges.ts`).
- **Stop.** node-pty throws on a signal on Windows, and the manager swallowed the error, so Stop never stopped anything. It now calls `kill()` without a signal there.
- **Moving a corrupt database aside.** Windows can't rename an open file, and closing the connection deletes its WAL. On Windows the WAL and shared memory are copied aside first, and the database is moved after closing.
- **The quick-questions folder and the session folders offered as projects** only recognised `/` paths.
- **The protocol takes only the local form of an absolute path** (`isLocalAbsolutePath`): a drive path on Windows, `/…` elsewhere. `C:\x` on a Mac, or `/x` on Windows, would be read relative to something. The UI keeps the lenient `isAbsolutePath`, which only tells folders from filter values. What reads the disk uses the local form too: the theme file check in main, and the folders with sessions that the engine offers as projects.
- **A drive root keeps its separator** when trailing ones are trimmed (`trimTrailingSeparators`): `C:\\` in a link or `E:/` typed in New session stays the root, not `C:` (the current folder on that drive).

Changes to the smoke test:
- **Running sessions are left alone.** The smoke test used to pick the newest session with messages, even one running in Claude Code at that moment, then type drafts into it and run its test actions in that project's folder. On this machine that was another live Claude Code desktop session. Steps that pick a session now skip `runningSessions()`: Claude Code's live registry and Switchboard's own hosts, plus `CLAUDE_CODE_SESSION_ID`, the session that started the run. The session whose folder later steps use also isn't one in a running session's folder or inside it (`inRunningFolder`). A folder around it, such as the main checkout while a session works in one of its worktrees, is another folder. AGENTS.md says so.
- **Fixes for races and assumptions** that any machine can hit:
  - the Changes button shows until the engine answers that a folder isn't a git checkout;
  - the Archived dock was measured while it was still sliding;
  - a short list can't scroll the Archived header up.
- The terminal and action steps type commands that PowerShell understands.
- **A tooltip waiting to show was dropped by any scroll in the window**, so while the conversation scrolled to its end (as it does while Claude writes, or after the sidebar is resized) a sidebar button's tooltip never showed. Only a scroll around the target hides it now. The controls step failed on about half the Windows runs because of it.
- The smoke test's check for running sessions fails closed: before the engine is connected, no session counts as safe.
- Tests use the temp folder's long name: GitHub's Windows runners name it by its 8.3 short name (`RUNNER~1`), while git and PowerShell print the long one (`vitest.setup.ts`).

From the code review:
- **Values in actions on Windows.** No quoting is safe for every program there: when an action calls a `.cmd` or `.bat` program (gradlew.bat, mvnw.cmd), `cmd.exe` reads its arguments again, so a branch named `x&whoami` would run `whoami`. An action now refuses to run when a value it uses holds `& | < > ^ % ! "`, a line break or a NUL, and says which one (`UNSAFE_VALUE`, `windowsUnsafe` in `shell.ts`).
- **Quotes for Windows PowerShell 5.1.** It hands an argument to a program without escaping its double quotes, so a commit message `a "b" --amend` reached git as several arguments. `windowsPowershellQuote` escapes them the way programs read them. PowerShell 7.3 and later do that themselves; 7.0 to 7.2 don't, so `userShell` reads pwsh's version from the `pwsh.deps.json` next to it and quotes for those as for 5.1. Commit messages and branch names only go to `git.exe` and `gh.exe`, so they need no refusing.
- **`-ExecutionPolicy Bypass`**, for the PowerShell Switchboard starts only: Windows PowerShell refuses scripts by default, and `npm`, `npx` and `pnpm` are `.ps1` scripts there. A policy set by Group Policy still wins.
- **Exit codes:** PowerShell reports any failure as 1; the program's own code is passed on now, as a POSIX shell does.
- **The trash guard** resolves folders to their long names on Windows and refuses a colon after the drive, so `.git` can't be reached as `GIT~1` or as the NTFS stream `.git::$INDEX_ALLOCATION`.
- **Known limit:** a command runs as `-EncodedCommand` (base64 of UTF-16), which makes it about 2.7 times longer, so one over roughly 12,000 characters exceeds Windows' 32,767-character command line and fails to start.

Found on the way, for later phases:
- **ConPTY drops output** a process prints right before it exits (a known node-pty behaviour on Windows). The terminal test waits for the output before exiting. Check whether actions lose their last lines (2.6).
- **Windows PowerShell 5.1 has no `&&`.** The pull-request command (`git push && gh pr create`) and many people's actions use it. PowerShell 7 has it. Detect it, or join commands the shell's way (2.6).
- **Stop on Windows shows "Failed (exit 1)"**, where macOS shows "Failed (exit 130)". It may read better as "Stopped" on both (2.6).
- **Windows can't delete or rename a folder that is a running process's working folder.** New session warms up Claude Code in the chosen folder, so that folder is locked while it's warm (2.9).
- **Node 24's `rmSync` doesn't retry** `EPERM`/`EBUSY` on Windows, even with `maxRetries`. Tests delete their folders with `removeDir` (`packages/engine/src/util/removeDir.ts`), which retries, and close databases and watchers first.

## Phase 2: the same features as on macOS

Goal: every feature in the README works on Windows, and looks and feels native there.

### 2.1 Window and menu

- `createWindow`: on Windows, use `titleBarStyle: 'hidden'` with `titleBarOverlay` (colours from the active theme, updated on theme and scheme changes), instead of `hiddenInset` and the traffic lights.
- The renderer gets the platform through the preload (`window.switchboard.platform` already exists). The UI then makes room for the window controls on the right instead of the traffic lights on the left:
  - `SidebarToggle` and `SidebarRail`;
  - `sidebarStore` and `sidebarWidth` (the 80px rail exists for the traffic lights; on Windows it can be narrower);
  - the header of every view, with drag regions checked.
- The `windowButtons` IPC does nothing on Windows.
- The menu: on Windows a File / Edit / View / Window / Help menu without `services`, `hide` and `hideOthers`. About, Check for Updates and Settings move to Help and File. Decide whether the menu bar shows, or hides behind Alt (`autoHideMenuBar`). The app already has a command palette, so hidden is likely right.
- `window-all-closed` quits on Windows (already in place). Check that this matches the quit guard and the notifier.

### 2.2 Keyboard shortcuts

- `normalizeShortcut`: `mod` means `cmd` on macOS and `ctrl` on Windows.
- `KEY_GLYPHS` on Windows: words (`Ctrl`, `Alt`, `Shift`, `Enter`) instead of ⌘⌥⇧↩.
- `formatKeys` and `KeyCombo` join keys with `+` there.
- Review the 62 entries in `SHORTCUTS` against Windows conventions and what Chromium, the OS and xterm keep:
  - `mod+q mod+q` (quit): use Alt+F4 / Ctrl+Q?
  - `ctrl+tab` for switching sessions: fine on Windows.
  - Anything that already uses `ctrl` and would collide with `mod` once `mod` is Ctrl.
  - `alt+click`.
- Record the choices in the registry (a per-platform `keys` override where needed). Extend the overlap test to check both platforms.
- Shortcuts people saved: stored as `cmd+…`. Map `cmd` to `ctrl` when reading them on Windows, and test it.
- `npm run docs:shortcuts`: the README table stays macOS (Windows keys in a second column, or a note that ⌘ is Ctrl there). Decide with the maintainer.
- Text: no hand-written "⌘" anywhere (already a rule); check copy that says "Mac" or "Finder".

### 2.3 Paths in the UI

- Audit every `split('/')`, `lastIndexOf('/')`, `startsWith('~/')` and `endsWith('/')` on a filesystem path. About 35 files are listed in "Where we start". Give the UI path helpers in `packages/protocol/src/paths.ts`, plain TypeScript with no `node:path`:
  - `basename`, `dirname`, `joinPath`, `samePath` (case-insensitive on Windows), `tildify`, `isInside`.
- Places to check:
  - the sidebar's project names and grouping;
  - New session's folder field and suggestions;
  - project tiles, the changes panel, context chips;
  - transcript file links (`fileRefs.ts`, `TranscriptItem.tsx`), the search dialog, backup dialogs, theme import, drafts and `format.ts`.
- Engine side:
  - `projectResolver` (worktree detection already accepts `\`);
  - `projectRegistry`;
  - `git/remotes.ts`;
  - `trashGuard.ts`, which must stay strict on Windows: case-insensitive drive letters and `\\?\` prefixes must not open a way around it.
- Deep links: done in 1.9.

### 2.4 VS Code companion over a named pipe

- `companionServer.ts` on Windows:
  - listens on `\\.\pipe\switchboard-<random>`. The random name and the token in `engine.json` take the place of the `0700` folder.
  - Optionally restrict the pipe to the current user with a security descriptor. Node can't set one, so rely on the token and an unguessable name, and note it in `docs/vscode-companion.md`.
- `engine.json` lives under `%APPDATA%\Switchboard\companion` (Electron's `userData`). `APP_DATA_FOLDERS` and `discovery.ts` in the extension look there on Windows, and accept a pipe name as `socket`.
- `connection.ts` connects to the pipe; `createConnection` takes it as is.
- Un-skip the companion tests from 1.7.
- Release a new extension version (`apps/vscode-extension/CHANGELOG.md`, only when asked).

### 2.5 Editors, file managers and terminals

- `editors.ts` on Windows:
  - **Detection:** find the CLIs on PATH (`code`, `code-insiders`, `cursor`, `windsurf`, `zed`, the JetBrains launchers, `subl`). Then look in the usual install folders (`%LOCALAPPDATA%\Programs\Microsoft VS Code\bin\code.cmd`, `%PROGRAMFILES%\…`), and optionally read the uninstall entries in the registry.
  - **Explorer replaces Finder:** `explorer.exe <folder>`, or `explorer.exe /select,<file>`; or `shell.showItemInFolder` through main.
  - **Terminals:** Windows Terminal (`wt.exe -d <folder>`), PowerShell and Git Bash replace Terminal, iTerm2, Ghostty and Warp.
  - Without a CLI, open the file with its default app (`shell.openPath`).
- Spawning `.cmd` files needs `shell: true` or `cmd /c`; quote the arguments properly.
- `continueInEditor` and `claudeExtensionUrl`: open `vscode://` and `cursor://` links with `shell.openExternal` (main), not `open`.
- `terminalFont.ts`: VS Code, Cursor and Ghostty settings under `%APPDATA%\<app>\User\settings.json`, plus Windows Terminal's `settings.json` (`profiles.defaults.font.face`).
- Labels: "Reveal in Explorer" instead of "Reveal in Finder" (text follows the platform).

### 2.6 Shell choice and environment

- Settings → Terminal: choose PowerShell 7, Windows PowerShell, Command Prompt or Git Bash (when found), stored as a preference. The default is from 1.4.
- Actions run in the chosen shell with matching quoting (cmd's quoting is its own; `^`-escaping or refusing variables that cmd can't quote safely).
- `resolveShellEnv` on Windows: the process environment is already complete for apps started from the Start menu, so no login-shell read. Check that PATH changes made after Switchboard starts are picked up (re-read `HKCU\Environment` and `HKLM\…\Environment`, or tell the user to restart).
- Claude Code on Windows can need Git Bash. Detect `CLAUDE_CODE_GIT_BASH_PATH` or Git for Windows. If Claude Code reports it missing, show a clear message on the Home and New session views, with a link to install Git.

### 2.7 Claude Code updates

- Finding an npm install on Windows: `claude.cmd` on PATH points at `node_modules\@anthropic-ai\claude-code\cli.js`. Use that file if the SDK can run it, and read the version with `node cli.js --version`.
- `claudeUpdater.ts` on Windows: `claude update` for the native install (already detected, 1.3), and `npm.cmd install -g @anthropic-ai/claude-code@<channel>` for npm installs. WinGet installs (if present) show the command to type (`winget upgrade Anthropic.ClaudeCode`) without running it.
- The test fakes (1.7) cover these.

### 2.8 Notifications, taskbar and focus

- Notifications:
  - set `app.setAppUserModelId('dev.switchboard.app')` before the first notification;
  - check that clicking one opens the session, with the window closed and open;
  - keep the `shown` set, which matters on Windows too.
- The dock badge becomes a taskbar overlay icon (`win.setOverlayIcon`) with the count of sessions that need you, and `win.flashFrame(true)` when one starts needing you while the window is in the background.
- `focusWindow`: `app.focus({ steal: true })` is macOS-only; on Windows use `win.show(); win.focus()`. If the OS blocks taking focus, flash the taskbar button.
- `attention.ts` comments and docs say "dock badge"; use neutral words.

### 2.9 Trash, data folder and file names

- `shell.trashItem` sends to the Recycle Bin. Run the trash guard's tests with Windows paths (case-insensitive, drive letters).
- The data folder is `%APPDATA%\Switchboard` (and `Switchboard Dev`). Check settings export and import between a Mac and a Windows machine: paths in an export are offered for remapping (`settingsTransfer.ts`).
- Long paths (over 260 characters) in worktrees: test a deep `.claude\worktrees\…` path with git and node-pty.

### 2.10 Copy and docs

- Text in the UI that names macOS things (Finder, Dock, ⌘ in hand-written text, "on this Mac") follows the platform.
- README: a Windows section (install, shortcuts, where data lives). `docs/development.md`: Windows prerequisites (Node 24, Git for Windows, Developer Mode for the symlink tests, the Visual Studio build tools are not needed thanks to the prebuilds).

**Done when:**
- Every smoke step passes on Windows, with the steps that check ⌘ keys and traffic lights asking for the Windows versions.
- A manual pass through the README's feature list on Windows finds nothing missing.
- Screenshots of the main views look right in light and dark mode.

### Phase 2 outcome

On branch `feat/windows-feature-parity`, one commit per section, with phase 1 and `main` of 10 October merged in. On Windows `npm run check` passes (1150 tests, 14 skipped: the symlink test without Developer Mode, the POSIX-only fakes, and the ones skipped everywhere) and so do all 59 smoke steps. On macOS 26.6 `npm run check` passes (1152 tests) and 58 of 59 smoke steps: the one failure, "action terminal", fails on `main` too. A review of the diff for macOS found no change in behaviour there.

What was done differently from the plan above, and why:
- **2.1 Window:** the system's own title bar on Windows, not `titleBarOverlay`. The overlay puts the window buttons over the top-right corner, and three different headers end up there (the conversation, Changes, a terminal docked right), each of which would need room for them. The native frame follows light and dark mode (`nativeTheme.themeSource`). Moving to the overlay is polish for later.
- **2.2 Shortcuts in the terminal:** Ctrl keys are the shell's and Ctrl+Shift keys are Switchboard's (as in Windows Terminal), with Ctrl+C copying a selection and Ctrl+V pasting. VS Code instead lets its own shortcuts (Ctrl+B, Ctrl+P) win over the shell. Decision 7 below.
- **2.6 Shell choice:** not built. macOS has no picker either (it's `$SHELL`), and safe quoting for Command Prompt is hard (`%VAR%` expands inside quotes). What was fixed instead:
  - chained commands work in Windows PowerShell 5.1 (`UserShell.sequence`, no `&&` there);
  - the environment on Windows is the process's own, with `PATH` under that name;
  - diagnostics name the real shell.
- **2.7 Claude Code updates:** the npm package's command is now a native `bin\claude.exe`, which is found next to npm's `claude.cmd` shim and runs without a shell. A WinGet install shows its command (`winget upgrade Anthropic.ClaudeCode`) instead of running it.
- **2.9 Long paths:** git runs with `core.longpaths` on Windows. Without it Git for Windows leaves out files whose full path is over 260 characters without an error, so they were missing from Changes.
- **Not reproduced:** the ConPTY concern from phase 1 (output lost at exit). 15 short actions in a row kept their last line; only an interactive shell typing `exit` lost its final output.

From the code review:
- **The VS Code companion connected where `engine.json` said.** On Windows it took any `\\.\pipe\…` name, and Windows reads `/` and `..` in one (`\\.\pipe\x/../../UNC/server/pipe/y` is a pipe on another computer). The App Data Folder setting could come from a workspace's `.vscode/settings.json`, in Restricted Mode too, and could name a network share, which Windows signs in to just to read it. Now the extension takes only the pipe the engine makes (`switchboard-` and 32 hex digits), the setting is user-level only (`application` scope, and restricted in untrusted workspaces), and a folder that isn't on this computer is ignored.
- **The extension started and showed Switchboard with macOS's `open`.** On Windows it opens `switchboard://` links through the system's URL handler (`rundll32 url.dll,FileProtocolHandler`), and the new `switchboard://show` brings the window up without changing what it shows, as `open -b` does on macOS.
- **Closing the window asked first during a Windows shutdown or sign-out**, which held them up. Switchboard now quits without asking then (`session-end`).
- **Updating an npm install** names its prefix (`npm install -g --prefix …`), as another npm first on PATH would install into its own. When it fails, it says to stop the sessions first: Windows can't replace a `claude.exe` that runs.
- **A WinGet install for every user** (`C:\Program Files\WinGet\Packages`) is recognised too.
- **Delayed expansion:** `cmd.exe` runs with `/v:off`, so a user who turned delayed expansion on in the registry doesn't get `!PATH!` in a file name replaced.
- **Branch names in tooltips** keep a `+`: only the key text goes through `localizeKeys`.
- **Windows PowerShell 5.1's joined commands** end with the failed command's exit code (an `if` that skipped the rest succeeded).

Found in passing:
- File links to Windows paths were `file://C:%5C…`; now `file:///C:/…`.
- The Changes button shows until the engine answers that a folder isn't a git checkout, then disappears. That's also true on macOS, with a 500 ms delay; a smoke step raced it.
- Under memory pressure (2–3 GB free), Electron's GPU process can crash while the smoke test takes a screenshot (`UnknownVizError`), and the steps after it fail. That's the machine, not the app: rerun when memory is free.

Still to check by hand on Windows:
- the title bar and menu (Alt) in light and dark mode;
- a real notification and the taskbar dot;
- Continue in VS Code;
- a live session through the SDK (`SWITCHBOARD_SMOKE_LIVE_CWD` on a throwaway repo).

## Phase 3: building and releasing for Windows

Goal: a signed installer that updates itself, built by CI with every release.

### 3.1 Packaging

- `electron-builder.yml`:
  - a `win` section with the `nsis` target for `x64` and `arm64`, and `build/icon.ico` made by `npm run icon`;
  - stop excluding `node-pty/prebuilds/win32-*`, and exclude `darwin-*` from Windows builds instead;
  - per-user install (no admin);
  - `switchboard://` registered by NSIS (`protocols` already covers this);
  - `perMachine: false`.
- `afterPack.mjs` returns early on Windows (it already checks `darwin`).
- `npm run dist` takes the platform: `dist:mac` and `dist:win`. `dist` builds for the current OS.

### 3.2 Updates

- electron-updater with NSIS reads `latest.yml` (`nightly.yml`). Check the updater's states on Windows:
  - no "run from the DMG" case;
  - the install restarts the app;
  - `beforeInstall` and `installFailed` still bring the engine down and back.
- `SWITCHBOARD_MOCK_UPDATES` (`scripts/mock-update-server.ts`) serves the Windows files too, so it can be tested locally.

### 3.3 Signing

- Code signing with an Authenticode certificate. For SmartScreen reputation, an EV certificate or Azure Trusted Signing. **The maintainer gets the certificate and adds the CI secrets. Agents never handle them** (see AGENTS.md → Safety).
- Unsigned builds are fine for testing. The release workflow must never attach an unsigned Windows build, as for macOS.

### 3.4 CI

- `release.yml`: a `windows-latest` job (and `windows-11-arm` when available) that builds, signs, checks the signature (`signtool verify /pa`) and attaches the installer and `latest.yml` to the same release.
- A check workflow on pull requests running `npm run check` on `macos-15` and `windows-latest`, so neither platform breaks the other. Today there is none for the desktop app.
- The smoke test on a Windows runner if it's stable there (it needs a desktop session; GitHub's Windows runners have one).

### 3.5 Distribution

- The GitHub release is the main channel. Optionally a WinGet manifest (the counterpart of the Homebrew cask), kept in this repo like `homebrew/` and pushed by the release workflow.
- `docs/building-and-signing.md` gets a Windows section.

**Done when:**
- A tagged release produces a signed Windows installer next to the `.dmg`.
- Installing it on a clean Windows machine and updating it to the next release both work.

### Phase 3 outcome

On branch `feat/windows-release`. `npm run dist` on Windows 11 builds `Switchboard-<version>-setup.exe` (unsigned without a certificate), `npm run smoke:packaged` passes all 59 steps against the packaged app, and with the mock update feed it is offered an update from `latest.yml`. On macOS the build matches phase 2's (the same files in the app, update settings and `Info.plist`), and the packaged smoke run and the mock update check pass as before. How to build, sign and release is in [Building and signing](building-and-signing.md#windows).

What was done differently from the plan above, and why:
- **3.1 One installer for both architectures**, not one each: electron-builder's default, and `latest.yml` then names one file. It's about twice the download (about 210 MB, nearly all of it Electron); updates download only the changed blocks.
- **3.1 `npm run dist` builds for the OS it runs on** (`scripts/dist.mjs`), rather than `dist:mac` and `dist:win`: neither can be built on the other OS anyway (the `.dmg` is signed and notarised on a Mac, the installer signed on Windows). The script also gives the Windows build the package name `switchboard`, as the per-user installer names its folder after it (it would be `@switchboarddesktop`). Setting it in `electron-builder.yml` would also move the macOS updater's download cache.
- **3.1 Icon:** `npm run icon` makes `build/icon.ico` with Electron, so on any OS, from the tile without macOS's margin and shadow.
- **3.1 `node-pty`:** its install leaves a copy of ConPTY for the build machine's architecture in `build/Release`, which is left out; each app loads `prebuilds/win32-<arch>`. Both architectures' prebuilds stay in each app (a few MB), as file patterns can't tell them apart.
- **3.2 Updater:** no change was needed. Installing shows the installer's progress window and restarts the app (`quitAndInstall(false, true)`): silent would leave the app gone for several seconds with nothing on screen. Closing the window asks first on Windows, but not while quitting to install, as `before-quit` comes before the windows close.
- **3.3 Signing:** code signing certificates can no longer be exported as files, so the workflow supports Azure Trusted Signing (repository variables and an app registration's secret) and, for an older certificate, a `.pfx`.
- **3.4 Windows releases are switched on with a variable** (`WINDOWS_RELEASES` = `true`). Until then the Windows job is skipped, so releases before Windows signing is set up don't show a failed job; once on, a release that can't be signed fails and attaches nothing.
- **3.4 CI:** `check.yml` runs `npm run check` on `macos-15` and `windows-latest` for every pull request and push to `main`. The smoke test isn't run there: it needs a `~/.claude` with real sessions, which a runner doesn't have.
- **Found by the macOS check:** a platform's own `files` list with only `!` patterns packs everything else in `apps/desktop` (the source, the scripts, and locally `.smoke` with screenshots of real sessions). Both lists now repeat `out/**` and `package.json`, and `scripts/dist.mjs` fails the build when `app.asar` holds anything but `out`, `node_modules` and `package.json`.
- **3.5 WinGet:** not done. Its manifest needs the signed installer's URL and checksum, so it follows the first signed release.

From the code review:
- **A Windows preview build got the update feed.** `dist.mjs` passed `-c.extraMetadata.name` next to `--config electron-builder.preview.yml`, and electron-builder then loaded electron-builder.yml on top of the preview config, so its GitHub feed beat `publish: null`. It also read `-c.` values that look like numbers or booleans as such (a certificate profile named `12345`). On Windows, `dist.mjs` now writes the build's own settings into a config file that extends the one asked for (`windowsBuildConfig.mjs`), with any `-c.` options as written; macOS passes its arguments as before. Checked with electron-builder's own config loading, and by building: a preview has no `app-update.yml`.
- **The signature check didn't compare the signer with the publisher.** With Azure signing, the publisher the app checks updates against comes from `AZURE_SIGNING_PUBLISHER`; a typo would have shipped, and installed copies would then refuse every later update. `checkWindowsSignatures.mjs` compares each signer with `publisherName` in both apps' `app-update.yml`, the way electron-updater does (a full DN, every part; a plain name, the CN).
- **Uninstalling removed any `switchboard://` handler**, also one another app or a copy run from elsewhere registered since. It now removes it only when its command starts this install's `Switchboard.exe`.

Still to do, by the maintainer or with them:
- set up signing (decision 5 and 9), set `WINDOWS_RELEASES` to `true`, and publish a release, which runs the Windows job for the first time;
- install that release on a clean Windows PC, and update it to the next one;
- try the Arm64 build on Arm hardware.

## Decisions for the maintainer

These shape the work. The defaults in brackets are what is built until they are decided.

1. **Default shell on Windows** [PowerShell 7 if installed, else Windows PowerShell; no picker in Settings].
2. **Menu bar on Windows** [hidden, shown with Alt].
3. **Quit shortcut on Windows** [Ctrl+Q twice as on macOS; closing the window asks too].
4. **README shortcuts table** [macOS keys, with a note that ⌘ is Ctrl on Windows].
5. **Code signing** [no Windows release until there is a certificate].
6. **Windows on ARM** [built, but tested only when someone has the hardware].
7. **Shortcuts in the terminal on Windows** [Ctrl+Shift keys are Switchboard's, Ctrl keys the shell's; the alternative is VS Code's way, where Switchboard's own shortcuts such as Ctrl+B win over the shell].
8. **Window frame on Windows** [the system's title bar; `titleBarOverlay` for a frameless look is later polish].
9. **How to sign on Windows** [Azure Trusted Signing; a `.pfx` also works if you have an exportable certificate]. It needs an Azure subscription and an identity check by Microsoft.

## Effort

Estimated as agent working time, with a person reviewing and checking the UI between steps:

| Phase | Estimate |
|---|---|
| 1. Usable on Windows | 4 to 8 hours |
| 2. Same features as macOS | 12 to 20 hours |
| 3. Building and releasing | 3 to 5 hours, plus getting a certificate |

Work in small pull requests: one per numbered section, or a few small sections together. Each one must leave `npm run check` and `npm run smoke` green on macOS.
