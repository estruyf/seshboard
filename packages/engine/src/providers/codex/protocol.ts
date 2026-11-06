/**
 * The part of `codex app-server`'s JSON-RPC protocol Seshboard uses, copied by hand from the bindings Codex writes
 * (`codex app-server generate-ts`, codex-cli 0.167.0). Only stable methods (no `experimentalApi`). Fields we don't read
 * are left out or loosely typed, and every item type we don't know falls through to `UnknownItem`: Codex releases
 * almost daily, so a new field or item must never break reading.
 */

export interface ClientInfo {
  name: string;
  title: string | null;
  version: string;
}

export interface InitializeParams {
  clientInfo: ClientInfo;
  /** Null for the stable API; `experimentalApi` opts into the experimental methods and fields. */
  capabilities: { experimentalApi: boolean } | null;
}

export interface InitializeResponse {
  userAgent: string;
  /** The server's `CODEX_HOME`. */
  codexHome: string;
  platformFamily: string;
  platformOs: string;
}

/** Where a thread was started. Subagents' sources are objects. */
export type ThreadSessionSource = 'cli' | 'vscode' | 'exec' | 'appServer' | 'unknown' | { custom: string } | { subAgent: unknown };

/** `thread/list`'s `sourceKinds`. Left out, the list has only interactive sources. */
export type ThreadSourceKind = 'cli' | 'vscode' | 'exec' | 'appServer' | 'subAgent' | 'subAgentReview' | 'subAgentCompact' | 'subAgentThreadSpawn' | 'subAgentOther' | 'unknown';

export type ThreadStatus = { type: 'notLoaded' } | { type: 'idle' } | { type: 'systemError' } | { type: 'active'; activeFlags: Array<'waitingOnApproval' | 'waitingOnUserInput'> };

export interface GitInfo {
  sha: string | null;
  branch: string | null;
  originUrl: string | null;
}

export interface Thread {
  /** UUIDv7, also in the rollout file's name. */
  id: string;
  forkedFromId: string | null;
  /** Set only for a subagent's thread. */
  parentThreadId: string | null;
  /** Usually the first user message. */
  preview: string;
  ephemeral: boolean;
  /** `paginated` threads keep their history in Codex's database, not only in the rollout file. */
  historyMode?: 'legacy' | 'paginated';
  modelProvider: string;
  model?: string | null;
  /** Unix seconds. */
  createdAt: number;
  /** Unix seconds. */
  updatedAt: number;
  status: ThreadStatus;
  /** The rollout file, when there is one. */
  path: string | null;
  cwd: string;
  cliVersion: string;
  /** The client that started it (`clientInfo.name`). */
  originator?: string;
  source: ThreadSessionSource;
  gitInfo: GitInfo | null;
  /** The name set with `thread/name/set` or Codex's own title. */
  name: string | null;
  /** Only filled by `thread/read` with `includeTurns`; empty in lists. */
  turns: Turn[];
}

export interface ThreadListParams {
  cursor?: string | null;
  limit?: number | null;
  sortKey?: 'created_at' | 'updated_at' | null;
  sortDirection?: 'asc' | 'desc' | null;
  sourceKinds?: ThreadSourceKind[] | null;
  /** True lists only archived threads; false or left out, only the others. */
  archived?: boolean | null;
  cwd?: string | string[] | null;
  /**
   * Lists from Codex's database without checking the rollout files. Never set: a thread whose rollout file went to the
   * Trash would still be listed.
   */
  useStateDbOnly?: boolean;
}

export interface ThreadListResponse {
  data: Thread[];
  nextCursor: string | null;
}

export interface ThreadReadParams {
  threadId: string;
  /** Deprecated for paginated threads: use `thread/turns/list`. */
  includeTurns?: boolean;
}

export interface ThreadReadResponse {
  thread: Thread;
}

export interface ThreadTurnsListParams {
  threadId: string;
  cursor?: string | null;
  limit?: number | null;
  /** Defaults to descending (newest first). */
  sortDirection?: 'asc' | 'desc' | null;
  /** `summary` (the default) leaves out every tool item: Seshboard always asks for `full`. */
  itemsView?: 'notLoaded' | 'summary' | 'full' | null;
}

