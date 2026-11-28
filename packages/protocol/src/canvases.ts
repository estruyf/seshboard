import { z } from 'zod';

/** What a canvas is doing: not started, starting (its process or its page), showing its page, or its last run failed. */
export const CanvasState = z.enum(['stopped', 'starting', 'running', 'failed']);
export type CanvasState = z.infer<typeof CanvasState>;

/** A line of a canvas's log: what the canvas wrote (stdout, stderr, `host.log`), or what Seshboard did with it. */
export const CanvasLogLine = z.object({
  at: z.number(),
  level: z.enum(['info', 'warn', 'error']),
  from: z.enum(['canvas', 'seshboard']),
  text: z.string(),
});
export type CanvasLogLine = z.infer<typeof CanvasLogLine>;

/** A project's canvas as a session's rail lists it (docs/canvases.md). */
export const CanvasListed = z.object({
  /** Its folder's name in `.seshboard/canvases`. */
  id: z.string(),
  /** The canvas's own name once it ran, its folder's name in words before. */
  name: z.string(),
  description: z.string().nullable(),
  /** Its folder, for the trust question. */
  dir: z.string(),
  /** Its `canvas.mjs` now: what you trust, and what `canvases.trust` checks you saw. */
  hash: z.string(),
  /** It runs only after you said yes to this exact file. */
  trusted: z.boolean(),
  state: CanvasState,
  /** You stopped it: it stays stopped until you start it again. */
  held: z.boolean(),
  /** Its page, on this computer, while it runs. */
  url: z.string().nullable(),
  /** The page's own title for the panel, when the canvas gave one. */
  title: z.string().nullable(),
  /** The partition its page lives in (`isCanvasPartition`). */
  partition: z.string(),
  /** Why its last run ended, while `failed`. */
  error: z.string().nullable(),
});
export type CanvasListed = z.infer<typeof CanvasListed>;
