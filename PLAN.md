# Switchboard: Plan

> Working name: **Switchboard**, a desktop switchboard for your Claude Code sessions. It's easy to rename later.

A fast macOS desktop control surface for Claude Code: start sessions, see what's running, jump between them, and approve or steer Claude without hunting through terminal tabs. It's inspired by [t3code](https://github.com/pingdotgg/t3code), but it only supports Claude Code, so it can go deeper than a multi-agent tool can.

---

## 1. Goals and non-goals

**Goals**
- **One place for every Claude Code session.** That covers sessions started by this app and sessions you started yourself in a terminal, the IDE, or the Claude desktop app.
- **Full Claude Code fidelity.** Your settings, CLAUDE.md, hooks, skills, plugins, subagents, MCP servers, slash commands, permission modes, plan mode, and rewind all work exactly as they do in the CLI.
- **Fast.** The window should be interactive in under 500 ms, the sidebar should fill from cache instantly, typing should never lag, and streaming should stay at 60 fps even in 5k-message sessions.
- **Keyboard-first.** A command palette, quick session switching, and shortcuts for approve, deny, and interrupt.

**Non-goals (v1)**
- Support for other agents (Codex, Cursor and so on). That's t3code's job.
- A mobile app or a web UI. The desktop app is the product; the one exception is **Remote** (below).

**Remote (in progress, #93).** Follow and steer sessions from a paired phone's browser, from anywhere: the session list, the live transcript, sending a prompt, answering a permission prompt, stopping a turn, starting a session in a known project. The engine listens on `127.0.0.1` behind a tunnel (Cloudflare, Tailscale, ngrok or your own), and the phone app is served from Switchboard's site. Pairing needs you at the computer, and every connection is a Noise handshake with the key from the QR code, encrypted end to end through the tunnel. Phase 2: Cloudflare Access in front of a named tunnel (the engine serving the remote app on that hostname) and push notifications. Design, threat model and phase 2: [docs/remote-access.md](docs/remote-access.md).
- Reimplementing Claude Code. We drive the real thing.

---

## 2. How we talk to Claude Code

There are two kinds of session, and each needs a different integration.

### A. App-owned sessions → Claude Agent SDK
For sessions this app creates or resumes, use `@anthropic-ai/claude-agent-sdk` `query()` in **streaming-input mode** (`prompt: AsyncIterable<SDKUserMessage>`). One long-lived `Query` serves each open session. This mode provides:

| Need | SDK surface |
|---|---|
| New / resume / fork | `cwd`, `resume`, `forkSession`, `sessionId` |
| Same behaviour as CLI | `systemPrompt: { type: 'preset', preset: 'claude_code' }`, `settingSources: ['user','project','local']` (loads CLAUDE.md, hooks, skills, plugins, MCP) |
| Live token streaming | `includePartialMessages: true` → `stream_event` deltas |
| Permission prompts in the UI | `canUseTool` callback → inline approve/deny/"always allow" |
| Mid-session controls | `interrupt()`, `setPermissionMode()`, `setModel()`, `stopTask()` |
| Slash-command palette | `supportedCommands()`, `supportedModels()`, `supportedAgents()` |
| MCP panel | `mcpServerStatus()`, `toggleMcpServer()`, `reconnectMcpServer()` |
| Context meter | `getContextUsage()` |
| Rewind / checkpoints | `rewindFiles(userMessageId)` |
| Session list / rename | `listSessions()`, `getSessionInfo()`, `renameSession()`, `tagSession()` |
| Fast first message | `startup()` pre-warm (about 2.4 s → 1.0 s to first token) |
| Live status dot | `session_state_changed` (`running`/`requires_action`/`idle`). **Requires `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` in `env`** |
| Worktree sessions | `extraArgs: { worktree: '<name>' }`, so Claude Code creates the worktree itself |
| Background tasks | `background_tasks_changed` / `task_started` events, `backgroundTasks()`, `stopTask()` |

> Spike results for every row above are in [spike/FINDINGS.md](spike/FINDINGS.md).

**Binary and auth:** set `pathToClaudeCodeExecutable` to the user's installed `claude`, so the app runs the same version, login, and config as their terminal. Run a minimum-version check at startup and fall back to the SDK's bundled binary if `claude` isn't found. ✅ *Spike: this uses the existing subscription login with no API key (`apiKeySource: 'none'`, `subscriptionType: 'Claude Max'`).*

**Engine robustness rule (from the spike):** the SDK can throw *asynchronously* after an interrupted turn. Every `SessionHost` wraps its iterator in try/catch, and the engine installs process-level `uncaughtException`/`unhandledRejection` guards. One broken session must never take down the engine, and with it every other session.

### B. External sessions → read-only discovery, plus a terminal for full control
Sessions started outside the app are discovered from disk:

- **Live registry:** `~/.claude/sessions/<pid>.json`. Each file holds `pid`, `sessionId`, `cwd`, `status` (busy/idle), `name`, `entrypoint` (cli, claude-desktop, …), `updatedAt`, and `messagingSocketPath`. This lets us mark a session as *running*, *waiting* or *idle* without inspecting processes. SDK sessions (including our own) register here too. The engine sets its own `CLAUDE_CODE_ENTRYPOINT` so the app's sessions are tagged correctly. ⚠️ The format is undocumented, so it lives behind an adapter, and we double-check entries with `kill(pid, 0)` plus the `procStart` time to drop stale files.
- **Transcripts:** `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl`, with subagent transcripts in `<sessionId>/subagents/`. We tail these for a live read-only view.
- **Taking over** a session:
  - If the session is idle or its process has exited, resume it as an app-owned SDK session.
  - If it's still running, open it in the **embedded terminal**: `node-pty` + xterm.js running `claude --resume <id>`. The terminal is also the full-fidelity fallback for any TUI-only feature the GUI doesn't render yet.
- We never write to a transcript that another live process owns. If you try to resume a session that's busy in a terminal, the app warns you or offers to fork instead.

> Note: `messagingSocketPath` is a live Unix socket for each session, and `peerProtocol` points to an inter-session messaging channel. It's undocumented and deliberately unused in v1.

---

## 3. Architecture

```
┌──────────────── Electron app ─────────────────┐
│  Renderer (React UI)                           │
│     │  typed RPC over MessagePort              │
│     │  (MessageChannelMain, no network port)   │
│  ┌──▼──────────────────────────────────────┐   │
│  │ Engine (Node, utilityProcess)           │   │
│  │  • SessionHost   – SDK Query per session│   │
│  │  • Discovery     – sessions/ registry   │   │
│  │  • Indexer       – JSONL → SQLite (wkr) │   │
│  │  • PtyHost       – actions + terminals  │   │
│  │  • Git           – status/diff/worktree │   │
│  └─────────────────────────────────────────┘   │
│  Main: windows, tray, notifications, updates   │
└────────────────────────────────────────────────┘
```

**Why this shape**
- **Electron.** The SDK, `node-pty` and SQLite are all Node-native, so everything stays in one familiar runtime. Most of the speed comes from the architecture (caching, virtualization, batching), not the shell.
- **The engine runs in an Electron `utilityProcess`,** so SDK parsing, indexing and git never block the main process or the UI.
- **The renderer talks to the engine over a `MessagePort`** handed over by the main process (`MessageChannelMain`). That means no localhost server, no open port and no auth token, since it's desktop only.
- **The engine is a plain Node package with no Electron imports.** Only `apps/desktop` knows about Electron, so the engine can be unit-tested and run with fixtures straight from Node.
- **The renderer is sandboxed** (`contextIsolation`, no `nodeIntegration`). The preload exposes only the port and a few native helpers: folder picker, open in editor or Finder, and notifications.

**Stack**
- **TypeScript everywhere, in strict mode.** That covers the Electron main process, preload, engine, protocol and UI, with no hand-written `.js` source. `tsc --noEmit` runs per package in CI. Types flow end to end: the engine and UI share the zod schemas in `packages/protocol`, so a protocol change breaks the build, not the app.
- **React 19** for the whole UI (function components and hooks only).
- npm workspaces (pnpm's self-download is blocked by safe-chain on this machine), TypeScript 7, Vite 7 for the renderer, `electron-vite` 5 / `electron-builder` for packaging.
- UI: React 19, TanStack Router, Zustand (one store per session, so updates stay granular), TanStack Virtual, Tailwind + Radix primitives, cmdk for the palette.
- Rendering: `react-markdown` with memoized blocks. Shiki highlighting runs in a Web Worker. Diffs use `@pierre/diffs` or `react-diff-view`.
- Engine: `@anthropic-ai/claude-agent-sdk` (pinned), `node:sqlite` (built into Node 22.5+, so there's no native rebuild) with FTS5, `@parcel/watcher` for file events, `node-pty`, and `simple-git` or a direct `git` CLI.
- Contracts: `zod` schemas shared by engine and UI, plus a small typed RPC layer (request/response plus subscriptions).

**Repo layout**
```
apps/desktop      Electron main + preload, packaging
apps/ui           React renderer
packages/engine   Session host, discovery, indexer, pty, git
packages/protocol zod schemas + RPC client/server
packages/claude   Adapters for on-disk formats (JSONL, sessions registry) + fixtures
```

---

## 4. Data model (SQLite cache, never the source of truth)

```
projects(id, path, git_root, name, last_activity)
sessions(id, project_id, title, origin[app|cli|ide|desktop], status,
         model, created_at, updated_at, jsonl_path, jsonl_offset,
         message_count, cost_usd, parent_session_id, worktree_path, pinned, archived)
messages_fts(session_id, uuid, role, text)   -- FTS5 for global search
project_actions(id, project_id NULL=global, name, icon, type, command,
                cwd_mode, confirm, shortcut, run_on_worktree_create, sort)
trusted_commands(project_id, command_hash)   -- approvals for .switchboard.json actions
app_state(key, value)                        -- UI prefs, default editor, last open session…
```

- **Indexing is incremental.** Each file stores `jsonl_offset` and its mtime, and only newly appended bytes are parsed. The first full scan runs in a worker thread and is throttled.
- **The sidebar renders straight from SQLite on launch.** It doesn't wait for a filesystem scan.
- **The source of truth stays `~/.claude`.** If the cache is deleted, it's rebuilt.

---

## 5. Feature set

### MVP (v0.1)
1. **Sidebar:** projects grouped by git root. Each session shows a status dot (running, needs you, idle, done), title, age, and origin badge. Unread markers, plus pin and archive.
2. **New session** (⌘N): pick one of your projects (or any folder), model, effort and permission mode, then choose **where to work**. Options start from the project's defaults. Section 5.1 covers the options, 5.4 projects.
3. **Chat view:**
   - Streaming markdown and collapsible thinking.
   - Tool cards for Bash (output), Edit/Write (inline diff), Read/Grep/Glob (compact), and TodoWrite (live checklist).
   - Subagent runs nested by `parent_tool_use_id`.
4. **Composer:**
   - Slash-command palette fed by `supportedCommands()`, so custom commands, skills and plugins all appear.
   - `@file` mentions and image paste.
   - You can queue messages while Claude is working, and interrupt with Esc.
5. **Permissions:** inline approval cards from `canUseTool`, offering allow once, always allow (written to settings), and deny with feedback. AskUserQuestion and plan-mode approval get their own UI.
6. **Status bar:** model, permission mode toggle (⇧Tab like the CLI), context-usage meter, and session cost.
7. **External sessions:** live read-only view of terminal sessions, plus "Open in terminal" and "Resume here".
8. **Notifications:** an OS notification and dock badge when a session needs input or finishes, so you can leave it running in the background.
9. **Project actions:** one-click, configurable commands per project (Commit, Publish, Test, Dev server…) in the session header. Section 5.2 covers them.
10. **Open in…** (⌘O): open the session's folder in VS Code (or Cursor, Zed, Finder, Terminal…), and open any file path in the chat at its line. Section 5.3 covers it.

### 5.1 Where a session works (like Claude Code)

The new-session dialog has a **Workspace** toggle that works the same way as Claude Code's own worktree option:

| Option | What happens |
|---|---|
| **Current folder** *(default)* | Claude runs in the chosen folder on whatever branch is checked out, exactly like running `claude` in that directory. |
| **New worktree** | The engine starts the session with `extraArgs: { worktree: '<name>' }`, and **Claude Code creates the worktree itself** at `<repo>/.claude/worktrees/<name>` on branch `worktree-<name>`. The name is generated from the first prompt and can be edited. The dialog offers *Base: fresh from origin* (Claude Code's default) or *current HEAD*, passed through as the `worktree.baseRef` setting. The user's `symlinkDirectories` / `sparsePaths` settings apply automatically. |

- Worktrees go **where Claude Code puts them** (✅ confirmed in the spike), so sessions created by `claude --worktree` in a terminal and sessions created in this app look the same and show up together in the sidebar.
- The **sidebar shows the branch** for every session, with a worktree badge where one applies. Sessions are grouped under their main repo (`listSessions({dir})` already includes worktree sessions). The branch comes from git for the session's cwd, because the transcript's `gitBranch` field can be stale.
- The option is **disabled with a hint** when the folder isn't a git repo.
- When you **archive a worktree session**, the app asks whether to delete the worktree. It warns if there are uncommitted or unpushed changes.
- The **default** is the choice you last made, and can be set per project (✅ in the Projects view, see 5.4).

### 5.2 Project actions

Configurable buttons that run a command for the current project, like t3code's project scripts, with one Claude-specific addition: an action can also **send a prompt to the session** instead of running a shell command.

**Where they appear**
- **Session header toolbar:** the top 2–3 actions as buttons, with the rest in a ▾ menu.
- **Command palette:** every action is listed as *"Run: Publish"*, and each one can have its own shortcut (for example ⌘⇧E for Publish).
- A **"+ Add action"** entry in the menu opens the editor in place, so you never have to go to Settings to create one.

**Definition**
```jsonc
{
  "id": "publish",
  "name": "Publish",
  "icon": "rocket",                       // from a fixed icon set
  "type": "shell",                        // "shell" | "prompt"
  "command": "npm run build && npm publish",
  "cwd": "session",                       // "session" (worktree if any) | "project-root"
  "confirm": true,                        // ask before running (good for publish/deploy)
  "shortcut": "cmd+shift+e",
  "runOnWorktreeCreate": false            // e.g. true for "npm install"
}
```
- **`type: "shell"`** runs in your **login shell** (`$SHELL -lc`), so `nvm`, `PATH` and aliases behave exactly as they do in your terminal. Output streams into a terminal tab in the session's bottom panel (xterm.js on `node-pty`). The tab shows a running spinner, then the exit code ✓/✗, and sends a notification if the window isn't focused. You can stop it, re-run it, or keep it open.
- **`type: "prompt"`** sends text into the session as if you typed it. It can also be a slash command, for example **Commit** = `/commit` or "Commit the staged changes with a conventional-commit message". Claude does the work, and permission prompts appear as normal.
- **Variables** are expanded and shell-escaped before running: `${cwd}`, `${projectRoot}`, `${branch}`, `${worktreeName}`, `${sessionId}`, `${sessionTitle}`.
- **`runOnWorktreeCreate`** actions (such as `npm install` or copying `.env`) run automatically after Claude Code creates a worktree for a new session. The first message waits until they finish.

**Where they're stored (two layers, merged by `id`)**
| Layer | Location | Use |
|---|---|---|
| Personal | App database, per project | Your own actions; the default when you click "+ Add action" |
| Shared | `.switchboard.json` in the repo root (optional, committable) | Team actions that travel with the repo |
| Global | App settings | Actions offered in every project (for example "Open PR in browser") |

Personal overrides shared, which overrides global. **Safety:** commands from a repo's `.switchboard.json` are untrusted. The first time each one runs, you see the exact command and confirm it. That approval is remembered per command hash, so an edited command asks again.

**Starter templates** you can add with one click: *Commit* (prompt `/commit`), *Push*, *Create PR* (`gh pr create --web`), *Test*, *Dev server*, *Install*. Templates are suggested from `package.json` scripts when present.

### 5.3 Open in editor

- An **"Open in" split button** in the session header. The main part opens the session's folder (the worktree if there is one) in your **default editor**; the ▾ lists everything installed. ⌘O does the same.
- **Detected automatically** on macOS by bundle id: VS Code, VS Code Insiders, Cursor, Windsurf, Zed, the JetBrains IDEs, Xcode, Sublime Text. Also Finder, Terminal, iTerm2, Ghostty and Warp. Only installed apps are shown. A custom command template (`myeditor --goto {path}:{line}`) covers anything else.
- **File links everywhere:** file paths in tool cards, diffs and Claude's text are clickable. ⌘-click opens the file **at its line** in the default editor (`code -g file:line`, `cursor -g`, `zed file:line`, `idea --line`). The app falls back to `open -a <App>` when the editor's CLI isn't on PATH.
- **Default editor** can be set globally and per project. Until you choose, the last one you used becomes the default.
- **"Open PR"** appears when the transcript has a `pr-link` record (seen in the spike data), and opens the PR in the browser.


### 5.4 Projects ✅ ([#13](https://github.com/estruyf/switchboard/issues/13))

- **Added by hand.** The sidebar filter, the New session folder list and the palette only offer projects you added. *Add project* lists the folders Claude Code has sessions for (most recent first, filterable), or opens the folder dialog. A session started in another folder offers to add it. Upgrading keeps every folder with a session started or continued in Switchboard (migration v8); a new install starts empty, with a prompt to add a project.
- **Defaults per project** (`project_settings.defaults_json`): model, effort, permission mode, workspace (current folder or worktree, and its base), and a branch to check out for current-folder sessions. Unset fields use the choices last made in the New session view. Changing a decided field there applies to that session only, until *Save as project default*.
- **Projects view** (sidebar footer, palette, a project's menu): add, remove (from Switchboard only), reorder, defaults, actions, icon, and a warning when the folder is gone.
- ✅ The Claude profile per project (#11, see 5.5). Later: Remote Control (#9), environment variables, additional directories.

### 5.5 Claude profiles ✅ ([#11](https://github.com/estruyf/switchboard/issues/11))

- **A profile is a Claude Code config folder** (one login, settings, plugins, sessions each). The built-in profile is Claude Code's own folder ($CLAUDE_CONFIG_DIR or `~/.claude`) and runs Claude Code with the environment unchanged; Claude Code keys its global config and keychain entry on whether CLAUDE_CONFIG_DIR is set, so setting it to `~/.claude` would act like another login. Profiles live in `claude_profiles` (migration v9), the default in `app_state`, a project's link in `project_settings.profile_id`.
- **Processes** (sessions, pre-warm, command and Tools helpers, usage, terminals) get `CLAUDE_CONFIG_DIR` through `env`. Resume and fork use the profile the transcript lives in, whatever the project's link says now.
- **Reading:** the SDK's transcript readers take the folder from `process.env.CLAUDE_CONFIG_DIR` only, so `ConfigDirLane` runs calls for one folder at a time. `MultiProfileSource` merges the profiles' sessions and routes each read to the folder it was found in; the index, search and live registry cover every folder, and every session records its `profileId`.
- **UI:** Settings → Claude profiles (add with a folder, colour, default, sign-in command; the account comes from Claude Code's `.claude.json`). With more than one profile: a dot on sidebar rows, a tag in the session header and Tools, a profile picker in New session, per-project links, and the usage band for the session's profile. With one, nothing shows outside Settings.

### 5.6 Links ✅ ([#5](https://github.com/estruyf/switchboard/issues/5))

- **`switchboard://new-session?prompt=…&cwd=…|project=name|repo=owner/name[&autostart=1]`** fills in New session (`cwd` > `project` > `repo`); **`switchboard://session/<id>`** opens a session. By default nothing is sent and the message box says the prompt came from a link until it is sent or cleared; `autostart=1` starts it once the folder and the project's defaults are in place, only when the link names the folder, and without adding the folder to your projects. A link naming no folder leaves it empty and opens the project list. `project` matches your projects' names (then folder names) in the renderer, before anything changes. Format and examples in [docs/deep-links.md](docs/deep-links.md).
- **Main** validates the URL in a pure module (`deepLink.ts`): prompt ≤ 5,000 characters without control or invisible characters, `cwd` absolute and local without `.`/`..`, `repo` as `owner/name`. Unknown parameters are ignored, a bad value refuses the link with a short message. Links arriving before the renderer is ready (cold start via `open-url`, engine restart) are queued and handed over on `rendererReady`.
- **Engine:** `projects.findByRepo` matches GitHub remotes (`git config --local`) of your projects, then other folders with sessions, a few at a time.
- **Registration:** `protocols` in `electron-builder.yml` (Info.plist) plus `setAsDefaultProtocolClient` in packaged builds only; development and smoke builds don't touch the system's handlers.
- Later: `model` and `permissionMode` from a link, limited to safe values (never `bypassPermissions`).

### 5.7 Focus limit ✅ ([#24](https://github.com/estruyf/switchboard/issues/24))

- **Preferences** (main): `focusLimit` (1–10, null is off), `focusMode` (`nudge` | `strict`), `focusCountExternal`, `focusCountRemote` (on by default). They travel with settings backups like every preference.
- **Counting** is a pure module (`apps/ui/src/state/focus.ts`): active hosts that are working, need you, or are idle with an unread turn, minus sessions archived since (needs you always counts); with `focusCountExternal`, live registry entries from the terminal and IDEs too (never SDK processes, which are Switchboard's own); with `focusCountRemote`, sessions on connected paired computers that are working, need you or are unread. `focusVerdict` answers `allowed`, `ask` (Nudge) or `blocked` (Strict); a message to a session that already counts is always allowed.
- **One gate** (`passFocusGate` in `focusGate.ts`) in front of every start: New session (and `autostart` links), messages to a session that doesn't count, forks, prompt actions, and Claude in the terminal. It shows one `alertdialog`; committing and compacting skip it.
- **Later list:** `later_prompts` (migration v14, a user choice) with `later.list` / `later.add` / `later.remove` and a `later.changed` event. Undo re-adds an item with its id and time. A minimal toast with Undo stands in until #14.
- Later: a reminder when a session has needed you for a while, waiting sessions in the quit prompt, a "hard stop" time, and the queue in settings backups.

### 5.8 Queue ✅

- The Later list becomes the **queue** (the names stay `later` inside: `later_prompts`, `later.*`, `laterStore`). Migration v16 adds `position` (numbered by age, oldest first) and `wait_json` (NULL is "any session in the project"), and `later_started` to remember which session a started item became, so an item waiting on it follows that session.
- RPCs: `later.reorder`, `later.update` (what it waits for) and `later.start`, which creates the session through the same path as `session.create`; `later.remove` takes `startedAs` for an item edited and started from New session.
- Ready logic is a pure module (`apps/ui/src/state/queue.ts`): busy means starting, running or needs you, measured on the rows the sidebar lists. Nothing starts by itself; the toast and the notification only say an item is ready.
- Sidebar sections close (`sidebarSections.ts`, saved in app state as `ui.sidebarSections`); the open session's row stays under a closed header.

### 5.9 VS Code companion and context tray ([#42](https://github.com/estruyf/switchboard/issues/42))

- **Context tray** ✅: chips above the message box, kept in the drafts store with the draft (`context`), from drops, the `@` list, the Add context picker (⌘⇧A) and the companion. Sending turns them into `@path#L12-40` mentions and fenced text (`promptWithContext`).
- **Socket and contract** ✅: `packages/engine/src/companion/` listens on a Unix socket with a token in `engine.json` (`0600` in `0700`); the contract is `packages/protocol/src/companion.ts` (`hello`, `sessions.list`, `sessions.watch`, `context.add`, `session.reveal`, `sessions.changed`). Windows report focus (`companion.focus`), receive `companion.context` and confirm with `companion.received`.
- **Extension** ✅ (`apps/vscode-extension`): selection, file, Explorer multi-select, open editors and tab groups, problems, terminal selection, Source Control; the focused session or a quick pick with New session; a status bar item; launching Switchboard when it isn't running. Text from files excluded in VS Code, ignored by git or denied by `Read` rules is never sent.
- **Prompts in VS Code** ✅: `sessions.list` / `sessions.changed` carry the listed sessions' `prompts`, and `prompt.respond` answers them; the extension shows each as a notification (permission, question, plan) and offers **Fix in Switchboard** as a quick fix on errors and warnings.
- **Continue in VS Code** ✅: `session.continueInEditor` stops the host, waits for it to exit, opens the folder, then `vscode://anthropic.claude-code/open?session=<id>`.
- **Release** ✅: `release-vscode.yml` publishes to the Marketplace and Open VSX on a `vscode-v*` release, a `#release #vscode` commit on main, or by hand.
- Later: "Ask about these lines" from the Changes panel, the terminal's selection or a failed action's output as chips, closing the Claude Code tab when continuing in Switchboard, and a test against the Claude Code extension's own `ide` server.

### 5.10 Quick questions ✅

- Sessions without a project, like a chat. They all run in one scratch folder the engine owns, `<dataDir>/questions` (so dev, smoke and the installed app each have their own), made when needed. `questions.folder` tells the UI its path. Claude Code sees an ordinary folder, so transcripts, resume, fork and search need no special cases.
- **Never a project:** `projects.list` leaves the folder out, and `projects.add`, `rename`, `setIcon`, `setProfile` and `setDefaults` refuse it (INVALID). `session.create` refuses a worktree or branch there.
- **UI:** the projects store adds an entry for the folder named *Questions* (never `added`, no session count), so every place that names a session's folder says Questions and no project list shows it. Pure helpers in `apps/ui/src/lib/questions.ts` (is this the folder, which options apply, the choices remembered for questions in `newSession.questionDefaults`, never a mode that skips prompts). New session (*Quick question* under the tiles, ⌘⇧N), the palette's *Quick question…* prompt step and `question=1` links all start through `startNewSession`. No git, project actions or Changes in the session view; the terminal works in the folder.

### 5.11 Session linking

Mention another session with `@` in the message box, and Claude gets a brief about it: folder, branch, pull request, what it did and its last reply. The case that drives it: "stack the PR on top of the one you opened in @Usage cost toggle". Design in [docs/session-linking.md](docs/session-linking.md).

- ✅ **Phase 1:** a Sessions group in the `@` list, the label kept in the text and a `session` chip; the engine expands the chip's stub into the brief right before Claude reads it; links and the PRs a session opened are stored (`session_links`, `session_prs`); the transcript shows a **Linked:** row.
- **Phase 2:** New worktree from a linked session's branch, **Builds on …** in the session header, the stacked base in Create pull request.
- **Phase 3:** `ask_session`, an in-process tool that asks a linked session through a read-only fork.
- **Phase 4:** a stack view.

### v0.2: power features
- ✅ **Embedded terminal** per session (xterm.js on node-pty), plus a raw `claude` TUI tab for anything the GUI doesn't cover (including mods). Built ahead of schedule; project actions will reuse it.
- **Diff panel:** the session's git diff against its starting point, with stage, revert and **rewind to message** (`rewindFiles`).
- **Worktree finishing actions:** when a worktree session is done, offer merge into the base branch, open a PR (via `gh`), or keep or discard the worktree.
- **Global search** (⌘⇧F) across all transcripts using FTS5.
- **Fork session** from any message.
- **Panels** for MCP servers (status, toggle, reconnect), skills, plugins and agents.
- **Multi-pane:** two sessions side by side.

### Mods (Claude Code function-hook plugins)

Mods such as [claude-stats-mod](https://github.com/estruyf/claude-stats-mod) draw UI through `on("ui.render", { component: "AbovePrompt" | "StatusLine" | … })` and return element trees (`Box`, `Text`, `Svg`) per surface (`terminal`, `desktop`, `mobile`, `vscode`). Investigated 2026-10-05 against Claude Code 2.1.285 and SDK 0.3.288:

- **Claude Code has a host protocol for it**, used by its desktop app, mobile app and VS Code extension. A host joins with the `ui_attach` control request, asks for a component with `ui_render` (surface, component, instance id, props, viewport), and sends input back with `ui_press`, `ui_input` and `ui_select`. Claude Code pushes `ui_invalidate`, `ui_status`, `ui_toast`, `ui_panes`, `ui_log` and `ui_scroll` as system messages.
- **It is all marked `@internal`**, and the public Agent SDK exposes none of it: no `ui_*` methods and no generic control-request call. The UI messages are only emitted once a surface has attached.
- **Options:**
  1. Wait for SDK support. Meanwhile mods render in their terminal form in the embedded `claude` terminal (Phase 5).
  2. Talk stream-json to `claude` directly for the control channel, attach as the `desktop` surface, and render `Box`/`Text`/`Svg` trees in React. This works today but depends on an internal protocol that can change between Claude Code releases.

### Later
- Sending messages into externally running sessions, if the peer-messaging channel turns out to be usable.
- Usage dashboards across sessions and projects.
- Scheduled and background sessions.

---

## 6. Performance budget and techniques

| Metric | Target |
|---|---|
| Cold start → interactive sidebar | < 500 ms |
| Switch session (cached) | < 50 ms |
| New session → first token | ≈ CLI (pre-warmed via `startup()`) |
| Streaming | 60 fps, no input lag in composer |
| Memory, 20 sessions open | < 500 MB total |

- **Batch stream deltas** and flush once per `requestAnimationFrame`. Never call `setState` once per token.
- **Virtualize the message list.** Finished messages are immutable, so they're memoized by uuid and never re-render.
- **Highlight code with Shiki in a worker,** and only for code that's visible.
- **Snapshot plus deltas over RPC.** The engine keeps a per-session event log, so the UI subscribes from a cursor and a reconnect costs almost nothing.
- **Send closed sessions to the UI lazily,** paging the transcript from SQLite or JSONL on scroll.
- **Pre-warm a single idle `startup()` instance** so ⌘N feels instant.
- **Add a perf CI job** that replays recorded fixture transcripts (10k messages) through the renderer and fails if it's slower than budget.

---

## 7. Phased delivery

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 · Spike** ✅ done, see [FINDINGS](spike/FINDINGS.md) | SDK hello-world with the user's `claude` binary and subscription; streaming input, `canUseTool`, `interrupt`, `rewindFiles`; parse the `~/.claude/sessions` registry and JSONL; confirm Claude Code's worktree location and naming; check whether `messagingSocketPath` is usable | Written findings that answer every ⚠️ in this doc |
| **1 · Foundation** ✅ done | Monorepo, Electron shell, engine utilityProcess, MessagePort RPC, SQLite cache | Window opens, engine responds over typed RPC. Verified by `npm run smoke`: UI talking to the engine in ~230 ms warm, 0.1 ms round trip, automatic recovery from an engine crash |
| **2 · Discovery** ✅ done | Indexer, sessions registry watcher, sidebar, read-only transcript viewer, live tail of external sessions | All existing sessions browsable; running CLI sessions show as live. Transcript formats are read through the SDK (`listSessions`, `getSessionInfo`, `getSessionMessages`), so the app parses only the registry and the `entrypoint` field itself. Full-text search indexing moves to Phase 5 with global search |
| **3 · Owned sessions** ✅ done | Create (current folder or worktree), resume, stream, composer, permissions, interrupt, status bar, **Open in editor**. Also: cache the login-shell environment (about 0.5 s per engine start today) | Verified against real Claude Code by `claude.live.test.ts` and the live smoke step: permission prompt in about 3 s, streaming, follow-up, stop/resume, interrupt, fork when open elsewhere. Only `PATH` is cached from the login shell, never the full environment | Can do a full day's work in the app instead of the terminal |
| **4 · Rich rendering + actions** ✅ done (terminal first) | Tool cards, diffs, todos, subagents, plan mode, AskUserQuestion, notifications, clickable file links; **PtyHost + project actions** (shell and prompt types, toolbar, palette, shortcuts, `runOnWorktreeCreate`, `.switchboard.json`) | Verified in the app and against real Claude Code: inline diffs, todo checklist and strip, subagent transcripts (from `agent-<id>.meta.json`), Shiki highlighting loaded on demand, plan cards; project actions (shell in terminal tabs, prompts, `.switchboard.json` with per-command trust, shortcuts, worktree setup before the first prompt); notifications and dock badge from main's own engine connection |
| **5 · Power** ✅ done | Free-form terminal tab, diff panel and rewind, worktree finishing actions, search, fork, MCP/skills panels, palette | Done: Changes panel (uncommitted or vs base, stage/unstage/revert, reverted new files to the Trash), undo file changes since a prompt (`rewindFiles`, previewed first), fork from any reply and edit-and-resend (`forkSession` up to a message), worktree finishing (commit with Claude, merge, push + `gh pr create`, remove with branch), full-text search (FTS5, indexed in the background, ⌘⇧F jumps to the message), ⌘K palette, Tools window (MCP status/toggle/reconnect live, skills, agents, plugins), and two sessions side by side. Verified by unit tests, the smoke test and the live smoke step |
| **6 · Ship** (packaging, signing and notarization ✅ done) | Perf CI, code signing and notarization, auto-update, crash reporting (opt-in) | Signed DMG and auto-updates. Done so far: `npm run dist` builds an unsigned arm64 `.app` and `.dmg` (249 MB / 113 MB) with electron-builder; the SDK's bundled `claude` is left out (the user's own is used), `node-pty` is unpacked from the asar, and the full smoke test (live session included) passes against the packaged app. Signing (Developer ID, hardened runtime) and notarization are done too: `npm run dist:notarized` produces an app Gatekeeper accepts as *Notarized Developer ID*. Auto-update is done too: `electron-updater` checks the GitHub releases (Stable, or Beta pre-releases too), downloads when asked and installs on restart; the release workflow attaches the `.zip` and `latest-mac.yml` feed. Still to do: perf CI, crash reporting |
| **7 · Windows** (all 3 steps done on Windows and macOS; Windows signing to set up) | The same features on Windows, then a signed installer that updates itself. The plan, findings and progress are in [docs/windows-support.md](docs/windows-support.md) | `npm run check` and `npm run smoke` pass on Windows and macOS; a signed Windows installer is attached to each release. Steps 1 (usable on Windows) and 2 (the same features) pass `npm run check` and all 59 smoke steps on Windows, and `npm run check` and the same smoke steps as `main` on macOS. Step 3 builds the installer and the release job, and leaves the macOS build as it was; it needs Windows signing set up and a first release |

---

## 8. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Undocumented on-disk formats (`sessions/*.json`, JSONL) change between Claude Code versions | Isolate them in `packages/claude` with version-tagged fixtures, add a CI job that runs against the latest `claude`, and degrade gracefully (unknown records render as raw JSON) |
| SDK API churn | Pin the version and wrap the SDK in one `SessionHost` module; nothing else imports it |
| Two writers on one transcript | Check the registry before resuming, and offer to fork or open a terminal instead |
| Subscription auth or terms for third-party GUIs | ✅ Technically verified. Keep `ANTHROPIC_API_KEY` / `apiKeyHelper` as a fallback |
| A malicious repo ships a harmful `.switchboard.json` action | Shared actions never run without a confirmation that shows the exact command, with approval tied to the command hash |
| SDK throws asynchronously after interrupt/error results | Per-session try/catch and process-level guards (see §2A), plus a regression test that replays the spike's interrupt case |
| GUI lags behind new CLI features | The embedded `claude` TUI tab is always available as an escape hatch |
| Electron memory or startup weight | Measure from phase 1 against the budget in §6, keep the renderer lean, and lazy-load heavy panels such as the terminal and diff view |

---

## 9. Decisions

| Decision | Choice |
|---|---|
| Shell | **Electron** |
| Language & UI | **TypeScript (strict) + React 19** across every package |
| Scope | **Desktop** (macOS first), with no web or mobile app; a paired phone can follow and steer sessions through **Remote** |
| Workspace | **Current folder by default**, with an optional **new worktree**, matching Claude Code |
| Name | **Switchboard** (working name) |
| Project actions | **In MVP.** Shell or prompt actions, personal + optional `.switchboard.json`, shown in the toolbar and palette |
| Open in editor | **In MVP.** Auto-detected editors, default editor, file:line links |
