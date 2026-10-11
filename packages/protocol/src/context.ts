import { z } from 'zod';
import { AbsolutePath } from './absolutePath.ts';
import { MAX_CONTEXT_ITEMS } from './companionConstants.ts';

/** Lines `start` to `end` of a file, counted from 1, both included. */
export const LineRange = z
  .object({ start: z.number().int().min(1), end: z.number().int().min(1) })
  .refine((range) => range.end >= range.start, 'A range ends on or after the line it starts on');
export type LineRange = z.infer<typeof LineRange>;

/**
 * Something added to a message as context (a chip in the message box), before it is sent.
 *
 * - `file`: a file or folder by reference, optionally a range of lines. Claude reads it itself, so a large
 *   selection stays small.
 * - `text`: text that isn't a file on disk, or not as it is on disk: a selection with unsaved changes,
 *   problems, terminal output. `path` and `range` say where it came from, when it came from a file.
 */
export const ContextItem = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('file'),
    path: AbsolutePath,
    directory: z.boolean().default(false),
    range: LineRange.optional(),
  }),
  z.object({
    kind: z.literal('text'),
    source: z.enum(['selection', 'problems', 'terminal', 'output']),
    /** What the chip says, such as "Problems in auth.ts". */
    label: z.string().trim().min(1).max(200),
    text: z.string().max(200_000),
    path: AbsolutePath.optional(),
    range: LineRange.optional(),
    /** The language of the text, for the code fence (`ts`, `python`). */
    language: z.string().max(40).regex(/^[\w+#.-]*$/).optional(),
  }),
]);
export type ContextItem = z.infer<typeof ContextItem>;
/** A context item as it is sent (defaults may be left out). */
export type ContextItemInput = z.input<typeof ContextItem>;

/** The items for one message. */
export const ContextItems = z.array(ContextItem).min(1).max(MAX_CONTEXT_ITEMS);
