# Links: open Switchboard from a URL

Switchboard registers the `switchboard://` URL scheme. A link opens the app on **New session** with the folder and prompt already filled in, or jumps to an existing session. You can put these links in runbooks, alerts, READMEs, issue templates or Raycast and Alfred scripts, or run `open "switchboard://…"` from a shell. They work like Claude Code's own [`claude-cli://` deep links](https://code.claude.com/docs/en/deep-links).

[← Back to the README](../README.md)

**By default a link only fills in New session.** You read the prompt, check the folder and press Enter yourself. A link starts the session on its own only when it says so with `autostart=1`.

## Start a new session

```text
switchboard://new-session?prompt=Investigate%20the%20failed%20deploy&cwd=/Users/me/dev/payments
switchboard://new-session?project=payments&prompt=What%20changed%20this%20week%3F
switchboard://new-session?repo=acme/payments&prompt=Review%20the%20open%20pull%20requests&autostart=1
```

| Parameter | What it does |
|---|---|
| `prompt` (or `q`) | Text for the message box, URL-encoded. Use `%0A` for a new line. At most 5,000 characters. |
| `cwd` | The absolute path of the folder to start in, such as `/Users/me/dev/payments` (on Windows `C:\Users\me\dev\payments`, URL-encoded). |
| `project` | One of your projects, by the name it has in Switchboard (or its folder's name), ignoring case: `project=payments`. If two projects share the name, the first in your list wins. A name that isn't one of your projects is refused, and nothing changes. |
| `repo` | A GitHub repository as `owner/name`. Switchboard looks for a checkout with a git remote on that repository, first among your projects, then among the other folders you've used Claude Code in (most recent first). If there's none, the folder field stays empty and New session says so. |
| `autostart` | `1` (or `true`) starts the session right away, as if you'd pressed Enter. Leave it out (or use `0`) to fill in New session and wait for you. |
| `question` | `1` (or `true`) makes it a quick question: no project, in Switchboard's scratch folder. `cwd`, `project` and `repo` are then ignored. |

All parameters are optional. When a link gives more than one of `cwd`, `project` and `repo`, `cwd` wins, then `project`, then `repo`. **A link that gives none of them doesn't guess:** the folder field stays empty and the project list opens so you can pick one.

### Starting automatically

With `autostart=1`, the session starts as soon as its folder is found, with the project's usual model, effort and worktree choice. The permission mode is the one saved as the project's default. Without a saved default, it is the default mode (Ask before edits), never the mode you picked last. Auto mode, Don't ask and Bypass permissions never apply to a session started from a link: it uses the default mode instead. So Claude still asks before it edits files or runs commands, unless the project's default is Accept edits or Plan mode. A session started from a link doesn't add its folder to your projects.

It only starts when the link has a prompt and names its folder (`cwd`, `project`, or a `repo` that Switchboard finds). Otherwise it waits like any other link: without a folder you pick one first, then press Enter. If the folder doesn't exist, nothing starts and the prompt stays filled in.

Only use `autostart` in links you write for yourself or your team. Clicking an `autostart` link someone else made starts Claude with their prompt in your project.

When a link fills in the prompt (and doesn't start the session), a line under the message box says **Prompt from an external link** until you send it or clear it. For a long prompt it also gives the number of characters, since part of it may be scrolled out of view. **Clear** empties the message box.

Model, effort, permission mode and the worktree choice come from the project's defaults (or your last choices), as they do when you press ⌘N. You see them before you press Enter. A link can't set them. A link that starts the session itself takes the permission mode only from the project's default, and never a mode that skips permission prompts (see [Starting automatically](#starting-automatically)).

## Open a session

```text
switchboard://session/0b9a7c1e-1234-4abc-9def-001122334455
```

Shows that session, as if you'd picked it in the sidebar. To get a session's ID, right-click it in the sidebar and choose **Copy session ID**.

## Bring the window up

```text
switchboard://show
```

Starts Switchboard, or brings its window to the front, without changing what it shows. The VS Code companion uses it on Windows, where it can't open the app by its bundle id as it does on macOS.

## When the app isn't running

Opening a link starts Switchboard if it isn't running. The link waits until the window has loaded and is connected to its engine, then opens. If the app is already open, its window comes to the front.

## Links Switchboard refuses

Links can come from any web page, chat message or script, so Switchboard checks each one before it changes anything. A link it refuses shows a short message at the bottom of the window explaining why, and nothing else happens. That covers:

- an action other than `new-session` or `session`;
- a prompt longer than 5,000 characters, or one with control characters (other than tabs and new lines) or invisible characters such as right-to-left overrides and zero-width spaces, which can hide text;
- a `cwd` that isn't an absolute path (on Windows: a drive path, not `/…`), is a network location (`//server/share`, `\\server\share`, `smb://…`), contains `.` or `..` segments, has a colon after the drive on Windows, or has control or invisible characters;
- a `project` that isn't one of your projects, or has control or invisible characters;
- a `repo` that isn't `owner/name`;
- an `autostart` value other than `1`, `true`, `yes`, `0`, `false` or `no`;
- a session ID that isn't a session ID, or a session that isn't on this Mac.

Switchboard ignores parameters it doesn't know, so a link made for a newer version still opens.

## Examples

### From a shell

```bash
open "switchboard://new-session?cwd=$PWD&prompt=Why%20are%20the%20tests%20failing%3F"
```

That works as long as the folder's path has no spaces or other characters that need encoding.

To encode any text as a prompt, let `jq` do the escaping (it comes with macOS 15 and later; with older versions, install it with Homebrew):

```bash
prompt='Summarise the last 10 commits
and list anything that looks risky.'
open "switchboard://new-session?cwd=$(jq -rn --arg v "$PWD" '$v|@uri')&prompt=$(jq -rn --arg v "$prompt" '$v|@uri')"
```

In a URL, `+` also means a space. Write a literal plus sign as `%2B`; `jq`'s `@uri` does that for you.

### In a README or runbook

```markdown
[Ask Claude to triage a failed deploy](switchboard://new-session?repo=acme/payments&prompt=The%20last%20deploy%20failed.%20Read%20the%20CI%20logs%20and%20suggest%20a%20fix.)
```

Using `repo` instead of `cwd` makes the link work for everyone on the team, wherever they cloned the repository. Some sites (GitHub among them) don't make custom-scheme links clickable; put the link in a code block there so people can copy it.

### Raycast script command

Save this as `ask-claude.sh` in your Raycast script commands folder. It asks for a project and a prompt, and starts the session right away (drop `&autostart=1` to check it first):

```bash
#!/bin/bash
# @raycast.schemaVersion 1
# @raycast.title Ask Claude in Switchboard
# @raycast.mode silent
# @raycast.argument1 { "type": "text", "placeholder": "Project" }
# @raycast.argument2 { "type": "text", "placeholder": "What should Claude work on?" }
uri() { jq -rn --arg v "$1" '$v|@uri'; }
open "switchboard://new-session?project=$(uri "$1")&prompt=$(uri "$2")&autostart=1"
```

### Alfred workflow

Add a **Keyword** input with an argument, connect it to a **Run Script** action (language `/bin/bash`, with input as argv) and use the script below. Typing `claude payments fix the flaky checkout test` fills in New session in the *payments* project; the first word is the project, the rest is the prompt.

```bash
read -r project prompt <<< "$1"
uri() { jq -rn --arg v "$1" '$v|@uri'; }
open "switchboard://new-session?project=$(uri "$project")&prompt=$(uri "$prompt")"
```

### From an alert

Most alerting tools can add a link to a notification. Point it at the service's repository and describe the alert in the prompt, for example:

```text
switchboard://new-session?repo=acme/payments&prompt=Alert%3A%20p95%20latency%20above%202s%20on%20checkout.%20Look%20at%20recent%20changes%20to%20the%20checkout%20path.
```

## Troubleshooting

- **An `autostart` link didn't start.** It needs a prompt and a folder: check that the link has `project`, `cwd` or a `repo` Switchboard can find.
- **Nothing happens when I open a link.** macOS sends `switchboard://` links to the copy of Switchboard it knows about. Move Switchboard to Applications and open it once; it registers itself as the handler for the scheme.
- **The folder is empty.** The link may not name a folder at all: add `project`, `cwd` or `repo`. For a `repo` link, none of your projects or recently used folders has a git remote on that repository. Add the checkout as a project (or open a session in it once), or use `cwd`.
- **The prompt looks wrong.** Check the encoding: spaces as `%20` (or `+`), new lines as `%0A`, `&` as `%26`, `#` as `%23`, `+` as `%2B`.

## For developers

The link is parsed and validated in the main process (`apps/desktop/src/main/deepLink.ts`), then handed to the window over the preload bridge (`onDeepLink`). Main keeps links that arrive before the window is ready, including the one that launched the app, and passes them on once the renderer reports that it's connected to the engine. The renderer resolves `repo` with the engine's `projects.findByRepo` request.

Only the packaged app registers the scheme: `protocols` in `electron-builder.yml` puts it in `Info.plist`, and on launch the app makes itself the default handler. Development and smoke builds leave the system's link handlers alone; the smoke test's *links* step feeds URLs to the handler directly. To try a link by hand, build the app with `npm run dist`, open it once from `apps/desktop/dist/mac-arm64/`, and then run `open "switchboard://…"`.
