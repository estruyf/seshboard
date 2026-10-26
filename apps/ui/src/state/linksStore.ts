import { useEffect } from 'react';
import { create } from 'zustand';
import type { DeepLink } from '@seshboard/protocol/bridge';
import { projectByName } from './projectList.ts';
import { useProjects } from './projectsStore.ts';
import { useSessions } from './sessionsStore.ts';

export type NewSessionLink = Extract<DeepLink, { action: 'new-session' }> & { seq: number };

/** The quick questions folder, once the engine has said where it is (just after the window connects); null after a while without. */
function questionsFolder(): Promise<string | null> {
  const known = useProjects.getState().questionsDir;
  if (known) return Promise.resolve(known);
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(null), 10_000);
    const unsubscribe = useProjects.subscribe((s) => s.questionsDir && done(s.questionsDir));
    function done(dir: string | null) {
      clearTimeout(timer);
      unsubscribe();
      resolve(dir);
    }
  });
}

/** Resolves once the project list has arrived (it loads just after the window connects), or after a while regardless. */
function projectsLoaded(): Promise<void> {
  if (useProjects.getState().loaded) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, 10_000);
    const unsubscribe = useProjects.subscribe((s) => s.loaded && done());
    function done() {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    }
  });
}

/** `seshboard://` links handed over by main (it has already validated them). */
interface LinksState {
  /** A new-session link waiting for the New session view to take it. */
  newSession: NewSessionLink | null;
  /** Why the last link did nothing, shown briefly. */
  error: { message: string; seq: number } | null;
  seq: number;
  open(link: DeepLink): Promise<void>;
  fail(message: string): void;
  /** The New session view took the link; returns it. */
  take(): NewSessionLink | null;
  dismiss(): void;
}

export const useLinks = create<LinksState>()((set, get) => ({
  newSession: null,
  error: null,
  seq: 0,
  open: async (link) => {
    // A quick question runs in the scratch folder: the link names it as its folder.
    if (link.action === 'new-session' && link.question) {
      const dir = await questionsFolder();
      if (!dir) return get().fail("Couldn't find where quick questions run. Try again in a moment.");
      link = { ...link, cwd: dir };
    }
    // A project is looked up first: a name that isn't one of yours shows why and changes nothing.
    if (link.action === 'new-session' && link.project) {
      await projectsLoaded();
      const found = projectByName(useProjects.getState().projects, link.project);
      if (!found) return get().fail(`None of your projects is called "${link.project}". Add it in the Projects view, or use cwd in the link.`);
      link = { ...link, cwd: found.root, project: null };
    }
    const seq = get().seq + 1;
    if (link.action === 'session') {
      const { sessions, live, select } = useSessions.getState();
      if (!sessions.has(link.sessionId) && !live.has(link.sessionId)) return set({ seq, error: { message: `No session ${link.sessionId} on this Mac.`, seq } });
      set({ seq, error: null });
      select(link.sessionId);
      return;
    }
    set({ seq, error: null, newSession: { ...link, seq } });
    useSessions.getState().openNewSession();
  },
  fail: (message) => set((s) => ({ seq: s.seq + 1, error: { message, seq: s.seq + 1 } })),
  take: () => {
    const link = get().newSession;
    if (link) set({ newSession: null });
    return link;
  },
  dismiss: () => set({ error: null }),
}));

/** Follows links opened while the app runs (and the one that launched it, which main kept until now). */
export function useLinksSync(): void {
  useEffect(
    () =>
      window.seshboard?.onDeepLink((message) => {
        if ('error' in message) useLinks.getState().fail(message.error);
        else void useLinks.getState().open(message.link);
      }),
    [],
  );
}
