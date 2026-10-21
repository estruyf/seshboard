# Phase 0 spike: findings

Run on 2026-10-05 against Claude Code **2.1.285** (`/opt/homebrew/bin/claude`), `@anthropic-ai/claude-agent-sdk` **0.3.288**, Node 24.21, macOS. The scripts in this folder reproduce each result:

```bash
cd spike && npm install
SPIKE_SANDBOX=/path/to/throwaway/git/repo node 01-auth-stream.mjs
```

| # | Script | Question |
|---|---|---|
| 01 | `01-auth-stream.mjs` | Auth, streaming input across turns, init payload, introspection calls |
| 02 | `02-permissions-rewind-interrupt.mjs`, `02b-interrupt.mjs` | Permission prompts, deny, AskUserQuestion, rewind, interrupt |
| 03 | `03-state-warm.mjs` | Session state events, `startup()` pre-warm |
| 04 | `04-disk.mjs` | Live registry + JSONL formats, listing/scan speed |
| 05 | `05-registry-worktree.mjs`, `05b-sdk-worktree.mjs` | Registry visibility of SDK sessions, worktrees |

---

## Verdict: the plan holds

Everything the plan depends on works. Three things change the design:
1. **Worktrees come for free.** Claude Code creates them itself, so the app doesn't have to.
2. **Live status needs an environment variable switched on.**
3. **The engine must survive SDK errors without crashing.**

All three are detailed below.

---

## 1. Auth ✅ uses the existing Claude Code login
- With `pathToClaudeCodeExecutable` set to the installed `claude` and **no `ANTHROPIC_API_KEY`**, `init.apiKeySource` is `'none'` and `accountInfo().subscriptionType` is `'Claude Max'`. The SDK runs on the user's subscription login with no extra setup.
- `accountInfo()` returns `email, organization, subscriptionType, apiProvider`. Show it in Settings so the user can see which account is in use.
- 📝 **Terms of use** are still a product question rather than a technical one. This is a personal local tool driving your own CLI, which is the same model t3code uses.

## 2. Streaming input ✅ one long-lived `Query` per session
- A push-based `AsyncIterable<SDKUserMessage>` keeps one process alive across turns. There's no respawn per message.
- **Cold start:** `system:init` at about 600 ms, first token about 1.5–2.4 s.
- **`init` is emitted on every turn, not just once.** The first one arrives before MCP servers connect (32 tools); the next one carries the full set (128 tools). The UI must treat `init` as a *refresh*, not a one-time setup.
- Other system events seen: `commands_changed`, `hook_started/response`, `status`, `thinking_tokens`, `task_summary`, `post_turn_summary`, `rate_limit_event`, `background_tasks_changed`, `task_started`. The renderer needs a no-op default so unknown events never break it.

## 3. Introspection ✅ everything a GUI needs
| Call | Result (this machine) |
|---|---|
| `supportedCommands()` | 106 commands, including all your skills and plugins, shaped `{name, description, argumentHint}` |
| `supportedModels()` | `default opus claude-fable-5-1 sonnet haiku claude-sonnet-5 …` |
| `supportedAgents()` | 15 (your custom agents included) |
| `mcpServerStatus()` | per-server `connected` / `needs-auth`, so the panel can offer "authenticate" |
| `getContextUsage()` | `percentage, totalTokens, maxTokens, categories, autoCompactThreshold, …` |

## 4. Permissions ✅ fully host-controlled
- `canUseTool` fires for anything that isn't auto-allowed. Writes to Claude's own scratchpad folder and read-only commands such as `ls` are allowed without asking, exactly as in the CLI.
- The callback options include `title, displayName, description, decisionReason, suggestions, blockedPath, toolUseID, agentID, requiresUserInteraction`. That's enough to build the same approval card the CLI shows. `suggestions` (for example `setMode->session`) map to the "always allow" buttons.
- A deny with `message` is passed back to Claude, which adapts. `result.permission_denials` counts the denials.
- **AskUserQuestion** goes through `canUseTool` too. To answer it, return `{behavior:'allow', updatedInput:{...input, answers:{[question]: label}}}`. ✅ Verified.

