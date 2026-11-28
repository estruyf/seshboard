# The `seshboard` tools

Every session Seshboard runs that isn't read-only or an orchestrator gets Seshboard's `seshboard` MCP server (#374). Its tools let an agent start sessions and set up Seshboard's automation for you: "plan with Opus, build with Sonnet, review with a fresh Opus, then open a draft PR" becomes a saved pipeline, and "when an issue gets the `bug` label and is assigned to me, run it" a saved trigger. Read tools answer at once. Every tool that saves or starts something asks you on an approval card first, in every permission mode.

The same server serves Claude Code, Copilot, Codex and Antigravity: it is the orchestrator's script (`apps/desktop/src/orchestratorMcp/`) in the `session` role, and each call goes to the engine's `OrchestratorBridge` over a local socket with the session's token ([orchestrator.md](orchestrator.md#any-session-can-ask-to-start-one)). Agents outside Seshboard are #377 (a `seshboard` CLI), which replaces the `seshboard mcp` idea in #374.

## The tools

| Tool | Card | What it does | Built on |
|---|---|---|---|
| `start_session` | Yes | A new session for a separate task, here or on another paired computer (`computer`) | `createSession`, `computers.call` → `session.create` |
| `list_computers` | No | The paired computers, whether each is connected and has this project | `computers.status`, `projects.list` there |
| `usage` | No | What is left of the plan's limits for the session's profile, and whether a limit stops sessions now | `usage.get`, `limits.state` |
| `start_later` | Yes | A start after the usage limit resets (the queue, by itself) or at a time (a one-time schedule) | `later.add` (`queueHeld`), `schedules.save` |
| `find_sessions`, `read_session` | No | This project's other sessions by words, and a brief of one. Same project only | search, catch-up, session linking |
| `notify_me` | No | A push to the paired phone. At most one a minute and ten an hour per session | `RemoteHub.pushNote` |
| `hand_off` | Yes | A fresh session in the same folder, with the agent's brief and a link to this one, under it | `createSession`, session linking |
| `list_canvases`, `canvas_log`, `canvas_guide` | No | The project's canvases ([canvases.md](canvases.md)), the end of one's log, and how to write one | `CanvasHost.list`, `log`, `CANVAS_GUIDE` |
| `open_canvas`, `canvas_action` | No | Shows a canvas in the session's side panel, and runs one of its actions. A canvas runs only after you trusted it in its panel, which is the gate here | `CanvasHost.open`, `action` |
| `list_pipelines`, `get_run` | No | The pipelines the project can run (as `save_pipeline` takes them), and a run's state | `pipelines.list`, `runs.get` |
| `check_pipeline`, `check_trigger` | No | The editor's checks on a draft, without saving | `PipelineSave`, `TriggerSave`, `triggerProblem`, `pipelineProblem` |
| `save_pipeline` | Yes | A new pipeline or a change to one of yours. Built-ins are only copied | `pipelines.save` |
| `run_pipeline` | Yes | A run with a task, under this session or as a run row | `pipelines.run` |
| `list_triggers`, `list_schedules`, `list_actions` | No | The project's triggers (with their last events), schedules (with the next run) and actions | `triggers.list`, `schedules.list`, `actions.list` |
| `repo_info` | No | What a trigger needs: the gh login, default branch, workflows, collaborators and labels | `triggers.repoInfo`, `gh label list` |
| `save_trigger` | Yes | A trigger, saved paused unless you tick Start watching now | `triggers.save` |
| `save_schedule` | Yes | A schedule | `schedules.save` |
| `save_action` | Yes | A project action, its command in full; `shared` puts it in `.seshboard.json` and approves it for you | `actions.save` |
| `set_paused` | Yes | Pauses or resumes a trigger or schedule | `triggers.setPaused`, `schedules.setPaused` |
| `delete` | Yes | Deletes a pipeline, trigger, schedule or project action of yours | `*.delete` |
| `check_trigger_now`, `run_schedule_now` | Yes | Check now and Run now | `triggers.checkNow`, `schedules.runNow` |
| `run_action` | The first time | Runs a shell action in a terminal you see, in the session's folder, and returns its exit code and the end of its output. Allowed once, the session runs it again without asking (in memory, per action and command) | `actions.run`, the terminal's exit |
| `clean_worktrees` | Yes | Removes the project's worktrees whose branches are merged, with nothing uncommitted and no session working, and deletes their branches after a recovery ref | `worktrees.remove` |

An orchestrator keeps its own four tools and gets `run_pipeline` (a run row of its own, without a card, as its starts go), `get_run` and `list_computers` too; its `start_session` takes `computer`.

## The code

- `packages/protocol/src/seshboardTools.ts`: the catalogue. The specs, which tools are the core (`SESSION_CORE_TOOLS`) and which the automation (`AUTOMATION_TOOLS`), `toolsFor(role, set)`, the instructions. The save tools' schemas are the drafts' own (`z.toJSONSchema` of `PipelineSave`, `TriggerSave`, `ScheduleSave`, `ProjectAction`), so the MCP script imports the protocol's zod entry.
- `packages/engine/src/sessionTools/sessionTools.ts`: what each tool does. Everything comes in through `SessionToolsDeps`; `call` is the engine's own RPC handler, checked by the contract (`callRpc` in `engine.ts`), so a tool can't save what a window couldn't.
- `packages/engine/src/sessionTools/cards.ts`: each kind's card, pure.
- `apps/ui/src/components/session/PermissionCard.tsx` (`ApprovalPermission`) and `ApprovalCard.tsx`: the card. `apps/ui/src/components/approval/ApprovalEditorHost.tsx`: Open in editor.

## The approval card

`HostManager.askApproval` and `ProviderHosts.askApproval` (through `RoutedHostManager`) raise Seshboard's own card with `PermissionRequest.approval` (`ApprovalCard` in `host.ts`):

- **A preview** as lines, indented for a pipeline's steps: "Build · Sonnet · forked from Plan · accept edits". The title says what and which: `Claude Code wants to save a pipeline: "Plan, build, review"`.
- **Every prompt and command in full** (`blocks`), never cut: a step's prompt, a trigger's prompt, an action's command, a brief, a task.
- **Risky choices on their own lines, unticked** (`options`): open the pull request without me, approve a step's plan for me, run without stopping for me, state labels, assign to me, issues from anyone, and Start watching now for a new trigger. Only what the draft asked for shows, and what you leave unticked is saved off (`applyPipelineOptions`, `applyTriggerOptions`).
- **Never offered:** bypass permissions, on a pipeline step, a trigger or a schedule. The tool refuses it with the reason before any card.
- **Allow** (its label is the action: Save, Run, Delete), **Open in editor** where an editor fits, and **Deny** with the "tell it what to do instead" field, whose text goes back to the agent.
- **Open in editor** opens the pipeline editor (in a dialog), the trigger editor, the schedule dialog or the action editor, filled in from `card.draft` (`{ root, isNew, value }`, the value shaped as the editor reads a saved one). Saving there answers the card with `{ saved: { id, name } }`, and the tool returns what you saved; closing it denies the card. While it is open the card's buttons wait.
- **The editor starts where the card does:** with the risky choices off (`applyPipelineOptions` and `applyTriggerOptions` with nothing ticked), so turning one on is your own edit.
- The answer goes back as the decision's `updatedInput` (`ApprovalReply`); `approvalReplyOf` reads it.
- **Only in the session, on the computer, for now.** Phones, other computers and the VS Code companion don't list the card (`promptsFor` leaves out a request with `approval`), a push about it has no Allow (`promptAnswers`), and the menu bar has no Allow for it (`canAllow`). The session shows Needs you everywhere, so you know to go to it.

## Which tools a session gets

- **Every session that isn't read-only**, as `start_session` already was. Claude Code allows them up front (`SESHBOARD_TOOL_NAMES` in `allowedTools`), the other providers let Seshboard's own servers through: the card is the gate.
- **A project's setting** (its Settings tab, Seshboard tools in sessions; `ProjectDefaults.sessionTools`): Start sessions lists only the core tools, With automation (the default) all of them. Fewer tools leave context for agents without tool search. The engine picks the set from the session's folder when its server starts (`sessionsServer(sessionId, cwd)`), sets `SESHBOARD_SESSION_TOOLS=sessions` for the script, and the bridge refuses a tool outside the set.
- **Scope:** the session's own project. `project` names another one for the read tools, and the cards say which project.

## Decisions on the issue's open questions

- **The card has Save and Open in editor.** Save is faster, the editor is there for a change. A JSON view in the Files panel's editor was tried and dropped: one way to change a draft is enough.
- **No saves without a card,** for pipelines too: every change of configuration goes through one.
- **One `seshboard` server,** with the project's setting in place of a second server.
- **Approving on the phone comes later.** For now the card is answered on the computer only.

## Not yet

- A session on another computer reports no turns to the orchestrator that started it, and `read_session` can't read it from here.
- The link back on the other computer itself: its session shows who started it (the device), not which session.
- Agents outside Seshboard: #377.

## Tests

- `packages/engine/src/sessionTools/sessionTools.test.ts`: each tool against fakes, a save after Allow, nothing after Deny, the ticks, the editor's answer, a trigger saved paused, the refusals, `notify_me`'s limit, `run_action`'s first card.
- `packages/engine/src/orchestrator/orchestrator.test.ts`: the bridge per role and set, the remote start, the clone, the orchestrator's remote start.
- `apps/desktop/src/orchestratorMcp/server.test.ts`: the tools listed per role and set, and their schemas.
- Smoke: `npm run smoke:demo -- --only "seshboard tools"` answers the card of a demo pipeline save: Save, Open in editor, and Deny on a delete.
