# Project actions

Project actions are in the **⋯** menu of a session's header, for the things you do over and over: commit, run the tests, start the dev server, publish. An action either **runs a command** in a terminal tab or **asks Claude** something, as if you'd typed it.

[← Back to the README](../README.md)

## Adding an action

1. Open a session in the project.
2. Click **⋯** in the header, then **Add an action…** (**Edit actions…** once you have some).
3. Pick a suggestion or fill in your own:

| Field | What it means |
|---|---|
| **Name** and **icon** | How it looks in the menu. |
| **Run a command** / **Ask Claude** | A command runs in your login shell in a terminal tab below the session, so your `PATH`, `nvm` and aliases work as they do in your terminal. A prompt is sent to Claude in the session, and can be a `/` command. |
| **Saved for** | *This project*, or *All projects* for actions you want everywhere. |
| **Runs in** | The session's folder (its worktree, if it has one) or the project root. |
| **Shortcut** | Optional, for example ⌘⇧T. |
| **Ask before running** | Shows a confirmation first. Useful for publish or deploy. |
| **Run in every new worktree** | Runs before Claude starts in each new worktree session, for example to install dependencies. Claude's first message waits until it has finished. |
| **Send the output to Claude when it finishes** | When the command ends, its exit code and the last 200 lines of its output go to the session as your message, held in Up next while Claude works. |

Your actions are listed under **Project actions** in the **⋯** menu, with their shortcuts. Use **Edit actions…** there to change or remove them.

### Suggestions

When you add an action, Seshboard suggests some to start from:

- your `package.json` scripts (with npm, pnpm, yarn or bun, whichever the project uses), plus *Install*
- *Commit* (asks Claude to commit with a clear message), *Push* (`git push`) and *Create PR* (`gh pr create --web`)

## Variables

Commands and prompts can use these, filled in when the action runs:

| Variable | Value |
|---|---|
| `${cwd}` | The session's folder |
| `${projectRoot}` | The project's root folder |
| `${branch}` | The current branch |
| `${worktreeName}` | The worktree's name, if the session has one |
| `${sessionId}` | The session's ID |
| `${sessionTitle}` | The session's title |

In commands, every value is quoted for the shell, so a branch name or title can never run anything by accident.

## Sharing actions with your team

Put a `.seshboard.json` file in the root of the repository and commit it. Everyone using Seshboard on that repo gets its actions. In the action editor, **Saved for** › **Shared with the project** writes an action to the file for you (and creates the file when there is none); moving it back to *This project* or *All projects*, or deleting it, takes it out again.

```json
{
  "actions": [
    { "name": "Test", "icon": "flask", "command": "npm test" },
    { "name": "Dev server", "icon": "play", "command": "npm run dev", "shortcut": "cmd+shift+d" },
    { "name": "Install", "icon": "package", "command": "npm install", "runOnWorktreeCreate": true },
    { "name": "Publish", "icon": "rocket", "command": "npm publish", "confirm": true, "cwd": "project-root" },
    { "name": "Review", "icon": "sparkles", "type": "prompt", "command": "Review the changes on ${branch} and list anything risky." }
  ]
}
```

| Key | Default | Values |
|---|---|---|
| `name` | (required) | Up to 40 characters |
| `command` | (required) | The command, or the prompt for `"type": "prompt"` |
| `type` | `"shell"` | `"shell"` or `"prompt"` |
| `icon` | `"play"` | `play`, `rocket`, `git-commit`, `git-pull-request`, `upload`, `flask`, `package`, `terminal`, `sparkles`, `wrench`, `globe`, `bug`, `check` |
| `cwd` | `"session"` | `"session"` or `"project-root"` |
| `confirm` | `false` | Ask before running |
| `shortcut` | none | For example `"cmd+shift+t"` |
| `runOnWorktreeCreate` | `false` | Run in every new worktree before Claude starts |
| `sendOutput` | `false` | When it ends, send its exit code and the end of its output to Claude |
| `id` | from the name | Lowercase letters, digits and dashes |

Actions with the same `id` (by default, the same name) replace each other: your actions for this project win over shared ones, and shared ones win over your *All projects* actions.

When Seshboard writes the file, it keeps keys it doesn't know and their order, and the file's indent, and leaves out settings that are at their default, so the commit shows only the action that changed. A file it can't read is never overwritten. The file is watched: a pull that changes it updates the actions in the app.

### Shared prompts

The same file holds the project's shared [saved prompts](https://seshboard.app/sessions/saved-prompts/), under `prompts`. Seshboard writes them there when you choose **Share with the project** for a prompt, and takes them out again when you move it back:

```json
{
  "actions": [],
  "prompts": [
    { "id": "fix-failing-test", "name": "Fix failing test", "text": "Fix {{test:file}}. It fails on {{branch:branch}}." }
  ]
}
```

| Key | Values |
|---|---|
| `name` | Up to 60 characters (required) |
| `text` | The prompt, with blanks written as `{{name}}` or `{{name:type}}` (required) |
| `id` | Lowercase letters, digits and dashes. From the name when it's left out |

When Seshboard writes the file, it keeps keys it doesn't know and their order, and the file's indent, so the commit shows only the prompt that changed. How often you use a shared prompt is kept on your computer, never in the file. The file is watched: a pull that changes it updates the prompts in the app.

**Safety:** a command from a repository could do anything, so Seshboard shows you the exact command the first time you run a shared action and asks you to approve it. If someone changes the command later, you're asked again. An action you share yourself is approved for you when you save it.

## Project icons

Seshboard picks up a project's icon from the repository when it can: a logo or favicon in the usual places, the `icon` in `package.json`, or an `iconPath` you set in `.seshboard.json`:

```json
{ "iconPath": "assets/logo.svg" }
```

You can also set your own: right-click a session (or use the project filter at the top of the sidebar) and choose **Choose image…** or **Use emoji…**.
