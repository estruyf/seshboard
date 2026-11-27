import { create } from 'zustand';
import { useProjects } from './projectsStore.ts';
import { useSessions } from './sessionsStore.ts';

/**
 * Start session from a selection in a conversation (the toolbar over the selection, or the message menu): New session
 * opens on that session's project, in a new worktree, with the selected text as the prompt and a link to the session
 * (session linking), so the new one knows where the text came from. Once it starts, it goes under that session in the
 * sidebar. Nothing starts until you press Start.
 */
export interface StartUnderRequest {
  /** The project it starts in: the session's. */
  root: string;
  /** The session the text came from, which the new one goes under. */
  sessionId: string;
  /** That session's title, for the link's chip and the notice. */
  label: string;
  /** The selected text, as the prompt. */
  text: string;
  seq: number;
}

interface StartUnderState {
  request: StartUnderRequest | null;
  seq: number;
  /** New session took the request; returns it. */
  take(): StartUnderRequest | null;
}

export const useStartUnder = create<StartUnderState>()((set, get) => ({
  request: null,
  seq: 0,
  take: () => {
    const request = get().request;
    if (request) set({ request: null });
    return request;
  },
}));

/** Opens New session on `root`, in a new worktree, with `text` as the prompt and the session linked. */
export function startFromSelection(request: Omit<StartUnderRequest, 'seq'>): void {
  const seq = useStartUnder.getState().seq + 1;
  useStartUnder.setState({ seq, request: { ...request, seq } });
  useProjects.getState().startIn(request.root, { worktree: true });
  useSessions.getState().openNewSession();
}
