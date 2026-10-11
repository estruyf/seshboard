import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';
import { Effort, PermissionMode } from './host.ts';

/** Where a session was started, derived from Claude Code's `entrypoint`. */
export const SessionOrigin = z.enum(['cli', 'desktop', 'ide', 'sdk', 'app', 'unknown']);
export type SessionOrigin = z.infer<typeof SessionOrigin>;

export const WorktreeInfo = z.object({
  /** Folder name under `<repo>/.claude/worktrees/` (or the worktree folder name). */
  name: z.string(),
  /** Current branch checked out in the worktree, read from git. */
  branch: z.string().nullable(),
});
export type WorktreeInfo = z.infer<typeof WorktreeInfo>;

/** One session in the sidebar. Built from the transcript on disk; never the source of truth. */
export const SessionSummary = z.object({
  id: z.string(),
  /** Custom title, AI title, or first prompt, in that order. */
  title: z.string(),
  firstPrompt: z.string().nullable(),
  customTitle: z.string().nullable(),
  cwd: z.string().nullable(),
  /** Grouping key: the main repository root (worktrees fold into their repo), or the cwd outside git. */
  projectRoot: z.string(),
  /** Branch recorded in the transcript. For worktree sessions prefer `worktree.branch`. */
  gitBranch: z.string().nullable(),
  worktree: WorktreeInfo.nullable(),
  origin: SessionOrigin,
  createdAt: z.number().nullable(),
  updatedAt: z.number(),
  fileSize: z.number().nullable(),
  tag: z.string().nullable(),
  /** Kept at the top of the list. */
  pinned: z.boolean(),
  /** When the user archived it by hand; new activity after this brings it back to the main list. */
  archivedAt: z.number().nullable(),
  /** When the user last looked at it in this app. */
  viewedAt: z.number().nullable(),
  /** Changed since the user last looked at it. */
  unread: z.boolean(),
  /** Started, forked or continued in Switchboard (the default sidebar shows only these). */
  inApp: z.boolean(),
  /** The Claude profile whose config folder holds the transcript (resume and fork use it). */
  profileId: z.string(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const ProjectIcon = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('image'), dataUrl: z.string().max(300_000) }),
  z.object({ kind: z.literal('emoji'), value: z.string().min(1).max(16) }),
]);
export type ProjectIcon = z.infer<typeof ProjectIcon>;

/** How the user can set a project's icon. */
export const ProjectIconChoice = z.discriminatedUnion('kind', [
  /** Go back to the detected icon (or the letter when nothing is found). */
  z.object({ kind: z.literal('auto') }),
  /** Always use the letter. */
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('emoji'), value: z.string().min(1).max(16) }),
  z.object({ kind: z.literal('file'), path: AbsolutePath }),
]);
export type ProjectIconChoice = z.infer<typeof ProjectIconChoice>;

/**
 * What a new session in a project starts with. Null fields fall back to the global
 * defaults (the choices last used in the New session view).
 */
export const ProjectDefaults = z.object({
  model: z.string().max(200).nullable().default(null),
  effort: Effort.nullable().default(null),
  permissionMode: PermissionMode.nullable().default(null),
  workspace: z.enum(['current', 'worktree']).nullable().default(null),
  /** For a new worktree: branch from origin's default branch (`fresh`) or the local HEAD. */
  baseRef: z.enum(['fresh', 'head']).nullable().default(null),
  /** For the current folder: a branch to check out before the session starts (null keeps what is checked out). */
  branch: z.string().min(1).max(250).nullable().default(null),
});
export type ProjectDefaults = z.infer<typeof ProjectDefaults>;

export const ProjectInfo = z.object({
  root: z.string(),
  /** The name you gave the project, else its folder's name. */
  name: z.string(),
  /** `custom` when you renamed it. */
  nameSource: z.enum(['custom', 'folder']),
  icon: ProjectIcon.nullable(),
  iconSource: z.enum(['custom', 'detected']).nullable(),
  /** Added to Switchboard by hand. Folders that only have Claude Code sessions are listed with `added: false`. */
  added: z.boolean(),
  exists: z.boolean(),
  /** Position in the user's project list (null: after the ordered ones). */
  order: z.number().nullable(),
  defaults: ProjectDefaults,
  /** The Claude profile new sessions here use (null: the default profile). */
  profileId: z.string().nullable(),
  /** Claude Code sessions in this folder (from every app) and when the newest one was active. */
  sessionCount: z.number(),
  lastActivity: z.number().nullable(),
});
export type ProjectInfo = z.infer<typeof ProjectInfo>;

/** Normalised live state from the `~/.claude/sessions` registry. */
export const LiveStatus = z.enum(['running', 'needs-you', 'idle']);
export type LiveStatus = z.infer<typeof LiveStatus>;

export const LiveSession = z.object({
  sessionId: z.string(),
  pid: z.number(),
  cwd: z.string().nullable(),
  projectRoot: z.string().nullable(),
  status: LiveStatus,
  /** The registry's own status string, kept for display and debugging. */
  rawStatus: z.string(),
  name: z.string().nullable(),
  origin: SessionOrigin,
  startedAt: z.number().nullable(),
  updatedAt: z.number().nullable(),
  /** The profile whose config folder registered this process. */
  profileId: z.string(),
  /** Descriptions of background tasks still running. Only known for sessions running in this app. */
  background: z.array(z.string()).optional(),
});
export type LiveSession = z.infer<typeof LiveSession>;