export interface ThreadTurnsListResponse {
  data: Turn[];
  nextCursor: string | null;
}

export interface Turn {
  id: string;
  items: ThreadItem[];
  itemsView: 'notLoaded' | 'summary' | 'full';
  status: 'completed' | 'interrupted' | 'failed' | 'inProgress';
  error: { message: string } | null;
  /** Unix seconds. */
  startedAt: number | null;
  /** Unix seconds. */
  completedAt: number | null;
  durationMs: number | null;
}

export type UserInput =
  | { type: 'text'; text: string; /** Spans in `text` a UI renders specially; Seshboard sends none. */ text_elements?: unknown[] }
  | { type: 'image'; url?: string; fileId?: string }
  | { type: 'localImage'; path: string }
  | { type: 'skill'; name: string; path: string }
  | { type: 'mention'; name: string; path: string }
  | { type: string };

export type CommandAction =
  | { type: 'read'; command: string; name: string; path: string }
  | { type: 'listFiles'; command: string; path: string | null }
  | { type: 'search'; command: string; query: string | null; path: string | null }
  | { type: 'unknown'; command: string };

export interface FileUpdateChange {
  path: string;
  kind: { type: 'add' } | { type: 'delete' } | { type: 'update'; move_path: string | null };
  /** A unified diff for an update; the whole content for an add. */
  diff: string;
}

export type ToolStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

export type WebSearchAction =
  | { type: 'search'; query: string | null; queries: string[] | null }
  | { type: 'openPage'; url: string | null }
  | { type: 'findInPage'; url: string | null; pattern: string | null }
  | { type: 'other' };

interface ItemTimes {
  /** Unix milliseconds, when recorded. */
  startedAtMs?: number | null;
  completedAtMs?: number | null;
}

export type UserMessageItem = ItemTimes & { type: 'userMessage'; id: string; content: UserInput[]; /** The `clientUserMessageId` it was sent with. */ clientId?: string | null };
export type AgentMessageItem = ItemTimes & { type: 'agentMessage'; id: string; text: string };
export type ReasoningItem = ItemTimes & { type: 'reasoning'; id: string; summary: string[]; content: string[] };
export type PlanItem = ItemTimes & { type: 'plan'; id: string; text: string };
export type CommandExecutionItem = ItemTimes & {
  type: 'commandExecution';
  id: string;
  command: string;
  cwd: string;
  status: ToolStatus;
  /** Codex's best guess at what the command does (a `read` with its path, a search). */
  commandActions: CommandAction[];
  aggregatedOutput: string | null;
  exitCode: number | null;
  durationMs: number | null;
};
export type FileChangeItem = ItemTimes & { type: 'fileChange'; id: string; changes: FileUpdateChange[]; status: ToolStatus };
export type McpToolCallItem = ItemTimes & {
  type: 'mcpToolCall';
  id: string;
  server: string;
  tool: string;
  status: 'inProgress' | 'completed' | 'failed';
  arguments: unknown;
  result: { content: unknown[]; structuredContent: unknown } | null;
  error: { message: string } | null;
};
export type WebSearchItem = ItemTimes & {
  type: 'webSearch';
  id: string;
  query: string;
  action: WebSearchAction | null;
  /** Opaque results of a standalone search, when Codex has them. */
  results?: unknown[] | null;
};
export type ImageViewItem = ItemTimes & { type: 'imageView'; id: string; path: string };
export type ContextCompactionItem = ItemTimes & { type: 'contextCompaction'; id: string };
export type ReviewModeItem = ItemTimes & { type: 'enteredReviewMode' | 'exitedReviewMode'; id: string; review: string };
export type CollabAgentToolCallItem = ItemTimes & {
  type: 'collabAgentToolCall';
  id: string;
  tool: string;
  status: string;
  senderThreadId: string;
  /** For a spawn, the new subagent's thread. */
  receiverThreadIds: string[];
  prompt: string | null;
  model: string | null;
  /** The last known state of each receiving agent, by thread id: a finished one's `message` is its report. */
  agentsStates?: Record<string, { status: string; message: string | null } | undefined>;
};
export type SubAgentActivityItem = ItemTimes & { type: 'subAgentActivity'; id: string; kind: string; agentThreadId: string; agentPath: string; model: string | null };
/** Any item this file doesn't describe (`hookPrompt`, `dynamicToolCall`, `sleep`, `imageGeneration`, newer ones). */
export type UnknownItem = ItemTimes & { type: string; id?: string; [key: string]: unknown };

