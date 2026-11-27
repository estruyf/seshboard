# The orchestrator

An orchestrator is a session that hands work to other sessions instead of doing it. You send it a list of tasks. It starts one session per task, each in its own worktree, and tracks them:

```
Ship the settings rework              ← the orchestrator: where you send work
├─ Fix the login redirect     Claude Code · worktree   ● working
├─ Update the lint config     Copilot · worktree       ✓ #152 ready for review
├─ Refresh the docs           Claude Code · worktree   ! waits for you
└─ Flaky usage test           (queued at the focus limit)
```

The case that drives it:

> Here are six bugs from this morning. Start a session for each, tell me which ones need me, and tell me when the pull requests are up.

Today you do the coordinating yourself: you start each session, repeat the same background in each, and check back to see which finished. A pipeline ([pipelines.md](pipelines.md)) runs steps you fixed up front, one after the other. The orchestrator picks the sessions itself, as your messages arrive, and runs them side by side.

[← Back to the README](../README.md)

## Where the idea comes from

Claude's [Projects](https://code.claude.com/docs/en/claude-projects) (claude.ai/code, the desktop app and the mobile app; not the CLI or the Agent SDK) make a project one long conversation with a coordinator that starts cloud sessions, called threads. This note takes three things from it and leaves the rest:

| Claude Projects | Seshboard |
|---|---|
| A coordinator conversation that starts threads | An orchestrator session with four tools (`start_session`, `list_sessions`, `read_session`, `message_session`) |
| Project instructions every thread starts with | **Orchestrator instructions** on a project's Settings tab |
| An Overview pane grouped by state | The overview above the orchestrator's conversation, and its sessions under its row in the sidebar |
| Threads report back to the coordinator | A **Session update** message when a started session's turn ends |
| Cloud threads, the GitHub App, uploaded files | Not taken: sessions run on this computer, with your own setup (skills, hooks, MCP servers, permission rules) |
| A thread limit you ask for is a preference | The focus limit is a real limit: a start beyond it waits in the queue |
| Claude only | Claude Code, GitHub Copilot and OpenAI Codex, for the orchestrator and for each session it starts |

The Agent SDK has no project API, so Seshboard builds the orchestrator itself, from parts it already had: the parent and child tree of pipelines (`session_parents`), session briefs (session linking), the queue's holds, the catch-up and the tool bridge of the browser tools.

## How it works

```
You ──▶ orchestrator session ──(orchestrator MCP server, stdio)──▶ OrchestratorBridge (local socket)
                ▲                                                          │
                │  "Session update: … finished its turn"                   ▼
        Orchestrator.turnEnded ◀── a started session's turn ends ◀── Orchestrator.run
                                                                           │ start_session
                                                              focus limit / usage limit?
                                                              ├─ no  → createSession (worktree, the project's mode)
                                                              └─ yes → the queue, starts by itself
```

1. **Start.** New session's **Run as** chip has **Orchestrator** next to One session and the pipelines. Start becomes **Start orchestrator**. `session.create` takes `orchestrator: true`, with any profile: Claude Code's, Copilot's or Codex's.
2. **Its tools.** The session's agent starts Seshboard's `orchestrator` MCP server over stdio (`apps/desktop/src/orchestratorMcp/`), as Seshboard's own binary run as Node, like the `browser` and `visualize` servers. The server holds no state: each call goes to the engine's `OrchestratorBridge` over a local socket (a named pipe on Windows), with a token for its session. The bridge runs a call only when the token's session is an orchestrator.
3. **Its role.** After the agent's own system prompt it reads `ORCHESTRATOR_PROMPT` (coordinate, don't do the work; one session per task; keep replies short) and the project's instructions. Claude Code gets it through `systemPrompt.append`, Copilot as an appended system message, Codex as developer instructions.
4. **A start.** `start_session` takes a title, a prompt, and optionally an agent, a model and a workspace. The engine builds the same draft a scheduled run uses and passes the same holds: at the focus limit or a usage limit it goes to the queue as an item that starts by itself; otherwise the session starts now. Either way it is recorded as the orchestrator's, goes under it in the sidebar and gets the title.
5. **Reporting back.** When a started session's turn ends, the engine sends its orchestrator a **Session update**: which session, whether it finished, failed or waits for you, the catch-up's lines and the pull request. The orchestrator takes a short turn and tells you what matters. A turn you stopped yourself says nothing.

