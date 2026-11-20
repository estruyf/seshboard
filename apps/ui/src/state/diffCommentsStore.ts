import { create } from 'zustand';
import type { CommentTarget, DiffComment } from '../components/changes/diffComments.ts';

/**
 * Review comments on lines in Changes, by session. They live here rather than in the diff, which reloads after every
 * check of git, so they survive closing the panel until they are submitted or removed.
 */
interface DiffCommentsState {
  comments: Record<string, readonly DiffComment[]>;
  /** A comment on lines of `path`, a file in the checkout at `root`. */
  add(sessionId: string, root: string, path: string, target: CommentTarget, body: string): void;
  edit(sessionId: string, id: string, body: string): void;
  remove(sessionId: string, id: string): void;
  clear(sessionId: string): void;
  /** Claude's edits moved the lines: the comments take their new line numbers. */
  move(sessionId: string, moves: ReadonlyArray<{ id: string; start: number; end: number }>): void;
}

let nextId = 0;
const NONE: readonly DiffComment[] = [];

export const useDiffComments = create<DiffCommentsState>()((set) => {
  const update = (sessionId: string, change: (comments: readonly DiffComment[]) => readonly DiffComment[]) =>
    set((s) => {
      const next = change(s.comments[sessionId] ?? NONE);
      const comments = { ...s.comments };
      if (next.length) comments[sessionId] = next;
      else delete comments[sessionId];
      return { comments };
    });
  return {
    comments: {},
    add: (sessionId, root, path, target, body) => update(sessionId, (list) => [...list, { id: `comment-${(nextId++).toString(36)}`, root, path, ...target, body }]),
    edit: (sessionId, id, body) => update(sessionId, (list) => list.map((c) => (c.id === id ? { ...c, body } : c))),
    remove: (sessionId, id) => update(sessionId, (list) => list.filter((c) => c.id !== id)),
    clear: (sessionId) => update(sessionId, () => NONE),
    move: (sessionId, moves) =>
      update(sessionId, (list) =>
        list.map((c) => {
          const moved = moves.find((m) => m.id === c.id);
          return moved ? { ...c, start: moved.start, end: moved.end } : c;
        }),
      ),
  };
});

/** A session's review comments (the same empty list while it has none, so selectors stay stable). */
export const useSessionComments = (sessionId: string): readonly DiffComment[] => useDiffComments((s) => s.comments[sessionId] ?? NONE);
