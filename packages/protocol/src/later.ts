import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';
import { MAX_CONTEXT_ITEMS } from './companionConstants.ts';
import { ContextItem } from './context.ts';
import { Effort, ImageAttachment, PermissionMode } from './host.ts';
import { MAX_PROMPT_LENGTH } from './promptConstants.ts';

// The queue. People see "Queue" everywhere; inside, it keeps the name it started with (the Later list), so the
// RPCs (`later.*`), the table (`later_prompts`) and the stores didn't need renaming.

/** What a queued prompt starts with: the folder and the choices from New session. */
export const LaterDraft = z.object({
  /** The folder the session would start in (a project's root). */
  cwd: AbsolutePath,
  prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
  /** Images pasted or dropped into the message box, sent with the prompt when it starts. */
  attachments: z.array(ImageAttachment).max(20).default([]),
  /**
   * What was typed and the files and text added as context, kept apart so the box shows them as it did (the
   * chips stay chips). `prompt` is the two put together, which is what starts. Items without `typed` hold only `prompt`.
   */
  typed: z.string().max(MAX_PROMPT_LENGTH).nullable().default(null),
  context: z.array(ContextItem).max(MAX_CONTEXT_ITEMS).default([]),
  model: z.string().max(200).nullable().default(null),
  effort: Effort.nullable().default(null),
  permissionMode: PermissionMode.default('default'),
  workspace: z.enum(['current', 'worktree']).default('current'),
  baseRef: z.enum(['fresh', 'head']).default('fresh'),
  /** A branch to check out first (current checkout only); null keeps what is checked out. */
  branch: z.string().min(1).max(250).nullable().default(null),
  /** A profile picked for this session only; null uses the project's, else the default. */
  profileId: z.string().min(1).max(100).nullable().default(null),
  /**
   * Start by itself: it starts once what it waits for has finished cleanly, instead of only turning ready. Only counts
   * while it waits for something; with `waitFor` set to nothing, saving turns it off.
   */
  autoStart: z.boolean().default(false),
});
export type LaterDraft = z.input<typeof LaterDraft>;

/**
 * What a queued item waits for before it is ready to start. Ready means the item says so (and the app offers to
 * start it); only an item with `autoStart` starts by itself, in the engine.
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

/**
 * How the turn of a session that queued items wait on ended. `clean`: a normal end. `error`: an error result (or the
 * process failed). `stopped`: you stopped Claude mid-turn, or closed the session while it worked. `quit`: no end was
 * seen in this run, usually because Switchboard closed while it worked; nothing starts after it.
 */
export const SessionOutcome = z.enum(['clean', 'error', 'stopped', 'quit']);
export type SessionOutcome = z.infer<typeof SessionOutcome>;

/**
 * What the engine knows about starting items by themselves, sent with the queue: how the sessions they wait on ended,
 * and the items that are ready but wait for a free slot under the focus limit.
 */
export const QueueAuto = z.object({
  outcomes: z.array(z.object({ sessionId: z.string(), outcome: SessionOutcome })),
  /** Items that would start now, but the focus limit is reached: they start when a slot frees. */
  focusHeld: z.array(z.string()),
});
export type QueueAuto = z.infer<typeof QueueAuto>;
