import { create } from 'zustand';
import type { GithubItemType, GithubListItem } from '@switchboard/protocol/client';
import { useProjects } from './projectsStore.ts';
import { useSessions } from './sessionsStore.ts';

/**
 * New session from an issue or pull request: ⌥↩ in the `#` list, the palette's "New session from issue…" and "New
 * session from pull request…", and `switchboard://new-session?issue=…` or `pr=…`. New session takes the request and
 * fills in the worktree, the chip and the prompt. Nothing starts until you press Start.
 */
export interface GithubStartRequest {
  /** The project it starts in. */
  root: string;
  type: GithubItemType;
  /** A number, `#123` or a link to it. */
  ref: string;
  /** What the `#` list already showed, so New session fills in before gh answers. */
  item: GithubListItem | null;
  /** Opened from a `switchboard://` link: its own prompt, and whether it asked to start on its own (refused). */
  link: { prompt: string | null; autostart: boolean } | null;
  seq: number;
}

interface GithubStartState {
  request: GithubStartRequest | null;
  seq: number;
  /** New session took the request; returns it. */
  take(): GithubStartRequest | null;
}

export const useGithubStart = create<GithubStartState>()((set, get) => ({
  request: null,
  seq: 0,
  take: () => {
    const request = get().request;
    if (request) set({ request: null });
    return request;
  },
}));

/** Opens New session on `root`, filled in from the issue or pull request. */
export function startFromGithub(request: Omit<GithubStartRequest, 'seq'>): void {
  const seq = useGithubStart.getState().seq + 1;
  useGithubStart.setState({ seq, request: { ...request, seq } });
  useProjects.getState().startIn(request.root);
  useSessions.getState().openNewSession();
}
