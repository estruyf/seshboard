# Pipelines

A pipeline is a saved set of steps that Switchboard runs for one task, each step in its own **sub-session** under the session you started it from:

```
Add a usage cost toggle            ← the parent: where you set it off
├─ Plan        Opus · plan mode    ✓
├─ Execute     Sonnet · forked from Plan   ✓
├─ Validate    Opus · read only    ● running
└─ Push        commit, push, pull request   (waits for you)
```

The case that drives it:

> Plan it with Opus, build it with Sonnet, have a fresh session check the diff and the tests, then push and open a pull request.

Today you can do this by hand: start a session in plan mode, approve the plan, change the model, ask for a review in a new session, copy its findings back, then open Create pull request. "Start after this session" and the queue do part of it, but every queued item starts an unrelated session in the project's root, with nothing from the step before. A pipeline keeps the steps together under one parent, in one worktree, hands each step what the one before did, and stops when it needs you.

This note is the design. Phases 1 and 2 are built (see [Phases 1 and 2 as built](#phases-1-and-2-as-built)); one thing changed from the first version of this note: steps hand over with @ session links instead of briefs of their own (see [The handoff: @ links](#the-handoff--links)). Places in the code are named as they are on `dev` on 2026-10-20.

[← Back to the README](../README.md)

## What exists today, and what it means for this design

- **The queue** (`later_prompts`, `LaterDraft` in `packages/protocol/src/later.ts`) holds a prompt with its model, effort, permission mode, workspace and profile. `QueueWaitFor` can wait for a project, a session or another item, and `autoStart` starts it once that finishes cleanly (`QueueAutoStarter`, `packages/engine/src/later/autoStart.ts`). A queued item always **starts a new session** with `cwd` set to the project's root, and with `workspace: 'worktree'` it makes a new worktree instead of using the last step's.
- **How a session ended** is known for sessions Switchboard runs: `SessionOutcome` (`clean`, `error`, `stopped`, `quit`). The ready rules in `packages/protocol/src/queueStates.ts` already deal with the focus limit and usage limits.
- **Forks** exist (Fork from here, *Fork session…*, `sessionHost.ts`): a new session with the conversation up to a message. A forked child keeps the parent's context and its prompt cache, and is still its own session.
- **Briefs** from session linking (`packages/engine/src/links/brief.ts`, `buildBrief`) describe a session: folder, branch, pull request, catch-up and last reply. The engine expands a `session` stub into a brief right before Claude reads the prompt.
- **Read only** answers exist for Ask about this session: the `isReadOnlyTool` hook (`host/sideQuestions.ts`).
- **The catch-up** (`packages/engine/src/catchUp/`) says how a turn ended without a model: tests, diff size, files outside the ask, plan followed or not, and whether Claude waits for an answer (`need`).
- **Project actions** run a command or ask Claude (`docs/project-actions.md`), and can be shared in `.switchboard.json`.
- **Commit and pull requests**: Ask Claude to commit (with a Haiku message from the diff), Create pull request (`packages/engine/src/git/pullRequest.ts`), the checks watcher (`prChecks.ts`) and Fix failing checks with Claude.
- **The sidebar is flat**: sessions are grouped by project, and a session has no parent. Forks show as unrelated rows.

So most parts exist. What is missing is a parent that owns its sub-sessions, the tree in the sidebar, one shared folder, and the handoff between steps.

## The flow, worked through

You have been talking with Claude in the session **Add a usage cost toggle** about what the toggle should do. Now you want it built. In the session's **⋯** menu you pick **Run pipeline › Plan, execute, validate, push**. That session becomes the parent.

1. **Plan** starts as a sub-session in a new worktree, with Opus at high effort, in plan mode. Its prompt is a brief of the parent (so the plan knows what you two discussed) and *Plan this. Don't edit files.*
2. Claude proposes a plan. The plan card shows in the Plan sub-session and the parent turns to Needs you. You approve it. The step is done once the turn after the approval ends cleanly.
3. **Execute** is a **fork of Plan**, with Sonnet and Accept edits: *Build the plan you just made. Run the tests.* Being a fork, it has the plan and every file Plan read, and it reuses the cache, so nothing is copied or read again.
4. **Validate** starts **fresh** in the same worktree, with Opus, **read only**. First it runs the project actions *Test* and *Lint*; their exit codes and the last lines of their output go into its prompt with a brief of Execute and *Check the diff against main and the results above. End with `Verdict: pass` or `Verdict: changes needed` and the list.*
5. The verdict is *changes needed*. The list goes to the Execute sub-session as a message, and when that turn ends, a new **Validate · round 2** starts fresh. This time it passes. After two rounds without a pass, the run stops for you.
6. **Push** waits for you: the parent shows **Push** with the commit message (from the diff, as Ask Claude to commit writes it) and the pull request's title and body (from the plan and the verdict). **Push and open pull request** commits, pushes and opens it.

The parent's transcript gets a row for each step as it ends (*Plan approved*, *Validate: changes needed, sent to Execute*, *Pull request #152 opened*). Those rows are for you and are not sent to Claude. The next time you write in the parent, Claude gets a brief of the run first, so you can ask it *what did the review find?* there.

## The tree

- **The parent** is the session you start a pipeline from. From New session (**Start ▾ › Run pipeline**), there is no conversation yet, so the parent is a **run row**: it holds the task and the tree, and has no Claude session of its own until you write in it.
- **Sub-sessions** are ordinary Claude Code sessions, with `parentId` set in Switchboard's database. You can open, read, reply in and stop any of them as you do now. Claude Code doesn't know about the tree.
- **In the sidebar** the parent row shows the run's progress, *Validate · 3 of 4*, and a chevron. Open, its sub-sessions show under it, indented, in step order, rounds included. Closed by default. The parent's status is the most urgent of its own and its children's: a child that needs you makes the parent Needs you.
- **The parent's view** shows the step tree above the conversation: each step with its model, its state and its catch-up's one line. Click a step to open its sub-session. The buttons for the run are there: **Continue**, **Run this step again**, **Skip this step**, **Stop the run**.
- **Sub-session headers** say *Execute · step 2 of Plan, execute, validate, push* with a link back to the parent.
- **Forks later**: `parentId` is not only for pipelines. Fork from here could put the fork under the session it came from, with the same tree. Out of scope for this design, but the field allows it.

## The model

```ts
/** One step of a pipeline. Each step runs as one sub-session (one per round for a step that repeats). */
type PipelineStep =
  | {
      kind: 'claude';
      name: string;                   // unique in the pipeline; `parent` is taken
      prompt: string;                 // with {{task}}, @parent and @<earlier step>
      /** A new session, or a fork of an earlier step's latest sub-session, which keeps its context and cache. */
      start: 'fresh' | { fork: string };
      model: string | null;           // null: the project's default
      effort: Effort | null;
      permissionMode: PermissionMode | null;
      /** Only tools that read (`isReadOnlyTool`). Plan mode would end in a plan to approve. */
      readOnly: boolean;
      /** Project actions run before Claude starts, by name; exit codes and output tails go in the prompt. */
      actionsFirst: string[];
      /** The step ends with a verdict. On "changes needed", the list goes to `sendTo` and the step runs again. */
      verdict: { sendTo: string; rounds: number } | null;   // rounds 1 to 5
      /** The run waits for you (Continue) before this step starts. */
      confirmBefore: boolean;
    }
  | { kind: 'push'; name: string; draft: boolean };

type Pipeline = {
  id: string;
  name: string;
  /** This project, or All projects. Shared with the project (`.switchboard.json`) is phase 3. */
  scope: { kind: 'project'; root: string } | { kind: 'all' };
  steps: PipelineStep[];
  /** Push without asking. Only for your own pipelines: ignored in `.switchboard.json`. */
  autoPush: boolean;
};
```

- **Two kinds of step.** A `claude` step is a sub-session. A `push` step is Switchboard's own: commit, push and Create pull request, no model. Actions run inside a `claude` step (`actionsFirst`) rather than as steps of their own, so their results always reach a model that can read them.
- **Fork or fresh.** Execute forks Plan, because building needs everything planning learned. Validate starts fresh, because a reviewer that shares the author's context grades its own work.
- **One folder.** A run makes one workspace when it starts: a new worktree from the parent's branch, or the parent's worktree when it has one. Every step runs in it; sub-sessions never make their own.
- **The verdict** is read from the step's last reply, `Verdict: pass` or `Verdict: changes needed` (any case, in bold or code too), with the list after it (`readVerdict`). No verdict line stops the run, so a confused reviewer never lets work through.
- **No branches or loops** beyond the verdict's rounds. See [Decisions](#decisions).

## The handoff: @ links

Steps hand work to each other with session linking ([session-linking.md](session-linking.md)), so there is one mechanism for it:

- A step's prompt can say `@parent` and `@<step>`, for example `@Plan` or `@Execute`. `pipelineIssues` refuses a name that isn't a step before this one.
- When the step starts, `fillStepPrompt` turns each into a real session link: the same `switchboard-session` stub the message box writes when you pick a session with @, pointing at the parent's session or that step's latest sub-session. The label stays in the text: "@Add a usage cost toggle", "@Execute".
- The engine expands the stubs into briefs right before Claude reads the prompt, as it does for any message (`LinkService.expand`). The step's prompt card then shows the "Linked:" row and "What Claude got", like any linked session.
- **Briefs have a `plan` field:** the approved `ExitPlanMode` input. A step that links `@Plan` gets the plan. When you approve the plan in a plan step, the step keeps it, and Claude is told not to build it (the next step does): the approval goes to Claude Code as an answer that says so, and the turn ends.
- **A run row** (a run started from New session, with no conversation yet) has no session to link: `@parent` brings a short block with the task text.
- **Fork steps** keep the context of the step they fork from. They still link `@parent`, so the task is always in the prompt.
- **Validate's changes.** When Validate sends changes back to Execute, the message sent to Execute lists them and links `@Validate`, so Execute gets the verdict in its brief too.
- The brief budget holds: 4,000 characters per brief, 12,000 per message. The task and the plan are never dropped to fit; a plan that alone is too long is cut, last.
- **The run's brief.** When you write in the parent, the message box puts a `switchboard-run` stub before your text, which the engine expands into a brief of the run: each step with its state, its verdict and its reason, and the pull request (`writeRunBrief`). A run row you write in gets a session of its own, in the run's folder, with the same brief first.

## When a step is done, and when the run stops

A step is done when its last turn ends with outcome `clean` **and** the catch-up doesn't say Claude waits for you (and, for a step with a verdict, the verdict is *pass*). Then the next step starts by itself, through the same holds as the queue: it waits for a free slot at the focus limit and for the reset at a usage limit.

The run stops at the step, and the parent turns to Needs you, when:

- the outcome is `error`, `stopped` or `quit`;
- Claude asks a question or waits for a permission;
- a verdict is still *changes needed* after its rounds, or missing;
- the next step is in `confirmBefore`, or is a push step.

You can reply in the sub-session that stopped: when that turn ends cleanly, the run goes on by itself. Quitting Switchboard pauses a run; it resumes when the app opens again.

When a verdict is still *changes needed* after its rounds, there are two ways on besides Continue (which goes on without the changes):

- **Another round** sends the changes to the step the verdict names, as the rounds before did, and the step with the verdict checks again when that turn ends. Stopping again offers another round again, so each extra round is yours to start (`runs.anotherRound`, `outOfRounds`).
- **By hand**: a turn you take in that step (Execute) starts the next round when it ends cleanly and Claude doesn't wait for you. Asking the reviewer what it needs first keeps its verdict: a reply without a verdict line doesn't replace the last one.

## Where pipelines are saved

Like saved prompts and actions: **This project**, **All projects**, or **Shared with the project**, which writes them to `.switchboard.json` under `pipelines`:

```json
{
  "pipelines": [
    {
      "name": "Plan, execute, validate, push",
      "workspace": "worktree",
      "steps": [
        { "kind": "claude", "name": "Plan", "prompt": "{{task}}\n\nPlan this. Don't edit files.", "start": { "kind": "fresh" }, "model": "claude-opus-5-5", "effort": "high", "permissionMode": "plan" },
        { "kind": "claude", "name": "Execute", "prompt": "Build the plan you just made. Run the tests.", "start": { "kind": "fork", "step": "Plan" }, "model": "claude-sonnet-5-5", "permissionMode": "acceptEdits" },
        { "kind": "claude", "name": "Validate", "prompt": "Check the diff against main and the results above. End with Verdict: pass or Verdict: changes needed, and the list.", "start": { "kind": "fresh", "briefOf": ["Execute"] }, "model": "claude-opus-5-5", "readOnly": true, "actionsFirst": ["Test", "Lint"], "verdict": { "sendTo": "Execute", "rounds": 2 } },
        { "kind": "push", "name": "Push", "commit": true, "pullRequest": { "base": null, "draft": false } }
      ],
      "confirmBefore": []
    }
  ]
}
```

A pipeline from a shared file comes from whoever can commit to the repository, so:

- **No `bypassPermissions`** in a shared pipeline. The editor refuses it, and a file that has it gets `default` for that step, with a warning.
- **A shared pipeline never pushes without you**: `autoPush` is ignored from the file.
- **The first run shows every step** (prompt, model, mode, the commands of its actions) and asks you to start it. After that it starts without asking until the file changes that pipeline.

## UI

- **A session's ⋯ menu**: *Run pipeline ›* with the project's pipelines. The session becomes the parent.
- **New session**: **Start ▾ › Run pipeline ›**. What you typed fills `{{task}}`; the parent is a run row. The Where, model and mode pickers grey out, with "Set by the pipeline".
- **The command palette**: *Run pipeline…*, then the pipeline, then the task. *Pipelines: pick one…* to edit, duplicate or delete.
- **The sidebar and the parent's view**: see [The tree](#the-tree).
- **Settings › Pipelines**: the list and the editor. The editor shows the steps as the tree they make, each a card with the fields above, dragged to reorder. **Duplicate** a built-in to start.
- **Upcoming**: runs that wait for a slot or a reset show under Queue.
- **Built-in pipelines**: *Plan, execute, validate, push* (as above) and *Execute and validate* (no plan step).

All copy follows AGENTS.md › Copy. New palette commands and the Settings section need entries in `website/src/content/features.json`.

## Protocol

- `packages/protocol/src/pipelineSchema.ts`: the zod `Pipeline`, `PipelineStep`, `PipelineSave`, `PipelineRun` (`id`, `pipelineId`, a snapshot of the pipeline, `parentSessionId` or null for a run row, `task`, `cwd`, `status: 'running' | 'waiting' | 'stopped' | 'paused' | 'done'`, `waitingFor: 'you' | 'confirm' | 'push'`, `reason`, `hold`, `step`, `round`, `sentBackTo`, `pr`), `PipelineRunStep` (`runId`, `step`, `index`, `round`, `sessionId`, `status`, `outcome`, `verdict`, `reason`, `plan`, `actions`), `PushPreview` and `PipelineNotice`.
- `packages/protocol/src/pipelines.ts`, plain TypeScript for the UI too: the built-ins, and the pure rules `nextStep` / `enterStep`, `readVerdict`, `fillStepPrompt`, `changesMessage`, `pipelineIssues`, `sidebarTree`, `runProgress`, `writeRunBrief` / `parseRunBriefs`, `writeActionResult` / `parseActionResults`.
- `SessionSummary` gets `parentId` (a session or a run), so the sidebar can nest any session.
- RPCs: `pipelines.list`, `pipelines.save`, `pipelines.delete`, `pipelines.restore`, `pipelines.run` (pipeline id, and a parent session id, or a task and a project), `runs.list`, `runs.get`, `runs.continue`, `runs.retryStep`, `runs.skipStep`, `runs.stop`, `runs.pushPreview`, `runs.write`. Events: `pipelines.changed`, `runs.changed`, `runs.notice` (for main's notifier).

## Engine

- **`packages/engine/src/pipelines/`**: `pipelineStore.ts` (the built-ins and your pipelines), `runStore.ts` (`pipeline_runs`, `pipeline_run_steps`, and `session_parents`, one migration, all user data that survives a cache rebuild), `runner.ts`, `actionsFirst.ts` and `push.ts`.
- **`PipelineRunner`** hears the same session outcomes as `QueueAutoStarter`, with the turn's catch-up, and uses the same holds: a free slot under the focus limit, the reset of a usage limit. A `fresh` step is a new session in the run's folder (`HostManager.create`); a `fork` step forks the named step's latest sub-session (`HostManager.fork`) with its own model, effort and mode. A read-only step gets the `isReadOnlyTool` PreToolUse hook, and keeps it when it resumes. `actionsFirst` runs the project's actions headless in the run's folder and keeps the last 40 lines of each.
- **Push** commits (with Haiku's message from the diff, as Ask Claude to commit writes it, or yours), pushes and opens the pull request with the existing code (`git/pullRequest.ts`); its title and description come from the task, the plan and the last verdict.
- **Quitting** pauses every run that goes on. At the next start a step that was working gets a message to go on; it never picks up in the middle of a turn.

## Edge cases

- **You change the model in a sub-session by hand**: the run doesn't change it back. Later steps use their own.
- **You close or delete a sub-session**: the run stops at that step, with "The Execute session was closed". Deleting the parent stops the run and asks whether to delete its sub-sessions too.
- **The worktree is removed** while a run waits: the run stops, like a schedule whose folder is gone.
- **A shared pipeline names an action that doesn't exist** on this computer: the editor shows it, and the step runs without it and says so in its prompt.
- **Two runs in one project** at once is fine with `workspace: 'worktree'`. With `current`, a second run waits for the first, like an item waiting for the project.
- **Other computers**: a run belongs to the computer it started on. The remote app shows the tree and the run's buttons, and doesn't start runs in phase 1.

## Phases 1 and 2 as built

- Everything in [The tree](#the-tree), [The model](#the-model) and [The handoff: @ links](#the-handoff--links), the stop rules, verdicts and rounds, `actionsFirst`, `confirmBefore`, the Push step and the run's brief.
- **Ways in:** a session's ⋯ menu (**Run pipeline ›**, with **Edit pipelines…**), New session's **Start ▾ › Run pipeline ›**, and the palette's **Run pipeline…** and **Pipelines: pick one…**.
- **Settings › Pipelines**: the list (Built in, All projects, one group per project) and the editor, with the steps as cards on a rail, the tree they make, and `pipelineIssues` inline.
- **Notifications** through main's notifier: a run that waits for you without a session asking, one that stopped, one that is done. A step's own turns give no Finished notification; a step that needs you or fails says so as any session does.
- The `pipeline` theme token for the pipeline icon and step kinds; violet stays away from states.
- Not yet: shared pipelines (phase 3), side by side (phase 4), starting a pipeline from a trigger, forks outside pipelines going under their parent, a run noticing that its worktree was removed while it waits, and the remote app's view of runs. A sub-session closed in the middle of a turn stops its run, as a stop does.

## Phases

1. **The tree.** `parentId`, the nested sidebar, the parent's step tree and the run row. `claude` steps with `fresh` and `fork`, one shared folder, the stop rules. Saved for this project or all projects. The built-in without Validate's actions and verdict.
2. **Validate and push.** `actionsFirst`, verdicts and rounds, the `push` step, `confirmBefore`, and the parent's brief of the run.
3. **Shared pipelines.** `.switchboard.json`, the rules for shared files, Settings › Pipelines' import and duplicate.
4. **Side by side.** A step that runs N sub-sessions at once in their own worktrees (best of N), and a step that picks one. The tree already has room for it.

## Tests

- `pipelines.test.ts` (protocol): `nextStep` for every outcome, catch-up `need` and verdict, rounds and their limit, `confirmBefore`; `readVerdict` with a missing, misspelled or doubled verdict line; `fillStepPrompt` with @ links, a run row's task and actions; `pipelineIssues`; `sidebarTree` with nested children, rounds, a run row and a parent whose child needs you.
- `runner.test.ts` (engine): a run through every step kind with a fake host; a fork step; a failed verdict going back to Execute; focus limit and usage limit holds; quit and resume; a closed sub-session; a removed worktree.
- Smoke: `smoke:demo` gets a demo run with a parent and three sub-sessions, stopped at Push.

## Docs and website

A page `website/src/content/docs/sessions/pipelines.mdx` and the sidebar entry, a section in `projects/actions.mdx` on `pipelines` in `.switchboard.json`, `sessions/sidebar.mdx` for nested rows, `features.json` entries for the palette commands and Settings › Pipelines, and screenshots of the tree in the sidebar, the parent's view and the editor.

## Decisions

- **One sub-session per step**, not one session that changes model between steps. Each step can be opened, read and stopped on its own, the tree shows where the run is, and a fork keeps the context where it matters. A run costs a few more sessions in the list; the tree keeps them out of the way.
- **Name.** *Pipeline* is the word people know from CI. *Recipe* or *Playbook* sound softer but say less. Open.
- **No branches or loops beyond verdict rounds.** A pipeline you can read top to bottom is one you trust to run alone. People who need more can chain pipelines with triggers ([event-triggers.md](event-triggers.md)).
- **Push waits for you by default.** Pushing is outward-facing; a run should never do it before you have seen the diff, unless you set `autoPush` on your own pipeline.
