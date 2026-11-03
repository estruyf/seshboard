import { looseEndText, type GitLooseEnd, type LooseEnd } from '@seshboard/protocol/client';

/** Everything a session left behind: git's and GitHub's, then an unsent message and a queued prompt. */
export function rowLooseEnds(git: readonly GitLooseEnd[], others: { draft: boolean; queued: boolean }): LooseEnd[] {
  return [...git, ...(others.draft ? [{ kind: 'draft' as const }] : []), ...(others.queued ? [{ kind: 'queued' as const }] : [])];
}

/** The row's tooltip and label: one line per loose end. */
export const looseEndLines = (ends: readonly LooseEnd[]): string[] => ends.map(looseEndText);

/** For the Done toast: what's left, in one short sentence ("3 files not committed, 2 commits not pushed"). */
export function leftBehind(ends: readonly LooseEnd[]): string | null {
  if (ends.length === 0) return null;
  const lines = looseEndLines(ends);
  return lines.length <= 2 ? lines.join(', ') : `${lines.slice(0, 2).join(', ')} and ${lines.length - 2} more`;
}
