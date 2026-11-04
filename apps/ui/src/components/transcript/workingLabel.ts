import type { StreamingBlock } from '../../state/hostsStore.ts';

/**
 * The working line under a reply, in a few words: waiting for you, compacting, the tool Claude is using, thinking, or
 * working. Home's Working cards say the same. Pure, for testing.
 */
export function workingLabel(state: { waiting: boolean; compacting: boolean; block: StreamingBlock | undefined }): string {
  if (state.waiting) return 'Waiting for you';
  if (state.compacting) return 'Compacting the conversation';
  if (state.block?.kind === 'tool') return `Using ${state.block.text}`;
  if (state.block?.kind === 'thinking') return 'Thinking';
  return 'Working';
}
