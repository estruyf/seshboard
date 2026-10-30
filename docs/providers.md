# Providers

Seshboard drives Claude Code. **Providers** are the other agents whose sessions it can show: GitHub Copilot CLI first ([#199](https://github.com/estruyf/seshboard/issues/199)). A provider is off until the user allows it in **Settings › Providers**; nothing of it is read before then. Its sessions follow Claude Code's rule in the sidebar: those started outside Seshboard show when the sidebar shows sessions from other apps (**Settings › Sidebar**). They are **read-only** for now: they show up with the provider's mark on the row and in the header, in search, catch-up and on the phone, and their transcript opens like any other, but Seshboard can't send to them, fork, rewind, rename or delete them.

## How it fits together

| Piece | Where | What it does |
|---|---|---|
| Ids and names | `packages/protocol/src/providerConstants.ts` | `SESSION_PROVIDERS`, `OPTIONAL_PROVIDERS`, `PROVIDER_NAMES`, and `otherProviderOf` / `isReadOnlySession` for a `SessionSummary` (whose `provider` is missing for Claude Code's). |
| The adapter | `packages/engine/src/providers/provider.ts` | `ProviderAdapter`: the provider's folder, how its files map to sessions (`ProviderFiles`), its `SessionSource`, and the command that resumes a session in its own CLI. |
| The registry | `packages/engine/src/providers/registry.ts` | `createProviders()`: every adapter, in the order Settings lists them. |
| Allowed or not | `providers/providerSettings.ts` | The `providers.allowed` app state key (carried by settings export and import), and the `providers.list` snapshot. |
| One source | `providers/providerSources.ts` | `ProviderSources` puts Claude Code's profiles and the allowed providers behind one `SessionSource`, and routes each session to the one that listed it. Fork, rename and subagents stay Claude Code's. |
| The index | `sessions/sessionIndex.ts` | An allowed provider's folder is one more root, with its `ProviderFiles`: watched and scanned like a Claude profile's `projects/`, with none of Claude Code's format read for it. |
| Guards | `engine.ts` (`assertClaudeSession`), `HostManager.startHost` | Refuse Claude-only actions with `READ_ONLY_SESSION`. `startHost` covers every way to a session's process (message box, phone, Up next, schedules). Read-only sessions are also left out of the archive clean-up. |
| UI | `apps/ui/src/components/providers/` | `ProviderMark` (each provider's icon in `PROVIDER_ICONS`; Copilot's is `CopilotIcon`) on rows and in the header, `ReadOnlyNotice` in place of the message box (with the resume command from the adapter), `ProvidersSettings`; `state/providersStore.ts` holds the snapshot. |

Each reader turns its provider's records into the messages Seshboard reads from Claude Code (`RawSessionMessage`, with Claude-style `text`, `thinking`, `tool_use` and `tool_result` blocks). Tools with a Claude Code counterpart are renamed and reshaped to it (a shell call to `Bash`, an edit to `Edit`, a file read to `Read`), so the transcript shows them with the same cards and diffs. Everything else gets the generic tool card.

## Adding a provider

1. Add its id to `SESSION_PROVIDERS` and `OPTIONAL_PROVIDERS`, and its name to `PROVIDER_NAMES` (`providerConstants.ts`). TypeScript then points at the two places that need it: `PROVIDER_ICONS` in `ProviderMark.tsx`, and the registry.
2. Write its adapter in `packages/engine/src/providers/<id>/`: a `SessionSource` (list, info, messages), its `ProviderFiles`, and a pure converter to `RawSessionMessage` with tests next to it. Use real temporary folders in the tests, with records copied from the agent's own files.
3. Add it to `createProviders()` in `registry.ts`, with a `folders` override for tests.
4. Add its entry to `settingsIndex.ts` (`data-provider-<id>` is the toggle's hook) and a line to `CHANGELOG.md`.

Read through the agent's own API where it has one that only reads. Parse its files where it doesn't, and degrade quietly: a missing or changed field leaves a session with less (no title, the folder from another record), never an error. Never write to the agent's folder.

## GitHub Copilot CLI

- **Where:** `$COPILOT_HOME/session-state`, else `~/.copilot/session-state`; one folder per session, named by its id.
- **What is read:** `workspace.yaml` (title, folder, branch, client, dates; flat YAML, read by `workspaceYaml.ts`) and `events.jsonl` (the conversation; its records have the Copilot SDK's `SessionEvent` shape). Only sessions with an `events.jsonl` and a prompt are listed: the Copilot desktop app keeps other folders there too, and Copilot opens some sessions for itself that never get a prompt.
- **Why not the SDK:** `@github/copilot-sdk` lists sessions (without their titles), but reads a session's events only by resuming it in a runtime, which writes to the session and clashes with a terminal that has it open. Driving sessions later will go through the SDK.
- **Last activity:** the last prompt, reply or tool result in the last 64 KB of `events.jsonl` (resuming or closing a session doesn't count), else `updated_at`.
- **Origin:** `client_name` `github/cli` is the CLI, `vscode` an editor; anything else is unknown.
- **Left out of the transcript:** `report_intent` (Copilot's own status line) and the steps of subagents (events with a `parentToolCallId`), as Claude Code's subagents are left out of the main conversation.
- **Resume:** `copilot --resume=<id>`.

## Driving sessions (in progress)

A provider can have a **`driver`** (`ProviderDriver` in `provider.ts`): it starts or resumes a session in a folder, sends messages, stops a turn, switches models and answers permission requests. What a running session reports goes through `DriverEvents`, in the shapes Claude Code's sessions use (`HostEvents`): stream deltas, complete `RawSessionMessage`s (from the same converter as the reader, so the live transcript and the file agree), the turn's state, and permission requests for the permission card.

**Signing in is the provider's own.** Seshboard never asks for, stores or passes a credential. Copilot's driver runs the user's own `copilot` (found like `claude`, `copilotBinary.ts`) through the Copilot SDK, with no token, so `copilot` uses its own login (`/login` in Copilot CLI, or the GitHub CLI's). When it isn't signed in, `status()` says how to sign in with Copilot CLI. The SDK's bundled runtime and `koffi` (only used to host that runtime in-process) are not shipped (`electron-builder.yml`).

Copilot's driver (`copilot/copilotDriver.ts`):
- One headless `copilot` runtime for all sessions, started on first use and stopped with the engine.
- Sessions it starts are recorded by Copilot with `client_name: seshboard`, which the reader reads as started in Seshboard (origin `app`).
- Events: `copilotLive.ts`. Permission requests and answers: `copilotPermissions.ts` (shell → Bash, write → Edit with its diff, read → Read, url → WebFetch, MCP → `mcp__server__tool`; Always allow is Copilot's approve for the session).
- Tests fake the SDK (`CreateCopilotClient`). The live test is opt-in and costs one small request: `SESHBOARD_LIVE_COPILOT_CWD=/path/to/throwaway/repo npx vitest run copilot.live`.

Next, each its own change:
1. **Hosts:** `HostManager` runs a provider's session through its driver, behind the same `SessionHostInfo`, stream, message and permission events as a Claude Code host; sessions it started are owned (`owned_sessions`) and no longer read-only.
2. **New session:** a provider picker (Claude Code the default; only allowed providers with a driver), the provider's models, and its status (install or sign in with its CLI) where it can't run.
3. **Continue a session started elsewhere:** sending to a Copilot session resumes it here, as for Claude Code.
4. **Parity, as far as the provider allows:** permission modes (Copilot's interactive, plan and autopilot), usage, Up next, the phone.
