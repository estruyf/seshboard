<p align="center">
  <img src="https://raw.githubusercontent.com/estruyf/switchboard/main/apps/vscode-extension/assets/icon.png" alt="Seshboard logo" width="128" height="128">
</p>

<h1 align="center">Seshboard for VS Code</h1>

<p align="center">
  <a href="https://visitorbadge.io/status?path=https%3A%2F%2Fgithub.com%2Festruyf%2Fswitchboard%3Fslug%3Dvscode"><img src="https://api.visitorbadge.io/api/visitors?path=https%3A%2F%2Fgithub.com%2Festruyf%2Fswitchboard&labelColor=%2315181f&countColor=%23ffd43b&slug%3Dvscode" alt="Visitors"></a>
</p>

Send what you're looking at in VS Code to a [Seshboard](https://github.com/estruyf/switchboard) session: the open file, the selected lines, several files from the Explorer, problems, terminal output and changed files. It arrives as chips in the session's message box. Nothing is sent to Claude until you add your question and press ⌘↵ in Seshboard.

It also works the other way: when a session in this workspace asks for a permission, has a question or a plan, you can answer it from a VS Code notification.

This is a companion, not a chat. Claude Code's own extension stays the chat inside VS Code; Seshboard is where you manage your sessions and talk to them.

## Requirements

- [Seshboard](https://github.com/estruyf/switchboard) 0.0.13 or later, on the same Mac. Answering prompts needs 0.0.14 or later.
- VS Code 1.95 or later (or Cursor, Windsurf, VSCodium).

## What you can send

| From VS Code | Arrives in Seshboard as |
|---|---|
| Selected lines (⌥⇧K, or right-click in the editor) | `auth.ts:12-40`, a reference Claude reads itself |
| The active file (nothing selected) | `auth.ts` |
| Files and folders in the Explorer (several at once) | one chip each |
| Open editors, all or one tab group | one chip per file |
| Problems in a file or the whole workspace | the errors and warnings, as text |
| **Fix in Seshboard** in the quick fixes (⌘.) of an error or warning | the problem as text, and the lines it is on |
| Selected terminal output (⌥⇧K in the terminal, or right-click) | the output, as text |
| Files in Source Control | the changed files |

Files go as references (a path and its lines), so a large selection stays small. Two things go as text instead: a selection in a file with **unsaved changes** (Claude would read the old version on disk), and things that aren't files, such as problems and terminal output.

## Answer prompts

When a session in this workspace waits for you, a notification says which session and what it asks:

- **A permission** ("Claude wants to run `npm test`"): **Allow**, **Always allow** (when Claude Code offers a rule), **Deny…** (with what to do instead, if you like) or **Show in Seshboard**.
- **A question**: **Answer…** asks each question in a list (pick several where the question allows, or type your own answer), or **Skip**.
- **A plan**: **Read the plan** opens it in a Markdown preview, then **Approve and accept edits**, **Approve, ask before edits** or **Keep planning…** with what to change.

Closing a notification leaves the prompt waiting in Seshboard; **Seshboard: Answer Prompts** shows it again. If you already answered in Seshboard, the extension says so.

## Which session

1. The session you have open in Seshboard, when its folder holds the file.
2. Otherwise a list of Seshboard's sessions for this workspace, with what each is doing, plus **New session**.
3. **New session** opens Seshboard's New session on that folder, with the chips already in it.

If Seshboard isn't running, the extension opens it first.

## Status bar

**Seshboard: 1 needs you** in the status bar says a session in this workspace waits for a permission or an answer. Click it to go to that session in Seshboard. Otherwise it says how many are working; click it for the list of sessions.

## What stays private

The extension never sends the text of a file you keep from Claude: files matched by `files.exclude` or `search.exclude`, files git ignores, and files Claude Code's settings deny reading (`Read(…)` rules in `permissions.deny`). For those, only the reference goes, and Claude Code applies its own rules when it reads the file.

The connection is a socket only your user account can open, with a token Seshboard writes to a file only you can read.

## Settings

| Setting | What it does |
|---|---|
| `seshboard.bringToFront` | Bring Seshboard to the front on the session when you add something (on by default). Turn it off to add context quietly. |
| `seshboard.statusBar` | Show the status bar item (on by default). |
| `seshboard.prompts` | Show prompts, questions and plans from this workspace's sessions as notifications you can answer (on by default). |
| `seshboard.quickFix` | Offer **Fix in Seshboard** in the quick fixes of errors and warnings (on by default). |
| `seshboard.editorTitleButton` | A button in the editor title bar that adds the selection or the file (off by default). |
| `seshboard.appDataFolder` | Where Seshboard keeps its data, for a build started with `SESHBOARD_DATA_DIR`. |

## Commands

All under **Seshboard:** in the command palette: *Add Selection to Seshboard*, *Add to Seshboard*, *Add Open Editors*, *Add Editors in This Group*, *Add Problems in This File*, *Add Problems in the Workspace*, *Fix in Seshboard*, *Add Terminal Selection*, *Add Changes*, *Answer Prompts*, *Show Sessions* and *Reconnect*.

## License

[MIT](https://github.com/estruyf/switchboard/blob/main/LICENSE)

## More

How the connection works, and the message format: [docs/vscode-companion.md](https://github.com/estruyf/switchboard/blob/main/docs/vscode-companion.md).