/**
 * An image in a transcript, by reference: the data stays in the engine and is
 * fetched with `transcript.image` when it scrolls into view.
 */
export const ImageRef = z.object({
  /** Stable within the session: `<message uuid>:<block>:<part>`. */
  imageId: z.string(),
  mediaType: z.string(),
  /** Approximate size of the decoded image. */
  bytes: z.number(),
  /** Pixel size, read from the image's header; missing for a format the engine can't read. */
  width: z.number().optional(),
  height: z.number().optional(),
});
export type ImageRef = z.infer<typeof ImageRef>;

export const TranscriptBlock = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({ type: z.literal('thinking'), text: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    id: z.string(),
    name: z.string(),
    /** Tool input with long strings shortened (see `truncated`). */
    input: z.json(),
    truncated: z.boolean(),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolUseId: z.string(),
    isError: z.boolean(),
    text: z.string(),
    truncated: z.boolean(),
    /** Images the tool returned (e.g. Read on a screenshot). */
    images: z.array(ImageRef),
  }),
  /** `ref` is null when the image is not stored inline (e.g. a URL source). */
  z.object({ type: z.literal('image'), mediaType: z.string().nullable(), ref: ImageRef.nullable() }),
  /** Anything we don't render yet; kept so the UI can show a placeholder instead of dropping it. */
  z.object({ type: z.literal('unknown'), kind: z.string() }),
]);
export type TranscriptBlock = z.infer<typeof TranscriptBlock>;

export const TranscriptMessage = z.object({
  uuid: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  timestamp: z.number().nullable(),
  /** Set for messages produced inside a subagent (Task/Agent tool). */
  parentToolUseId: z.string().nullable(),
  model: z.string().nullable(),
  blocks: z.array(TranscriptBlock),
  /** Token counts Claude reported for an assistant message (how full the context was then). */
  usage: z.object({ input: z.number(), output: z.number(), cacheRead: z.number(), cacheCreation: z.number() }).nullable().optional(),
});
export type TranscriptMessage = z.infer<typeof TranscriptMessage>;

/** One message matching a search. `snippet` marks matched words with \u0002 … \u0003. */
export const SearchHit = z.object({
  sessionId: z.string(),
  messageUuid: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  at: z.number().nullable(),
  snippet: z.string(),
});
export type SearchHit = z.infer<typeof SearchHit>;

export const SessionsSnapshot = z.object({
  sessions: z.array(SessionSummary),
  live: z.array(LiveSession),
  /** False while the list comes from the cache and the first scan of ~/.claude has not finished. */
  complete: z.boolean(),
});
export type SessionsSnapshot = z.infer<typeof SessionsSnapshot>;

export const SessionsChanged = z.object({
  upserted: z.array(SessionSummary),
  removed: z.array(z.string()),
  complete: z.boolean(),
});
export type SessionsChanged = z.infer<typeof SessionsChanged>;

export const TranscriptUpdate = z.object({
  sessionId: z.string(),
  /** `append` when the new messages extend what was sent before; `replace` after rewinds or compaction. */
  mode: z.enum(['append', 'replace']),
  messages: z.array(TranscriptMessage),
  /** Set (with an empty `replace`) when the first read of the transcript failed; `transcript.diagnose` says more. */
  error: z.string().optional(),
});
export type TranscriptUpdate = z.infer<typeof TranscriptUpdate>;

/** One transcript file for a session, as found on disk, and what is in it. */
export const TranscriptFileCheck = z.object({
  path: z.string(),
  size: z.number(),
  modifiedAt: z.number(),
  lines: z.number(),
  /** Lines that aren't valid JSON (Claude Code's reader skips them). */
  badLines: z.number(),
  /** Your prompts and Claude's replies (and tool results) in the file, before any compaction is applied. */
  messages: z.number(),
  compactions: z.number(),
  /** False when the last line has no newline yet: Claude Code may still be writing it. */
  complete: z.boolean(),
});
export type TranscriptFileCheck = z.infer<typeof TranscriptFileCheck>;

/** What one Claude profile's folder holds for a session, and what Claude Code's reader made of it. */
export const TranscriptProfileCheck = z.object({
  profileId: z.string(),
  configDir: z.string(),
  files: z.array(TranscriptFileCheck),
  /** Messages the reader returned; null when it failed. */
  read: z.number().nullable(),
  readMs: z.number(),
  error: z.string().nullable(),
  /** The error's stack, shortened, for a bug report. */
  stack: z.string().nullable(),
});
export type TranscriptProfileCheck = z.infer<typeof TranscriptProfileCheck>;

export const TranscriptFinding = z.object({
  tone: z.enum(['error', 'warn', 'info', 'ok']),
  text: z.string(),
});
export type TranscriptFinding = z.infer<typeof TranscriptFinding>;

/** Why a session's conversation shows the way it does (or doesn't): `transcript.diagnose`. */
export const TranscriptDiagnosis = z.object({
  sessionId: z.string(),
  checkedAt: z.number(),
  /** The file Switchboard's session list knows the session by, if any. */
  indexedPath: z.string().nullable(),
  profiles: z.array(TranscriptProfileCheck),
  /** Plain-language conclusions, most serious first. */
  findings: z.array(TranscriptFinding),
});
export type TranscriptDiagnosis = z.infer<typeof TranscriptDiagnosis>;