export type ThreadItem =
  | UserMessageItem
  | AgentMessageItem
  | ReasoningItem
  | PlanItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | WebSearchItem
  | ImageViewItem
  | ContextCompactionItem
  | ReviewModeItem
  | CollabAgentToolCallItem
  | SubAgentActivityItem;

export type Account = { type: 'apiKey' } | { type: 'chatgpt'; email: string | null; planType: string; workspaceName: string | null } | { type: 'amazonBedrock' } | { type: 'gcp' };

export interface GetAccountResponse {
  account: Account | null;
  requiresOpenaiAuth: boolean;
}

/** The read-only requests Phase 1 makes, with their params and results. */
export interface ReadMethods {
  'thread/list': { params: ThreadListParams; result: ThreadListResponse };
  'thread/read': { params: ThreadReadParams; result: ThreadReadResponse };
  'thread/turns/list': { params: ThreadTurnsListParams; result: ThreadTurnsListResponse };
  'account/read': { params: Record<string, never>; result: GetAccountResponse };
}

/* --- Driving sessions (Phase 2) ----------------------------------------------------------------------------------- */

/** When Codex asks before it acts. `untrusted` asks for anything not known to be safe; `never` doesn't ask. */
export type AskForApproval = 'untrusted' | 'on-request' | 'never';

/** `thread/start`'s sandbox. Seshboard never asks for `danger-full-access`. */
export type SandboxMode = 'read-only' | 'workspace-write';

/** `turn/start`'s sandbox, which holds for that turn and the ones after. */
export type SandboxPolicy =
  | { type: 'readOnly'; networkAccess: boolean }
  | { type: 'workspaceWrite'; writableRoots: string[]; networkAccess: boolean; excludeTmpdirEnvVar: boolean; excludeSlashTmp: boolean };

/**
 * Codex's plan mode, set per turn. Experimental: `turn/start` takes it only with `initialize`'s `experimentalApi`, and
 * `settings.model` is required.
 */
export interface CollaborationMode {
  mode: 'plan' | 'default';
  settings: { model: string; reasoning_effort: string | null; developer_instructions: string | null };
}

export interface ThreadStartParams {
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  sandbox?: SandboxMode | null;
  /** A throwaway thread, never written to disk (Ask about this session). */
  ephemeral?: boolean | null;
  /** Codex's config for this thread, merged over the profile's (`{ mcp_servers: { name: { enabled: false } } }`). */
  config?: Record<string, unknown> | null;
}

export interface ThreadResumeParams {
  threadId: string;
  config?: Record<string, unknown> | null;
  model?: string | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  sandbox?: SandboxMode | null;
  /** Seshboard reads the history itself (`thread/turns/list`). */
  excludeTurns?: boolean;
}

export interface ThreadStartResponse {
  thread: Thread;
  model: string;
  reasoningEffort: string | null;
  approvalPolicy: unknown;
  sandbox: unknown;
}

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
  /** Comes back as the `userMessage` item's `clientId`, which names the message the turn starts with. */
  clientUserMessageId?: string | null;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  sandboxPolicy?: SandboxPolicy | null;
  model?: string | null;
  effort?: string | null;
  /** Experimental (see `CollaborationMode`). */
  collaborationMode?: CollaborationMode | null;
}

export interface TurnStartResponse {
  turn: Turn;
}

export interface TurnSteerParams {
  threadId: string;
  input: UserInput[];
  clientUserMessageId?: string | null;
  /** The turn running now: the request fails when another one is. */
  expectedTurnId: string;
}

