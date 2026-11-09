import { toolStepLabel, VISUAL_GUIDE_TOOL, VISUAL_TOOL } from '@seshboard/protocol/client';
import type { StreamingBlock } from '../../state/hostsStore.ts';

/** The tool Claude is starting, as the working line says it: a visual by what it does, others by name. */
export const usingLabel = (tool: string): string => (tool === VISUAL_TOOL || tool === VISUAL_GUIDE_TOOL ? toolStepLabel(tool, {}, null).present : `Using ${tool}`);

/**
 * The working line under a reply, in a few words: waiting for you, compacting, the tool Claude is using, thinking, or
 * working. Home's Working cards say the same. Pure, for testing.
 */
export function workingLabel(state: { waiting: boolean; compacting: boolean; block: StreamingBlock | undefined }): string {
  if (state.waiting) return 'Waiting for you';
  if (state.compacting) return 'Compacting the conversation';
  if (state.block?.kind === 'tool') return usingLabel(state.block.text);
  if (state.block?.kind === 'thinking') return 'Thinking';
  return 'Working';
}
