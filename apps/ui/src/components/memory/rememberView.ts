import { firstSentence, MEMORY_INDEX_LIMIT, slugify } from '@switchboard/protocol/client';

/** Who wrote the text you want remembered: you (your prompt) or Claude (its reply). */
export type RememberFrom = 'user' | 'claude';

/** A name for a memory from its text: the first words of its first sentence, as a slug. */
export function suggestName(text: string): string {
  const sentence = firstSentence(text, 200) || text;
  const words = sentence.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
  return slugify(words).slice(0, 40).replace(/-+$/, '') || 'memory';
}

/** A name that isn't taken in the folder: the name itself, or with `-2`, `-3`, … */
export function uniqueName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) if (!used.has(`${name}-${n}`.toLowerCase())) return `${name}-${n}`;
}

/** Your own words are about you; Claude's are usually about the project. */
export const defaultType = (from: RememberFrom) => (from === 'user' ? 'user' : 'project');

/** "Adds 1 line to MEMORY.md (187 of 200)", and whether that goes past what Claude Code reads. */
export function addsLineNote(indexLines: number): { text: string; over: boolean } {
  const after = indexLines + 1;
  return { text: `Adds 1 line to MEMORY.md (${after} of ${MEMORY_INDEX_LIMIT})`, over: after > MEMORY_INDEX_LIMIT };
}

/** The metadata a remembered memory gets: the session it came from, and that Switchboard wrote it. */
export const rememberMetadata = (sessionId: string | null): Record<string, string> => ({ ...(sessionId ? { originSessionId: sessionId } : {}), source: 'switchboard' });
