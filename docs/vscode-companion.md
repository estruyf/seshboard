# VS Code companion

The VS Code companion (`apps/vscode-extension`) sends what you're looking at in the editor to a Switchboard session: the selected lines, the active file, Explorer files and folders, open editors, problems, terminal output and changed files. It arrives as chips in the session's message box (the context tray). Nothing goes to Claude until you press send in Switchboard. The other way round, it shows the prompts those sessions wait on (a permission, a question, a plan) as notifications you can answer.

[← Back to the README](../README.md)

This page is about how it works. For what it does and how to use it, see the extension's [README](../apps/vscode-extension/README.md).

## The connection

`switchboard://` links only go one way, and the companion needs answers: is Switchboard running, which sessions belong to this workspace, did the context arrive. So the engine listens on a Unix socket, the same design as Claude Code's own editor connection (`~/.claude/ide/<port>.lock`):

1. At start, the engine (`packages/engine/src/companion/companionServer.ts`) makes a folder only you can open (`0700`) in the system's temporary folder, listens on `engine.sock` in it (`0600`), and writes `engine.json` to `<app data>/companion/` (`0600` in a `0700` folder):

   ```json
   { "protocol": 1, "socket": "/var/folders/…/T/switchboard-a1B2c3/engine.sock", "token": "<64 hex characters>", "pid": 4242, "startedAt": 1760000000000, "appVersion": "0.0.13" }
   ```

   `<app data>` is `~/Library/Application Support/Switchboard` for the installed app and `Switchboard Dev` for `npm run dev` (`%APPDATA%\Switchboard` on Windows, `~/.config/Switchboard` on Linux). The socket is not in the app data folder because macOS limits socket paths to 104 bytes.

   Windows has no Unix sockets: there the engine listens on a named pipe with a random name (`\\.\pipe\switchboard-<32 hex characters>`), and `socket` in `engine.json` is that name. File modes don't apply there; `%APPDATA%` is only readable by your account, and the token is what lets an editor in.
2. The extension reads `engine.json` (the installed app's first, then the dev build's, or the folder in `switchboard.appDataFolder`), skips a file whose process is gone, connects, and sends `hello` with the token.
3. The engine closes any connection whose first message isn't `hello` with the right token (compared in constant time), or that says nothing for 5 seconds. Every message after that is validated against the contract; a line that isn't JSON, or is longer than 8 MB, closes the connection too.
4. When Switchboard isn't running, the extension opens it (`open -b dev.switchboard.app`, or a `switchboard://new-session?cwd=…` link for a build macOS knows by its scheme only) and waits up to 20 seconds for `engine.json` to appear.

The engine process is stopped when Switchboard quits, so `engine.json` can stay behind: the extension ignores a file whose process is gone, and the next start replaces it and removes the old socket's folder. `SWITCHBOARD_NO_COMPANION=1` starts the engine without the socket.

## Messages

One JSON message per line, in the same request, response and event shape the UI uses over its MessagePort (`packages/protocol/src/wire.ts`, `lineTransport.ts`). The contract is in `packages/protocol/src/companion.ts`; the extension imports `@switchboard/protocol/companion-client`, which has the RPC client, the transport and the types without zod.

| Request | What it does |
|---|---|
| `hello` `{ token, protocol, client }` | The first message. Answers the protocol version and the app's version. |
| `sessions.list` `{ folders, limit? }` | The sessions in these workspace folders (a session working in one of them, or whose folder holds one) that Switchboard's sidebar shows outside Archived, under its scope (`companion.focus` reports it), what needs you first, then what is working, then the most recent. Also the session on screen in Switchboard (`focused`, wherever it is), how many windows are open, and `prompts`: the permission requests, questions and plans those sessions wait on, oldest first. |
| `sessions.watch` `{ folders }` | From now on, `sessions.changed` with the same answer whenever it changes. |
| `context.add` `{ target, items, reveal }` | Adds context items to a session's message box (`{ kind: 'session', sessionId }`) or to New session on a folder (`{ kind: 'new', cwd }`). Resolves once a window has added them; fails with `NO_WINDOW`, `NOT_FOUND`, `NOT_ADDED` or `TIMEOUT`. `reveal` shows the session and brings Switchboard to the front. |
| `session.reveal` `{ sessionId }` | Shows a session in Switchboard and brings it to the front (the status bar item). |
| `prompt.respond` `{ requestId, decision, acceptEdits? }` | Answers one of `prompts` with the same decision a card in Switchboard sends (`session.respond`); `acceptEdits` then switches the session to accepting edits, for an approved plan. Fails with `NOT_FOUND` when it was already answered. |

A context item (`packages/protocol/src/context.ts`) is a file or folder by reference, optionally with a range of lines, or a piece of text with a label (`selection` with unsaved changes, `problems`, `terminal`, `output`). At most 100 per message.

