# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Copilot and others) working on Switchboard, a macOS desktop app (that runs on Windows and Linux too, see [docs/windows-support.md](docs/windows-support.md) and [Building: Linux](docs/building-and-signing.md#linux)) for managing Claude Code sessions. People should start with [README.md](README.md); the design and roadmap are in [PLAN.md](PLAN.md).

## Architecture

Switchboard is an Electron app in four npm workspaces, plus its VS Code companion extension, its website and the remote app for phones:

| Path | What it is | Rules |
|---|---|---|
| `packages/protocol` | zod contract and typed RPC over MessagePorts | The single source of truth for every request and event. Entry points: `.` (with zod, for the engine), `./client` (types and RPC client only, no zod, for the renderer), `./bridge` (IPC channels and preferences, plain TypeScript, for main and preload), `./companion-client` (the VS Code extension's client and socket transport, no zod). |
| `packages/engine` | Plain Node; runs in an Electron `utilityProcess` | **No Electron imports.** Owns the SQLite cache, the session index and search, Claude Code processes (through the Agent SDK), git, terminals, project actions and usage. |
| `apps/desktop` | Electron main process, preload, and the engine entry | Main does what needs Electron: windows, menus, dialogs, notifications, the Trash, preferences. The preload is sandboxed and exposes `window.switchboard`. |
| `apps/ui` | React 19 renderer, Tailwind 4, zustand | Talks to the engine only through the RPC client, and to main only through `window.switchboard`. |
| `website` | The website and docs (Astro + Starlight), published to GitHub Pages by `website.yml` | Pages are MDX in `website/src/content/docs/`. Colours come from the app's `--sb-*` tokens (`website/src/styles/switchboard.css`); keys use `<Kbd shortcut="…">` from the shortcuts registry, which renders them for macOS and Windows (the reader picks in the header), and `<Os>`/`<OnlyOn>` hold words and passages that differ by platform. Every feature is listed in `website/src/content/features.json`, which a test checks against the palette commands, shortcuts, Settings sections and project tabs. |
| `apps/remote` | The remote app (React, Tailwind), built into the website at `/remote/` | A paired phone's view of the sessions, over an end-to-end encrypted channel through a tunnel ([docs/remote-access.md](docs/remote-access.md)). Talks to the engine only through `@switchboard/protocol/remote-client` (no zod) and the remote contract, never the app's. Transcripts are rendered as text, never HTML. Pure logic (links, transcript merging, the layout's breakpoints, the thresholds of swipes, the drawer and pull to refresh) lives in `src/lib` with tests next to it. Overlays the back gesture closes (sheets, the sessions drawer) go through `useOverlayHistory`. |
| `apps/vscode-extension` | The VS Code companion, bundled with esbuild into `dist/extension.cjs` | Talks to the engine only over its Unix socket (`packages/engine/src/companion/`), through `@switchboard/protocol/companion-client` (no zod). Pure logic (payloads, exclusions, discovery, which session) lives in modules without `vscode` imports, with tests next to them. Released on its own (`release-vscode.yml`, tags `vscode-vX.Y.Z`); see [docs/vscode-companion.md](docs/vscode-companion.md). |

The path of a feature is usually: add the request or event to `packages/protocol/src/contract.ts`, handle it in `packages/engine/src/engine.ts` (logic in a module next to it), and call it from the UI with `client.call(...)` / `client.on(...)`.

### Claude Code

- Sessions run through `@anthropic-ai/claude-agent-sdk` (pinned), using the user's own `claude` binary and login. Only `packages/engine/src/host/sessionHost.ts` and `hostManager.ts` drive `query()`, plus one documented exception: `usageMonitor.ts`, whose helper sends `/usage` (see below). Keep it that way.
- Read transcripts through the SDK (`listSessions`, `getSessionMessages`, `forkSession`, …) in `packages/engine/src/claude/sessionSource.ts`. Parse Claude Code's on-disk formats only where the SDK has no answer (the live registry in `~/.claude/sessions`, `agent-*.meta.json`, `installed_plugins.json`), and degrade quietly when a format changes.
- Short-lived helper processes (command lists, Tools) never get a prompt. Two exceptions: the usage helper sends the local `/usage` command, which uses no tokens, and Ask about this session (`HostManager.askAbout`) sends the question to a fork of the session, behind a read-only PreToolUse hook, and records its tokens itself. All of them use `persistSession: false` and register their ids as ephemeral so they don't show up as sessions.
- The SDK can throw asynchronously after interrupts: every session is wrapped so one failing session can't take the engine down.
- **Claude profiles** (`packages/engine/src/profiles/`): each is a config folder with its own login. Anything that starts Claude Code gets the profile's environment (`envFor` in `engine.ts`); never set `CLAUDE_CONFIG_DIR` for the built-in profile. The SDK's transcript readers only read `process.env.CLAUDE_CONFIG_DIR`, so they go through `ConfigDirLane`; don't call them around it.

## Commands

```bash
npm install
npm run dev          # Electron + Vite with hot reload
npm run check        # typecheck every package + unit tests (Vitest)
npm run smoke        # build, launch the real app with a throwaway profile, drive the UI
npm run smoke:demo   # the same in a made-up home folder (what CI and agents run); add -- --only "pop-out" for some steps
npm run screenshots  # retake the README screenshots in a made-up demo home folder
npm run dev:vscode   # rebuild the VS Code companion on every change (F5 in VS Code runs it in a dev host)
npm run dev:remote   # the remote app at http://localhost:5199/remote/ (start the app with SWITCHBOARD_REMOTE_APP_URL set to it)
npm run website:dev  # the website and docs with hot reload
npm run website:build          # build the website; fails on a broken internal link
npm run website:screenshots    # retake the website's screenshots in a made-up demo home folder
npm run chaos -- --phase repro # chaos testing in a sandbox (macOS; docs/chaos-testing.md)
npm run dist         # package the app for this OS: Switchboard.app and a .dmg, the Windows installer, or the Linux AppImage, .deb and .rpm
```

Before you report a feature as done, `npm run check` and the smoke steps for what you changed must pass. The full `npm run smoke:demo` runs on the pull request (`.github/workflows/check.yml`, on macOS, Windows and Linux) and before a release, not while you build (see Working on a feature).

## Working on a feature

Most of the time in a feature goes into rerunning slow checks and re-reading the same code. Keep each run small:

- **Check only what you touched while you build.** After a change, run the tests next to it (`npx vitest run <files>`) and `npm run typecheck` (or one workspace's: `npm run typecheck -w @switchboard/ui`). Run the smoke steps for your area with `npm run smoke:demo -- --only "<part of the step label>"` (the labels are the `step(...)` lines in `runSmokeStep`; repeat `--only` for more, and steps inside "projects" run with it). Run `npm run check` once, at the end of the feature. Don't run the full `npm run smoke:demo`: the pull request runs it on every platform and shows what the feature broke elsewhere. When you change shared code (the palette, the composer, the stores, `main/index.ts`), also run the steps of the features that use it. A feature that lands on `dev` without a pull request gets one full `npm run smoke:demo` before it is pushed.
- **Agents run the demo smoke** (`smoke:demo`, what CI runs): a made-up home folder with the same projects and sessions on every run, so a step always works on the same session and a failure can be reproduced. It is also faster, and the agent's own session is not in it. The plain `npm run smoke` runs against your real `~/.claude`, so its results depend on your recent sessions; started from Claude Code, some of its steps fail by design (the agent's session and folder are off limits, see Smoke test). Leave it to a person in a terminal with no Claude session in this repository.
- **A step that fails every time is not flaky.** Check whether a recent change altered what the step expects (`git log -p` on the component) before rerunning: a rerun of a step that is out of date costs a full run and tells you nothing.
- **One agent per feature.** An agent that already read this file and the code it needs keeps that: continue it (SendMessage) for the next step instead of starting a fresh one, which reads everything again.
- **Small specs.** Split a spec that is several features (a view, its actions, its sidebar entry) into a core that ships first and follow-ups. Each run stays short and is less likely to hit a rate limit.
- **Features side by side** go in their own git worktree (the Agent tool's `isolation: "worktree"`). A new worktree has no `node_modules` of its own and would resolve packages from the main checkout, on another branch: run `npm install` in it first (if npm skips install scripts, run `node node_modules/electron/install.js` for Electron). Smoke runs take turns; use `--only` in each worktree.
- **Node 24 or later** (`engines`). If `node -v` says otherwise, put a newer Node first on the `PATH` (on a Mac with Homebrew, `/opt/homebrew/bin`).
- **Docs and screenshots wait for the release** ([docs/releasing.md](docs/releasing.md)). Per feature, add its `CHANGELOG.md` line and its `website/src/content/features.json` entry (`npm run check` needs it); the pages and screenshots are written at release time.
- **Read the detail only for your area**: [.claude/rules/ui.md](.claude/rules/ui.md) and then the one section of [docs/ui-patterns.md](docs/ui-patterns.md) you need for the UI, and the subsystem docs in `docs/` (remote access, session linking, mods, themes, Windows) when you change that subsystem.

## Conventions

- **TypeScript strict, ESM, Node 24+.** Files import each other with explicit `.ts`/`.tsx` extensions. There is no formatter or linter: match the surrounding code (2-space indent, single quotes, semicolons, long lines are fine).
- **Comments** explain why, in plain sentences, at the density of the surrounding code. JSDoc on exported functions and on non-obvious fields.
- **Testable logic lives in pure modules.** Unit tests must not import modules that touch `window` or `localStorage` at load time; put pure helpers in their own file (see `toolSummary.ts`, `agentRuns.ts`, `lib/fuzzy.ts`, `lib/unifiedDiff.ts`). Tests sit next to the code (`*.test.ts`).
- **Engine tests** use real temporary directories, real git repositories and a real SQLite file, not mocks. The SDK is injected (`SdkRuntime`), so host tests fake Claude Code.
- **macOS, Windows and Linux.** Code that differs per platform goes through one helper for each question, never a path or key written for macOS:
  - paths: `isAbsolutePath`, `isSameOrInside`, `pathInside`, `joinPath` (`packages/protocol/src/paths.ts`) and `basename` (`apps/ui/src/lib/format.ts`), never `split('/')` or `startsWith('/')`; the zod `AbsolutePath` takes only this platform's form;
  - the shell: `userShell()` (`packages/engine/src/system/shell.ts`), for the file, its arguments, `quote` and `sequence`;
  - starting a `.cmd`: `viaCmd()` (`system/windowsCommand.ts`);
  - keys: `mod` in the registry, `modKey(event)` in handlers;
  - wording: `fileManagerName()` and `trashName()` (`apps/ui/src/lib/platform.ts`).

  Linux takes the POSIX side of each (paths, `$SHELL`, the Ctrl keys of Windows); where macOS calls an app by its bundle (`open -a`), Linux uses a command on `PATH` or `xdg-open`.

  Pure helpers take the platform as a parameter, so the macOS tests run on Windows and the other way round.
- **Schema changes** go through a new migration appended to `packages/engine/src/db/migrations.ts`. The cache is derived from `~/.claude` and may be dropped and rebuilt; `owned_sessions`, `session_flags`, `project_settings` and `project_actions` hold user choices and must survive.

### UI

The UI rules (theme tokens, light and dark, narrow panes, form controls, dialogs, the command palette and shortcut registries, the type scale, status colours, buttons, components, layout) are in [.claude/rules/ui.md](.claude/rules/ui.md). Claude Code loads it when you work in `apps/ui`; other agents, read it before you change the UI. The detail for each area (split view, catch-up, mods, charts and more) is in [docs/ui-patterns.md](docs/ui-patterns.md); open only the section you need.

**Copy.** Plain, short sentences. Say what something does ("Allow", "Start session"), not how. No em dashes.

### Smoke test

`apps/desktop/src/main/index.ts` holds the smoke steps (`run…Step` functions); `runSmokeStep` runs each through `smokeRun.step(label, …)` (`smokeRunner.ts`: timed, 30s limit, cleaned up after), and `apps/desktop/scripts/smoke.ts` prints their results and times. A new step is one `step(...)` line there, returning `ok: …` or what went wrong; `npm run smoke -- --only "<label>"` runs it with the two steps that open the session (`always: true`) and nothing else. A step that needs an earlier one's state says so in a comment, so `--only` can name both. Wait for conditions (`waitInPage`, `until`, `settle`), never for a fixed time, except to show that something did *not* happen. Steps find elements by `data-*` attributes, so give new UI a `data-` hook when you add it. Steps must be **read-only on real data**: the app runs against the user's real `~/.claude` and projects, with a throwaway app profile. Never stage, revert, delete or send anything outside the sandbox. Never type into, or run anything in the folder of, a session that is running in Claude Code right now (often the agent's own session, which started the run): steps that pick a session skip `runningSessions()`, and the one whose folder later steps use also skips sessions in a running session's folder or inside it (`inRunningFolder`).

### Live tests (real Claude Code, costs a little)

Opt-in and only in a throwaway git repository:

```bash
SWITCHBOARD_LIVE_CWD=/path/to/throwaway-repo npx vitest run claude.live
SWITCHBOARD_SMOKE_LIVE_CWD=/path/to/throwaway-repo npm run smoke
```

**Never point these at a real project.** The live smoke step refuses to submit unless the folder field shows the sandbox; keep that guard.

## Documentation

- `README.md` is for people using the app: what it does, how to install it, shortcuts, settings. No implementation details.
- Technical material goes in `docs/` (`development.md`, `building-and-signing.md`, `project-actions.md`) and is linked from the README.
- Update `PLAN.md` when a phase or roadmap item changes status.
- The website (`website/`) documents every feature for people using the app. A change people can see gets its `features.json` entry with the change; its page and screenshots are updated before the release (the [docs checklist](docs/releasing.md#docs-checklist)).
- Keep `CHANGELOG.md` up to date: when a change is visible to people using the app, add a line to the `## [Unreleased]` section at the top (create it if it's missing), written for them, not about the implementation. At release time that section becomes `## [X.Y.Z] - YYYY-MM-DD` (see Releases).

## Releases

### Branches

- **`dev`**: where work lands, by commit or pull request. Betas are tagged here.
- **`main`**: what is released, nothing else. It only moves when a release is merged into it (or for a hotfix), and the website deploys from it, so the docs go live with the release that has the feature.

The release workflow fails when a release is tagged off `main` or a beta off `dev` (`.github/scripts/release-branch.sh`).

### Release

The steps to prepare and publish a release, a hotfix or a beta, the release workflow, the VS Code companion's release and the docs checklist are in [docs/releasing.md](docs/releasing.md). Read it only when the user asks for a release.

## Safety

- Commit, push, tag or publish only when the user asks.
- Never handle passwords, certificates or app-specific passwords, and never change keychain or system settings. The user runs `notarytool store-credentials` and adds CI secrets themselves.
- Deleting is always to the Trash (`shell.trashItem` in main), guarded by `apps/desktop/src/main/trashGuard.ts`: session files only, or new files inside a git repository for a revert.