export interface Model {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
  defaultReasoningEffort: string;
  inputModalities: string[];
  isDefault: boolean;
}

/** The requests Phase 2 makes to drive a thread. */
export interface DriveMethods {
  'thread/start': { params: ThreadStartParams; result: ThreadStartResponse };
  'thread/resume': { params: ThreadResumeParams; result: ThreadStartResponse };
  /** Stops listening to a thread's events (the session closed here); Codex unloads it when nobody listens. */
  'thread/unsubscribe': { params: { threadId: string }; result: unknown };
  'turn/start': { params: TurnStartParams; result: TurnStartResponse };
  'turn/steer': { params: TurnSteerParams; result: { turnId: string } };
  'turn/interrupt': { params: { threadId: string; turnId: string }; result: unknown };
  /** The MCP servers Codex would start, with the plugin each comes from. */
  /** With `threadId`, the thread's own connections and their state; without, the config's servers (`runtimeStatus` null). */
  'mcpServerStatus/list': {
    params: { cursor?: string | null; limit?: number | null; threadId?: string | null; detail?: 'full' | 'toolsAndAuthOnly' | null };
    result: { data: McpServerStatus[]; nextCursor: string | null };
  };
  'model/list': { params: { cursor?: string | null; limit?: number | null; includeHidden?: boolean | null }; result: { data: Model[]; nextCursor: string | null } };
}

export type Methods = ReadMethods & DriveMethods & UsageMethods;

/**
 * A notification from Codex (`item/started`, `item/agentMessage/delta`, `turn/completed`, `thread/tokenUsage/updated`,
 * …). Most carry the `threadId` they're about in `params`. Read loosely: the converter knows the shapes it uses.
 */
export interface ServerNotification {
  method: string;
  params: unknown;
}

/**
 * A request from Codex to Seshboard (`item/commandExecution/requestApproval`, `item/fileChange/requestApproval`,
 * `item/tool/requestUserInput`, …), answered with a result or an error. Its `params` carry the `threadId`.
 */
export interface ServerRequest {
  id: number | string;
  method: string;
  params: unknown;
}

export interface CommandApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  commandActions?: CommandAction[] | null;
}

export interface FileChangeApprovalParams {
  threadId: string;
  turnId: string;
  itemId: string;
  reason?: string | null;
  /** Codex asks to write anywhere under this folder for the rest of the session. */
  grantRoot?: string | null;
}

/** An approval's answer. `acceptForSession` is Always allow; `cancel` also stops the turn. */
export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

// Phase 3 (#276): Tools (MCP servers, skills, hooks), rename and compact. Checked against codex-cli 0.167.

/** An MCP server's connection in a loaded thread. */
export type McpServerConnectionStatus = 'notStarted' | 'starting' | 'connected' | 'authenticationRequired' | 'failed' | 'cancelled' | 'disabled';

export interface McpServerStatus {
  name: string;
  /** Null without a thread, or when its config changed. */
  runtimeStatus?: McpServerConnectionStatus | null;
  /** The plugin it comes with, when it does. */
  pluginId: string | null;
  serverInfo?: { name: string; title?: string | null; version?: string | null } | null;
  /** By the tool's name. */
  tools?: Record<string, unknown>;
  /** Discovery failed (it didn't start, say). */
  toolsError?: string | null;
}

export interface SkillMetadata {
  name: string;
  description: string;
  shortDescription?: string;
  path: string;
  /** `system` skills are Codex's own, left out of Tools as Claude Code's built-in commands are. */
  scope: 'user' | 'repo' | 'system' | 'admin' | (string & {});
  enabled: boolean;
  pluginId: string | null;
}

export interface HookMetadata {
  key: string;
  /** `preToolUse`, `postToolUse`, `sessionStart`, `stop`, … */
  eventName: string;
  matcher: string | null;
  statusMessage: string | null;
  /** `user`, `project`, `plugin`, `mdm`, … */
  source: string;
  pluginId: string | null;
  enabled: boolean;
  handlerType: 'command' | 'mcpTool' | 'prompt' | 'agent' | (string & {});
  /** A `command` hook's command line. */
  command?: string;
  /** An `mcpTool` hook's server and tool. */
  server?: string;
  tool?: string;
}

