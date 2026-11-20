import type { RemoteArchivedSession } from '@seshboard/protocol/remote-client';
import { listKey } from './everywhere.ts';
import { age } from './groups.ts';

/**
 * The Done page: every paired computer's sessions in Done (the sidebar's Archived), so one archived by mistake can be
 * reopened from the phone. Pure, with tests; `DoneView.tsx` shows them.
 */

/** A session in Done, with its computer and its key in the list (`lib/everywhere.ts`). */
export type DoneSession = RemoteArchivedSession & { computer: string; key: string };

/** Each computer's sessions in Done as one list, most recently done first. */
export function mergeDone(lists: ReadonlyArray<{ computer: string; sessions: readonly RemoteArchivedSession[] }>): DoneSession[] {
  return lists.flatMap(({ computer, sessions }) => sessions.map((s) => ({ ...s, computer, key: listKey(computer, s.id) }))).sort((a, b) => b.archivedAt - a.archivedAt);
}

/** The sessions whose title, project or branch has the words searched for, as the list's search. */
export function searchDone(sessions: readonly DoneSession[], query: string): DoneSession[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [...sessions];
  return sessions.filter((s) => {
    const text = `${s.title} ${s.projectName} ${s.branch ?? ''}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}

/** Reopen, or with a pipeline's sessions that come back with it, as on the computer ("Reopen with its 3 steps"). */
export function reopenLabel(steps: number): string {
  if (!steps) return 'Reopen';
  return `Reopen with ${steps === 1 ? 'its step' : `its ${steps} steps`}`;
}

/** When it went to Done, after its project: "done 3d ago", or "done just now". */
export function doneAgo(at: number, now: number): string {
  const ago = age(at, now);
  return ago === 'now' ? 'done just now' : `done ${ago} ago`;
}
