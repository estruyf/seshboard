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
  capabilities: null;
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
  | { type: 'text'; text: string }
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

export type UserMessageItem = ItemTimes & { type: 'userMessage'; id: string; content: UserInput[] };
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
export type WebSearchItem = ItemTimes & { type: 'webSearch'; id: string; query: string; action: WebSearchAction | null };
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