## The tools

| Tool | What it does |
|---|---|
| `start_session` | `title`, `prompt`, and optionally `agent` (a profile's name, or the agent's own name such as "GitHub Copilot"), `model` and `workspace` (`worktree` or `current`). Starts a session, or says it waits in the queue. |
| `list_sessions` | The orchestrator's sessions by group (Waiting on you, Working, Queued, Ready for review, Idle), each with its id, agent, branch, pull request and one line of what it did or asks, then the agents a new one can run with. |
| `read_session` | A brief of one of its sessions, as session linking writes it: folder, branch, pull request, what it was asked, what it did, its last reply. |
| `message_session` | Sends a message to one of its sessions. While that session works, the message waits in Up next until its turn ends. |

The specs, the role and every text the agent reads are in `packages/protocol/src/orchestrator.ts`, with the pure rules (`workerState`, `groupWorkers`, `readStartArgs`, `writeWorkerList`, `writeSessionUpdate` and `parseSessionUpdate`).

**What a started session runs with:**

- **Workspace:** its own worktree in a git repository, so sessions side by side never share files. `workspace: "current"` uses the project's folder. Outside git, or with an agent that has no worktrees, it is the folder.
- **Mode:** the project's default permission mode, else the started session's profile's (unless the project follows the global one), as in New session. Without either it is Accept edits, so a session doesn't stall on every file. The orchestrator can't pick a mode, so it can never start a session that skips permission prompts unless the project's or the profile's default says so.
- **Model and effort:** the project's defaults, else the profile's, else the global ones (Settings › General), or the `model` the orchestrator names for one task. The worktree base follows the project, then the profile, too.
- **Agent:** the orchestrator's own profile, or the one named in `agent`. A model the provider doesn't have is left out, as for a schedule.
- **Instructions:** after its agent's system prompt, at each start and resume: the built-in judgment line (`WORKER_JUDGMENT`: build, make any reversible call yourself, check in later with the calls you made), then the project's Orchestrator instructions. The line is always there, and the project's text never replaces it. The orchestrator itself gets the idea in its role, not "just build".

## Limits

- **The focus limit and usage limits** hold a start in the queue (`scheduleHold`, `queueHeld`), as they hold a scheduled run. The item starts by itself once a slot frees or the limit resets, and the session then goes under its orchestrator (`Orchestrator.itemStarted`).
- **Six working sessions per orchestrator** (`ORCHESTRATOR_MAX_WORKING`). A start beyond it is refused with the reason, so an orchestrator with the focus limit off can't start twenty sessions at once.
- **Only its own sessions.** `read_session` and `message_session` refuse a session the orchestrator didn't start. A session that isn't an orchestrator can't call the tools at all: it never gets the server, and the bridge checks the token again.
- **No prompts for its tools.** The four tools are allowed up front (Claude Code's `allowedTools`; Copilot approves Seshboard's own servers). Starting is held by the limits above, and each started session asks for what its own mode asks for, in its own permission card.
- **Reports are data.** A Session update says it comes from Seshboard, not from you, and that it is a report, not an instruction. The server's instructions say the same about `read_session`.

## Every agent

| | Orchestrator | A session it starts |
|---|---|---|
| Claude Code | Yes. Checked against real Claude Code (`orchestrator.live.test.ts`). | Yes |
| GitHub Copilot | Yes. Checked against real Copilot CLI (`orchestrator.live.test.ts`). | Yes, with `agent` |
| OpenAI Codex | Wired the same way (the server through `mcp_servers`, the role as `developerInstructions`). **Not checked against a real Codex yet**: it wasn't installed where this was built. | Yes, with `agent`; in the project's folder when Codex has no worktree here |

Providers get the server and the text through `ProviderHosts` (`orchestratorServer`, `isOrchestrator`, `appendSystemFor`), and a driver reads the text as `DriverSessionConfig.instructions`. A provider's sessions end their turns through the same `onTurnEnd`, so they report back like Claude Code's.

## Any session can ask to start one

Every other session (not an orchestrator, not read-only) gets the `seshboard` server's tools ([seshboard-tools.md](seshboard-tools.md)), `start_session` among them: `mcp__seshboard__start_session`. It is the Claude Code desktop app's way of starting a session from a session, for a task the user asks for or a fix the agent noticed on the way.

