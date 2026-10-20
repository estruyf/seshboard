# Event triggers

A trigger starts a session, or a pipeline, when something happens: CI fails on `main`, an issue gets the `claude` label, a reviewer asks for changes on a pull request a session opened, or a script you wrote reports an error. Schedules start sessions at a time. Triggers start them when there is work.

This note is the design. Nothing is built yet. Places in the code are named as they are on `dev` on 2026-10-19.

[← Back to the README](../README.md)

## What exists today, and what it means for this design

- **Schedules** (`packages/engine/src/schedules/scheduler.ts`, `packages/protocol/src/schedules.ts`) have most of what a trigger needs around the start: one timer capped at a minute, wake handling, `checked_at` for what was missed while closed, `missed: run | skip`, runs held at the focus limit or a usage limit as queue items that start by itself (`QueueAutoStarter.armForLimit`), pausing when a folder is gone, the last 20 runs, and main's notifier. Triggers should reuse this, not copy it.
- **GitHub goes through `gh`** (`packages/engine/src/git/github.ts`): no shell, always `--json`, an answer cached for `GITHUB_CACHE_MS`, and failures sorted into not installed, signed out, rate limited and offline. The checks watcher (`prChecks.ts`) polls every 30 seconds in the foreground and every 5 minutes in the background, and `readCheckLogs` reads a failed job's log.
- **New session from an issue or pull request** fills in the worktree and the prompt, and gives Claude the text as **context to read, not instructions** (`githubContext.ts`).
- **Session linking knows which session opened which pull request** (`session_prs`, `links/prDetect.ts`).
- **Deep links** (`docs/deep-links.md`): `switchboard://new-session?…&autostart=1` already lets any script or alert start a session. That is a push from outside, with no dedupe, no limit and no history. Triggers are the pull side.
- **Switchboard is a desktop app.** There is no server to receive a webhook. Remote access has a tunnel, but opening it to the internet for webhooks is a different risk (see [Decisions](#decisions)).

So a trigger is a schedule whose rule is "when this source has a new event", with a dedupe store and a prompt that gets the event.

## The flow, worked through

The project *acme-store* has a trigger **CI fails on main**.

1. Every 5 minutes, while Switchboard is open, the engine runs `gh run list --branch main --status failure --limit 5 --json databaseId,headSha,workflowName,displayTitle,url,createdAt`.
2. Run `8812` of the workflow *test* failed on commit `4e1a…`. The trigger hasn't seen that workflow fail on that commit, so it is an event. The same workflow failing again on the same commit (a re-run) is not.
3. The engine reads the failed job's log with `readCheckLogs`, cut to its last 150 lines.
4. It starts a session in a new worktree from `main`, with the trigger's prompt filled in: *CI failed on main in the test workflow. Find the cause and fix it. Don't push.*, followed by the log as a context block.
5. A notification says *CI failed on main. Started "Fix test on main"*. The session row has the trigger's bolt icon.
6. When the next run on `main` passes before you look, the trigger says so in its history, and the session's header says *main is green again since 14:20*. It does not stop the session for you.

## Sources

| Source | What is an event | Event key (dedupe) | Variables |
|---|---|---|---|
| **CI fails on a branch** | a failed workflow run on the branch (default: the repo's default branch) | workflow + head commit | `{{event.workflow}}`, `{{event.branch}}`, `{{event.commit}}`, `{{event.url}}`, the log as context |
| **Issues for you** | an open issue that newly matches the trigger's filter: a label, an assignee, or both (with state labels: and has no state label) | issue number | `{{event.number}}`, `{{event.title}}`, `{{event.url}}`, the issue as context (as New session from issue does) |
| **Changes requested** on a pull request a session opened | a review with *Request changes*, or new unresolved comments | review id | `{{event.pr}}`, `{{event.reviewer}}`, the comments as context |
| **A command** you choose, on an interval | each JSON object it prints with an `id` it hasn't printed before | `id` | every field of the object, `{{event.<field>}}` |

- **Changes requested** doesn't start a new session. It sends the review to the session that opened the pull request (from `session_prs`), as a message held in Up next while Claude works. When that session is gone, it starts a new one from the pull request.
- **A command** is the way in for everything else: Sentry, Linear, a status page, a log file. `sentry-cli issues list --json | jq …` or a ten-line script. It runs in your login shell in the project's folder, like a project action, with a timeout of 60 seconds.
- **Polling** uses `gh`'s cache, the background interval (5 minutes, at least 1 minute) and stops a source for an hour after a rate-limit answer, saying so on the trigger.

## What a trigger does

```ts
type Trigger = {
  id: string;
  name: string;
  cwd: string;                          // the project's root: a trigger always belongs to one project
  source:
    | { kind: 'ciFailed'; branch: string | null; workflows: string[] }
    | { kind: 'issues'; match: IssueMatch; authors: 'collaborators' | 'anyone'; stateLabels: StateLabels | null; assignOnPickUp: boolean }
    | { kind: 'changesRequested' }
    | { kind: 'command'; command: string; everyMinutes: number };
  /** What it starts: a session with these choices, or a pipeline with the event as its task. */
  start: { kind: 'session'; draft: LaterDraft } | { kind: 'pipeline'; pipelineId: string };
  /** Sessions (or pipeline runs) of this trigger that may be busy at once; the next events wait for a slot. */
  maxAtOnce: number;                    // default 3 in worktrees; always 1 in the project's folder
  /** Events that may wait for a slot; beyond that they are recorded as skipped. */
  maxWaiting: number;                   // default 10
  missed: 'run' | 'skip';               // events from while Switchboard was closed
  paused: boolean;
};
```

Starting a [pipeline](pipelines.md) is where the two features meet: *an issue assigned to me with the `claude` label → Plan, execute, validate, push*, with the push step still waiting for you.

## Set up on the project

Triggers are set up per project, on a **Triggers** tab of the project's page, next to Sessions and Settings. A trigger needs a repository, a folder to start in and choices for its sessions, and those are the project's. The tab lists the project's triggers with their last check and events, and **New trigger** opens the dialog with the project's defaults filled in (profile, model, effort, mode, workspace).

The project's **⋯** menu in the sidebar gets *Triggers…*, and **Start ▾ › Start when…** in New session opens the same dialog for the chosen project. Upcoming's Triggers filter shows them across projects, as it does schedules.

## Which issues: a label, an assignee, or both

On a repository more people work on, "an issue with the `claude` label" is everyone's issue. So the issue trigger has a filter, and at least one part of it must be set:

```ts
type IssueMatch = {
  /** Issues with this label. Null: any label. */
  label: string | null;
  /** Issues assigned to you (the account gh is signed in with), to someone by login, or to anyone. */
  assignee: { kind: 'me' } | { kind: 'login'; login: string } | null;
};
```

| Filter | Picks up | Fits |
|---|---|---|
| **Label** `claude` | every open issue with the label | a repository you work on alone, or a team where one person runs the triggers |
| **Assigned to me** | every open issue assigned to you | a team: each person's Switchboard picks up only their issues |
| **Label and assigned to me** | issues with the label that are assigned to you | a team where you also choose which of your issues Claude takes |

- **Me** is the account `gh` is signed in with, read with the `viewer { login }` query `github.ts` already makes. The dialog shows it: *Assigned to estruyf (the account gh uses)*. When `gh` switches accounts, the trigger follows and says so in its history.
- `gh issue list --label <label> --assignee @me --state open --json number,title,labels,assignees,author,authorAssociation,updatedAt` does the filtering on GitHub's side.
- **An issue newly matches** when it wasn't in the last answer: a label added, an assignment to you, or a new issue that matches.
- **A label alone on a shared repository**: the dialog warns, *Everyone with this trigger picks up these issues. Use Assigned to me, or turn on state labels or Assign to me when picked up.*
- **Assign to me when picked up** (`assignOnPickUp`, off by default): for a label-only trigger, the issue is assigned to you when the work starts, so the team sees who has it. Like state labels, it writes to GitHub, so it is opt in. It skips issues that already have an assignee.

## How many start at once

Label ten issues on a Monday morning and ten sessions would start together. `maxAtOnce` says how many of this trigger's sessions (or pipeline runs) may be busy at the same time. The rest wait for a slot, oldest first, and show in Upcoming under the trigger, like queue items that start by itself.

- **In worktrees** each session has its own folder, so several at once is safe. The default is 3, and you can set 1 to 10.
- **In the project's folder** sessions would edit the same files, so it is always 1, and the field says why.
- **CI failures** don't pile up: a newer failure of the same workflow on the same branch replaces one that still waits.
- **`maxWaiting`** (default 10) caps the line. Beyond it, events are recorded as skipped, *12 more skipped, 10 already waiting*, and a script that prints 200 ids in one go can't fill your week.
- The focus limit and usage limits still apply on top, through the queue: a slot under `maxAtOnce` doesn't start a session past the focus limit.

## State labels

For **issues for you**, the trigger can keep a second label on the issue that says where the work is, so you and your team see it on GitHub without opening Switchboard. It is off by default, and turned on per trigger.

```ts
type StateLabels = {
  working: string;      // default "claude: working"
  needsYou: string;     // default "claude: needs input"
  done: string;         // default "claude: pr open"
  failed: string;       // default "claude: failed"
  /** Take the trigger label off when the work starts, so adding it again starts it again. */
  removeTrigger: boolean;   // default true
};
```

| When | The issue gets |
|---|---|
| The event is picked up (it may still wait for a slot) | `claude: working`, and the trigger label comes off (when the filter has one) |
| The session or a pipeline step needs you | `claude: needs input` |
| It goes on again | `claude: working` |
| A pull request is opened that closes the issue (`session_prs`) | `claude: pr open` |
| It ends with an error, is stopped, or the run stops for good | `claude: failed` |

- **One state label at a time**: setting one takes the others off, in one `gh issue edit --add-label … --remove-label …`.
- **Missing labels** are made with `gh label create` the first time, with a colour per state. Without the right to make labels, the trigger says so and runs without state labels.
- **They make the trigger safe on more than one computer**: an issue that already has a state label is skipped, so two Switchboards with the same trigger don't both start on it. A small race is left (two computers in the same minute); the first `gh issue edit` wins and the other one sees the label and stops before the session starts.
- **Starting again** is adding the trigger label again, or for an assignee-only filter, taking the state label off: either way the issue matches again and a new session starts.
- **Changed by hand**: when you take `claude: working` off on GitHub, Switchboard doesn't put it back. It leaves the issue alone until the next state change.

## Guardrails

A trigger starts work while you look elsewhere, from text other people wrote. That decides most of the rules:

- **Never `bypassPermissions`.** A triggered session runs in the mode you pick, but the editor doesn't offer bypass. Claude asks for permissions as always, and you get a notification.
- **Event text is context, not instructions.** Issue bodies, review comments, CI logs and command output go in as context blocks with the line GitHub context already uses. The trigger's own prompt is the instruction.
- **Issues from collaborators only** by default (`authorAssociation` is `OWNER`, `MEMBER` or `COLLABORATOR`). Only people with triage access can add a label by hand, but an issue template or a bot can add one for anyone who opens an issue. On a public repository, *anyone* can then mean a stranger starts a session on your computer. The editor says so when you pick it.
- **Nothing outward by default.** A trigger doesn't comment on the issue or push. [State labels](#state-labels) and Assign to me when picked up are the only things it writes to GitHub, and only when you turn them on. Anything else is for Claude to do in the prompt, where the permission prompt shows it.
- **Limits.** [How many start at once](#how-many-start-at-once), the focus limit and usage limits through the queue, and one session per event key.
- **Pause on repeat failure.** When a source fails five times in a row (gh signed out, the command exits non-zero), the trigger pauses with the reason, like a schedule whose folder is gone.

## Where triggers are saved

On this computer only, in the engine's database, like schedules: `triggers` and `trigger_events` (trigger id, event key, at, result, session id, reason), a migration, and a **Triggers** section in the settings file for backup and import (imported paused).

Not in `.switchboard.json` in phase 1: a file in the repository that starts sessions on everyone's computer is too much to accept by committing it. Later, a project could **suggest** triggers there, each turned on by hand.

## UI

- **Upcoming** gets a fourth filter: All | Queue | Schedules | **Triggers**. Each trigger shows its source, when it last looked, its last events and their sessions. History shows skipped events with why.
- **The project's page**: a **Triggers** tab, see [Set up on the project](#set-up-on-the-project).
- **New session**: **Start ▾ › Start when…** opens the trigger dialog with the current choices as what it starts, next to Schedule….
- **The command palette**: *New trigger…*, *Triggers: pick one…* (Check now, Edit…, Pause or Resume, Delete).
- **Session rows** started by a trigger get the bolt icon, and the header says which trigger and event, with a link to the run, issue or review.
- **Notifications**: *CI failed on main. Started "Fix test on main"*, and one for a paused trigger. They follow Settings › Notifications.
- **The remote app** shows triggers in Upcoming with Pause and Resume.

The palette commands, the project's Triggers tab, the Upcoming filter and the dialog need entries in `website/src/content/features.json`.

## Protocol

- `packages/protocol/src/triggers.ts`: the zod `Trigger`, `TriggerEvent` and the pure parts, without the engine: `issueQuery(match)` for the `gh` arguments, `newEvents(source, seenKeys, raw)` for each source's `gh` or command output, `eventKey`, `fillTriggerPrompt`, `slots(trigger, busy, waiting)`, `nextStateLabel(state, labels, current)`.
- RPCs: `triggers.list`, `triggers.save`, `triggers.remove`, `triggers.checkNow`, `triggers.pause`, `triggers.resume`. Events: `triggers.changed`, `triggers.fired`, `triggers.paused`.

## Engine

- **`packages/engine/src/triggers/`**: `triggerStore.ts`, `watcher.ts` and a file per source (`ciFailed.ts`, `issues.ts`, `changesRequested.ts`, `command.ts`).
- **`TriggerWatcher`** shares the Scheduler's timer and wake handling, or the two move to one `Clock` they both use. Each tick polls only the triggers that are due. A start goes through the path a schedule run takes, so the holds, the titles and the queue fallback are the same.
- **The first look** at a source records what is there as seen, without starting anything. Otherwise a new issue trigger would start a session for every old issue that matches.

## Edge cases

- **The computer sleeps** for a night: on wake, `missed: skip` records the night's events as missed. `missed: run` lets them wait for a slot like new events, still within `maxAtOnce` and `maxWaiting`.
- **The same event on two computers**: with Assigned to me, an issue is only one person's. For your own two computers, or a label alone, state labels decide (see [State labels](#state-labels)). For CI failures and issues without state labels, each Switchboard with the trigger starts a session, and the editor says so.
- **A force-push** on `main` changes the commit: a new event, which is right.
- **The issue is assigned to someone else** while its session works: the session goes on (stopping work is your call), and its header says *#57 is now assigned to mara-k*. The trigger doesn't pick the issue up again unless it matches again.
- **The label is removed and added again**: with state labels, that starts it again. Without them, the issue number was seen, so nothing starts; **Check now › Run for #57** starts it by hand.
- **gh is signed in to another account** than the repository needs: the source fails with gh's message, and pauses after five tries.

## Phases

1. **CI fails on a branch** and **issues for you** (label, assignee or both), starting a session, set up on the project's Triggers tab. State labels, Assign to me when picked up, how many at once, Upcoming's Triggers filter, the dialog, notifications and the guardrails above.
2. **Changes requested**, sent to the session that opened the pull request, and **a command** source.
3. **Start a pipeline** from a trigger (needs pipelines phase 1).
4. **Suggested triggers** in `.switchboard.json`, each turned on by hand. Maybe a webhook through the remote tunnel, after its own security review.

## Tests

- `triggers.test.ts` (protocol): `issueQuery` for each filter; `newEvents` for each source with real `gh --json` output, an issue assigned to you later, an assignee change, re-runs on one commit, a first look, label removed and added, `authors`; `slots(trigger, busy, waiting)` for `maxAtOnce`, `maxWaiting` and a newer CI failure replacing a waiting one; `nextStateLabel` for every session and run state, a label changed by hand and an issue that already has one; `fillTriggerPrompt`.
- `watcher.test.ts` (engine): due triggers only, label edits that fail for lack of rights, rate limited and offline `gh`, five failures pause, missed run and skip after a wake, focus limit and usage limit holds, a command that hangs past its timeout.
- Smoke: `smoke:demo` gets a demo trigger with two events in its history.

## Docs and website

A page `website/src/content/docs/new-session/triggers.mdx` next to Schedules, with the sidebar entry; Upcoming's page gets the Triggers filter; `features.json` entries; screenshots of the dialog, Upcoming's Triggers and a session row with the bolt.

## Decisions

- **Poll, don't listen.** A webhook needs a public address on your computer. Polling through `gh` works behind any firewall, uses the sign-in you have, and 5 minutes is fast enough for CI and issues. Deep links already cover the scripts that want to push.
- **Per computer, not per repository**, until suggested triggers. Turning one on is your choice, not a committer's.
- **A trigger never finishes the job alone.** It starts the work; pushing, commenting and merging stay with you or with a prompt that asks for permission.
