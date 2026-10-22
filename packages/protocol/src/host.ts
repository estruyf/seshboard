import { z } from 'zod';
import { isBranchName } from './githubRepo.ts';
import { UsageLimitHit } from './usageLimit.ts';
import { isWorktreeBase, type WorktreeBase } from './worktreeBase.ts';

/** Permission modes the UI can switch between (bypassPermissions is deliberately not offered). */
export const PermissionMode = z.enum(['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions']);
export type PermissionMode = z.infer<typeof PermissionMode>;

export const Effort = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export type Effort = z.infer<typeof Effort>;

/** One of the models Auto can pick. */
export const AutoTierSchema = z.enum(['haiku', 'sonnet', 'opus']);

/** What Auto decided for a session (see `AutoPickInfo`): kept with the session, so it survives a restart. */
export const AutoPick = z.object({
  /** Null: picking failed, and the session runs on the default model. */
  model: AutoTierSchema.nullable(),
  reason: z.string().max(500),
  at: z.number(),
  tokens: z.number().int().min(0),
  allowed: z.array(AutoTierSchema).max(3),
  /** You changed the model since. */
  left: z.boolean().optional(),
});
export type AutoPick = z.infer<typeof AutoPick>;

/** State of a session this app is running (an active Claude Code process owned by the engine). */
export const HostState = z.enum(['starting', 'running', 'needs-you', 'idle', 'closed', 'error']);
export type HostState = z.infer<typeof HostState>;

/** The context window's contents, as Claude Code's /context counts them. */
export const ContextUsage = z.object({
  totalTokens: z.number(),
  maxTokens: z.number(),
  percentage: z.number(),
  model: z.string(),
  categories: z.array(z.object({ name: z.string(), tokens: z.number(), color: z.string(), kind: z.string() })),
});
export type ContextUsage = z.infer<typeof ContextUsage>;

/** What rewinding files to a message changes (or would change, for a dry run). */
export const RewindResult = z.object({
  canRewind: z.boolean(),
  error: z.string().nullable(),
  files: z.array(z.string()),
  insertions: z.number(),
  deletions: z.number(),
});
export type RewindResult = z.infer<typeof RewindResult>;

/** Work Claude Code keeps running after a turn ends: a background shell command, subagent or workflow. */
export const BackgroundTask = z.object({
  taskId: z.string(),
  /** Claude Code's task type, e.g. `local_bash` or `local_agent`. */
  type: z.string(),
  description: z.string(),
  /** When this app first saw it running (Claude Code doesn't report the start of tasks begun before a restart). */
  startedAt: z.number(),
});
export type BackgroundTask = z.infer<typeof BackgroundTask>;

/** A message waiting for Claude's turn to end. Images stay in the engine; the window only sees their names. */
export const QueuedMessage = z.object({
  id: z.string(),
  text: z.string(),
  /** Names of the attached images (a generic name when one has none). */
  attachments: z.array(z.string()),
  createdAt: z.number(),
});
export type QueuedMessage = z.infer<typeof QueuedMessage>;

/** What a message does while Claude is working: wait for the turn to end, join the turn at its next step, or stop it. */
export const SendMode = z.enum(['queue', 'steer', 'now']);
export type SendMode = z.infer<typeof SendMode>;

export const SessionHostInfo = z.object({
  sessionId: z.string(),
  /** The session's working directory (the worktree path for worktree sessions, once known). */
  cwd: z.string(),
  state: HostState,
  model: z.string().nullable(),
  permissionMode: PermissionMode,
  effort: Effort.nullable(),
  /** Cost reported by Claude Code for this process so far. */
  costUsd: z.number(),
  contextPercent: z.number().nullable(),
  /** Tokens in the context window now, and its size (from Claude Code, once it has started). */
  contextTokens: z.number().nullable(),
  contextMax: z.number().nullable(),
  /**
   * When the conversation last used Anthropic's prompt cache (its last request), and for how long the cache keeps it
   * (`contextCache.ts`). Null or missing until a turn ran here.
   */
  cacheAt: z.number().nullable().optional(),
  cacheTtl: z.enum(['5m', '1h']).nullable().optional(),
  error: z.string().nullable(),
  startedAt: z.number(),
  /** When you last sent a message (null before the first). The Working list orders by it, so sessions don't trade places as they write. */
  promptedAt: z.number().nullable(),
  /**
   * Messages you queued while Claude was busy, in the order they will be sent: one when each turn ends. They are not
   * in the transcript until they are sent.
   */
  queue: z.array(QueuedMessage),
  /**
   * Why the queue isn't sending by itself: you stopped Claude, its turn failed, or the messages were kept from before
   * the session stopped or the app quit (`saved`). Null while it moves on its own.
   */
  queueHold: z.enum(['stopped', 'error', 'saved']).nullable(),
  /** The Claude profile (login) this process runs with. */
  profileId: z.string(),
  /** Background tasks still running; the session can be idle (ready for a message) while these work. */
  backgroundTasks: z.array(BackgroundTask),
  /** Auto picked the model this session started on (null or missing: it didn't). */
  autoPick: AutoPick.nullable().optional(),
  /** Auto is still picking the model this session starts on; your first message waits for it. */
  autoChoosing: z.boolean().optional(),
  /** Its profile is at a plan usage limit: what is queued waits, and new sessions in the profile wait too. */
  usageLimit: UsageLimitHit.nullable().optional(),
});
export type SessionHostInfo = z.infer<typeof SessionHostInfo>;

