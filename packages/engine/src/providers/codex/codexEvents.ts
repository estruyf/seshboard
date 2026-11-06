import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { Turn } from './protocol.ts';

/**
 * A Codex thread's turns (oldest first, read with `itemsView: 'full'`) as the messages Seshboard reads from Claude Code.
 * Pure. Subagents' own threads are separate threads, so nothing is left out here.
 */
export function codexMessages(_turns: readonly Turn[]): RawSessionMessage[] {
  throw new Error('codexMessages: not built yet');
}

/** The first prompt's text, for a session's first prompt and title. */
export function codexFirstPrompt(_turns: readonly Turn[]): string | undefined {
  throw new Error('codexFirstPrompt: not built yet');
}

/**
 * The thread of the subagent a tool call started (`toolUseId`, as `codexMessages` names it), from the parent's turns.
 * Undefined when the call started none.
 */
export function codexSubagentThread(_turns: readonly Turn[], _toolUseId: string): string | undefined {
  throw new Error('codexSubagentThread: not built yet');
}
