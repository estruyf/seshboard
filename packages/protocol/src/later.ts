import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';
import { Effort, ImageAttachment, PermissionMode } from './host.ts';

// The queue. People see "Queue" everywhere; inside, it keeps the name it started with (the Later list), so the
// RPCs (`later.*`), the table (`later_prompts`) and the stores didn't need renaming.

/** What a queued prompt starts with: the folder and the choices from New session. */
export const LaterDraft = z.object({
  /** The folder the session would start in (a project's root). */
  cwd: AbsolutePath,
  prompt: z.string().trim().min(1).max(200_000),
  /** Images pasted or dropped into the message box, sent with the prompt when it starts. */
  attachments: z.array(ImageAttachment).max(20).default([]),
  model: z.string().max(200).nullable().default(null),
  effort: Effort.nullable().default(null),
  permissionMode: PermissionMode.default('default'),
  workspace: z.enum(['current', 'worktree']).default('current'),
  baseRef: z.enum(['fresh', 'head']).default('fresh'),
  /** A branch to check out first (current checkout only); null keeps what is checked out. */
  branch: z.string().min(1).max(250).nullable().default(null),
  /** A profile picked for this session only; null uses the project's, else the default. */
  profileId: z.string().min(1).max(100).nullable().default(null),
});
export type LaterDraft = z.input<typeof LaterDraft>;

/**
 * What a queued item waits for before it is ready to start. Nothing ever starts by itself: ready only means
 * the item says so (and the app offers to start it).
 * - `project`: no session is busy in its project (or a worktree of it).
 * - `session`: that session isn't busy, or is closed.
 * - `item`: another queued item has been started and its session isn't busy.
 * - `none`: nothing; it stays queued until you start it.
 */
export const QueueWaitFor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('project') }),
  z.object({ kind: z.literal('session'), sessionId: z.string().min(1).max(100) }),
  z.object({ kind: z.literal('item'), itemId: z.string().min(1).max(100) }),
  z.object({ kind: z.literal('none') }),
]);
export type QueueWaitFor = z.infer<typeof QueueWaitFor>;

/** A prompt on the queue, to start later. */
export const LaterItem = LaterDraft.extend({
  id: z.string(),
  createdAt: z.number(),
  /** Queue order, lower first. New items go at the end. */
  position: z.number().int(),
  waitFor: QueueWaitFor,
});
export type LaterItem = z.infer<typeof LaterItem>;

/** A queued item that was started, and the session it became: an item waiting on it follows that session. */
export const QueueStarted = z.object({ itemId: z.string(), sessionId: z.string() });
export type QueueStarted = z.infer<typeof QueueStarted>;
