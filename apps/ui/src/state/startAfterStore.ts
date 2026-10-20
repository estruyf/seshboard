import { create } from 'zustand';
import { useProjects } from './projectsStore.ts';
import { projectOf } from './queue.ts';
import { useSessions } from './sessionsStore.ts';

/**
 * Start after this one… (a session's menus and the palette): New session opens on the session's project, with Wait
 * for set to that session and Start by itself on. Add to queue queues it; nothing starts from here.
 */
export interface StartAfterRequest {
  sessionId: string;
  root: string;
  seq: number;
}

interface StartAfterState {
  request: StartAfterRequest | null;
  seq: number;
  /** New session took the request; returns it. */
  take(): StartAfterRequest | null;
}

export const useStartAfter = create<StartAfterState>()((set, get) => ({
  request: null,
  seq: 0,
  take: () => {
    const request = get().request;
    if (request) set({ request: null });
    return request;
  },
}));

/** Opens New session to queue something that starts by itself once `session` finishes. */
export function startAfter(session: { id: string; projectRoot: string }): void {
  const seq = useStartAfter.getState().seq + 1;
  const root = projectOf(session.projectRoot);
  useStartAfter.setState({ seq, request: { sessionId: session.id, root, seq } });
  useProjects.getState().startIn(root);
  useSessions.getState().openNewSession();
}