## 5. Rewind ✅
- With `enableFileCheckpointing: true`, `rewindFiles(userMessageUuid, {dryRun:true})` previews the changes (`filesChanged, insertions, deletions`), and the real call restores them. Verified that a file Claude created is removed again.
- User-message uuids come from `getSessionMessages()` (or from the streamed messages).

## 6. Interrupt ✅, with a crash trap ⚠️
- `interrupt()` resolves in under 10 ms. The turn ends with `result: error_during_execution`, and **the session keeps working.** The next message is answered normally.
- ⚠️ **If the input stream is ended right after an interrupted (error) result, the SDK throws an uncaught `Error: Claude Code returned an error result` asynchronously.** In a shared engine process, that would kill *every* session.
  → **Design rule:** each `SessionHost` wraps its iterator in try/catch and the engine registers `uncaughtException` / `unhandledRejection` guards. A failure marks that one session as errored and never takes the process down.
- Claude Code itself blocks some commands, for example `sleep N` ("use Monitor instead"), and backgrounds long ones on its own (`run_in_background` → `background_tasks_changed` / `task_started`). The UI needs a **background tasks** indicator (`backgroundTasks()`, `stopTask()`).

## 7. Live session state ✅, behind an env flag
- `system:session_state_changed` (`running` / `requires_action` / `idle`) is **only emitted when `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`** is in the session's `env`. With it set, we saw `running > requires_action > running > idle`. That sequence is exactly the sidebar status dot.

## 8. Pre-warm ✅ worth it
- `startup({options})` takes about 550 ms, and is paid while the user is still typing. It brings time to first token down from about **2.4 s to 1.0 s**. Keep one warm instance per recently used folder.

## 9. On-disk formats ✅ readable, ⚠️ undocumented
**Live registry `~/.claude/sessions/<pid>.json`.** Keys: `pid, sessionId, cwd, startedAt, procStart, version, peerProtocol, peerFeatures, kind, entrypoint, hostSessionId, pidDomain, messagingSocketPath, name, nameSource, nameSince, status (busy|idle), updatedAt, statusUpdatedAt`.
- **SDK sessions register here too** while running. That's useful, because the app can see its own sessions from the CLI's point of view, and other tools can see the app's sessions.
- `entrypoint` is inherited from the parent environment. These tests ran from inside Claude desktop, so they show up as `claude-desktop`. **The engine should set its own `CLAUDE_CODE_ENTRYPOINT`** (to be confirmed which values are accepted) so origin badges are correct. Fall back to the app's own list of session ids.
- `messagingSocketPath` is a live Unix socket for each session. **Not touched in this spike**: connecting to another live session's control socket is out of scope for v1, as planned.

**Transcripts `~/.claude/projects/<encoded-cwd>/<id>.jsonl`.** 122 transcripts and 228 MB on this machine.
- `listSessions()` (all): **58 ms**. It reads file heads and tails, not whole files. It returns `sessionId, summary, lastModified, fileSize, customTitle, firstPrompt, gitBranch, cwd, tag, createdAt`.
- A full raw JSONL parse of everything took 0.6 s, which is fine as a one-off in a worker followed by incremental byte-offset reads.
- Useful metadata records for the sidebar: `ai-title`, `custom-title`, `agent-name`, `cost-state` (cost, lines added/removed, model usage), `pr-link` (PR number and URL), `permission-mode`, `mode`, `last-prompt`.
- Conversation records: `user`, `assistant`, `attachment`, `system:*`, and `file-history-*` (rewind checkpoints).

