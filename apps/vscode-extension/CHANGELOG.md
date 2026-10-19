# Changelog

## [Unreleased]

- Works with Switchboard on Linux: it starts Switchboard and brings it up there with `xdg-open`.

## [0.2.0]

- Works with Switchboard on Windows (where it listens on a named pipe), and matches Windows folders without regard to case. It starts Switchboard and brings it up there too (with a `switchboard://show` link).
- The **App Data Folder** setting can only be set in your user settings, not by a workspace, and a folder on another computer is ignored. Only the pipe Switchboard itself makes is connected to.
- Answer Switchboard's prompts in VS Code: when a session in this workspace asks for a permission, has a question or a plan, a notification lets you allow or deny it, answer the questions, or read and approve the plan. *Switchboard: Answer Prompts* shows the ones you closed again. Needs Switchboard 0.0.14 or later.
- **Fix in Switchboard** in the quick fixes (⌘.) of an error or warning adds the problem and the lines it is on to a session.

## [0.1.2]

- Fix for showing only project related sessions.

## [0.1.1]

- Documentation updates.

## [0.1.0]

- First release: send the selection, the active file, Explorer files and folders, open editors, problems, terminal output and changed files to a Switchboard session, as chips in its message box.
- Picks the session you have open in Switchboard when it holds the files, or asks which one (or New session).
- A status bar item says when a session in this workspace needs you, and takes you there.