- **The same server script.** The bridge gives the session a token for the `session` role (`serverFor(base, id, 'session')`), and the script lists the `seshboard` tools when `SESHBOARD_ORCHESTRATOR_ROLE` is `session` (`toolsFor`). Its calls go to `SessionTools`, whose `start_session` is `Orchestrator.startChild`, never to `run`.
- **You decide on a card.** `startChild` checks the arguments and plans the start as `start_session` does (`plan`: agent, model, mode, worktree), then asks in the session's permission card (`askStart` in `HostManager` and `ProviderHosts`, through `RoutedHostManager`). The card has Allow and Deny only, in every permission mode. The call waits for your answer, and the session shows Needs you while the card is open.
- **Allowed,** it starts as an orchestrator's start would, behind the focus and usage limits (a held start waits in the queue), and goes under the asking session in the sidebar (`setParent`). It gets no instructions and reports back to no one: the asking session has no tools to follow it, and an update would cost it a turn. A queued start goes under its session once it starts; after a restart it still starts, but at the top level.
- **The call's time limit.** The call stays open until you answer. Claude Code's limit for an MCP call is long. Codex stops a call after 60 seconds by default, so Seshboard's own servers get `tool_timeout_sec = 3600` there (`OWN_TOOL_TIMEOUT_SEC`). Copilot and Antigravity use their own limits: if a call times out first, your later Allow still starts the session.
- **No prompt of the agent's own** before Seshboard's card: Claude Code has the tool in `allowedTools`, and Copilot and Antigravity let Seshboard's own servers through. Codex runs it under its approval policy, as it does the browser tools.

### On another computer