## Prompts

The engine re-sends `sessions.changed` when a prompt appears or is answered (`session.permission`, `session.permissionResolved`). The extension (`promptNotifier.ts`, with the pure parts in `prompts.ts`) announces each new prompt once as a warning notification: a permission with Allow, Always allow and Deny…; a question with Answer… (a quick pick per question) and Skip; a plan with Read the plan (a read-only Markdown preview under the `switchboard-plan:` scheme), then Approve or Keep planning…. VS Code can't close a notification itself, so one answered in Switchboard stays until you click it, and then says it was already answered. `switchboard.prompts` turns the notifications off.

`prompts` is optional in the contract, so an older engine just has none, and an older extension ignores it; `prompt.respond` on an older engine fails with `METHOD_NOT_FOUND`, which the extension reports as "Update Switchboard". The protocol version stays 1.

## Inside Switchboard

- Each window reports the session in its active pane (`companion.focus`). The engine (`CompanionHub`) sends `companion.context` to the window that reported last; the window adds the chips to the drafts store and confirms with `companion.received`.
- Chips live in the drafts store with the rest of a draft (`context` on a draft, saved with its text), so context sent to a session that isn't on screen waits there. The Unsent list shows a draft with only chips as "2 files".
- When you send, `promptWithContext` (`apps/ui/src/components/composer/contextItems.ts`) builds the message: what you typed, then the files as `@` mentions on one line (`@src/auth.ts#L12-40`, which Claude Code reads as those lines), then each piece of text in a fenced block under its label.
- The same tray takes files dropped on the message box, files picked from the `@` list, and the Add context picker (⌘⇧A, the paperclip, or *Add context…* in the command palette).
- *Continue in VS Code* (the session's ⋯ menu, or the command palette) calls `session.continueInEditor`: the engine stops the session and waits for its process to exit, runs `code <folder>`, then opens `vscode://anthropic.claude-code/open?session=<id>`. Claude Code's extension only resumes sessions of the folder that's open, so the folder goes first.

## What stays private

The extension sends references for files, and Claude Code applies its own permission rules when it reads them. Text is only sent for a selection with unsaved changes (Claude would read the old file) and for things that aren't files. The text of a file is never sent when:

- it matches `files.exclude` or `search.exclude`;
- git ignores it (`git check-ignore`);
- a `Read(…)` rule in `permissions.deny` of `~/.claude/settings.json`, `.claude/settings.json` or `.claude/settings.local.json` matches it (gitignore patterns: `//abs`, `~/home`, `/from-the-settings`, `relative`).

In those cases only the reference goes, and the extension says your unsaved changes weren't sent. The checks are in `apps/vscode-extension/src/exclusions.ts`.

Answering prompts gives whoever holds the token what a Switchboard window has: allowing a tool Claude asked for. The token is in a file only your account can read, and the socket only your account can open, so this adds nothing a process running as you couldn't already do (it could run `claude` itself).

## Developing the extension

From the repository's root:

```bash
npm run dev:vscode       # rebuild dist/extension.cjs on every change
npm run build:vscode     # build it once
npm run package:vscode   # a .vsix in apps/vscode-extension
```

Or open the repository in VS Code and press **F5** (*Run Extension* in `.vscode/launch.json`). It starts the *Watch extension* task, which bundles on every change and typechecks in the background (errors show in Problems), then opens this repository in an Extension Development Host. Reload that window (⌘R) to pick up a change. Have Switchboard running; a development build (`npm run dev`) is found too. The pure parts (payloads, exclusions, discovery, which session) have unit tests next to them and run with `npm run check`; nothing there imports `vscode`.

## Releasing the extension

`.github/workflows/release-vscode.yml` builds, tests and packages the `.vsix` once, then publishes that file to the Visual Studio Marketplace and Open VSX (a version already there is skipped). Three ways to start it, like Demo Time:

- **A GitHub release tagged `vscode-vX.Y.Z`.** The version comes from the tag; the `.vsix` is attached to the release, and empty notes are filled in from that version's section of `apps/vscode-extension/CHANGELOG.md`. Releases tagged `vX.Y.Z` are the desktop app's and don't publish the extension.
- **A commit on `main` whose message has `#release` and `#vscode`.** It publishes the version in `apps/vscode-extension/package.json`, so bump that (and the extension's CHANGELOG) in the same commit.
- **By hand:** Actions → *Release VS Code extension* → *Run workflow*, optionally as a pre-release.

It needs two repository secrets, each behind a GitHub environment (*Microsoft Marketplace* and *Open VSX*) so a release can wait for approval:

- `VSCE_PAT`: an Azure DevOps personal access token with *Marketplace › Manage* for the `eliostruyf` publisher.
- `OPEN_VSX_PAT`: an access token from open-vsx.org for the same namespace.
