# Changelog

All notable changes to Switchboard are listed here. Each release is also on the [releases page](https://github.com/estruyf/switchboard/releases), with the `.dmg` for macOS and, from the first release with Windows support, the installer for Windows to download.

## [Unreleased]

### Added

- **Open a folder from the terminal.** Type `switchboard .` (or `seshboard .`, or just `sesh .`) in a terminal to open New session in that folder, like `code .` for VS Code. Install the commands in Settings › General › Terminal, or press ⌘K and choose **Install the switchboard command**. On a Mac they go in /usr/local/bin, which may ask for your password; on Windows Switchboard adds them to your PATH; on Linux they go in ~/.local/bin. A name another program already uses, such as the tmux tool sesh, is left alone.
- **Light or dark in the remote app.** Open **Theme** in the remote app's **⋯** menu and set Appearance to Match System, Light or Dark. **Sync now** there asks your computers for their theme again.
- **Keep catch-ups folded.** Turn on Settings › Conversation › Catch-up › **Show catch-ups folded** and a finished session shows the one-line strip instead of the full briefing. Press Space to open it. A turn that stopped with an error still opens in full. In the command palette (⌘K), **Catch-ups: show folded** and **Catch-ups: show in full** switch it.
- **Sign in again without leaving the app.** When Claude Code's login expires, the session says it is signed out instead of showing a bare error. Click **Sign in** to sign in from the session's terminal panel; once you are signed in, the session continues where it left off. Signed in somewhere else? Click **Continue**.
- **Middle-click to close a terminal tab.** Middle-click a tab in the terminal panel to close it.
- **Reload MCP servers.** Added an MCP server to your Claude Code settings or a project's `.mcp.json` while sessions were open? Press ⌘K and choose **Reload MCP servers**: running sessions pick it up for their next message without restarting, and the refresh button in a session's Tools does the same for that session.
- **Mark as read after a few seconds.** A finished session you open is marked read once it has been in front of you for 3 seconds, also when it opens with a catch-up, which stays open until you fold it. Settings › Sessions › Mark as read after sets the seconds, or turn it off to mark sessions read yourself.

### Changed

- **On a phone, sessions and New session match the new look:** round buttons, a cleaner catch-up, one composer, and an Options sheet instead of seven chips.
- **The remote app on a phone:** a menu button on every screen, a drawer with Settings and your computer at the bottom, a full-width Home, and a Settings page.
- **New session from the remote app's drawer.** In a session, open the drawer and tap **New session** under Home: no need to go back to Home first. Back from New session goes to your sessions.
- **A clearer order for permission modes.** Settings › General › Global permission mode is what new sessions start in, unless the Claude profile or the project sets a mode, and each session can still change it. A project's Permissions now offers Profile default and Global default (which skips the profile's mode), each with a Change link to where it is set. If Settings had Use project default, it is now Ask before edits, and projects and profiles still come first. A mode set in Settings no longer overrides a project's or profile's own.

### Fixed

