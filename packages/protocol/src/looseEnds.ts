/**
 * Loose ends (session triage): what a session left behind that still needs you, from git and GitHub. Plain TypeScript,
 * for the engine (which finds them), the renderer (the row's marker and the Done toast) and their tests.
 */

/** One thing a session left behind. `pr` is the pull request's number. */
export type GitLooseEnd =
  | { kind: 'uncommitted'; files: number }
  | { kind: 'unpushed'; commits: number }
  | { kind: 'checks-failing'; pr: number; failed: number }
  | { kind: 'pr-closed'; pr: number };

/** What the renderer adds to them: an unsent message and a queued prompt (it knows those already). */
export type LooseEnd = GitLooseEnd | { kind: 'draft' } | { kind: 'queued' };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One loose end in a few words: "3 files not committed", "Checks failing on #12". */
export function looseEndText(end: LooseEnd): string {
  switch (end.kind) {
    case 'uncommitted':
      return `${plural(end.files, 'file')} not committed`;
    case 'unpushed':
      return `${plural(end.commits, 'commit')} not pushed`;
    case 'checks-failing':
      return `Checks failing on #${end.pr}`;
    case 'pr-closed':
      return `#${end.pr} closed without merging`;
    case 'draft':
      return 'An unsent message';
    case 'queued':
      return 'A queued prompt';
  }
}

/** The same two loose ends: what changed, for the cache and the event. */
export const sameLooseEnds = (a: readonly GitLooseEnd[], b: readonly GitLooseEnd[]): boolean => JSON.stringify(a) === JSON.stringify(b);