export const PermissionRequest = z.object({
  requestId: z.string(),
  sessionId: z.string(),
  toolName: z.string(),
  toolUseId: z.string().nullable(),
  input: z.json(),
  /** Claude Code's own prompt text, e.g. "Claude wants to run npm test". */
  title: z.string().nullable(),
  description: z.string().nullable(),
  decisionReason: z.string().nullable(),
  blockedPath: z.string().nullable(),
  /** What "Always allow" would do, e.g. `Allow Bash(npm test:*) in this project`. Null when not offered. */
  alwaysLabel: z.string().nullable(),
  /** Set when a subagent asked. */
  agentId: z.string().nullable(),
  createdAt: z.number(),
});
export type PermissionRequest = z.infer<typeof PermissionRequest>;

export const PermissionDecision = z.discriminatedUnion('behavior', [
  z.object({
    behavior: z.literal('allow'),
    /** Apply Claude Code's suggested rule so it doesn't ask again. */
    always: z.boolean().default(false),
    /** Replaces the tool input, e.g. AskUserQuestion answers or an edited command. */
    updatedInput: z.record(z.string(), z.json()).optional(),
  }),
  z.object({
    behavior: z.literal('deny'),
    message: z.string().default('The user declined this action.'),
    /** Also stop the current turn. */
    interrupt: z.boolean().default(false),
  }),
]);
export type PermissionDecision = z.input<typeof PermissionDecision>;

/** Incremental output of the block Claude is writing right now (cleared when the block is complete). */
export const StreamDelta = z.object({
  sessionId: z.string(),
  kind: z.enum(['text', 'thinking', 'tool', 'clear']),
  /** Text to append for text/thinking; the tool name for `tool`. */
  text: z.string(),
});
export type StreamDelta = z.infer<typeof StreamDelta>;

export const ImageAttachment = z.object({
  type: z.literal('image'),
  mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
  /** Base64 without the data: prefix. ~7.5 MB of image max. */
  data: z.string().max(10_000_000),
  name: z.string().max(200).optional(),
});
export type ImageAttachment = z.infer<typeof ImageAttachment>;

export const SlashCommand = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
});
export type SlashCommand = z.infer<typeof SlashCommand>;

export const ModelOption = z.object({
  value: z.string(),
  /** The full model id an alias resolves to (`opus` → `claude-opus-…`), so a running session's model can be matched to its row. */
  resolvedModel: z.string().optional(),
  displayName: z.string(),
  description: z.string(),
  supportsEffort: z.boolean(),
});
export type ModelOption = z.infer<typeof ModelOption>;

/**
 * A branch a new worktree starts from, which the engine makes itself (`git/worktreeFrom.ts`): Claude Code's own setting
 * only knows `fresh` and `head`. With `pullRequest`, the branch is that pull request's: it is fetched first
 * (`pull/<n>/head`, which works for forks too) and the worktree works on it, at the pull request's latest commit.
 */
export const WorktreeBranchBase = z.object({
  branch: z.string().min(1).max(250).refine(isBranchName, 'Not a branch name git takes'),
  /** Start from this remote's copy of the branch (`origin/dev`), fetched first, rather than the local branch. */
  remote: z.string().regex(/^[A-Za-z0-9._][A-Za-z0-9._-]{0,99}$/, 'Not a remote name').optional(),
  pullRequest: z.number().int().positive().optional(),
  /** The pull request is from a fork: its branch isn't on this repository's remote, so the worktree tracks nothing. */
  fork: z.boolean().optional(),
});
export type WorktreeBranchBase = z.infer<typeof WorktreeBranchBase>;

/**
 * A worktree base as New session, a project's defaults, the queue and triggers keep it: `fresh`, `head`, or a branch's
 * full ref (`refs/heads/dev`, `refs/remotes/origin/dev`). `worktreeRequestBase` turns it into what `session.create` takes.
 */
export const WorktreeBaseSchema = z.custom<WorktreeBase>(isWorktreeBase, 'Choose fresh, head or a branch');

export const WorktreeRequest = z.object({
  name: z.string().regex(/^[A-Za-z0-9._-]{1,60}$/, 'Use letters, digits, dot, dash or underscore'),
  /** `fresh` = from origin's default branch (Claude Code's default); `head` = from the current local HEAD; or a branch. */
  baseRef: z.union([z.enum(['fresh', 'head']), WorktreeBranchBase]),
});
export type WorktreeRequest = z.infer<typeof WorktreeRequest>;
/** A worktree Claude Code makes itself (`--worktree`): from origin's default branch or the local HEAD. */
export type ClaudeWorktreeRequest = WorktreeRequest & { baseRef: 'fresh' | 'head' };

export const ProjectInspection = z.object({
  path: z.string(),
  /** True only for a folder. */
  exists: z.boolean(),
  /** The path is a file, so `exists` is false; New session says so instead of "no longer exists". */
  isFile: z.boolean().optional(),
  isGitRepo: z.boolean(),
  root: z.string(),
  branch: z.string().nullable(),
});
export type ProjectInspection = z.infer<typeof ProjectInspection>;

/** A folder offered while typing a path in New session (`fs.folders`). */
export const FolderEntry = z.object({
  name: z.string(),
  path: z.string(),
  /** The folder is the top of a git checkout. */
  isGit: z.boolean(),
  branch: z.string().nullable(),
});
export type FolderEntry = z.infer<typeof FolderEntry>;

export const EditorInfo = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['editor', 'terminal', 'finder']),
});
export type EditorInfo = z.infer<typeof EditorInfo>;