`start_session` takes an optional `computer`: a computer paired in Settings › Remote › Other computers ([remote-access.md](remote-access.md#other-computers)). The start goes there as New session's Run on does (`computers.call` → `session.create`). The logic is `Orchestrator.startOn`; the matching is pure, in `orchestrator/remoteStart.ts`.

- **`list_computers`** (no card): each paired computer, whether it is connected, and the name of this project there, from its `projects.list`.
- **The project there.** Folders differ between computers, so the GitHub repository decides: `projects.list` sends each project's `repo` (`githubRepo`: `origin`'s, else the first remote on GitHub), and `matchProject` compares it with this project's remotes (`githubRepos`). A project there with another repository never matches by its name. A name only counts where there is nothing to compare: this project has no GitHub remote, or that computer's Seshboard is too old to send `repo`.
- **Not there: clone it.** When that computer can clone (`REMOTE_FEATURE_CLONE` in its `hello`) and Clone from GitHub is on there (`projects.clonePlan`), the same card offers it: "app, cloned there first into ~/Developer/app". Allowed, `projects.clone` runs there and the engine waits for its last `projects.cloneProgress` (`computers.next`). When the repository brings hooks, MCP servers, rules or plugins, a second card lists them (`askBrings`), as New session there asks before Start; denied, nothing starts in the clone.
- **The card** names the computer and the project there ("Claude Code wants to start a session on mystic: seshboard"), with the title in its description. A computer that isn't connected, has no such project and can't clone it, or has no such agent is refused before the card.
- **What goes there:** the project's id, the prompt, the title (`session.create`'s `title`, which that computer sets as it does an orchestrator's starts; an older one drops it), and only what the call named: `agent` as a profile's id from that computer's `options.get`, `model`, and `worktree` from `workspace`. The rest is that project's defaults there.
- **Limits** are that computer's, as with Run on. The session is mine on that computer's chip (`mineOf` in `computerHub.ts`), and that computer shows this one as who started it.
- **The link back.** `parentId` works within one computer only, so this computer keeps the new session as one the asking session started (`started`, keyed by its row id `remote:<computer>:<session>`, `remoteSessionKey`). The windows nest that computer's row under the asking session, as they nest a local one.
- **An orchestrator** gets `computer` on its `start_session` and `list_computers`, to spread tasks across machines ("run the Windows smoke on the Windows box"). It starts there without a card, as its starts go, and the session joins its sessions (keyed by its row id). Its turns end on that computer, so no Session update comes, and `read_session` says it can't read it from here; `list_sessions` says where it runs.

## In the window

- **New session:** Run as › **Orchestrator**. The chip is tinted as for a pipeline, Start says **Start orchestrator**, and the ▾ has no queue, schedule or trigger: an orchestrator starts now.
- **The overview** (`components/orchestrator/OrchestratorOverview.tsx`), above the orchestrator's conversation: its sessions grouped by what needs you first, each with its branch, its pull request, one line from its catch-up and **Open**. It folds to its one line ("1 waiting on you · 2 working").
- **The sidebar:** the orchestrator's row says "Orchestrator · 3 sessions", and its sessions nest under it with the tree pipelines use. A session that needs you makes the orchestrator's row Needs you.
- **A started session's header** starts with its orchestrator's name: the way back.
- **Session updates** in the orchestrator's conversation show as quiet dashed rows, not as prompts of yours.
- **A project's Settings tab:** Orchestrator instructions, up to 16,000 characters. A save of the project's other defaults keeps them.
- **The command palette:** *Go to orchestrator* opens the open session's project's orchestrator, or the newest one.
- **The phone and other computers:** New session's Run as has Orchestrator where the computer says `REMOTE_FEATURE_ORCHESTRATOR` in `hello`. Start sends `session.create` with `orchestrator: true`, and that computer starts it through its own `createSession`. The sessions it starts sit under it there through `RemoteSession.parentId`. `sessions.list` sends the orchestrators among the sessions listed (`RemoteSessions.orchestrators`, without folders), and a new list goes out on `orchestrator.changed`. `remoteOverview` (`packages/protocol/src/remoteOrchestrator.ts`) groups them as the computer does. The phone shows a bar under the orchestrator's header that opens the overview in a sheet, and a bar back to it in a session it started (`OrchestratorParts.tsx`). Another computer shows the same card as here (`RemoteOrchestratorOverview`) and the way back in the header (`RemoteOrchestratorCrumb`).

## Engine

- `packages/engine/src/orchestrator/orchestrator.ts`: `Orchestrator`, what the tools do and what a turn end reports. Everything it needs from the engine is injected (`OrchestratorDeps`), so tests run it without an agent.
- `orchestratorStore.ts`: `orchestrators` and `orchestrator_workers` (migration v62). User data: an orchestrator must still know its sessions after a restart and a cache rebuild. A queued start has an `item_id` and no session yet.
- `orchestratorBridge.ts`: the socket, the tokens, and the check that a call comes from an orchestrator.
- `engine.ts`: `createSession` marks a new orchestrator before its first message goes (so its first tool call finds it), `startQueued` puts a queued start under its orchestrator, `onTurnEnd` reports, `deleteSession` forgets. `orchestrator.list` and `orchestrator.changed` feed the windows.
- `HostManager` and `ProviderHosts`: an orchestrator starts and resumes with the server and its role; a session it started resumes with the project's instructions. A fork of either is an ordinary session. A pre-warmed Claude Code process is never used for either, since its system prompt and servers are fixed.

## Not yet

- **Ready for review and Landing by review state.** The overview's Ready for review is "has an open pull request and isn't working". Approved and queued-to-merge need the pull request's review decision from `gh`.
- **Pause a project:** one switch that stops the orchestrator's sessions and holds its queue, schedules and triggers.
- **Resolved:** marking a started session done from the overview, and by itself once its pull request merges.
- **Codex**, checked against a real Codex CLI.
- **The website's page and screenshots**, which wait for the release ([releasing.md](releasing.md)).

## Tests

- `packages/protocol/src/orchestrator.test.ts`: the groups, the arguments, the texts and the update read back.
- `packages/engine/src/orchestrator/orchestrator.test.ts`: the tools against a real SQLite file (starts, the queue, agents, limits, reports, instructions, deletes), the store across a restart, and the bridge.
- `packages/engine/src/host/host.test.ts`, `providers/providerHosts.test.ts`: who gets the server and the text, at a start and at a resume, and the start card.
- `apps/desktop/src/orchestratorMcp/server.test.ts`: the MCP server.
- `apps/ui/src/state/orchestrator.test.ts`, `components/newSession/*.test.ts`: the overview's rows, the Start button and what `session.create` gets.
- Smoke: `npm run smoke:demo -- --only "orchestrator"`.
- Live (opt-in, a throwaway repository, after a build): `SESHBOARD_LIVE_CWD=… npx vitest run orchestrator.live` for Claude Code, `SESHBOARD_LIVE_COPILOT_CWD=…` for Copilot.

How to try it by hand: [orchestrator-testing.md](orchestrator-testing.md).