/** Requests of Phase 3, merged into `DriveMethods` (and so into `Methods`). */
export interface DriveMethods {
  /** The skills each folder has (the user's, the repository's, Codex's own). */
  'skills/list': { params: { cwds?: string[]; forceReload?: boolean }; result: { data: Array<{ cwd: string; skills: SkillMetadata[]; errors: unknown[] }> } };
  /** A loaded thread's hooks (`threadId`), or each folder's (`cwds`). */
  'hooks/list': { params: { cwds?: string[]; threadId?: string | null }; result: { data: Array<{ cwd: string; hooks: HookMetadata[]; warnings: string[]; errors: unknown[] }> } };
  /** Reads the MCP config again and reconnects the loaded threads' servers (all of them: there is no one-server form). */
  'config/mcpServer/reload': { params: Record<string, never>; result: unknown };
  /** Names a thread, loaded or not; `thread/name/updated` follows. */
  'thread/name/set': { params: { threadId: string; name: string }; result: unknown };
  /** Codex's effective config, as seen from `cwd` (its project layers too); read for its MCP servers' names only. */
  'config/read': { params: { cwd?: string | null; includeLayers?: boolean }; result: { config: { mcp_servers?: Record<string, { enabled?: boolean } & Record<string, unknown>> | null } & Record<string, unknown> } };
  /** Compacts a loaded thread's context, as a turn of its own with a `contextCompaction` item. */
  'thread/compact/start': { params: { threadId: string }; result: unknown };
}

/* --- Usage (Phase 3): the account's rate limits ------------------------------------------------------------------ */

/** One rate-limit window: how much of it is used, how long it is, and when it resets. */
export interface RateLimitWindow {
  /** 0–100. */
  usedPercent: number;
  windowDurationMins: number | null;
  /** Unix seconds. */
  resetsAt: number | null;
}

/** A bucket of limits (`limitId`, e.g. `codex`): a short window (`primary`, 5 hours) and a long one (`secondary`, a week). */
export interface RateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: RateLimitWindow | null;
  secondary: RateLimitWindow | null;
  planType: string | null;
  /** Set when a limit is reached (`rate_limit_reached`, a workspace's credits or usage limit). */
  rateLimitReachedType: string | null;
}

export interface GetAccountRateLimitsResponse {
  /** The single-bucket view (Codex's own, `codex`). */
  rateLimits: RateLimitSnapshot;
  /** Every bucket by its `limitId`, when Codex has more than one. */
  rateLimitsByLimitId: Record<string, RateLimitSnapshot | undefined> | null;
}

/** The requests Phase 3 makes for usage. Reading the limits costs no tokens. */
export interface UsageMethods {
  'account/rateLimits/read': { params: { excludeResetCreditDetails?: boolean }; result: GetAccountRateLimitsResponse };
}

/* --- Fork and Ask about this session (Phase 3) -------------------------------------------------------------------- */

export interface ThreadForkParams {
  threadId: string;
  /** The last turn the fork keeps, inclusive; all of them when left out. It can't be a turn in progress. */
  lastTurnId?: string | null;
  /** A throwaway fork, never written to disk (Ask about this session). */
  ephemeral?: boolean;
  /** Seshboard reads the history itself (`thread/turns/list`). */
  excludeTurns?: boolean;
  cwd?: string | null;
  model?: string | null;
  approvalPolicy?: AskForApproval | null;
  sandbox?: SandboxMode | null;
  /** Codex's config for the fork, merged over the profile's (`noMcpConfig` for Ask). */
  config?: Record<string, unknown> | null;
}

// Added to the requests that drive a thread (declaration merging keeps this block apart from the others').
export interface DriveMethods {
  /** A new thread with the source's history (through `lastTurnId`); the new one is loaded and subscribed. */
  'thread/fork': { params: ThreadForkParams; result: ThreadStartResponse };
}