- **No more surprise forks after a restart.** A session that was running a background task, such as a watcher, kept its Claude Code process running after Switchboard quit, restarted or updated. Switchboard then saw the session as open elsewhere, and your next message started a fork of it. Quitting now stops those processes. If one is still running after a crash, sending stops it and continues the same session.
- **Saved prompts in New session on another computer.** With another computer picked in Run on, type `/` or click a chip above the message box to use a saved prompt, as on this computer.
- **New session starts on this computer.** The **+** button in the sidebar no longer opens New session on the other computer you picked last. It only goes back there when you typed a prompt for it that you haven't started yet.
- **A pen for a prompt typed for another computer.** The **+** button in the sidebar now shows its pen when you typed a prompt in New session on another computer and haven't started it yet, as it does for this computer.
- **The remote app follows your computer's theme again.** A phone also paired with a computer that no longer connects stayed in Demo Time and missed theme changes. It now uses the first computer that sends its theme.
- **The preview remote app keeps working on the Beta channel.** With the update channel in Settings › About set to Beta, a phone that uses the beta remote app stays connected after you install a stable release. On Stable, only the regular remote app connects.
- **Large context notice in sessions with a 1M window.** The notice, the reminder before the cache expires and the quit prompt now count tokens: Large from in Settings › Usage is a share of a 200k window (60% is 120k), whatever the session's window. Before, a session on a 1M window only counted as large from 600k.
- **Compacting shows after switching sessions** ([#198](https://github.com/estruyf/switchboard/issues/198)). A session that is compacting now says so when you switch to another session and back, also in pop-outs and split view, instead of only Working.
- **Large context cost follows the model you pick.** The cost in the Large context notice is now the price of the model your next message goes to, also after you pick another one in the model chip.

## [1.1.0] - 2026-10-22

### Added

- **Keep this Mac awake.** Settings › General › Keep this Mac awake stops your Mac from sleeping while Switchboard is open, so schedules, triggers and remote access keep working. On a Mac it holds sleep off while on power; on Windows and Linux it is Keep this PC awake. The display can still sleep.
- **Profiles on other computers' sessions.** A session from another computer now has the profile's colour on its left line in the sidebar, as local sessions do. A profile with the same name here (Personal, Work) gets this computer's colour, so one account reads the same everywhere.
- **Pipelines** ([#179](https://github.com/estruyf/switchboard/issues/179)). Pipelines: run a saved set of steps for one task, each in its own sub-session under the session you start it from. Plan with one model, build with another, have a fresh session check the work, then push. Steps hand over with @ links. Run one from a session's ⋯ menu, from New session's **Run as** chip, or from the command palette, and set them up in Settings › Pipelines.
- **Hide the built-in pipelines.** Settings › Pipelines has a Built-in pipelines switch. Turn it off to see only your own pipelines.
- **Another round for a pipeline's review.** When a step like Validate still asks for changes after its last round, the run offers **Another round**: the changes go back to Execute, and Validate checks again when it is done. Or work on them in Execute yourself, and Validate checks again when that turn ends. Ask Validate what it needs first if you like: the run still waits for the changes.
- **Tokens, Copy and Read in the remote app.** A finished turn on your phone shows its tokens after the time and duration, as on your computer ("8:19 AM · 31s · 18.4k tokens"). Your messages have Copy, and a finished reply has Read, which opens the turn's replies in full with how long they take to read. Tokens need the computer to have this version; an older one shows the time and duration only.
- **Pipelines in the remote app.** Pipeline runs now show in the remote app too. Each step's sub-session sits under the session the run started from, and a run started from New session gets a row of its own. Open a run to follow its steps, then Continue, Run this step again, Skip, Stop or Push, with the commit message and the files first. Start a pipeline from a session's **⋯** menu or from New session's **Run as**, and get a notification when a run waits for you, stops or is done.
- **Run as.** New session has a Run as chip next to Start: pick a pipeline, and Start runs it, with its steps shown under the message box.
- **Archive or delete a pipeline run as one.** Archive or delete a pipeline run as one: the parent and its sub-sessions go together.
- **Themes that match the app icons.** Nine new themes in Settings › Theme, one for each app icon: Graphite, Midnight, Paper, Signal, Forest, Plum, Aluminium, Ocean and Neon, each in light and dark.
- **Preview Markdown, HTML and code files** ([#181](https://github.com/estruyf/switchboard/issues/181)). Click a Markdown or HTML file in one of Claude's replies and it opens in a preview in the side panel, next to Changes and Ask, rendered, with a **Source** switch and a **Reload** button for when Claude changes the file. **Open in a dialog** moves it over the window, and files open there from then on; **Dock to the side** brings it back. A link to a line or a range (`src/a.ts:10-14`, `#L10-L14`) opens on the source with those lines marked and scrolled into view. Markdown shows tables, raw HTML such as `<details>`, GitHub's alerts (`> [!NOTE]`) and the pictures next to the file. HTML pages show in a sandbox with no scripts and no network, with their local pictures included. Code and text files (TypeScript, JSON, YAML, shell, CSS and more) show as their source with syntax colours and line numbers. HTML opens on its source, as a page can fail to render; **Preview** is one click away. Long lines wrap, and a **Wrap lines** button, shown pressed while it is on, turns that off. Files over 2 MB offer the editor or your file manager instead. It is also in the command palette as **Preview last written file**. This is now what a click on a file link does by default (**Clicking a file link** in Settings › Conversation), while other files still show in Finder or File Explorer. If you had chosen the editor, it stays that way; if you had left it on Show in Finder, the new default applies.
- **Reading mode.** Reading mode: open any reply on its own, full window, with an outline of its headings and tool calls folded away. Use **Read** in the reply's actions.
- **Triggers** ([#180](https://github.com/estruyf/switchboard/issues/180)). Triggers: start a session when CI fails on a branch or an issue is labelled or assigned to you. Set them up on a project's Triggers tab. Switchboard checks through gh, keeps a state label on the issue if you want, and never bypasses permissions. Archiving or deleting a triggered session takes its working or needs input label off the issue.
- **Triggers can start a pipeline** ([#185](https://github.com/estruyf/switchboard/issues/185)). A trigger's **Starts** can be a pipeline instead of a session: each new failed CI run or issue for you starts a run of it, with the trigger's prompt as its task and the issue or log for the first step to read. The run's row has the bolt and links to the issue or run. **At once** counts runs, not their steps; state labels follow the run, with Push waiting for you as needs input. A trigger pauses when its pipeline is deleted or no longer fits. Pick a pipeline in Run as, then **Start ▾ › Start when…**, to make one from New session. Turn on **Run without stopping for me** and plans are approved for you, steps that wait for you start, and Claude decides questions itself; tool permissions, errors and a failing review still stop the run. **Open the pull request without me** lets Push go too.
- **Approve a pipeline's plan for you.** A plan step in Settings › Pipelines has **Approve the plan for me**: the run goes on to the next step once the plan is written, and the plan is still kept for later steps and the pull request.
- **Upcoming.** Upcoming: one view in the sidebar for everything queued and scheduled, across all projects, with the next 7 days of scheduled runs. Skip a single run without pausing its schedule. Open it from **Upcoming** under the search field, with ⌘⇧Y (Ctrl+Shift+Y on Windows), or from the command palette. **History** shows the runs of the last 7 days and how they went, and Home's Queue and Schedules cards now show three rows with **See all in Upcoming**.
- **Switchboard on Linux.** Switchboard now runs on Linux, on x64 and Arm64. Each release has an AppImage, a `.deb` for Debian and Ubuntu, and an `.rpm` for Fedora, RHEL and openSUSE, and each one updates itself: the AppImage in place, the `.deb` and `.rpm` through your package manager. Open in offers your file manager and the terminals it finds (Ghostty, GNOME Terminal, Konsole, kitty, Alacritty and WezTerm), and notification sounds come from your desktop's sound theme.
- **Attach a GitHub issue or pull request with #** ([#32](https://github.com/estruyf/switchboard/issues/32)). Type # to attach a GitHub issue or pull request to a message. Start a session from an issue or pull request from the # list, the palette or a link. The list shows the project's open issues, then its open pull requests; typing narrows it, and a number or a pasted link finds that one. Claude gets the title, link, labels and text, and for a pull request its branch and unresolved review comments, as context to read, not instructions. A new session from an issue starts in a worktree named after it, with "Fix #32: …" in the box; a pull request is worked on in a new worktree at its latest commit, or in your current checkout. Nothing runs until you press Start, and Switchboard never pushes to a pull request from a fork it can't push back to. It needs the GitHub CLI, signed in.
- **Scheduled sessions** ([#173](https://github.com/estruyf/switchboard/issues/173)). Scheduled sessions: start a prompt once, every day, on weekdays, on set days each week or on a day each month. Pick **Once** under Repeat to run a prompt a single time: it starts an hour from now, and you can change the date and time. After its run it leaves the lists, and its run shows in Upcoming's History. Find them on Home and in a project's Sessions tab.
- **Queued items can start by themselves** ([#172](https://github.com/estruyf/switchboard/issues/172)). Queued items can start by themselves when the session they wait for finishes. Use Start after this one… on a session to set one up. An item only starts after a clean finish: after an error or a stop it stays in the queue, ready, and says why. At the focus limit it waits for a free slot instead of asking, and it starts with or without a window open.
- **Pick an app icon.** Pick an app icon in Settings › Theme: nine colourways of the Switchboard icon for the Dock and taskbar, and for the remote app on your phone.
- **Open at login.** Turn on **Open at login** in Settings › General, under On startup, and Switchboard opens when you log in to your Mac or sign in to Windows. So on a virtual machine or a computer that restarts by itself, it is running again without you opening it. The setting is the system's own login item, so you can also change it in System Settings › General › Login Items, or in Startup apps on Windows. When macOS asks you to allow it first, Settings says so and opens the right page. It isn't available on Linux.
- **Start a worktree from any branch.** The **Branch from** menu of a new worktree offered only the remote's default branch, such as `origin/main`, and your local HEAD. It now lists every other branch too, local and remote, such as `dev` or `origin/release`, with **Search branches** to find one. Claude Code can't start a worktree from those, so Switchboard makes it, in the same `.claude/worktrees` folder and with the same `worktree-` branch, and starts Claude in it. A remote branch is fetched first. The new branch doesn't track the one it started from, so a push never lands on `dev` itself. Git-ignored files your `.worktreeinclude` lists, such as `.env`, are copied in. A project can keep a branch as its default under **Worktree base** on its Settings tab, or with **Save as project default**; queued items, scheduled sessions and triggers in that project start from it too.
- **Unlock a locked worktree.** A worktree git has locked (Claude Code does this while a session runs, and a crash can leave it behind) has **Unlock worktree** in its ⋯ menu, so you can remove it.
- **A project's own default branch.** A project's defaults have a **Default branch**, for when you work on another branch than the one GitHub calls the default (`dev` instead of `main`). New worktrees from origin start from it, pull requests go into it and Changes compares against it. Leave it on the remote's default branch to follow GitHub.
- **The remote app uses your computer's theme.** Your phone now looks like Switchboard on your computer, in the theme you picked there, and changes when you pick another one or edit it. Light or dark follows your phone. Open **Theme** in the **⋯** menu to go back to **Demo Time**. With more than one computer, your phone uses one computer's theme for all your sessions, so the colours don't change when you switch: the first computer's at first, or the one you pick in **Theme**.

### Changed

- **New sessions start from the project's defaults.** A model, effort, mode or workspace you change in New session now applies to that prompt only, and the next one starts from the project's defaults again. To change what a project starts with, use Save as project default or the project's configuration.
- **Permission mode for new sessions.** Settings › General › Permission mode now offers **Use project default** (the default: the project's or profile's mode, else Ask before edits), **Remember last** (the mode you picked last in New session or the palette) or one mode to always start in, which now applies even in a project with its own default mode. If you had it on The last one you picked, it is now on Use project default.
- **Projects is one view.** The list is on the left, the project on the right. Switch with the name's menu, the arrows or ⌥↑↓, and open a project's Settings from its row. Drag a row to reorder the list, and right-click it to rename or remove the project.
- **A clearer trigger editor.** The trigger editor is easier to follow: five numbered sections, and a sentence at the top that says what the trigger will do. A new issues trigger changes nothing on GitHub until you turn on state labels in **What happens on GitHub?**.
- **A clearer queue line in New session.** The line under the message box now says what happens ("If you add it to the queue, it waits for “Fix login” to finish, then starts by itself"), and the **Wait for** button shows what is picked.
- **Removing many worktrees goes one by one.** The clean-up dialog removes worktrees one at a time and shows each as Removing…, Removed or the error. A slow one no longer hides the rest, and **Stop after this one** ends the run early. If one doesn't answer in time, the list is read again so it shows what is really left.
- **Pull requests go to the branch your project develops on.** A project whose worktrees start from a branch (Project settings › Worktree base) now opens pull requests into that branch, not the repository's default branch. You can still pick another in the pull request dialog.
- **Plan usage under the message box takes less room.** The 5-hour and weekly limits now show as small rings instead of bars, next to the context ring.
- **Stop, cancel and remove buttons are red.** Stop (Claude, agents, commands, background tasks), Cancel on a running clone or pairing, Discard on a draft, and Remove, Revoke and Forget for computers and devices now show in red like Delete, in the app and on the remote app.
- **Claude and The unnamed themes removed.** If you used one of them, Switchboard switches to Demo Time.
- **Home in the remote app.** In the remote app, Home is now the first row under Sessions, in the sidebar and the sessions drawer, above your computers and the search. In the sidebar it was a small button next to the title. The drawer's Home row no longer shows each profile's usage; Home itself has it.
- **Stop and steer from your phone.** In the remote app, **Stop** is now next to the send button while Claude works, not hidden in the **⋯** menu. Stopping from your phone lets Up next carry on, so the next queued message goes at once. The arrow next to the send button offers **Queue**, **Steer** (Claude reads your message at its next step) and **Send now** (stops Claude first).
- **One usage card per account in the remote app.** With more than one computer paired, a Claude profile signed in to the same account on several of them used to show once per computer, with the same numbers each time. It now shows once, with its newest numbers and the computers it is on, such as "On mystic and studio". Each computer needs this version.
- **Ask Claude to commit is fast and uses far fewer tokens.** It used to send the session a message to commit, so Claude read the whole conversation again: in a long session, that was close to a million tokens for one commit message. Now Haiku writes the message from the changes alone (the files, the diff stat and up to about 10,000 tokens of the diff, lock files left out), in the style of your recent commits, and the commit runs in a terminal tab as with **Commit…**. The conversation is not touched. The tokens count on the session's profile, in Usage. New project actions no longer suggest a *Commit* action that asks the session to commit; an action like that you added before stays as it is.
- **The catch-up says what Claude did in words, not in commands.** When Haiku didn't write the catch-up, its lines could be a line of a `sed` command, a Python script or a heading of Claude's reply, such as "What's in it". Now a command shows as what Claude said it does, such as **Built the website**, or what it was, such as **Ran the tests** or **Ran a Python script**, and a heading of the reply is left out. **Skipped or not finished** says **Couldn't rewrite the imports** instead of the command that failed, and leaves out a command that failed and worked when Claude ran it again. A command that failed is no longer under **What it did** too. Haiku now gets what each command does, and is told never to copy a command into the card.

### Fixed

- **↑ in New session shows no earlier messages.** The message box on New session had ↑ bring back the first prompts of your sessions in the project, which could be another session's text. ↑ now works only in a session, with that session's own messages.
- **A paired computer can no longer blank the window or the remote app.** When another computer sends sessions this version can't read, for example because it runs an older or newer Switchboard, the window and the remote app now leave them out and say so, instead of showing an empty screen. The computer's page and its chip in the sidebar say what happened, and the remote app shows a banner. Updating Switchboard on both computers fixes it.
- **Archived sessions stop following their checks.** A session's pull request checks were still read and notified after the session was archived. Once archived, it no longer follows them, and no check notification comes for it. Opening it again while it's archived doesn't start following them either.
- **Steer and Send now on another computer's sessions.** In a session from another computer, a message you send while Claude works no longer always waits in Up next. Enter queues or steers as set in Settings › Conversation, ⌥↵ (Alt+Enter on Windows) does it the other way, ⌘⇧↵ (Ctrl+Shift+Enter) stops Claude and sends at once, and the arrow next to Queue lists all three, as on your own sessions. Up next has **Send now** there and in the remote app on your phone. The other computer needs this version.
- **The Steer button steers.** With Enter set to steer in Settings › Conversation, clicking **Steer** next to the message box queued the message instead.
- **Steps on your phone read like the app's.** The remote app now names each step the way the app does: a command by what it does ("Merge origin/dev"), not its raw text, and the step Claude is on while it works ("Running the tests").
- **Remove an offline computer.** In Settings › Remote, a paired computer with a long error line no longer pushes its Try again, Open and Remove buttons out of view. The line is cut short, so you can always remove a computer that is gone.
- **What you type for another computer stays when you go elsewhere.** A message you started in a session that runs on another computer, or in New session with **Run on** set to another computer, was gone when you opened something else and came back. Each session there keeps its draft, and New session keeps one prompt per computer, also after a restart, until you send it.
- **Mod chips no longer cover the message box chips.** In a narrow message box, the prompt shield and a mod's statuses used to run over the model and mode chips. They now give way first (the shield keeps only its icon), then the chips shrink, and the footer wraps as a last resort.
- **Pull requests always push the branch first.** Create pull request pushes the branch before it creates the pull request, so one whose remote copy was deleted (after an earlier pull request was merged) no longer stops with "you must first push the current branch".
- **Copy error messages.** The text of a notice, such as a failed pull request, and its output can be selected and copied.
- **No more 0 on the side panel's tabs.** With two or more panels open on the right, a tab shows a count only when there is something to count: Preview no longer reads 0, and Terminal, Agents and Commands show no number while nothing is running.
- **Git errors are shown.** When Commit, Pull, Push or Fetch fails, a toast now says why, instead of only a red border on the button (which is gone).
- **Usage limit controls in the remote app and on other computers.** A session stopped by a usage limit now shows the notice with **Resume now** and **Resume when it resets** in the remote app on your phone, and in a session on another computer opened in Switchboard, where the messages held in Up next are listed too (you can take one back with the **X**). Before, those views showed neither the controls nor the queue. Both need the other computer to run this version.
- **A new permission mode applies to requests that are already waiting.** If you switched a session to Auto mode or Accept edits while Claude was asking, you still had to answer the requests that were already waiting. Answering one request sends the next one right away, so switching after answering didn't help either. Requests the new mode allows now close, and Claude makes those calls again without asking. Questions and plans still wait for your answer.
- **Copy text in Remote settings.** You can now select the Remote address and the connection line in Settings and copy them, not only with the Copy button. Right-click selected text anywhere you can select it to get **Copy**.
- **Change the model, effort and mode of a session that isn't running.** A session that wasn't running in Switchboard showed "Not running in Switchboard" under the message box instead of its chips, so you couldn't change its model, effort or permission mode before you sent. The chips are now there, and what you pick is what the session resumes with. If its last run failed, the reason shows next to them.
- **A computer that is away takes one line in the remote app.** When the remote app couldn't reach a computer, it showed a large banner with the reason and a try counter, which took a lot of the sidebar. It is now one short line, "Can't reach Elio's iMac · Reconnecting…". Tap it for **Help** with the reason and what to do.
- **Right-click in the message box.** The message box on the New session page and in a session now has a right-click menu (or Shift+F10) with **Cut**, **Copy**, **Paste** and **Select all**. **Paste** works like the keyboard shortcut, so an image on the clipboard is attached too.
- **Right-click in the terminal.** Right-click, or press Shift+F10, for **Copy**, **Paste** and **Select all**. In a session's terminal, select an error or some output and choose **Explain with Claude** or **Fix with Claude** to put it in the message box, in a code block under the question, ready to send.
- **A pipeline's parent stops saying Needs you once you answer.** When a step asked a question or a permission, its parent showed Needs you, and kept showing it after you answered and the step was working again. The parent and the step now go back to working as soon as you answer, or as soon as the step works again after you reply to it.
- **Finished pipeline steps are green in the sidebar.** A step the run had finished showed a blue dot under its parent until you opened it, as if it still worked. It is now green, as in the run's overview.
- **Move back and Close window stay in reach in a narrow window.** In a session's own window at its smallest, a Create PR or Pull button no longer pushes them off the edge: under 560px it shows only its icon (and count), as it already did in four panes side by side.

## [1.0.0] - 2026-10-19

### Added

- **Link another session with @.** Type `@` in the message box and the list now has your sessions above the files. Pick one, and its name stays in your text, such as "stack the PR on top of the one you opened in @Usage cost toggle", with a chip above the message. When the message goes to Claude, it gets a short brief about that session: its folder, its branch and commits, its pull request and the branch it merges into, what it did and its last reply. So Claude can start from that branch and stack a new pull request on it without you copying anything over. Under your message, **Linked:** shows each session it linked, and **What Claude got** shows the brief. Right-click a session and choose **New session linked to this one** to start from it.
- **Use Claude in Chrome in your sessions** ([#150](https://github.com/estruyf/switchboard/issues/150)). Turn on **Use Claude in Chrome** in Settings › General, and sessions get the browser tools of the Claude in Chrome extension, as they do in a terminal. Claude Code's own **Enabled by default** for Claude in Chrome didn't reach Switchboard's sessions. It is off by default, since it needs the extension installed in Chrome, and it applies to sessions you start or resume after you change it.
- **A Beta channel for updates** ([#65](https://github.com/estruyf/switchboard/issues/65)). In Settings › About, choose **Beta** under **Channel** to get beta versions of what comes next before it is released, and the published releases too. Going back to **Stable** never installs an older version: you stay on the beta until its release is out. Beta replaces Nightly, which had no builds; if you had chosen Nightly, you are now on Beta.
- **Sign in to a new Claude profile without leaving Switchboard.** **Sign in** on a profile that isn't signed in yet opens Claude Code with that profile in Switchboard's terminal, next to Settings, so you sign in there instead of copying a command to another terminal. When you add a profile, **Sign in now** does this right away (it is on by default, and skipped for a folder that is signed in already). It works the same on Windows, where the command to copy was in a form PowerShell doesn't run.

### Changed

- **Pull requests go to the branch your project develops on.** A project whose worktrees start from a branch (Project settings › Worktree base) now opens pull requests into that branch, not the repository's default branch. You can still pick another in the pull request dialog.

- **A shorter session menu in the sidebar.** The menu you get when you right-click a session had grown long, with the project's profile, icon and pages in between the session's own items. They now sit under **Project**, a submenu with the project's **Claude profile** and **Project icon** in submenus of their own, next to **Rename project…**, **Open project**, **Worktrees…**, **Branches…** and **Project settings…**. The memories a session wrote are under **Memories**. Point at a submenu, or press → or Enter, to open it; ← or Esc goes back.
- **The catch-up opens with its Details, so Mark as read is in sight.** **Mark as read** and the other actions were behind **Details**, so a session you had read kept its bold title. They show as soon as the banner opens; **Details** still closes them. Right-click an unread session in the sidebar and choose **Mark as read** to clear it without opening it. A session you have read has **Mark as unread** there, to come back to it later; it stays unread until you leave the session.
- **The remote app shows the sessions of all your computers in one list.** With your phone paired to more than one computer, you no longer switch between them: every computer's sessions are in the same list and groups, and each says which computer it runs on, such as **mystic**, as Switchboard shows another computer's sessions in its sidebar. So do the cards of what Claude asks, a session's header, Home in a wide window and the search. A chip for each computer at the top shows its status and how many sessions need you there, and opens its menu with **Disconnect** and **Forget this computer…**. A computer that is offline keeps its sessions in the list, greyed out. In **New session**, **Run on** picks the computer the session starts on, and keeps what you typed when you switch. The usage card has a row for each computer.

- **Commands without a description show what they run, not their script.** While Claude runs a long command or an inline script, the step reads **Running a Python script** or **Running git** instead of a line of code. Short commands still show as they are, such as **Running npm test**. Open the step to see the whole command.
- **A session in its own window now has all its panels.** The window used to show only the conversation and the message box, so Changes, Ask, Agents, Commands and the terminal were out of reach once the session left the main window. Now the header has the same panel buttons, the panels open next to the conversation, and the session's shortcuts work there, such as the terminal's and Open in editor. The window opens wider (1000 pixels, or as much as fits beside the main window), so a panel has room. The panels that are open go with the session: a session opens in its window with the panels it had open in the main window (Agents on the same agent, Ask on the same thread, the terminal), and when it comes back, by Move back to main window or by closing its window, the main window shows the panels as you left them. The size of a panel stays with its window. Settings, Usage and a project's page open in the main window, which comes to the front. The command palette (⌘K, Ctrl+K on Windows) and the shortcuts sheet (⌘/) open in the window too, with the commands for its session: Toggle agents, Toggle changes, Rename session…, the git commands and the rest act on that session, and the commands for the sidebar, split view and Home are left out. Go to, Search, New session, Quick question and the commands that move to another session still use the main window, which comes to the front.
- **Copy a long code block without scrolling back up.** The copy button of a code block now stays at the top of the conversation while the block scrolls past, in the app and in the remote app. In the app, it shows when you hover the block, with Run for a shell command.

### Fixed

- **The terminal uses every font from your terminal settings.** When VS Code's terminal font setting lists more than one font, such as `'Cascadia Code', monospace`, the terminal treated the whole list as one font name and fell back to the default font. It now uses each font in order. The same goes for a list of fonts in Windows Terminal, and for several font lines in Ghostty.
- **Up next in the remote app stays right after the phone was away.** A message you added to Up next from your phone stayed there after Claude had sent it, and tapping its × did nothing, when the phone was locked or offline at the time. Opening a session now shows its Up next as it is on the computer, and removing a message that was already sent clears it. Opening a session also shows what you queued for it on the computer.
- **The remote app keeps what you typed and didn't send.** A message you started in a session's message box was gone when you opened another session and came back. Each session now keeps its own draft, as New session does, also after a reload, until you send it.
- **The Agents panel shows an agent that runs again, and one that failed.** A background agent that stopped, such as at the 5-hour usage limit, and was then sent on again, stayed under **Finished**. It now moves back to **Active** until it reports back, also for a finished agent you give more work. An agent that ended on an error, hit the usage limit or was stopped now says **Failed** with a red mark, where it said **Finished** with a green one.
- **File links in replies no longer turn back into plain text after Claude moves to a subfolder.** When Claude ran a command in a subfolder of the project, the next message made Switchboard look up every file name from that subfolder, so links such as `parts/clamp/plate.3mf` lost their link while a bare file name kept it. The session now stays in its own folder; only a worktree Claude starts or leaves moves it.
- **Text in the terminal no longer spreads out with wide gaps between letters.** Output that arrived while a terminal tab was in the background, or while the terminal was closed, could show with every letter far apart once you came back to it. The terminal now draws it again when it shows.
- **Terminals keep their fast drawing with many tabs open, and get it back after a graphics reset.** With many terminal tabs open, the older ones could slow down and stay slow. Now only the terminal you can see uses the graphics card, and a terminal that lost it, after a driver reset for example, gets it back the next time it shows.

## [0.0.23] - 2026-10-17

### New

- **Start a project from a GitHub URL.** Turn on **Clone from GitHub** in the new Settings › Projects page and choose the folder new projects go in, such as `~/Developer`. Then paste `https://github.com/owner/name` in New session (**Clone from GitHub…** above the projects, or the project filter), type your first prompt and press Start: Switchboard clones the repository, adds it to your projects and starts the session there. The clone starts right away, with its progress and **Cancel**, while you type. A `/tree/<branch>` URL checks out that branch, and a checkout of the same repository that is already there is used as it is. With **Run on** set to another computer, the clone and the session run there, in that computer's own folder. The command palette has **New session from a GitHub repository…**, the sidebar's add project menu has **Clone from GitHub…**, and a link whose `repo` you have no checkout of offers **Clone owner/name**. A cloned repository can bring hooks, MCP servers and permission rules of its own: before its first session, Switchboard lists them and asks. **Project order** moved from General to the Projects page.
- **The remote app works with more than one computer, with notifications from all of them.** Pair your phone with a laptop and a desktop, for example: **Pair another computer…** in the computer's menu pairs one more, and your other computers stay paired. The app shows one computer at a time but stays connected to all of them. The computer's menu lists the others with how many sessions need you there; tap one to switch. While sessions on another computer need you, a row above your sessions says so, such as **mystic · 2 need you**, and the counts on the drawer button and in the browser tab add up every computer. Every computer sends notifications, each starting with the computer's name, and a tap opens the session on the right computer. **Forget this computer…** only forgets the computer on screen. Notifications from more than one computer need this version of Switchboard on each of them.
- **Saved prompts: save a prompt with blanks, pick it with / or in New session, fill in an issue, pull request, branch or your own options, and send. Keep them for every project, for one project just for you, or share them with the project.** Type / in any message box: your saved prompts come first, then the commands. Pick one and its text goes in the message box, each blank a chip: type in a text blank, or pick a GitHub issue, an open pull request, a local branch, a file or one of your own options. Tab moves to the next blank, Backspace in an empty one takes it out, and Send waits until the blanks you need are filled ("1 blank left"). **Clear** takes the prompt out of the box. Write more under the prompt to send it along. New session shows the prompts you use most as chips above the message box. Make one in **Settings › Prompts**, with *New saved prompt…* in the command palette, or with **Save as prompt…** on a message you sent, which offers its links, branches and paths as blanks. Shared prompts are saved in the project's `.switchboard.json` with its actions, so the team gets them once it's committed.
- **Share an action with the project from the action editor.** Set **Saved for** to **Shared with the project** and save: Switchboard writes the action to the project's `.switchboard.json`, and creates the file if there is none. Commit the file and everyone on the project gets the action. Shared actions can now be edited and deleted in the app too, and moving one back to *This project* or *All projects* takes it out of the file. Switchboard keeps the rest of the file as it was, so the commit shows only the action that changed. A pull that changes the file updates the actions in the app.
- **See what your tokens would cost at API prices, in the currency you pick: per plan window, per session, project, model and day.** After the 5-hour and weekly bars under the message box and in New session, an estimate such as **5h 38% ≈$4.10 · Week 52% ≈$61** says what the tokens of each window would cost at Anthropic's API prices, every model at its own price. Next to Context under a session's message box, **Cost ≈$12.40** is what that session used since it started, also for a session on another computer. The bars and the Limits cards add up your paired computers that sign in to the same account, since your plan counts them all; hover a bar to see which computers count. In the Usage view, the Limits cards show each window's cost, and the Tokens tab has a **Cost (est.)** tile and column for every session, project, model, day or computer. Your plan is not billed per token, so this is never a charge. A new **Usage** page in Settings turns it off or on, picks the currency (US dollar, Euro, British pound, Japanese yen and 20 more), and has **Open usage** for the Usage view.
- **A session with a large context says when its prompt cache expires, and what the next message costs after that.** Anthropic keeps a conversation's context in its prompt cache for up to an hour after the last message; after that, the next message reads the whole context again, at a much higher price. From 60% full, the context ring turns orange and a note above the message box says *Large context: 412k tokens (82%). Its cache expires in 48 min. After that, your next message reads all of it again (≈$3.20).*, with **Compact now**. The next morning it says how long ago the cache expired instead. A notification comes 5 minutes before a large session's hour-long cache expires, and the first time you quit with a large session open, the quit prompt says so and offers **Warn me about this every time I quit**. Pick the percentage, or turn each of these off, under **Large context** in Settings › Usage.
- **See a pull request's checks on the git button, and let Claude fix the ones that fail.** Once the branch has an open pull request, **View PR #123** shows how its checks stand: a green check when they all passed, a red cross when one failed, a spinning circle while they run. Hover it for how many, such as *1 of 5 checks failed*. The git menu lists the checks, failed ones first, with their workflow and how long they ran; click one to open it on GitHub. While checks run, Switchboard follows them, and a notification says **Checks failed on PR #123** or **Checks passed on PR #123** when they finish while you are elsewhere. **Fix failing checks with Claude** in the menu (or **Fix with Claude** on one check's row, or the command palette) puts a prompt in the message box with the end of each failed job's log as a chip, so you no longer copy logs from the browser. Nothing is sent until you send it. Needs the GitHub CLI, signed in.
- **The Agents panel shows which model each agent runs on.** Every row and the agent's detail now say *Opus 5.5*, *Sonnet 5.5* or the like, next to the agent's type. An agent without a named type no longer shows a generic *agent* label, as the panel is only for agents. Claude picks it when it starts the agent; an agent it gives no model runs on the model its type sets, or on the session's own.
- **Open a session in its own window, next to the main window or on another screen.** Press ⌘⌥O (Ctrl+Alt+O on Windows), click **Open in new window** in the session's header, or right-click a session in the sidebar and choose **Open in new window**. The window shows the session and its message box, with permission prompts and questions, but not the side panels. A session is open in one window at a time: its pane in the main window closes, and its row in the sidebar shows a small window icon. Clicking that row, or a notification about the session, brings its window to the front. A message you started typing goes with it. Shortcuts for the whole app, such as the command palette, work in the main window. **Move back to main window** puts the session back in a pane. Closing its window leaves the session running.
- **Turn off the fading of inactive panes.** With sessions side by side, the panes other than the active one are faded. Turn off **Fade inactive panes** in Settings › Conversation to show them as clearly as the active one, which keeps its line along the top.

### Changed

- **Pull requests go to the branch your project develops on.** A project whose worktrees start from a branch (Project settings › Worktree base) now opens pull requests into that branch, not the repository's default branch. You can still pick another in the pull request dialog.

- **Hide the estimated cost on the usage bars only.** With **Show estimated cost** on, **Show it on the usage bars** in Settings › Usage turns the estimate after the 5-hour and weekly bars off, and keeps it in the Usage view and next to Context.
- **The time and duration under a reply now show when you hover the reply, with its buttons.** The faint line under the last reply of a turn, such as **14:32 · 2m 14s**, stays out of the way while you read. Hover the reply, or move to its buttons with Tab, to see it. It takes the same space as before, so nothing moves.

### Fixed

- **A computer with a long name can pair with another one.** Its name is cut to 60 characters, the most a paired device's name may have; pairing used to fail with "Invalid params".
- **The session header fits four panes side by side.** In a narrow pane, the git button shows its icon and count instead of the word (Commit, Push…), so the ⋯ menu no longer runs off the edge.
- **The Usage view fits a narrow window.** The chart on the Tokens tab no longer runs past its card after the window gets narrower, and the breakdown's columns no longer stick out of their rows: the table scrolls sideways instead.
- **Side panels stay with their session in split view.** With two sessions side by side, a session's Changes, Agents, Commands or mod panel used to disappear when you clicked the other session, and come back when you clicked back. Each session now keeps its own panels, and which one is in front, wherever you focus. Changes is now open per session too, and no longer stays open when you switch to another session or restart Switchboard.
- **The keyboard no longer covers Start session in the remote app.** On a phone, while you type in New session, the screen now shows only the project's name, the prompt and the buttons, with **Start session** right above the keyboard. Tap the keyboard button next to it to hide the keyboard and see the project tiles and the chips again.
- **Working sessions no longer swap places in the remote app.** In the **Working** section, sessions moved each time one of them wrote something. As on your computer, the session you set going last is now on top, and the others keep their place. The same goes for sessions of another computer in your sidebar. This needs this version of Switchboard on that computer.
- **Sessions on another computer work in split view.** Dragging one from the sidebar into the panes left an empty pane, and while one was open, you couldn't drag another session next to it. A session on another computer now opens in a pane like your own: drag it next to another session, ⌥-click it (Alt+click on Windows), or right-click it and choose **Open beside**.

## [0.0.22] - 2026-10-16

### New

- **Each reply shows when the turn ended and how long it took. Turn on tokens in Settings › Conversation to see what a turn used.** A faint line after the buttons under the last reply of a turn says when it ended and how long Claude worked, such as **14:32 · 2m 14s**. Time a permission prompt, a question or a plan waited for you is left out, and shown in brackets; a turn you stopped says **Stopped after**, and one that ended on an error **Failed after**. Hover the time for the full date. With **Time, duration and tokens** under **Under each reply**, the line adds the turn's tokens, its agents' included; hover them for what they were made of and the model. While Claude works, the working line counts along, and pauses while a prompt waits for you. Hover one of your prompts to see when you sent it, and from which phone. Sessions on another computer and in the remote app show the time and duration too.
- **The remote app on a phone: a sessions drawer, one first screen with every profile's usage, pull to refresh, swipe to mark read or archive, and Disconnect from the computer's menu.** In a session, the button at the top left (or a swipe from the left edge) opens your other sessions in a drawer, with a pink count of what needs you; tap one to switch, and the back gesture goes back to the list instead of through every session you looked at. The app now opens on your sessions, its only home on a phone, with your computer's name at the top: tap it for the computer's menu. The line under it says how you're connected and what needs you, such as **Connected · 2 need you**, and when you scroll, the name moves into the bar at the top. Search takes the name's place, with **Cancel** and the **All**, **Needs you** and **Working** chips. A usage card is on top of the list: the 5-hour and weekly bars, one row per Claude profile when you have more than one. Tap it for each profile's full card. Pull the list down to refresh it. Swipe a session right to mark it as read, or left to archive it, with **Undo**; a long press has the same actions. Sessions that need you don't swipe away. The computer's menu has how long you've been connected, **Disconnect** and **Forget this computer…**. Disconnected, the app stays that way, also after a reload, until you tap **Connect**. While you type, the keyboard no longer covers the message box, and a prompt folds to one line above it. A phone in landscape keeps the phone layout, and on an iPad in portrait the sidebar can fold away (⌘B, Ctrl+B on Windows). With more than one profile, each session shows its profile's dot, and notifications start with the profile's name. Undo after **Mark as read** needs this version of Switchboard on your computer.
- **The remote app tells you when there is a new version.** On an iPhone, the app on your Home Screen keeps running the version it started with until iOS closes it. It now checks for a new version when you come back to it, and shows **A new version is ready.** with **Reload**, on the screen you are on. **Later** hides it for an hour. While a new version waits, pulling the list down says **Release to update** and loads it.

### Fixed

- **Starting a session no longer empties the window.** Sending the first message from New session could leave Switchboard blank, until you restarted it. It now opens the session.
- **A mod's switch hides its band.** Turning a mod off in Settings › Mods left its band above the message box, because Claude Code doesn't say which mod drew a band. With more than one mod, bands now show only while all their switches are on, and Settings › Mods says so. Panes, statuses and toasts still follow each mod's own switch.
- **A new line at the bottom of a full message box.** When the message box was at its full height, ⇧↵ (Shift+Enter) at the end left the new line, and the caret, just out of sight under the box. The box now scrolls to the caret.

## [0.0.21] - 2026-10-16

### New

- **Claude Code mods show in Switchboard: bands above the message box, panes in the side panel, statuses and toasts. Settings › Mods turns them off.** Mods are Claude Code plugins that draw UI. Each thing a mod draws sits in a frame with its name, in your theme's colours. A mod can also draw its own view of a tool call or a message, with **Show the built-in view** to switch it back. The **mods** chip in a session's header lists the mods and what they draw, with a switch for each. A green **checked** chip shows when a mod checks your prompts. Needs a Claude Code version with mod support.
- **Commands panel: see what background commands print.** The commands Claude runs in the background, such as a build or a dev server, and its monitors now show in a panel on the right, a tab beside Changes, Ask and Agents. **Running** and **Finished** are two lists you can fold, and finished commands stay for the whole session. Pick one to see its command line, how it ended (with the exit code) and its output, which follows along live while it runs. **Copy** copies the output, and **Stop** stops a command that still runs. Open it with ⌘⇧E (Ctrl+Shift+E on Windows), the **Commands** button in the header (it shows how many run), **Toggle commands** in the command palette, or **Commands** under ⋯. In the background tasks above the message box, a command's name now opens it in the panel, and a background command's call in the conversation has **Open in Commands panel**.
- **Send a command's output to Claude.** A shell code block in Claude's reply (on Windows a PowerShell one too, which now gets **Run in terminal** as well) has a second button next to **Run in terminal**: **Run and send the output to Claude** (or ⌥-click **Run in terminal**, Alt+click on Windows). The command runs in a terminal tab of its own, and when it ends, Claude gets a message from you with the command, its exit code and the last 200 lines of its output, so it can carry on from there. While Claude works, the message waits in **Up next** until its turn ends. Project actions can do the same: turn on **Send the output to Claude when it finishes** in the action editor, for a *Test* or *Lint* action whose result Claude should see. A line under the output in the tab says where it went.
- **Usage counts your other computers.** When you use Claude Code on more than one computer, the Usage view now adds up the tokens of the same claude.ai account on the computers you paired. **This Mac** (**This PC** on Windows) and **All computers** in its header pick whose tokens count. The totals, the chart and **What used this window** count every computer; sessions and projects on another computer show its name, and the breakdown can be grouped by **Computer**. A computer that is offline, runs an older Switchboard or has no profile on the same account isn't counted, and the view says so. It needs this version of Switchboard on the other computer too.
- **Connected to this Mac.** The sidebar shows which phones and computers are connected to this Mac, with what they did last. Revoke one from there. While Remote is on, **Connected to this Mac** at the bottom of the sidebar lists each connected device, with since when. Click a device to see its last action, such as **Sent a prompt in Needs review sort**, when it was paired and the address it came through. **Revoke** asks first, then disconnects it at once. A device that connects for the first time that day shows a toast with **Revoke**. With nobody connected, a quiet line says Remote is on; turn it off with **Show in the sidebar when nobody is connected** in Settings › Remote. In the collapsed sidebar, a phone icon shows how many devices are connected.
- **Count sessions on other computers in your focus limit.** Sessions that are working, need you or are unread on a computer you paired now count toward the focus limit, and show in the counter's list with the computer's name. Turn it off with **Count sessions on other computers** in Settings → Focus. A computer that is offline doesn't count.
- **Images and files in the remote app.** New session in the remote app takes images and files, and a session takes files next to images: tap the paperclip button, or paste or drop them on the message box. A message takes up to four images and four files, about 2.7 MB in all. Sending files, and images with a new session, needs this version of Switchboard on your computer. Queue for later doesn't take attachments.
- **Pick the branch on another computer.** New session with **Run on** set to another computer now shows the branch checked out there when you work in the current checkout. Click it to pick another local branch, and it is checked out on that computer before the session starts, as on your own. The remote app's New session has the same branch chip next to **This folder**. It needs this version of Switchboard on the other computer.
- **Pick the profile, model, effort and mode for another computer.** New session with **Run on** set to another computer now has the same chips as the remote app: with more than one Claude profile there, pick the profile the session runs with, and the other chips follow its defaults. The model list offers **Auto** when it is on there, and the effort chip only shows for a model that takes an effort. In an open session on another computer, the model, effort and mode chips under the message box now change them there, and the session's profile shows next to the computer's name.

### Fixed

- **Background tasks on another computer and in the remote app.** When Claude's turn ended but a background command or agent still ran, the remote app showed the session as **Finished** with its catch-up, and a session on another computer showed **Working…** with a **Stop** that couldn't stop it. Both now say what still runs, in green, such as **1 background command running**, and the catch-up waits until it's done. A green pill above the message box lists each task with a **Stop** for it, as on your own sessions. Home in the remote app no longer lists such a session under **Finished, ready to review**. This needs this version of Switchboard on the computer the session runs on.
- **Picking a project and a choice on a phone.** In the remote app's New session, **All projects** opens every project as a list, with the filter there, and a project's tile no longer snaps against the edge of the screen. The model, effort, mode and worktree chips open their choices from the bottom of the screen instead of a list that ran off its side.
- **Your first message in a new session from the remote app.** A session you started from your phone sometimes opened without the message you sent, until you closed it and opened it again. It now shows it at once.
- **The remote app's conversation keeps its place.** When a run of steps folded away after Claude moved on, the conversation could show blank space with the earlier messages out of view. Opening and closing a step no longer leaves a **New messages** button that goes nowhere.
- **Long links in the remote app's catch-up.** A long link in what you asked, or in what Claude did, ran off the side of the card. It now wraps.
- **Remote with Tailscale on macOS.** With Switchboard started from the Dock, turning Remote on with Tailscale failed with "The Tailscale GUI failed to start" (Tailscale.CLIError error 3), even though Tailscale was running. Switchboard now runs the Tailscale app as its command-line tool.
- **Background tasks in a remote conversation.** In the remote app and in a session on another computer, a background command or agent finishing showed as a message from you, full of markup such as `<task-notification>`. It now shows as a short line, such as *Background command "Wait for PR checks to finish" failed with exit code 1*. Slash commands show as **/review --fast**, command output and **Interrupted by you** as a line, and the reminders Claude Code adds to your messages are gone. This needs this version of Switchboard on the computer the session runs on.

## [0.0.20] - 2026-10-15

### New

- **Other computers in the same app.** Sessions on your other computers show in the same sidebar and view, marked with the computer's name. New session can start on another computer. A remote session sits in the same groups as yours, with a violet chip that names its computer and a badge on its project icon. It opens in the normal session view, with a violet line along the top and **on mystic** in the header. What only works on that computer, such as the terminal and Changes, stays in its place, disabled, and says why. Under **Where do we start?**, **Run on** picks This Mac or a paired computer: its projects become the tiles, and **Start on mystic** starts the session there. The **Computers** strip at the bottom of the sidebar, and **Show sessions from** in the project menu, show one computer's sessions or hide them. The command palette has **New session on mystic…** and **Show only mystic** for each connected computer. Search and ⌘⇧U (Ctrl+Shift+U on Windows) include remote sessions. When a computer goes offline, its sessions stay, dimmed, with when it was last seen.
- **Images and files for another computer.** A session on another computer, and New session with **Run on** set to it, take images and files: click the paperclip button, or paste or drop them on the message box. A message takes up to four images and four files, about 2.7 MB in all. Files are saved on that computer and the message mentions them by path, so Claude reads them there. Sending files needs this version of Switchboard on both computers.

### Fixed

- **Remote turns off while its tunnel is starting.** Turning Remote off in Settings › Remote stopped nothing until the tunnel gave its address, up to 30 seconds. It now stops the tunnel at once.

## [0.0.19] - 2026-10-15

### New

- **Settings › Remote shows its status first, with the fix for each problem.** Devices can be renamed, and **Reconnect a paired device** only shows when the address changed. A missing tunnel tool offers its download or Cloudflare instead, a port in use offers the next free one, and with Remote off and nothing paired the page walks you through three steps. **Pair a phone** is now **Pair a device**.
- **Other computers.** Follow and steer the sessions of Switchboard on another computer from this one. On that computer, turn Remote on, click **Pair a device** and **Copy link**, then paste the link under **Other computers** in Settings › Remote here (or *Connect to another computer…* in the command palette) and click **Allow** there. It shows under **Other computers** at the bottom of the sidebar, with how many of its sessions need you: open one to read it as it happens, answer Claude, send a message and stop a turn. Claude keeps running on that computer.
- **Prompt outline.** A prompt outline beside the conversation: a mark for each of your prompts. Click one, or use **Previous prompt** and **Next prompt**, to jump back. Hover a mark to see the start of the prompt and when you sent it. The keys are ⌘⇧↑ and ⌘⇧↓ (Ctrl+Shift+↑ and Ctrl+Shift+↓ on Windows), and both are in the command palette. The outline shows from 3 prompts in a pane wide enough for it; turn it off with **Show prompt outline** in Settings › Conversation.
- **Remote: change the effort of a running session.** Under the message box of a session that runs in Switchboard, a chip now shows its effort next to the model and mode. Tap it to pick **Low** to **Max**, or **Default** for the model's own. It shows only for a model that takes an effort. The effort chip now shows only the level with a gauge (**Medium**), and the chips wrap to a second line on a narrow phone instead of running off the screen.
- **Remote: Auto model.** With Auto model on in Settings › Conversation, New session on your phone offers **Auto** first in the model list: Haiku reads your prompt and picks the model. A session Auto started shows what it picked on its model chip, such as **Auto · Sonnet**, until you pick another model.
- **Remote: Ask about this session.** The blue question mark in a session's header asks Claude about the session from your phone, as on your computer: what changed, which files it touched, why it took this approach. Claude answers while it keeps working, and nothing is added to the conversation. Follow-ups, **New thread**, earlier threads, **Copy** and **Quote in message** work as in Switchboard, and the threads are the same on both. On a phone it opens as a sheet; in a wide window it sits on the right, in the place of Changes.
- **Remote: Home with your plan usage.** The remote app now opens on **Home**: how many sessions need you, and a card for each Claude profile with how much of its 5-hour window and week is used and when each resets, as on your computer's Home. Tap the house button next to **Sessions** to come back to it. In a wide window, Home shows the usage under what needs you, and **Go to Home** is in the search.
- **Remote: pick the Claude profile.** With more than one profile, New session on your phone shows the profile a session runs with (the project's own, else your default) as the first chip. Pick another for this session only, and the other chips show its defaults. In the list, each session's left edge has its profile's colour, as in Switchboard's sidebar, and a session's header shows its profile.
- **Remote: see that Claude is working.** While a session works, the end of its conversation shows three dots, how long the turn has taken and what Claude is doing (**Thinking**, **Using Bash**), as on your computer. A working session's dot pulses in the list and the header.
- **Remote: answers formatted as they arrive.** Headings, lists, code and tables show formatted while Claude is still writing, as on your computer, instead of as plain text until the answer is done.
- **When a usage limit stops a session.** A notice above the message box says which limit you reached, when it resets and how long that is (*5-hour limit reached. Resets at 15:16 · in 4h 42m*). **Resume now** tells Claude to continue right away. **Resume when it resets** does it by itself, 30 seconds after the reset, also when you quit Switchboard in between, and a notification says when it did. Messages in Up next wait for the limit instead of being sent into it, the queue holds new sessions for that Claude profile until the reset, and the session's row in the sidebar says *Usage limit*. To always resume by itself, set **Resume after a usage limit resets** to **Always** in Settings › Conversation.

### Changed

- **Pull requests go to the branch your project develops on.** A project whose worktrees start from a branch (Project settings › Worktree base) now opens pull requests into that branch, not the repository's default branch. You can still pick another in the pull request dialog.

- **Catch-up says what Claude said.** When Haiku doesn't write the catch-up (it is off, or it didn't answer in time), **What it did** starts with Claude's own account from the end of its reply, its opening sentence and the bold headings of a report, before the commands it ran. It used to list only the last few commands.
- **Ask in the session's header.** The header's panel buttons now have **Ask** next to **Changes**, **Agents** and **Terminal**. It opens Ask on the right, brings it to the front when another panel is in front, or closes it. A blue dot on it says an answer is ready.
- **Remote: Mark as read and Archive from the list.** Right-click a session in the list for **Mark as read** and **Archive**, without opening it. The quick replies above the message box (**Continue**, **Run the tests**, **Open a PR**, **Mark as read**) are gone: the session's **⋯** menu still has **Mark as read** and **Archive**.
- **The terminal stays on the right next to Changes, Ask and Agents.** With the terminal docked right, opening Changes, Ask or Agents no longer moves it below the conversation. It becomes a **Terminal** tab next to theirs, and its shells keep running while another tab is in front. Click the tab, the **Terminal** button in the header or press ⌘J (Ctrl+J on Windows) to bring it to the front.
- **Message box: the model, effort and mode stay readable.** In a narrow window, the profile shrinks to its dot first, then the model drops its version, and the effort and mode labels go last.

### Fixed

- **Remote: pair the app on your Home Screen.** On an iPhone, Switchboard Remote on the Home Screen didn't share Safari's pairing and had no address bar, so it could not pair. It now has a field to paste a link from your computer, with **Paste** and **Open link**. When you scan the QR code in Safari, **Copy link** copies the pairing link for the Home Screen app.
- **Remote: the row under the pointer lights up in lists.** In the model, effort, mode and worktree lists and the **⋯** menu, the row you point at is now highlighted (it barely showed in dark mode), and the chosen one has a check.

## [0.0.18] - 2026-10-15

### New

- **Agents panel, next to the conversation.** The agents Claude started in a session now show in a panel on the right, a tab beside Changes and Ask, instead of a popup. Leave it open while you keep talking to Claude. **Active** and **Finished** are two lists you can fold. Pick an agent to see what it is doing, what Claude asked it and, once done, what it reported. A background agent has a **Stop** button. With more than one panel open, the header buttons show which one is in front: a bar under its icon, the others paler. Open it with ⌘⇧K (Ctrl+Shift+K on Windows), the **Agents** button in the header (it shows how many run), **Toggle agents** in the command palette, or **Agents** under ⋯. In the background tasks above the message box, an agent's name now opens it in the panel, and an agent's call in the conversation has **Open in Agents panel**.
- **Ask about this session.** An **Ask** button next to Send opens a panel on the right where you ask Claude about the session: what changed so far, which files it touched, why it took this approach. Claude answers from the conversation and the project while it keeps working, and can read files, search and look at git, but never changes anything. Nothing reaches the conversation: no message, no Up next, no unread state or notification. With text in the message box, **Ask** asks that text. Follow-ups go with the earlier questions of their thread, **New thread** starts another, and **Earlier threads** opens the last 20. **Quote in message** puts an answer in the message box as a quote. Close the panel while Claude answers and a blue dot on **Ask** says when the answer is ready. With Changes open too, the two share the right side as tabs. This replaces the side question panel above the message box; `/btw` and a question now asks in this panel, and its tokens show in Usage as **Side questions**.
- **Catch-up: a short briefing when a session finishes.** A banner over the conversation: what you asked, the one thing it needs from you next (commit, reply or review), and the signals you'd otherwise look up yourself: whether the tests passed, how much changed, files changed outside the plan, and whether Claude followed its plan. **Details** shows what Claude did and skipped. Every action has a key: ↩ for the main one, D to review changes, C to commit, R to reply, U to mark as read, E to archive and go to the next session, Space for Details, Esc to fold it. Once you've read a session, the briefing folds into one line. Haiku writes the lines from your prompt, Claude's last reply and the list of tool calls, never your files or memory; its tokens show in Usage as **Catch-up summaries**. Turn it off with **Write catch-up summaries with Haiku** in Settings › Conversation. For a session that ran in a terminal, run **Catch up on this session** from the command palette.
- **Why is Claude asking?** A permission or question card has a **Why?** button. It opens a panel beside the conversation with why Claude needs it, what saying yes does (for a command, whether it only reads or changes something), Claude's own last words, your ask and what it did so far. You still answer in the card.
- **Sort the sidebar by Quickest to unblock.** Next to **Recent** at the top of the sidebar: sessions that wait for you, then finished ones you haven't read, each by how long they take to review, then the ones you've read, then the ones still working. Rows say how long a review takes ("~2 min to review"), and a warning shows when Claude changed files outside the plan. ⌘⇧U (Ctrl+Shift+U on Windows) now goes through what needs you in this order: sessions waiting for you first, then finished ones you haven't read, the quickest first.
- **Add a project from New session in one step.** **Add project…** next to the Project heading opens the same Add project dialog as on first start, with the folders you have used Claude Code in, and the project you add is picked right away. You can also type a path that starts with `~/` or `/` (a drive such as `C:\` on Windows): the field lists the folders in it, Tab completes a name, and ↩ (Enter on Windows) adds the folder and picks it. When a name matches none of your projects, the list offers the folders Claude Code already has sessions for, and you can drop a folder from Finder (File Explorer on Windows) onto the projects to add it. A folder that already is a project is picked instead. **Filter** next to it opens the full list, as does the fifth tile (**+N more**), which is gone when you have four projects or fewer.
- **Remote: your sessions on your phone.** Follow your sessions from your phone's browser, wherever you are: see which ones need you, read the conversation as it happens, allow or deny what Claude asks, answer its questions and plans, send a prompt or add it to Up next, stop a turn, and start a session in one of your projects. Turn it on in Settings › Remote, choose a tunnel (a Cloudflare quick tunnel, Tailscale, ngrok or your own address), click **Pair a phone** and scan the QR code. Your computer asks you to allow the phone, with a code to compare. Only phones you pair can connect, and everything is encrypted from your phone to your computer, so the tunnel can't read it. **Revoke** disconnects a phone at once. It works in the browser of another computer too: click **Copy link** under the QR code. On a wide screen your sessions stay on the left, as in Switchboard, and New session offers the projects you added, with the one you last used already picked.
- **Remote: answer from the list.** What Claude asks shows first in your phone's list, as cards. Allow or deny a command, an edit or a fetch right there, and the card folds away; a question or a plan opens its session. **Needs you** and **Working** chips narrow the list, and the magnifier searches titles, projects and branches. The header shows your computer's name with a green dot while you're connected.
- **Remote: what Claude asks stays in view.** In a session, the prompt sits above the message box instead of at the end of the conversation. Fold it to read first, and step through several with the arrows. Type in the message box to say no and tell Claude what to do instead.
- **Remote: readable answers.** Headings, lists, links, code and tables show as they do on your computer, with **Copy** on code blocks. A run of tool calls is one line, such as "6 steps · edited 3 files, ran 2 commands".
- **Remote: catch-up, Changes and Commit on your phone.** A finished session starts with its catch-up, the conversation folded under it. **Changes** shows the files and their diffs, **Ask Claude to fix…** starts a message about one, and **Commit** commits them (it never pushes). Quick replies above the message box send **Continue**, **Run the tests** or **Open a PR**. The **⋯** menu has **Mark as read** and **Archive**.
- **Remote: choose the model, effort, mode and worktree.** New session on your phone shows the project's defaults as chips to change for this session only, and **Queue for later** while the project is busy. In a running session, change its model and mode from the chips under the message box.
- **Remote: notifications.** Your phone can tell you when a session needs you or finishes, also when the page is closed. Turn them on from the card after pairing, or from **Notifications** in the **⋯** menu. On an iPhone, add Switchboard Remote to your Home Screen first.
- **Remote on a computer's browser: what needs you, first.** In a wide window, Switchboard Remote opens on what needs you: every prompt as a card you answer right there (**Always allow** too), and the finished sessions you haven't read, each with its review time, the tests, **Changes** and **Open**. Prompts are rows in the list's **Needs you**, with what they ask.
- **Remote: keys.** J and K move through the cards or the sessions, A allows and D denies, ↩ (Enter on Windows) opens, N starts a new session, U or ⌘⇧U (Ctrl+Shift+U on Windows) opens the next session that needs you, and ? shows them all. A only allows a prompt you can see.
- **Remote: search and jump.** ⌘K (Ctrl+K on Windows) finds a session by its title, project or branch, starts a new session in a project, and runs **Next that needs you**, **Mark all as read**, **Turn on notifications** and **Forget this computer**.
- **Remote: Changes next to the conversation.** In a window at least 1280 pixels wide, **Changes** opens on the right, with the diff, a commit message and **Commit**. The header shows the model and mode, the number of changed files and **Stop**.
- **Remote: images.** Send photos from your phone's camera, or paste and drop screenshots on a computer. They show as thumbnails above the message box.
- **Remote: answer from a notification.** In Chrome, Edge and Firefox on a computer, a notification about a command or an edit has **Deny** and **Allow**. The browser tab counts what needs you and its icon gets a pink dot.
- **Remote: why your phone can't connect.** Instead of one line of text, your phone says what it thinks happened (the tunnel's address changed, the computer is asleep), keeps showing the last list, and **Help** says what to do.

### Fixed

- **The list above the message box stays open.** When you open the background tasks or Claude's task list above the message box, it is still open when you come back to the session after going to another one or hiding it.
- **Random characters at the prompt of a terminal.** Switching to a terminal tab or session could type text like `11;rgb:1111/1111/1b1b` and `1R8;81R` into the shell. They were answers to questions programs asked a while ago, which the terminal sent again when it showed its history. They are no longer sent.
- **Notifications that don't come through on a newer Mac.** Newer versions of macOS no longer let Switchboard see that notifications are off, so Settings › Notifications never said so. Next to **Send a test notification** it now asks "Nothing showed up?" and has **Open System Settings** to check.
- **Questions from Claude are easier to read and answer.** When Claude asks several questions at once, the one you are answering has an accent line and "1 of 2" before it, and the questions you have answered fade back, so the next one stands out. Picking an answer to a single-choice question, with a click or a number key, moves on to the next open question and scrolls it into view. A multi-select stays until you press Enter or **Next question**, and so does the answer field. Changing an earlier answer doesn't jump ahead.

## [0.0.17] - 2026-10-14

### New

- **A click on a file link shows the file in File Explorer (Finder on a Mac).** The file is selected in its folder. ⇧-click (Shift+click on Windows) opens it in your editor at its line instead, and a right-click on the link lists **Show in File Explorer**, **Open in** your editor and **Copy path**, above the message's **Quote** and **Remember this…**. The **Show** or **Open** chip beside a tool run that touched a file does the same. If a file is gone, the link now says so. To make a click open the editor, change **Clicking a file link** in Settings › Conversation.
- **Copy a reply as rich text.** Claude's replies have a second copy button, **Copy as rich text**, next to **Copy as Markdown**. Paste into an email, a document, Slack or Notion and the headings, lists, bold, links, code and tables come along. A plain text field gets the Markdown.
- **A terminal anywhere.** Press ⌘J (Ctrl+J on Windows) on Home, a project's page, Projects, Usage, New session or Settings to open a terminal there too, without opening a session first. On a project's page it starts in the project's folder, in New session in the folder the session would start in, and elsewhere in your home folder. These views share one terminal, so its tabs stay with you as you move between them; a session still has its own.
- **Split view is now a tiling layout.** Open as many sessions as fit, side by side, one above the other, or mixed. ⌥-click a session to split the active pane (a wide pane gets the new session on its right, a tall one below it), and Switchboard says so when the window has no room for another. Drag a pane by its title, or a session from the sidebar, into the panes: a pane's edge docks beside it, its middle swaps (or replaces a session that isn't open yet), and a band along each edge of the window docks across its whole length, so you can turn one pane next to two stacked ones into three equal columns. A session that is already open just moves its tile. Esc cancels, and a red frame says when the result wouldn't fit. Drag the dividers between panes to resize them (or use the arrow keys, and double-click for equal sizes). New keys and commands: go to the pane on a side (⌘⌥ and an arrow, Ctrl+Alt on Windows), close this pane (⌘⌥W), close the other panes (⌘ and the backslash key), turn the split the active pane is in (⌘⇧O) and swap with the next pane (⌘⇧X). In a window too small for every pane only the active one shows, and the rest come back as the window grows. Nothing reloads while you rearrange, so your unsent messages and scroll positions stay.

### Fixed

- **File Explorer and Windows Terminal open on Windows.** "Open in File Explorer" and "Open in Windows Terminal" in the ⋯ menu started a window you could not see. They now open where you can.
- **Up next fits above the message box.** It shows five whole messages, and scrolls a whole message at a time when there are more, with the edge faded, instead of cutting the last one in half under the box. A long message is cut short with its full text in the tooltip, so every message keeps its **Send now**, edit and remove buttons in view.
- **Menus under the message box stay open.** The profile, model, effort and permission menus no longer close on their own when a new message arrives in the session.
- **Edit in Up next keeps your files.** A queued message you edit comes back with its files as chips again, not as `@` mentions in the text.
- **Starting a session when Claude Code can't run.** Start now says why, for example that you are not logged in, instead of "This session is not running". A Claude Code process that already failed is no longer handed to the next new session.
- **A new session that fails at once** keeps its message box, instead of saying "The folder for this session is unknown". Send again to start it in the same folder. Its first message is back in the message box, and if you quit Switchboard first, it waits in New session for that folder, listed with your unsent messages.
- **Many sessions at once.** Adding a Claude profile with a long history, or syncing many sessions, no longer freezes the window or shows an error.
- **When Switchboard's engine stops answering**, the window now says so and waits for it, instead of showing old information without a word.
- **Terminals after an engine restart.** The terminal panel now says its terminals were closed, instead of going empty.
- **Changed files stay up to date.** The count in the session header and the Changes panel now update by themselves every few seconds, and when you open the panel, also for changes made in the terminal.
- **Your home folder shows as ~ everywhere**, also when it isn't in the usual place (some Linux setups, or a Windows profile on another drive): in folder names and paths, and in the name of a terminal tab that opens there.
- The command palette only offers **Toggle changes** in a git checkout. Elsewhere it did nothing.
- **A file is no longer taken as a project folder.** New session and links that point at a file say "That is a file, not a folder."
- The branch menu shows branches that are checked out in another worktree as unavailable, with the reason, instead of failing when you pick one. New session and the command palette's New session do the same, and Start says why instead of showing git's "already checked out" error.
- Branch lists load again with git older than 2.23. The branch menu, New session's branch picker and a project's defaults showed no branches.
- Changes, branches and worktree status in a folder that was moved away say "Folder not found" instead of "spawn git ENOENT".
- The Memory tab no longer shows an error when a project's folder was replaced by a file.
- A broken startup message from Claude Code no longer breaks the Worktrees tab until you restart.
- The shortcuts for the command palette, Search and the shortcuts list no longer open behind another dialog, where what you typed went into a palette you couldn't see.
- A menu closes when a dialog opens over it, so Esc closes only the dialog.
- Closing a dialog you opened from the command palette, or closing Settings, puts focus back where it was, such as the message box.
- Search takes up to 500 characters and says when a search fails, instead of showing the results of the previous search.
- In a small or zoomed-in window, the sidebar narrows, or shows as the rail, so the session view stays in full view.
- A double click on a file's checkbox or **Stage all** in Changes stages once, instead of failing with a git lock error. Clicking **Start** on a queued item more than once starts it once.
- Clicking **Restart** on a terminal tab more than once restarts its command once, instead of starting it twice.
- Opening and closing the terminal many times no longer runs out of graphics contexts, which could switch an open terminal to slower drawing.
- **Undo file changes** no longer shows "Checking what changed…" as an error while it loads.
- **Import settings** no longer keeps saying "Reading…" after it fails to read a file, and shows the error once.

## [0.0.16] - 2026-10-13

### New

- **Side questions with /btw.** Type `/btw` and a question to ask Claude about the session without adding anything to the conversation. It works while Claude is busy: the question never waits in Up next, and Claude isn't stopped. The answer shows in a panel above the message box, with ‹ › to go through your earlier side questions, **Copy**, and **Show all** for a long answer. Esc hides the panel while the answer keeps coming, and a chip brings it back. `/btw` without a question opens the latest one. Switchboard keeps the last 50 per session, also after you quit. The command palette has *Ask a side question…* and *Show side questions*.
- **Settings › Notifications and sounds.** Notifications and sounds each have their own card and switch, so you can have one without the other. **Send a test notification** checks that notifications come through, and the page tells you when they are turned off for Switchboard in System Settings, with a button to open it. With **Sounds** on, each moment has its own sound, a different one from the start so you can tell them apart: **Needs you** (Ping), **Finished** (Glass), **Stopped with an error** (Basso) and **Project action ended** (Pop). Pick one from your system sounds, or **None**, hear it by moving over it in the list or with ▶, and set the **Volume** for all of them. Turning sounds off keeps the sounds you picked. You get neither for the session you are looking at. The command palette has *Notifications: turn off* and *Sounds: turn on*.
- **Up next.** Messages you send while Claude works now wait in **Up next**, above the message box, until Claude finishes the turn: one goes each time. Edit one (it goes back in the message box), remove it (with Undo), drag it or press ⌥↑ ⌥↓ to reorder, or press **Send now** on it to stop Claude and send just that one. If you stop Claude or a turn fails, the messages wait and Up next shows **Send next**. Up next is kept when you stop the session or quit Switchboard.
- **Steer.** Settings › Conversation has **While Claude is working**: choose what Enter does, **Queue** (wait in Up next) or **Steer** (Claude reads the message at its next step, without stopping). ⌥↵ does the other one, and ⌘⇧↵ still stops Claude and sends now.
- **Create pull requests in Switchboard.** **Create PR** now opens a dialog: a title, a description that starts from your repository's pull request template or the list of commits, the base branch and **Draft**. Switchboard pushes the branch and creates the pull request with the GitHub CLI, without opening the browser. Long branches no longer fail with "URL too long", and when something goes wrong the dialog says what to do next: install gh, sign in, pull first, or open the pull request that is already there.
- **View PR.** Once a branch has an open pull request, the git button shows **View PR #123**, with whether it is open or a draft, and opens it on GitHub. A draft can be marked ready for review from the git menu.
- **Switch branches from the Branches tab.** A branch's menu in a project's Branches tab has **Switch to this branch**, which switches the project's folder to it (a branch only on the remote gets a local copy that tracks it). On the branch you're on, it offers **Switch to main** (your base branch) instead, so you can delete that branch right after, without a terminal.
- **Copy link.** Right-click a link in a message and choose **Copy link** to copy its address.
- **Add files from anywhere.** The Add context dialog (the paperclip under the message box) has **Choose in Finder…** (**Choose in File Explorer…** on Windows), so you can add files that are not in the project. On macOS you can pick folders too.
- **Search in Settings.** Type in **Search settings** at the top of the section list (or press ⌘F in Settings) to find a setting in any section. Results show grouped by section with your words marked; choose one to open its section at that setting.
- **Defaults per Claude profile.** In Settings › Claude profiles, open **New session defaults** on a profile to set the model, effort, permission mode and workspace its new sessions start with. A project's own defaults still come first; fields it leaves unset now use its profile's defaults before the choices you made last in New session. The project's Settings tab shows what an unset field falls back to, such as *Profile default (Opus)*.
- **Permission mode for new sessions.** Settings › General has **Permission mode**: start every new session in the same mode, such as Auto mode, instead of the one you picked last. A project's own default still comes first.
- **Pasted text cards.** A long paste (more than 2,000 characters or 25 lines) goes in a **Pasted** card above the message instead of in the box. Click it to read or edit the text; Claude gets it with your message.
- **Star on GitHub.** Once you have a few sessions, the sidebar shows **Star on GitHub**. With the GitHub CLI signed in, one click stars Switchboard without opening the browser; otherwise it opens the repository. It doesn't show again after a click, and **×** hides it for good.

### Fixed

- **Scroll up while Claude writes.** Scrolling up during a reply now keeps your place, instead of every new word pulling the view back to the end. **New output below** takes you back down and follows the reply again, as does scrolling to the very end.
- **Run** on a command in the conversation runs it the first time too. When the session had no terminal yet, the command was typed into the new shell before your shell config (prompt theme, plugins) had loaded, and was dropped. Switchboard now waits until the shell is ready, a few seconds at most. **Run gh auth login** in the pull request dialog waits the same way.
- **Claude Code not installed.** When Switchboard can't find Claude Code, it now says so when it opens: **Install Claude Code** shows the commands to install it for your system, how to sign in, and **Check Again** to pick it up without restarting. Starting a session without it says *Claude Code isn't installed, or Switchboard can't find it* instead of "Native CLI binary for darwin-arm64 not found". Settings → About has **Install Claude Code…** while it's missing.
- **Queue keeps added files.** A file, folder or pasted text you added to a new session stays a chip when you add the session to the queue and open it again, instead of turning into an `@` mention in the text.
- **Export includes Claude profiles.** Export settings has a **Claude profiles** option: your profiles with their folders, colours and defaults for new sessions, the default profile and which projects use which. Import adds them back (signing in again is still needed; logins are never in the file).
- **Usage**: the profile menu shows the whole profile name; a long email is cut short instead.
- **Usage**: in % used over time, the labels at the end of the lines no longer overlap when two windows are close, such as Weekly and Session.
- Sending a very long message no longer fails with "Invalid params for session.create". A message can now hold up to 1,000,000 characters, and the message box says so when it is longer. A paste that is longer than that is not put in the box; drop the file instead.
- The first message you send in a session you just opened no longer leaves the "Working…" line hidden under the message box.
- A message you steer into a session while Claude works no longer vanishes when you switch to another session and back before Claude has picked it up.
- **Queue** used to hand the message to Claude at once, so it was read at the next step instead of after the turn. It now waits for the turn to end, as the button says.
- **Auto model**: a new session started on Auto shows your message while Auto is choosing a model, not only once it has picked.
- **Auto model**: when you change the model of a session Auto picked for, its model chip shows the new model at once instead of staying on "Auto · Sonnet".
- **Worktrees** and **Branches**: a long label such as "PR #2004 merged" is cut short to fit its column instead of running into the size next to it.

## [0.0.15] - 2026-10-12

### New

- **Settings › Sessions.** Choose after how many days finished sessions move to Archived (3 by default, it was a fixed 48 hours). The VS Code companion follows the same setting.
- **Delete archived sessions**, off until you turn it on: sessions that have been in Archived for longer than the days you set go to the Trash (the Recycle Bin on Windows), checked at launch and once a day. Pinned and working sessions, and ones open in another window, with a queued prompt or an unsent message, are always kept. Turning it on says how many go today, with **Review** to see exactly those first. Each run is in the Diagnostics log.
- **All sessions in one table**, on the same page: every session (also from other apps), grouped by month, with filters for text, time, project, app and status, its size and where it came from. Select a month or single sessions to unarchive them or move them to the Trash in one go; the confirmation says how much space it frees and which sessions are kept and why.
- **Claude Code's own cleanup** per Claude profile: Settings › Sessions says after how many days Claude Code deletes old transcripts by itself (`cleanupPeriodDays`), and **Change…** sets it in each profile's settings.json, leaving the rest of the file as it was.
- **Back and forward with your mouse.** The back and forward buttons on your mouse return to where you were before, as in a browser: sessions, Home, New session, Settings pages, Projects and project pages.
- A project opened from Settings (the projects in Settings › Memory) has **Settings › Memory** in its breadcrumb, which takes you back there instead of to Projects.
- The Archived header in the sidebar has a menu with **Manage sessions…** and **Archive settings…**, the session count at the bottom of the sidebar opens the overview, and the command palette has *Manage sessions* and *Delete archived sessions…*.
- **Quote in reply.** Select text in a message and click **Quote** (or right-click it) to put it in the message box as a Markdown quote, with the cursor under it for your answer. Handy when Claude asks a few questions at once. *Quote in reply* in the command palette does the same. The toolbar over a selection also has **Copy**, and you can reach it with Tab.
- **Lists and code in the message box.** In a list, ⇧↵ starts the next item: `- ` again, or the next number after `1. `. On an empty item it ends the list. Type ` with text selected to wrap it as code: one line as inline code, several lines in a code block. Both work in New session and the command palette's prompt too.
- **Auto model.** Pick **Auto** in the model menu and Haiku reads your prompt when the session starts, then picks Haiku, Sonnet or Opus for it. The session opens at once and says Auto is choosing a model, so you can start the next one; your prompt goes once it has picked. Haiku sees only your prompt's text, never your files or memory. The pick is made once: the chip reads "Auto · Sonnet", a line above Claude's first answer says why, and **Run again with Opus** or **Use Opus from the next message** undo it. Later, Auto can suggest a stronger model when a session grows, and says what switching costs; it never switches by itself. Queued prompts on Auto are routed when they start. Each pick uses a few hundred to a few thousand Haiku tokens, shown in Usage as **Auto routing**. Turn it off or choose which models it can pick in Settings › Conversation.
- **Usage view.** Click a usage bar (under the message box, in New session or on Home), or run *Open usage* from the command palette, to see where your plan went. **Limits** shows what is left of each window, when it comes back, your % used over time, and which sessions used the current 5-hour window. **Tokens** shows where the tokens went per session, project, model and day, with the cache hit rate and fast mode turns. Pick the current window, 24 hours, 7 days or 30 days. Every share is an estimate, and no prices are shown.

### Fixed

- **Unarchive** now brings back a session that was archived because it was quiet for a while. It stays in the main list until it has new activity.
- Menus and dropdowns now open over toasts, so a toast no longer covers their bottom items.
- ↑ in the message box first takes the caret to the start of your text, and only the next ↑ brings back an earlier message. ↓ goes to the end first in the same way. Before, ↑ anywhere on the first line jumped straight to the earlier message.

## [0.0.14] - 2026-10-11

### New

- **A website with the full docs** at [switchboard.struyfconsulting.com](https://switchboard.struyfconsulting.com/): every feature, every setting and every keyboard shortcut, with screenshots in light and dark.
- **Search memory.** ⇧⌘F finds memories too, in their own group above conversations, by type and project; *Search memory…* in the command palette searches memory only. A memory Claude saves during a session shows in the conversation as one **Saved memory** line, and a session's menu lists the memories it wrote.
- **Links between memories.** `[[name]]` links open the memory they name; the editor lists what links to a memory and the links not written yet (with **Write it…**), suggests names as you type `[[`, and Rename… can update the links to it.
- **Remember this.** Select text in the conversation (or right-click a message) to save it as a memory in this project, another one or Personal, straight to the file, without using Claude.
- **Memory health.** The Memory tab lists what to look at: references to files and scripts that are gone, duplicates, MEMORY.md lines out of step with the folder, an index past what loads, and old memories, each with a fix you start (Open, Compare, Fix index, Tidy with Claude…).
- **Edit Claude Code's memory.** A project's Memory tab opens each memory in an editor: description, type and text, ⌘S to save, links between memories you can follow, and the session it was written in. Add a memory with **New**; rename, move, copy to another profile or delete one (to the Trash, with Undo) from its menu. Instruction files (CLAUDE.md, rules, CLAUDE.md in subfolders, subagent memory) can be edited too, and say when a change is waiting in git.
- **What loads in a session here.** Every file Claude Code reads at the start of a session in a project, in order and by size, with the part of MEMORY.md past the 200 lines that load marked in red. A MEMORY.md meter shows how full the index is, on the Memory tab and the project's Overview.
- **Personal memory.** A folder of memory about you that loads in every project and every Claude profile, through one line Switchboard adds to each profile's CLAUDE.md (shown first, and removable). Keep it in iCloud Drive, Dropbox or a git folder to sync it; Switchboard shows sync conflicts and lets you keep one. **Settings › Memory** has the folder, its meter and every project's memory.
- **Memory from and to the Claude app.** **Import from Claude export…** brings the Claude app's memory into Claude Code from its data export, with a preview of every memory and where it goes; your conversations are never read. **Paste from Claude app…** does the same with text you paste, and **Copy for Claude app…** copies memories to paste in the app. All three are in the Memory tab's **Import** menu and in Settings › Memory.
- **Memory and Share with the team.** A project's new Memory tab lists what Claude Code remembers about it, next to its CLAUDE.md, rules and CLAUDE.local.md. **Share with the team…** turns a private memory into project instructions: pick CLAUDE.md, a rule file (a new one can apply to some paths only) or CLAUDE.local.md, edit the heading, and check the preview before anything is written. It warns about text that looks like a secret, a section with the same heading, uncommitted changes, and a CLAUDE.local.md that git would commit. Nothing is ever committed: the change waits in Changes, and the toast has Show in Changes and Undo. **Copy to my memory…** does the reverse for a section of the instructions. Also in the command palette (*Share memory with the team…*, *Memory…*).
- **Answer prompts from VS Code.** With the VS Code companion, a permission prompt, question or plan from a session in the open workspace shows as a VS Code notification you can answer there. Your answer works as if you gave it in Switchboard, and the card goes away.
- **Branch overview and clean-up.** A project's new Branches tab lists every branch here and on the remote, with whether it's pushed, merged (or its pull request, with the GitHub CLI), deleted on the remote, and its last commit. It groups them into *In use*, *Safe to delete*, *Deleted on the remote*, *Inactive* and *Active*, and deletes the ones you tick after one confirmation: the local branches, their copies on the remote, or both, with a recovery ref if you like. The base branch, checked-out branches and branches with an open pull request are never deleted. Open it from the project page, **Branches…** in a project's menu, or the command palette (*Branches…*).
- Save an image from the conversation: use the save button on the image, right-click it and choose Save image…, or press ⌘S while it is open full size.
- **A page for each project.** Click a project in Projects, choose **Open project** in its menu in the sidebar, or run *Project: &lt;name&gt;* in the command palette. Its tabs hold an Overview (sessions, worktrees, queue and git at a glance), its Sessions (archived ones in their own section at the end), its Worktrees, its Actions and its Settings. A project opens on the tab you left it on, and ⌘N there starts a session in it. Click its icon at the top to choose an image, an emoji or a letter, or to rename it; the Settings tab has Choose image… too.
- **Worktree overview and clean-up.** A project's Worktrees tab lists every worktree with its sessions, uncommitted changes, commits ahead of the base branch, whether it's pushed and merged (or its pull request, with the GitHub CLI), its size on disk and when it was last active. It groups them into *Safe to remove*, *Probably done*, *Keep* (with the reason) and *Stale*, and removes the ones you tick after one confirmation that shows the space freed and any ignored files that would be lost. Branches can go too, with a recovery ref if you like. Worktrees with uncommitted changes, a session working in them, or a lock are never removed, and removing always goes through `git worktree remove`. Open it from the project page, the new worktree pill in Projects, **Worktrees…** in a project's menu, or the command palette (*Worktrees…*, *Clean up worktrees in &lt;project&gt;…*).
- **Switchboard runs on Windows** 10 and 11. Download the installer (`Switchboard-<version>-setup.exe`, one for x64 and Arm64 PCs) from the release: it installs for you only, without admin rights, and Switchboard updates itself like on a Mac. Shortcuts use Ctrl, the terminal panel runs PowerShell, Open in knows VS Code, Cursor, File Explorer and Windows Terminal, the VS Code companion connects, and a session that needs you flashes the taskbar button. See [Windows support](docs/windows-support.md).
- Settings files move between a Mac and a Windows PC: their project folders show as missing until you point them at folders on the new computer.

### Changed

- **Pull requests go to the branch your project develops on.** A project whose worktrees start from a branch (Project settings › Worktree base) now opens pull requests into that branch, not the repository's default branch. You can still pick another in the pull request dialog.

- Archiving a session that is open closes it. With two sessions side by side, the other one takes the full width.
- **Projects list.** Each project shows its defaults on one line, a worktree pill, New session, ⋯ and the reorder buttons. Defaults, the profile choice and actions moved to the project's page; Remove is in the ⋯ menu.
- **Images in your messages.** They show above the text, so Show more never hides them: one image at its own shape, two to four as thumbnails, and five or more as tiles with a +N for the rest. Hover one for its type, size and pixel size. Full size, ← and → step through all of a message's images, with a filmstrip at the bottom.

### Fixed

- A compacted conversation shows in full. After `/compact` the conversation showed only what came after the last compaction, so you couldn't scroll back through it; now it shows everything, with a *Conversation compacted* line where each compaction happened.
- The pointer turns into a text cursor over text you can select in the conversation (messages, code blocks, diffs), instead of staying an arrow.
- Collapsible sections in the sidebar (your session groups, the Queue, Archived) always show their chevron, pointing right when closed and down when open, so you can tell their state without hovering.
- Archived stays at the bottom of the sidebar while it is closed, so a short list no longer shows a scrollbar. Opening it slides it up right under your other sessions, with no gap, and closing it slides it back down.
- Tooltips show while Claude is writing. The conversation scrolling along no longer hides the tooltip of a button you point at in the sidebar or a header.

## [0.0.13] - 2026-10-10

### New

- **Quick questions.** Ask Claude something without picking a project: choose **Quick question** under the project tiles in New session, press ⌘⇧N, or run *Quick question…* in the command palette. You still pick the model, effort, permission mode and profile; there are no git options, and it starts in a mode that asks before edits. Quick questions show as *Questions* in the sidebar with their own icon, and they never show up in your projects. A link can start one too: `switchboard://new-session?question=1&prompt=…`.
- **Context chips in the message box.** Files you drop on a session, pick from the `@` list, or choose with **Add context** (⌘⇧A, the paperclip, or *Add context…* in the command palette) show as chips above your message, each with a × to remove it. Pick several files at once in Add context with Space. Claude gets them as references and reads them itself; chips are kept with an unsent message.
- **VS Code companion.** A new extension, *Switchboard Companion* on the Visual Studio Marketplace and Open VSX, sends the lines you have selected, the open file, Explorer files and folders, open editors, problems, terminal output and changed files to a session as chips. It goes to the session you have open when its folder holds the files, or asks which one, from the sessions your sidebar shows outside Archived (or New session). Nothing is sent to Claude until you press send. Its status bar item says when a session in the workspace needs you. **Settings → VS Code** (or *VS Code extension* in the command palette) links to it and shows whether an editor is connected.
- **Markdown blocks open rendered.** When Claude writes markdown in a code block (a README, a PR description), it shows formatted, with a **Preview | Source** switch above it to see the markdown itself. Copy still copies the markdown.
- **Send now.** While Claude is working, a message you send waits until it finishes. To have it handled right away, press ⌘⇧↩ or choose **Send now** from the ▾ next to **Queue**: Claude stops what it is doing and picks up your message at once.
- **Run commands from the conversation.** Shell code blocks in Claude's replies have a Run button next to Copy when you hover them. It types the command into a terminal tab of the session and runs it, reusing the same tab for later runs. For a block that shows a terminal session (`$ ` lines with their output), only the `$` lines run.
- **Continue in VS Code.** Under **⋯** in the session header (and in the command palette): stops the session here and opens it in Claude Code's VS Code extension, in the window for its folder.

### Changed

- **Pull requests go to the branch your project develops on.** A project whose worktrees start from a branch (Project settings › Worktree base) now opens pull requests into that branch, not the repository's default branch. You can still pick another in the pull request dialog.

- **Shorter worktree names.** A new worktree gets a made-up name of three short words, such as `brave-humming-otter`, like Claude Code's own, instead of the first words of your prompt. You can still type your own name in New session.
- Dropping files and folders on the message box adds them as chips instead of `@` mentions in the text.
- The Copy and Fork buttons of Claude's replies show in a row under the reply when you hover it, instead of over its text.
- **A calmer New session message box.** **Add to queue** moved into Start's menu (the ▾ next to **Start**), with **Start session** and **Start in a new worktree**; ⌘↩ and ⌘⇧↩ work as before. The chips under the message show only their value ("Personal", "Opus 4.5", "Medium", "Auto") without borders, and the image button comes first. In a narrow window effort and mode show only their icon, then the model drops its version, instead of cutting words off. A session's message box has the same chips. With a strict focus limit, Start waits while you're at the limit, and Add to queue stays in its menu.
- **Updates show as a message in the window's corner.** A new Switchboard or Claude Code shows in the bottom right instead of taking the sidebar's footer, with **Download**, **Restart to update** or **Update**, and **What's new** for the release notes. You see it with the sidebar closed too, and the footer keeps showing your sessions.
- **Archived sits at the bottom of the sidebar**, out of the way, while your sessions don't fill it. Opening it scrolls its sessions into view.

### Fixed

- Search (⌘⇧F) with **Show sessions from other apps** turned off no longer misses your own sessions, or finds nothing, when other apps' sessions mention the same words more often.
- Typing in a long message no longer scrolls the conversation up a little with each key.
- The Catppuccin theme's text has more contrast, in light and dark mode, so messages and the message box are easier to read.
- Images in the message box are kept when you add the prompt to the queue, and go with it when the queued session starts. Opening a queued item in New session shows them too.

## [0.0.12] - 2026-10-09

### New

- **Unsent messages are kept and easy to find.** What you typed and didn't send stays in its session, and in New session per project with the choices you made, also after you quit (images only while the app runs). A pen next to a session in the sidebar marks an unsent message, and an idle session shows the start of it after *Draft:*. The **+** button gets a pen for an unsent New session prompt and takes you back to it. The footer says how many there are ("2 unsent") and opens the list; ⌘P, Home and the command palette's *Unsent messages…* list them too. Coming back to one says so above the message box, with **Discard**. The quit prompt counts them, with **Show unsent**, and archiving a session with an unsent message asks first.
- **Queue.** The Later list is now a queue of prompts to start next, always there, not only with the focus limit. **Add to queue** (⌘⇧↩) sits next to Start in New session. Each item says when it's ready (its project is free, a session finished, or the item above it was done), and you start it with one click: nothing starts by itself. Click an item to check or change it first: it opens in New session in a box of its own, your changes stay with the item, and the prompt you were writing in New session is left as it was. Reorder by dragging or with ⌥↑ and ⌥↓, choose what an item waits for, and find it in the sidebar (right under Working), on Home and in the command palette. When an item turns ready, a message says so with **Start it**; the "Claude finished" notification names what's next. Prompts you saved for later are in the queue, oldest first.
- **Close sidebar sections.** Click a section's header (Working, Queue, Pinned, Today, Yesterday, Earlier) to close it, or ⌥-click to close or open them all. A closed section keeps its count and says what's unread or ready, and the session you have open stays visible under it. Earlier starts closed. Going to a session in a closed section opens it again.
- **Open files from Claude's replies.** A file Claude names in a reply (`src/search/suggestions.ts:69`, `~/notes.md`, or a link to a file) is now a link: click it to open the file in your editor, at that line. Only files that exist are linked, looked up from the session's folder; a bare name like `suggestions.ts` is linked when only one file in the project has it.
- **Files open in their project's window.** In VS Code, Cursor, Windsurf and Zed, a file you open from Switchboard (a link in a reply, *Open* on a tool, the Changes panel) opens in the window that has its project open, or a new one for it, instead of the window you used last.
- **Copy a code block.** Hover a code block in Claude's reply (or Tab to it) and click the copy button in its corner to copy the code.
- **Check transcript.** When a session's conversation shows up empty or short, choose **Check transcript…** in the session's ⋯ menu (or the command palette). It shows the session's transcript files, how many messages are in them, how often the conversation was compacted and any error reading it, and **Copy details** copies it all for a bug report.
- **Middle-click to archive.** Middle-click a finished session in the sidebar to archive it. Sessions that are working or waiting for you stay where they are.
- **⌃` shows or hides the terminal**, as in VS Code, next to ⌘J. It works from inside the terminal too.
- **Project order.** Settings → General → *Project order* chooses how New session, Home and the command palette list your projects: the ones you used last first (as before), or the order you set in Projects.
- **Pull before you start.** When you pick a project in New session, a git button next to *Open in editor* fetches from the remote, and pulls when your copy is behind (↓ shows how far). It's also in the command palette as *Update from remote*.
- **Change the project of a quick new session.** In the command palette's New session step, click the project to pick another one. What you typed comes along.

### Changed

- **Pull requests go to the branch your project develops on.** A project whose worktrees start from a branch (Project settings › Worktree base) now opens pull requests into that branch, not the repository's default branch. You can still pick another in the pull request dialog.

- **Pinned sessions have their own section** in the sidebar, below Needs you and Working. A pinned session that waits on you or is working shows there, and goes back to Pinned when it's done. The menu item is now *Pin*.
- Switchboard opens where you left it: the same display, size and position, maximized if it was. If that display is no longer connected, it opens on the main one.
- Sessions under **Working** (in the sidebar and on Home) no longer trade places as they write: the one you last sent a message to is at the top.

### Fixed

- A session whose conversation can't be read now says so, with **Show details** and **Try again**, instead of loading forever.
- When the message box grows while you type a long prompt, the conversation stays scrolled to the end if it was there, so its last lines no longer hide under the box.
- The terminal stays with the session you opened it in. Going to another session no longer shows an empty terminal there, and with two sessions side by side each keeps its own.
- Images you attached in New session are still there, with your prompt, after you visit a session and come back. Clearing the prompt removes them too.
- A message with several images shows them as small thumbnails side by side instead of one under the other at full width. Click one to see it full size.

## [0.0.11] - 2026-10-08

### New

- **Keyboard shortcuts sheet.** Press ⌘/ (or Help › Keyboard Shortcuts, or *Keyboard shortcuts* in the command palette) to see every shortcut, grouped by where it works, with your project actions' shortcuts for the open project. Shortcuts that don't work where you are are faded; switch to *Here* to hide them. Type to filter by name, or by keys ("⌘J", "cmd j"); pressing a shortcut in the filter looks it up instead of running it.
- **Themes.** Settings → Theme now has a theme picker under Light and Dark, with Demo Time, Catppuccin, Claude, Nord (dark only), Solarized and The unnamed (dark only) built in. A theme colours the app, code blocks, diffs and the terminal, and switching shows a toast with Undo.
- **Import and export themes** as `.json` files. Import shows both modes, what the file sets, what is worked out from its background and accent, and text that is hard to read, before anything is added. A theme only needs a background and an accent per mode; the rest is generated to stay readable. Drop a theme file on the window to import it.
- **Edit a theme while you look at it.** Switchboard reloads the theme in use when its file in the themes folder changes, and keeps the last working version if a change isn't valid.
- In the command palette: *Theme: <name>*, *Import theme…* and *Export current theme…*. The Light, Dark and Match System commands are now called *Appearance: …*.
- Settings → Backup can include the themes you imported.
- The Light, Dark and Match System switch in Settings is easier to see in light mode.
- **Collapse the sidebar.** ⌘B, or the sidebar button at the left of the header, turns the sidebar into a narrow rail: one project icon per session in the same groups and order, with a coloured rail for what needs you, what's working and what's unread. Hover an icon to see its title, project, branch and state. In Settings → Sidebar, choose *Hidden* to hide it completely instead, so the conversation takes the whole window.
- **Drag the sidebar's edge to collapse it.** Drag it in and it snaps to the rail, further and it hides; drag it out again to open it at your width. The arrow keys on the edge do the same.
- **A pill for sessions that need you** shows in the header while the sidebar is hidden. Click it to open the one waiting longest.
- **Move between sessions without the sidebar.** ⌃⇥ and ⌃⇧⇥ go to the next and previous session in the sidebar's order, and ⌘⇧U to the next one that needs you. With the sidebar collapsed, a short label at the top says where you landed.
- **⌘P lists sessions like the sidebar**: Needs you, Working, Today, Yesterday and Earlier, then your projects.
- New palette commands: *Toggle sidebar*, *Open sidebar*, *Minimize sidebar*, *Close sidebar*, *Next session*, *Previous session* and *Go to next session that needs you*.
- Settings → Diagnostics has a button to open the Claude Code config folder and show the cache database in Finder.

### Changed

- **Pull requests go to the branch your project develops on.** A project whose worktrees start from a branch (Project settings › Worktree base) now opens pull requests into that branch, not the repository's default branch. You can still pick another in the pull request dialog.

- A project action can no longer be given a shortcut Switchboard already uses: ⌘/, ⌘⇧J, ⌃↩, ⇧↩, ⇧⇥, ⇧↑, ⇧↓ and ⇧F10 are now refused like the others.
- Project actions can no longer use ⌘B, ⌃⇥, ⌃⇧⇥ or ⌘⇧U. An action that already has one of them keeps it, and runs instead of Switchboard's shortcut.
- A long prompt that is cut to two lines now fades out above Show more, so it's clear there is more to read.
- The pin on a pinned session now sits next to its age in the sidebar, instead of at the end of the branch line.

### Fixed

- New session in the command palette now takes pasted images, and dropped images, files and folders, like the message box. ⌘E brings the images along to the New session view.

## [0.0.10] - 2026-10-07

### New

- **A new command palette.** ⌘K (or ⌘⇧P, as in VS Code) shows the commands for where you are first: with a session open, **This session** (rename, pin, archive, fork, rewind, compact, change model, effort or mode, copy the last reply, delete…), then **Git** (commit, pull request, sync, switch branch, stage or revert everything, finish a worktree), the project's actions and the terminal's, followed by what you used recently and everything else. Commands that don't apply right now are left out.
- **⌘P goes to anything**: sessions (what needs you first, then what's working, unread and recent) and projects. ⌥↩ opens a session beside the current one.
- **Prefixes switch what the palette lists** without closing it: `>` commands, `+` new session, `!` project actions, `?` help.
- **Start a session from the palette.** **New session…** asks for a project (recent first, with its branch and status; ⌘1 to ⌘9 pick one, ⌥↩ picks it with a new worktree), then becomes a small message box with the project's defaults: where it runs, the prompt, and the profile, model, effort and mode. ⌘↵ starts it, ⌘E moves it to the full New session view, and Esc keeps the draft for next time.

### Fixed

- ⌘K in the terminal clears the screen, as in Terminal and iTerm.

## [0.0.9] - 2026-10-07

### New

- **Unsent messages stay.** Start typing in a session, open another one and come back: what you typed, and any images you attached, are still in the message box.
- **Copy a message.** Hover over a message and click **Copy**: your prompts and commands are copied as you typed them, Claude's replies as Markdown, even when a long prompt is cut to two lines.
- **Commands anywhere in a message.** Type `/` after a space or at the start of a line, not only at the very start, to pick a command or skill from the list.
- **Reload skills.** Added or removed a skill outside Switchboard? Press ⌘K and choose **Reload skills**: the `/` list picks up the change without restarting the session.
- **Rename projects.** Give a project a name of its own: right-click a session or open a project's **⋯** menu in the sidebar filter and choose **Rename project…**, or click **Rename…** under the project in the **Projects** view. The folder on disk keeps its name, and **Use folder name** goes back to it. Names are included when you export your settings.

### Fixed

- You can select text in a command you ran (such as `/review …`) in the conversation, as in your other messages.
- A report from an agent that finishes while you watch the session no longer shows up as a message from you; it appears with the other steps, as it does when you open the session later.
- The usage bars under the message box no longer disappear in a narrower window or with two sessions side by side; they only make way when the line under the message box is really short of room.
- Long paths and words in tooltips wrap onto the next line instead of running out of the tooltip.

## [0.0.8] - 2026-10-07

### New

- **Focus limit.** Set how many sessions you want going at the same time in **Settings → Focus** (off by default). A counter in the sidebar shows where you stand, and a click lists what is going, with what needs you first. At the limit, New session lists those sessions and asks before you start another: **Nudge** lets you go ahead, **Strict** waits until you finish, read or archive one. Resuming, forking, prompt actions and Claude in the terminal ask the same way; answering a session that already counts never does.
- **Save for later.** At the focus limit, park a prompt with its project and settings instead of starting it. Saved prompts are in a **Later** group in the sidebar and under **Later in <project>** in New session; pick one to fill in New session again. Saving and removing can be undone.
- **Prompt history.** Press ↑ on the first line of the message box to bring back an earlier message, edit it and send it again, as in Claude Code. ↓ goes forward again, and past the newest message (or with Esc) what you were typing comes back. In a session it's your messages there; in New session, the first prompts of your sessions in the picked project.
- **See what runs in the background.** Click the green background pill above the message box to list what Claude keeps running after its turn: shell commands, agents and workflows, with how long each has run. **Stop** ends one without stopping Claude.
- **Rename a session.** Right-click it in the sidebar and choose **Rename…** (or press F2), or use **Rename…** in the session's ⋯ menu. Claude Code shows the new name too, in `claude --resume`.
- **Long messages take less room.** Your messages and commands in the conversation show their first two lines. **Show more** opens the whole message and **Show less** shortens it again. Find in session opens a message when a match is in the hidden part.

### Improved

- **Install with Homebrew.** `brew install --cask estruyf/tap/switchboard` installs the same signed app as the download, and the tap follows every release.
- **New session shows where you are working.** Each project tile is one row with its icon, name, status and ⌘ shortcut. The project you pick, and the message box around your prompt, take that project's colour.
- **See when your plan limits reset.** Under the message box in New session, the usage line starts with the Claude profile you picked and says when the 5-hour and weekly limits reset. It follows the profile you choose.
- **The terminal panel is its own layer.** It has a darker background with a soft shadow, a handle you can see and grab (or use the arrow keys), and room around the prompt. Tabs show a dot while an action runs and the exit code when something failed; the close button stays on the selected tab.
- **Dock the terminal on the right.** The button in the terminal's tab bar moves it beside the conversation, full height, and back below. While Changes is open, or the window is too narrow, it stays below. **Maximize** (⌘⇧J) gives the terminal the whole view; Esc or ⌘⇧J brings the conversation back.
- **More room for the conversation with the terminal open.** While the terminal is open below, the usage and context line under the message box folds into a small ring next to Send. Hover it for the numbers, click it for the details.

### Fixes

- **Project menus close together.** Clicking outside the project filter now also closes the ⋯ menu of a project you opened from it.
- **New skills show up in the / menu right away.** A skill you add while Switchboard runs, or one a session writes for you, is listed in the message box once Claude's turn ends, in that session, in other sessions of the same Claude profile and in New session. Before, it only appeared after a restart.
- **Skills no longer fill the conversation.** When Claude uses a skill, you see one "Use the … skill" step. The skill's full instructions, which are meant for Claude only, no longer show up as a message from you.
- **Fetch, Pull, Push and project actions show what they run.** Their terminal tab starts with the command and ends with a **Done** line (or the exit code), so a command that prints nothing, like a fetch with nothing new, no longer looks like it never ran.
- **A finished terminal tab says so.** The cursor no longer blinks as if you could type, and Esc closes the tab.
- **Stop and Restart for actions always respond.** They moved into a strip above the terminal that shows the command, how long it has run and where. You can reach them with Tab, and Restart also works while the command is still running.
- The right-click menu of a session no longer offers **Remove from Switchboard**, which removed the project and was easy to mistake for deleting the session. It is still in the project menus and in Projects.
- With **Show sessions from other apps** on, opening New session no longer adds a session named after the project that runs in the background for a couple of minutes.
- Picking a slash command with Tab no longer puts a focus ring around the message box.
- A slash command you send shows as a command straight away, in a card with everything you wrote after it, instead of changing style a moment later and cutting your message off.
- Claude Code's internal commands, such as `/__remote-workflow`, are no longer offered in the slash command list.
- A session whose first prompt has a pasted image is listed under its project, with the project's icon, instead of under **Unknown folder**.

## [0.0.7] - 2026-10-07

### New

- **Right-click a project action** above the message box, or one in its **N more** menu, to run, edit or delete it. Shift+F10 opens the same menu from the keyboard. Delete asks first.

### Safer

- **A link can't start Claude without permission prompts any more.** A `switchboard://` link with `autostart` now uses the project's own permission mode, or Ask before edits when the project has none. It never uses the mode you last picked, and never Auto, Don't ask or Bypass permissions.
- **Going back to an older version of Switchboard keeps your pins, projects, actions and profiles.** It used to start from an empty list; now the older version leaves your data alone, so it is all there when you update again.
- **Reverting a file in the Changes panel only touches that file.** File names with `[`, `*` or `?` (such as `app/[id]/page.tsx`) could also affect a similar file next to them. Reverting a staged deletion now brings the file back, and reverting a renamed file restores the original name.
- Switching branches when starting a session, and merging or removing a worktree, now wait while Claude is working in that checkout.
- While **Settings** is open, permission shortcuts (Esc, ⌘↵), project action shortcuts and ⌘⇧L no longer act on the session behind it.
- **Remove from Switchboard** in the sidebar menus asks first, as it does in Projects.

### Fixes

- **Stop** and **Restart** on a project action's terminal tab work again. The terminal was catching the clicks.
- Saving a project action closes the editor, updates its pill straight away and says **Action saved**. If the save fails, the editor stays open with the error at the top, so nothing you typed is lost.
- With two sessions side by side, a project action's shortcut or **Run** from the command palette runs it once, in the active session, not in both.
- Opening or closing a second pane keeps the message you were typing in the other one.
- Recording a shortcut for a project action no longer runs the action that already uses those keys. A shortcut Switchboard already uses (such as ⌘K or ⌘F), or one another action has, is refused with a message. ⌘⇧+ and ⌘Space can be recorded and are shown properly.
- Text you type while a message is still sending is kept.
- A file search with `@` that finishes late no longer reopens the list and replaces what you typed on Enter.
- **Approve and accept edits** only switches to Accept edits when the approval went through.
- Double-clicking **Commit**, **Push** or **Pull** runs it once.
- Clicking a notification, choosing **Settings…** or **Check for Updates…** after closing the window now opens the right place.
- Home shows "Usage unavailable" for a profile whose plan usage can't be read, instead of "Loading usage…" forever, and tries again later.
- Deleting the open session when it was the last one in the list no longer leaves it on screen.
- Closing a session means it doesn't reopen the next time Switchboard starts on your last session.
- The Changes panel shows correct diffs with git settings such as an external diff tool (difftastic), forced colour, or blank lines written without a leading space. An open diff refreshes when Claude edits it again.
- A session started on a new Claude profile shows up right away, without waiting for a refresh or a restart.
- Sessions no longer briefly disappear from, or come back to, the sidebar while it refreshes.
- Forking a session (sending to a session open elsewhere) no longer makes the original look as if it is starting, or adds your message to it.
- Sending twice quickly to a stopped session starts Claude Code once.
- Plan usage that can't be read is retried once instead of every 30 seconds.
- `@` file search in a folder that isn't a git repository no longer freezes the app or walks your Library, Desktop and Documents folders.
- If an update can't be installed, Switchboard keeps working instead of losing its connection to Claude Code. Switching the update channel during a download no longer mixes up the two versions, and automatic update checks keep running after a busy moment.
- A blank window after a crash reloads on its own.
- Your preferences survive a crash while they are being saved.
- Find in session highlights the right text after letters such as "İ".
- Typing with an input method (Japanese, Chinese, Korean) no longer picks a branch, folder or find result on the Enter that confirms the text.
- The emoji picker for a project closes when you click elsewhere and stays inside the window.
- Renaming a Claude profile keeps the keyboard focus.

## [0.0.6] - 2026-10-06

### A fresh look

- **The sidebar puts what needs you first.** Sessions are grouped into **Needs you**, **Working**, **Today**, **Yesterday** and **Earlier**. Each row has a coloured bar for its state: pink when it waits for you (with what it waits for), yellow while Claude works, and blue when it finished and you haven't read it yet. The selected row is easier to see in light mode.
- **Home** shows what needs you, what is working, each Claude profile's plan usage (5-hour and weekly, with when they reset) and what its sessions are doing, and a quick start for your projects. Open it with the house button at the top of the sidebar, ⌘⇧H or the command palette; closing a session (×) also goes there. Switchboard now opens on Home; pick another start in **Settings → General → On startup**.
- **New session** is centred and starts with your projects as tiles: the four you used last, the rest one click away, and ⌘1 to ⌘9 to pick one. Where the session runs (current checkout or a new worktree, and the branch) sits on top of the message box, with a Worktree switch. Below it, pick up a recent session in that project.
- **Permission requests stand out** with a pink frame. ⌘↵ allows, Esc denies, and you can tell Claude what to do instead. Questions show numbered answers you can pick with 1 to 9.
- **A calmer session header**: Changes and Terminal are one compact switch, the git button is the main action, and **Open in** moved into the **⋯** menu (⌘O still works). Your **project actions** are pills above the message box, with their shortcuts; all of them are still in the **⋯** menu.
- **Project actions** have a clearer editor: your actions on the left, the selected one on the right, variables you can insert with a click, and package.json scripts to add in one go.
- **Terminal** (⌘J) opens a shell straight away instead of asking what to open, and closing its last tab hides the panel. Claude Code's terminal interface moved to **⋯ → Open in → Claude Code**.
- The context meter always shows its ring and opens on a click, also for a session you haven't sent a message to yet.
- **Usage and context change colour** as they fill up: green, then orange from 60%, red from 85%. Claude's task list and background tasks are small pills above the message box.
- **The conversation has fewer boxes.** Your prompts are cards on the right; tool runs, agent reports and task lists are quiet lines that open on a click.
- **Settings uses the main area** and leaves the sidebar's session list in place, so anything waiting for you stays in view.
- **The Changes panel can be resized** by dragging its edge (or with ← →), and the diff can fill the window.
- With two sessions side by side, the one you're not working in fades back.
- The terminal is always dark, also when the app uses the light theme.
- Dialogs look and behave the same everywhere: the same title and close button, Esc closes only the dialog on top (a dropdown inside it closes first), ⌘↵ commits or saves, and a click outside closes them. Messages such as a failed action or a session open elsewhere share one style too.
- Buttons, keyboard shortcuts and usage bars look the same on every screen. Send, Stop and the permission buttons are the same height, second choices such as "Approve, ask before edits" have a visible border, and the counts on Home take the colour of their group, as in the sidebar.

### Sidebar

- **Settled** is now called **Archived**: right-click → **Archive** (or **Unarchive**). Sessions quiet for 48 hours still move there on their own. Nothing is deleted, and a session comes back when it has new activity or needs you. To remove a session for good, use **Delete session…**.
- **Select several sessions** with ⌘-click (or ⇧-click and ⇧↑ ↓ for a range). While you pick, every row shows a round checkbox you can click (or tick with Space), the picked rows share one highlight, and each group has **Select all** (⌘A picks the group you're in). A bar over the list archives or unarchives, pins and deletes them all at once (⌘⌫), with the same actions in the right-click menu. Escape clears the selection.
- Sending a message to an archived session moves it back to the main list right away, instead of waiting until Claude finishes.
- Archiving or unarchiving a session no longer makes rows overlap the **Archived** header.

### Session view

- A calmer **session header**. Under the title, one line says what the session is doing, its project and its branch; click the branch to switch (or, in a worktree, to merge or remove it). Where it was started and when it was last updated are in the title's tooltip.
- A **git button** next to **Open in**: commit (Claude writes the message, or write your own with **Commit…**), push, create a pull request, pull or fetch, without leaving the session. Its face shows the next step and the count, such as **Pull ↓2** when the branch is behind its upstream, and **Fetch** when there's nothing to do. The menu shows where the branch stands, says when you need to pull before you push, and has **Switch branch…** and **New worktree…**. ⌘⇧L pulls. Commit and pull request moved here from the **Worktree** menu, which now merges or removes.
- **Open in** shows your editor with an icon, and its menu can copy the folder's path.
- A **⋯** menu holds your project actions, the agents Claude started, the Claude profile the session uses and **Stop session**.
- The message box has one row of chips, the same in a session and in **New session**: profile · model · effort · permission mode (⇧Tab still switches it), next to **Tools**, attach and **Stop** (with its Esc key). A running session's profile chip says which account it bills to. Under the box, one quiet line has your plan usage and how full the context is; the context breakdown can compact the conversation. Effort in New session is now a chip instead of the bars.
- The **context breakdown** is easier to read: the bar has a visible outline so you can see how much is free, small categories still show up in it, and **Compact now** looks like a button.

### New session

- A prompt you start typing in **New session** is still there when you come back from a session or Settings. A **Clear** link under the message box empties it.
- **Open in** (VS Code, another editor, a terminal, Finder or GitHub) is at the top of **New session** too, to look around the project before you start.
- A simpler bar under the message box with two dropdowns: where the edits go (**Current checkout** or **New worktree**, with **Save as project default** at the end) and the branch, which you can search. For a new worktree it shows the branch it starts from, such as **From origin/main**. Your plan usage and the sessions already running in the project sit on one quiet line below it.

### Fixes

- The arrow that opens the **Open in** menu is now a proper chevron instead of a tiny glyph sitting off-centre.
- **New session** no longer counts archived sessions in "running here", so the number matches what the sidebar shows.

## [0.0.5] - 2026-10-06

### Sessions

- The **Open in** menu in a session's header has a **GitHub** entry when the project is on GitHub. It opens the branch you're on when it's pushed, and the repository otherwise.
- When Claude leaves a command or agent running in the background, the session shows it: a slowly turning green ring in the sidebar, "Open, 1 background task running" in the header, and the task under the message box. Hover to see what's running.
- **Find in a conversation** (⌘F): search the session you're reading. Every match in your prompts and Claude's replies is highlighted, the count shows where you are, and ↩ / ⇧↩ (or ⌘G / ⇧⌘G) step through them. Escape closes it.

### Accessibility

- Small grey text, timestamps and hints are easier to read in both themes, and so are green and pink status text in light mode.
- You can use Switchboard with the keyboard alone. Menus work with the arrow keys and hand focus back when they close. Dialogs keep Tab inside them. ⇧F10 opens a session's menu in the sidebar. Hover-only buttons (message actions, Changes panel rows, project options) also show when you Tab to them.
- VoiceOver reads each session in the sidebar as one sentence (title, project, status, how long ago), and every icon button, status dot, usage ring and context meter is labelled. It also announces when Claude finishes, needs permission or a session starts waiting for you.
- Animations stop when *Reduce motion* is on in macOS. Spinners still turn.

### Changes

- A permission request no longer takes focus while you're typing, so pressing Enter can't approve a command by accident.
- Deleting a project action asks first.
- The terminal panel's **Claude TUI** tab is now called **Claude Code**.
- New session explains what to do before a folder is chosen, instead of showing empty controls. A disabled Send or Start session button says why when you hover it.
- Clearer wording across the app: empty states say what to do next, errors say what failed, and the action editor explains how to set a shortcut.

### Fixes

- The Claude profiles page no longer runs off the side of the window when a sign-in command is long. The command wraps and has a copy button.
- Diffs in the Changes panel scroll sideways with the line numbers kept in view, and added or removed lines are coloured across the whole width. A new button in the panel's header wraps long lines instead; Switchboard remembers your choice.
- A session that starts again (after Stop, a while idle, or restarting Switchboard) keeps its permission mode, and the model and effort you picked for it, instead of going back to your defaults.
- The model picker under a session shows the model it runs, such as Opus 5.5, instead of an extra row with the raw model id.
- Switchboard no longer closes a session that has been idle for a while when a background task is still running in it. That used to stop the task before Claude could report back.
- The permission mode picker under a session shows the same coloured dot as New session.
- A session you just started goes to the top of the sidebar, even while another session is working.
- The **Open in** menu is no longer hidden behind the conversation.

## [0.0.4] - 2026-10-06

### Updates

- Switchboard updates itself. It checks for a new release shortly after it opens and every few hours; a pill at the bottom of the sidebar offers the update, shows what's new, downloads it when you click, and restarts into it (asking first if sessions are running). **Switchboard → Check for Updates…** checks right away.
- A new **About** section in Settings shows the version you're running and the commit it was built from, links to its release notes and the changelog, and has the update settings: automatic checks on or off, and the *Stable* or *Nightly* channel. The version also shows at the bottom of the Settings sidebar, and in the About Switchboard window.
- Switchboard tells you when a newer Claude Code is out and updates it for you. It checks shortly after it opens and every few hours, following your Claude Code channel (*latest* or *stable*). A notice at the bottom of the sidebar offers the update (or dismiss it until the next version), and **Settings → About** shows the Claude Code you have, how it was installed, the update's output, and a switch to turn the checks off. New sessions use the new version right away. When Switchboard can't run the update itself, it shows the command to copy into a terminal.

### Links

- Open Switchboard from a link. `switchboard://new-session?project=payments&prompt=…` opens New session in that project with the prompt filled in. Use `cwd=/path` for any folder, or `repo=owner/name` and Switchboard finds your checkout of that GitHub repository. A link that doesn't say where opens the project list instead of guessing. By default you read the prompt and press Enter (a note under the message box says it came from a link); add `autostart=1` to start the session right away. `switchboard://session/<id>` opens a session. Links Switchboard can't use show why and change nothing. See [Links](docs/deep-links.md) for the format and examples.

### Sessions

- A session working in its project's folder (not a worktree) shows the branch checked out right now in its header, instead of the one Claude Code last recorded. Click it to switch branches: uncommitted changes come along when they don't conflict, git refuses when they do, and nothing is ever stashed or discarded. Running sessions in the sidebar show the same live branch.
- A session keeps its permission mode (such as *Auto*) when it picks up again after being stopped, idling for a while or rewinding, instead of falling back to *Default*. The mode shown also follows changes Claude Code makes on its own, such as leaving plan mode.
- A session's model dropdown shows the model's name from the list (such as *Opus*) instead of its raw id like `claude-opus-5-5`.
- The "open" count at the bottom of the sidebar now matches the sessions in the main list. It no longer counts Claude Code processes idling outside Switchboard, which are listed under *Settled*.

### Projects and profiles

- After you add a project, the Projects view opens on it so you can choose its Claude profile and defaults straight away.
- The Claude profile dropdown shows profile names in full; the account email is shortened instead.

### Actions

- A running action's terminal tab has a **Stop** button, and ⌃C in it stops the action like in any terminal. An action stopped this way shows exit code 130 instead of 0.
- **Restart** on a finished action now runs it again in the same tab. If the action was edited, the new command runs; if it comes from `.switchboard.json` and changed, it has to be approved again (run it from the actions bar) before it restarts.

### Settings

- Back up and move your settings. **Settings → Backup** (or *Export settings…* in the command palette) saves your preferences, projects with their icons, project actions and app choices to a file; *Import settings…* shows what a file would change before anything happens, merges by default or replaces, and lets you point folders that aren't on this Mac at new ones. Your current settings are backed up first, and imported shell actions ask for approval before they run.

### Look and feel

- Menus, dropdowns, popovers and dialogs stand out more from what's behind them, especially in dark mode: they have a lighter surface, a clearer border and a stronger shadow, and dialogs dim the app further.
- macOS permission prompts, such as the one for local network access, now say *Switchboard* instead of *Electron*.

## [0.0.3] - 2026-10-06

### Projects

- Projects are now the folders you add yourself. The sidebar filter, New session and the command palette offer only those. *Add project* suggests the folders you already have Claude Code sessions in, and starting a session in another folder offers to add it. If you're upgrading, folders where you started or continued a session in Switchboard are kept.
- A new **Projects** view (the folder icon at the bottom of the sidebar): add, remove and reorder projects, and set their icon, actions and defaults. Removing a project only takes it off Switchboard's lists; nothing on disk changes.
- Defaults per project for new sessions: model, effort, permission mode, current folder or new worktree (and its base), and a branch to check out. Change one in New session and choose *Save as project default* to keep it.

### New session

- Redesigned around the prompt. The project sits above it, with a switcher for recent folders. Model, a five-step effort dial and the permission mode are in the prompt's toolbar. Below it you choose this checkout or a new worktree, its base and branch, and see your plan usage.
- ⌘N, the sidebar button and the command palette put the cursor straight in the prompt, even when New session is already open.
- The "running here" note only counts sessions the sidebar shows, so terminal and editor sessions stay hidden when *Show sessions from other apps* is off.

### Claude profiles

- Use more than one Claude account, for example a personal plan and a work one. Each profile is a Claude Code config folder with its own login, settings, plugins and sessions. Add them in **Settings → Claude profiles**, choose the default, and link a project to a profile from its menu or the Projects view.
- With more than one profile, sessions show which account they use, New session lets you pick one for a single session, and the usage band shows that account's limits.
- *How to set up another profile* in Settings walks you through creating the folder, signing in, adding it and linking projects.

### Settings

- Settings now uses the sidebar for its sections, and closes with the × button, *Back to sessions* or Escape.
- Diagnostics moved into Settings (or "Engine diagnostics" in the command palette).
- New **General** section: choose whether Switchboard opens on the last session or on New session. It also holds the "Ask before quitting" option.

### Sessions and the message box

- Close a session with the × in its header to go to New session. A session that's working keeps running.
- Switchboard no longer reopens a session from another app at launch while those sessions are hidden from the sidebar.
- Drag files onto a session and the message box shows what will happen: images are attached, and other files and folders are mentioned as `@path`. Images over the limit are mentioned instead of being dropped.

### Look and feel

- Drag the sidebar's edge to resize it; double-click the edge to reset. Switchboard remembers the width.
- Dropdowns, checkboxes, switches and tooltips match the app's theme in light and dark mode.
- Buttons and links show the pointer cursor again.

## [0.0.2] - 2026-10-05

- The sidebar now lists only the sessions you start or continue in Switchboard. Turn on **Settings → Sidebar → Show sessions from other apps** to see your terminal, Claude desktop and editor sessions too.
- Closing or reopening Claude Code elsewhere no longer marks sessions unread or reshuffles the sidebar: a session is dated by its last message, not by when its file was last touched.
- Claude's reply is formatted as it streams in (headings, lists, code, bold), instead of as plain text until it finishes.
- With two sessions side by side, the message box, its buttons and the context meter fit inside each pane instead of sticking out.

## [0.0.1] - 2026-10-05

The first release of Switchboard, a Mac app for running and keeping track of your Claude Code sessions. It uses the Claude Code you already have installed, with your login, settings, commands and skills.

The app is signed and notarised by Apple, for Macs with Apple Silicon. You need [Claude Code](https://github.com/anthropics/claude-code) installed and signed in.

### Sessions

- Every session in one list, across all your projects, including the ones running in your terminal or in Claude desktop.
- See at a glance which sessions are working, waiting for you, finished or unread, with notifications and a Dock badge when one needs you.
- Pin sessions, filter by project, give projects an icon, and settle sessions you're done with (they come back when they need you).
- Search every conversation (⌘⇧F) and jump straight to the matching message.
- Delete sessions to the Trash.

### Working with Claude

- Start a session in any project (⌘N), in the current folder or a new worktree.
- Streaming replies, `/` commands, `@` file mentions, images, permission prompts, questions and plans.
- Each run of tool calls is one line ("Reading src/app.ts…", then "Ran 3 commands and edited 2 files"); click it to see every step.
- Undo file changes since a prompt, edit and resend a prompt, or fork from any reply.
- Change the model, permission mode and effort while a session runs; see the context window and your plan usage.
- Agents Claude starts, background ones included, show in the session header; click to watch what they're doing.

### Reviewing and finishing work

- Changes panel (⌘⇧D) with the session's git diff: stage, unstage or revert files.
- Finish a worktree: commit with Claude, merge into the base branch, open a pull request, or remove it.

### Everything in one place

- Command palette (⌘K) and two sessions side by side (⌥-click).
- Built-in terminal (⌘J) with a shell and the full Claude Code terminal interface.
- Project actions: one-click commands and prompts, shareable through `.switchboard.json`.
- Open in your editor, terminal or Finder (⌘O); file paths in the conversation open at their line.
- Tools: the session's MCP servers (turn them on or off and reconnect them), skills, agents and plugins.
- Settings (⌘,): theme (the Demo Time colours, light or dark), sidebar style, how tool activity shows, and the quit prompt.

[0.0.1]: https://github.com/estruyf/switchboard/releases/tag/v0.0.1
