# Switchboard 1.1

Two images, for a post and a follow-up (a thread on X and Bluesky, both images in one post on Mastodon and LinkedIn):

- [image.png](image.png): the theme of 1.1, Claude Code that starts on its own (schedules, triggers, pipelines, Upcoming).
- [../release-1.1.0-more/image.png](../release-1.1.0-more/image.png): the rest of 1.1 (Linux, #, previews, reading mode, app icons and themes).

Both use crops of the website's real screenshots (demo data, `website/src/assets/screenshots/*-dark.png`); after `npm run website:screenshots`, run `social/render.sh release-1.1.0 release-1.1.0-more` to bring them up to date.

Links:

- Release: https://github.com/estruyf/switchboard/releases/tag/v1.1.0
- Website and download: https://switchboard.struyfconsulting.com/
- Pipelines: https://switchboard.struyfconsulting.com/sessions/pipelines/
- Triggers: https://switchboard.struyfconsulting.com/projects/triggers/
- Schedules: https://switchboard.struyfconsulting.com/new-session/schedules/
- Upcoming: https://switchboard.struyfconsulting.com/sessions/upcoming/
- Linux: https://switchboard.struyfconsulting.com/getting-started/linux/
- Issues and pull requests with #: https://switchboard.struyfconsulting.com/sessions/github-issues/
- File preview: https://switchboard.struyfconsulting.com/sessions/file-preview/
- Homebrew: `brew install --cask estruyf/tap/switchboard`

Released: 1.1.0, tagged `v1.1.0` on 2026-10-22, after nine betas (162 commits since 1.0.0).

## Alt text

**image.png:** Switchboard 1.1, out now: "Claude Code that starts on its own", with "Now on Mac, Windows, Linux". On the right, the Upcoming view, slightly tilted: a queue of two prompts, the scheduled runs for tomorrow, the schedules with their switches, and a history of the last runs. In front, a trigger, "CI fails on main", with the sessions it started to fix a test and a lint error. Below it, a pipeline run, "Plan, execute, validate, push", at step 3 of 4: Plan on Opus with the plan approved, Execute on Sonnet, Validate checking a second round, and Push waiting for you.

**release-1.1.0-more/image.png:** Also new in Switchboard 1.1: "Now on Linux, with nine new looks". The nine app icons from Settings: Graphite, Midnight, Paper, Signal yellow (picked), Forest, Plum, Aluminium, Ocean and Neon. A message box with "Fix #" typed and a list of GitHub issues and a pull request to attach. A preview of a Markdown plan, with a note and a table of steps. Also listed: Keep this Mac awake, Open at login, and worktrees from any branch.

## X (280 characters)

Post, with image.png:

Switchboard 1.1 is out ⏰

Claude Code that starts on its own:
• Schedules: a session every morning
• Triggers: one when CI fails or an issue is assigned to you
• Pipelines: plan, build, check and push in one run

And it now runs on Linux.

https://switchboard.struyfconsulting.com/

Reply, with release-1.1.0-more/image.png:

Also new in 1.1:
• Type # to attach a GitHub issue or pull request
• Preview Markdown, HTML and code files
• Reading mode for long replies
• Nine app icons with themes to match
• Keep this Mac awake, and Open at login

https://github.com/estruyf/switchboard/releases/tag/v1.1.0

## Bluesky (300 characters)

Post, with image.png:

Switchboard 1.1 is out ⏰

Claude Code that starts on its own: schedule a session every morning, trigger one when CI fails or an issue is assigned to you, or plan, build, check and push in one pipeline run.

And it now runs on Linux too.

switchboard.struyfconsulting.com

Reply, with release-1.1.0-more/image.png:

Also new in 1.1: type # to attach a GitHub issue or pull request, preview Markdown, HTML and code files, read long replies in reading mode, and pick one of nine app icons with a theme to match.

All the details: github.com/estruyf/switchboard/releases/tag/v1.1.0

## Mastodon (500 characters)

With both images:

Switchboard 1.1 is out ⏰

Claude Code that starts on its own:
• Schedules: once, daily, on weekdays or monthly
• Triggers: a session when CI fails or an issue is assigned to you
• Pipelines: plan, build, check and push in one run
• Upcoming: all of it in one view

Also new: Linux, # to attach a GitHub issue or PR, previews of Markdown and code files, reading mode, and nine app icons with themes.

https://switchboard.struyfconsulting.com/

#ClaudeCode #macOS #Linux

## LinkedIn

With both images:

Switchboard 1.1 is out. ⏰

Until now, every Claude Code session started with you typing a prompt. In 1.1, Switchboard can start the work for you:

• Scheduled sessions. Run a prompt once, every day, on weekdays, on set days each week or on a day each month. A morning look at new issues, a weekly dependency check.
• Triggers. Start a session, or a whole pipeline, when CI fails on a branch or an issue is labelled or assigned to you. Switchboard checks through the GitHub CLI and never bypasses your permissions.
• Pipelines. Give one task to a set of steps, each in its own sub-session: plan with one model, build with another, have a fresh session check the work, then push. When the check still asks for changes, Another round sends them back.
• Queued prompts that start by themselves when the session they wait for finishes cleanly.
• Upcoming. One view for everything queued and scheduled, across your projects, with the next 7 days and how the last runs went.

Also new in 1.1:

• Switchboard on Linux: an AppImage, a .deb and an .rpm, for x64 and Arm64, that update themselves.
• Type # to attach a GitHub issue or pull request to a message, or start a session from one.
• Previews of Markdown, HTML and code files next to the conversation, and a reading mode for long replies.
• Nine app icons, with a theme to match each one.
• Keep this Mac awake and Open at login, so schedules and triggers keep running.
• New worktrees from any branch, and pipelines in the remote app on your phone.

Download: https://switchboard.struyfconsulting.com/
What's new: https://github.com/estruyf/switchboard/releases/tag/v1.1.0

#ClaudeCode #DeveloperTools #OpenSource
