# Changelog

All notable changes to Switchboard are listed here. Each release is also on the [releases page](https://github.com/estruyf/switchboard/releases), with the `.dmg` for macOS and, from the first release with Windows support, the installer for Windows to download.

## [Unreleased]

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
