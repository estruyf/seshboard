import type { TranscriptMessage, TranscriptUpdate } from '@seshboard/protocol/client';

/**
 * The transcript after an update: a `replace` is the new list, an `append` adds to the end, a `splice` keeps the
 * messages before `at` (the same objects, so their rows don't render again) and puts the new ones after them.
 */
export function applyTranscriptUpdate(current: readonly TranscriptMessage[], update: Pick<TranscriptUpdate, 'mode' | 'messages' | 'at'>): TranscriptMessage[] {
  if (update.mode === 'replace') return update.messages;
  if (update.mode === 'splice') return current.slice(0, update.at ?? 0).concat(update.messages);
  return [...current, ...update.messages];
}