## 10. Worktrees ✅ Claude Code does it for us
- `claude --worktree <name>` creates the worktree at **`<repo>/.claude/worktrees/<name>`** on branch **`worktree-<name>`**, and marks it `locked`.
- **From the SDK:** `extraArgs: { worktree: '<name>' }` does the same. `init.cwd` reports the worktree path. So the app passes a flag and Claude Code applies the user's `worktree` settings (`baseRef: fresh|head`, `symlinkDirectories`, `sparsePaths`). There's no custom git code to keep in sync.
- The default `baseRef` is `fresh` (from `origin/<default-branch>`). With no `origin` it falls back to HEAD.
- `listSessions({dir: repo})` includes the repo's worktree sessions (`includeWorktrees` defaults to true), so grouping under the main repo comes for free.
- ⚠️ `gitBranch` in session info showed `main` for the worktree session. **Get the branch from git for the session's cwd** instead of trusting that field.

## 11. Storage ✅
- `node:sqlite` in Node 24 has **FTS5** (SQLite 3.53.4), so global search needs no native module. Latest Electron is **44.5.1**. Phase 1 must confirm that Electron's bundled Node includes `node:sqlite`. Fall back to `better-sqlite3` if it doesn't.

## 12. Messages pushed mid-turn and `priority` ✅ (`11-queue-midturn.mjs`, claude 2.1.287, SDK 0.3.288)
A turn runs two 8 s foreground Bash calls; a second message B ("end your answer with BRAVO") is pushed 2 s into the first call.
- **No `priority` (what Switchboard sends today): B is read at the next tool boundary, in the same turn.** One `result`, no second turn, no tool aborted. The final answer followed B. So today's "Queue" is really a **steer**, not "after the turn".
- **`priority: 'next'`:** same as the default.
- **`priority: 'later'`: a real queue.** The turn finishes (answer ALPHA, `result` #1), then B runs as its own turn (`result` #2). The SDK did this by itself, with no `session_state_changed: idle` between the two turns.
- **`priority: 'now'`: an interrupt.** The running tool is aborted (`Command was aborted before completion`), `result` #1 ends the turn, B starts a new turn at once, and Claude carried on with the earlier work. No `idle` between the turns, so a host that flushes its own queue on `idle` isn't tricked by it.
- The SDK echoes no `user` frame for B in any mode (nothing with `isReplay`), so the host's own echo is the only live copy of the message.
- A queued message can't be edited, removed or reordered through the public SDK (`cancel_async_message` and `cancel_queued` are control requests with no `Query` method; `interrupt()` takes no arguments and only reports `still_queued`). **To edit, remove or reorder, the host has to hold the message itself** until it is time.
- ⚠️ **`priority: 'now'` doesn't stop a turn that hasn't started answering yet.** Found in the live smoke: a 'now' message sent 0.4 s after a long prompt (Claude still thinking) was folded into that turn, which then answered only the first prompt. `interrupt()` does stop a turn in that window (Claude Code latches it).
- Mapping for the app: **Queue** = held by the host, pushed when the session goes `idle`; **Steer** = push with no priority, now, no interrupt; **Send now** = `interrupt()`, then push, with the host's queue held until the message's turn has started (so an `idle` from the stopped turn can't send a queued message first).

## 13. Side questions (`/btw`) ✅ (`12-side-question.mjs`, claude 2.1.296, SDK 0.3.288)
- **The SDK has it, undocumented:** `Query.askSideQuestion(question, { history?, signal? })` exists at runtime but not in `sdk.d.ts`. It sends the `side_question` control request and resolves with `{ response, synthetic, refusalFallback? }` (`response: null` when there is nothing to answer from). Claude Code 2.1.287 to 2.1.296 all handle the request.
- **Claude Code runs it as a one-shot fork** of the conversation (the same code as the terminal's `/btw`): `maxTurns: 1`, `skipTranscript: true`, `skipCacheWrite: true`, and **no tools** (`canUseTool` always denies, and a system reminder tells the model it has none). A turn in progress gets its open tool calls closed with a placeholder in the fork only.
- **It runs beside a turn:** asked 0 s into a 10 s Bash call, it answered in 0.8 s; the turn went on and ended with its one `result`. Nothing was queued or steered. The main stream only gets a `system: control_request_progress` (`started`, or `api_retry`) for it.
- **Nothing lands in the session file:** the question and answer were not in the `.jsonl`, so the transcript reader needs no filter.
- **No streaming:** the answer comes in one piece with the control response; no `stream_event` belongs to it.
- **History is the caller's:** the terminal keeps the last 20 exchanges and sends them along (`btwHistory`); for an SDK host the client passes `history: [{ question, response }]`, so Switchboard keeps its own.
- **A session that isn't running** can answer from a short-lived process: `resume: <id>`, `forkSession: true`, `persistSession: false`. It answered in 2.2 s (start included), and the original file and the projects folder were unchanged.


## 14. Ask about this session: a fork with read-only tools ✅ (`13-ask.mjs`, claude 2.1.299, SDK 0.3.288)
- **Why not `askSideQuestion`:** Claude Code's side question has no tools (`canUseTool` always denies), doesn't stream (one control response) and reports no tokens. Ask needs to read the project, stream, and count its tokens in Usage.
- **A short-lived fork with the question as its prompt works beside a turn:** `resume: <id>`, `forkSession: true`, `persistSession: false`, asked while the session's own process was 1 s into a 20 s Bash call. It answered in 5 to 8 s with three model calls (a Read, a denied Write, the answer); the main turn went on and ended with its one `result`.
- **Nothing lands anywhere:** the question wasn't in the session's `.jsonl`, no new session file appeared, and the Write the model tried never happened.
- **Read-only through a PreToolUse hook:** a hook in `options.hooks` that returns `permissionDecision: 'deny'` for anything but Read, Grep, Glob and `git status|diff|log|show` blocks the tool before settings' allow rules apply; the model is told why. The tool list stays the session's own.
- **It reuses the prompt cache:** keeping the session's tools (no `tools` or `disallowedTools`), the fork read 63.5k cached tokens and wrote 4.1k. Claude Code reuses the recorded system prompt on resume, so `appendSystemPrompt` would be ignored: the framing goes in the prompt.
- **It streams and reports tokens:** `includePartialMessages` gives `text_delta`s (12 for a short answer). Count tokens from each assistant message's `usage` once per `message.id`: on a resumed or forked run, `result.modelUsage` may start from the totals the transcript saved.
- **A tool call still running in the session shows as interrupted** to the fork; the prompt says a call without a result is still running.

## 15. Compressing tool output, and where the tokens go ⚠️ works, saves little (`14`–`18`, claude 2.1.303, SDK 0.3.288)
The question: can Switchboard shrink what tools send to Claude, the way Headroom does with a proxy, through a PostToolUse hook instead? Each case of `14-compress-tool-output.mjs` swaps the real output for a decoy with a wrong answer in it, so Claude's reply shows which one it saw. `15`–`17` run offline over the newest ~218 transcripts in `~/.claude/projects` and print totals only.

**The mechanism works:**
- **`updatedToolOutput` in a PostToolUse hook replaces the output for built-in and MCP tools** (Bash, Read, an in-process MCP tool): Claude answered from the decoy every time.
- **The replacement must keep the tool's own shape.** Bash is `{stdout, stderr, interrupted, isImage, noOutputExpected}`, Read is `{type, file: {filePath, content, numLines, startLine, totalLines}}`, MCP is the `content` array. **A plain string for Bash is silently ignored**: Claude got the original.
- **A failed command can't be rewritten.** A non-zero exit goes to `PostToolUseFailure` instead (`{error}`, already trimmed to about 10k characters), whose output takes only `additionalContext`.
- **Past `bashOutputMaxChars` (30000) the hook gets the preview,** plus `persistedOutputPath` and `persistedOutputSize`. The full output is in that file.
- **The session file keeps only the replacement,** in the `tool_result` and in `toolUseResult`, and the streamed `user` message carries it too. The original is gone unless the host keeps a copy, and the transcript view would show the compressed text.
- **Claude notices an odd rewrite:** given `… lines folded …` with a wrong last line, Haiku said the output looked folded and didn't match. A marker like that is understood.
- **Claude Code 2.1.303 has no Grep or Glob tools:** searches go through Bash (`rg`, `grep`), so Bash carries search results too.

**But lossy compression has little to work on in these sessions (`15-estimate-savings.mjs`, `compress-prototype.mjs`):**
- Bash is 80% of text tool output, and **about 75% of the Bash output is file contents** (`sed -n`: 2.1M tokens, `cat`: 1.4M, plus `git diff` and `git show`). Claude quotes that text back into Edits, so it can't be compressed lossily. Read, the other 15%, has the same problem.
- Test and build output is already short, because it is piped through `| tail -40`. Of what is left, most is under 2k characters, or search results that are dense already.
- The prototype (strip ANSI codes and progress bars, fold runs of similar lines, keep every error and warning line, keep the head and tail) cut the outputs it touched by 75%. **But it touched only about 170k of 7.8M tokens: ~2% of tool output.** MCP text (chrome-devtools snapshots) compresses well, but is small here.
- **Deduplication doesn't help either (`16-duplicate-reads.mjs`):** exact repeats of an earlier result in the same session are ~0%, and long lines seen before are 4%.

**Where the tokens go (`17-where-tokens-go.mjs`, weighted 1 / 1.25 / 2 / 0.1 / 5 for input, 5-minute write, 1-hour write, read, output):**
- **Cache reads are 68% of the weighted cost**, 1-hour cache writes 20% and output 13%. Fresh input is about 0%.
- A session averages 59 API calls, and **each call reads a median of 169k tokens of context.** Every call reads the whole conversation again.
- **30% of all context read is the part above 200k tokens** (42% of calls are past 200k). Past 400k it is 7%. The largest context was 929k, and there was 1 compaction in 218 sessions, because the window is 1M.
- The first call of a session (system prompt, tools, CLAUDE.md, the first prompt) is a median of 41k tokens. That is ~20% of all context read.

**The lever this offers is context length:**
- **`settings: { autoCompactWindow }` at start works:** with 150000, `getContextUsage()` reports `maxTokens: 150000` and `autoCompactThreshold: 117000` (with the default it is 1M and 967k).
- **`applyFlagSettings({ autoCompactWindow })` mid-session has no effect,** unlike effort: the threshold stayed at 967k. So a context budget is fixed when the process starts. It has to be part of the pre-warm match, and changing it means restarting the session with `resume`.
- Compaction is lossy too: it trades detail for a shorter context. A budget is a choice the user makes, not a free win. The 20% of cost that is 1-hour cache writes also grows a little with each compaction, because the new summary has to be written to the cache.

**For the app:**
1. A Headroom-style compressor is possible in the engine (`hooks.PostToolUse` in `buildOptions`), but on this workload it saves ~2%. Keep it to log-like Bash output and MCP text, never file contents, diffs or search results.
2. The bigger saving is a **context budget**: a global and per-session `autoCompactWindow`, set at start. Show the measured effect in the context meter.
3. Output (13%) is effort, which Switchboard already sets per session.

---

## Side effects of running the spike
- About 16 short Haiku test sessions now exist in `~/.claude/projects/` under the scratchpad sandbox repo path, with a few cents of usage.
- Spike 14 and 18 added about 9 more short Haiku and Sonnet sessions under `/tmp/sb-spike14-*`.
- Two locked worktrees (`spike-wt`, `spike-sdk`) exist inside the scratchpad sandbox repo. Nothing touched your real projects.
