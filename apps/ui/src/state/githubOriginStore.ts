import { useEffect } from 'react';
import { create } from 'zustand';
import type { GithubOrigin } from '@seshboard/protocol/client';
import { useEngineConnection } from '../engine/useEngine.ts';

/**
 * The issue or pull request each session was started from (`github.origin`), read once per session: a session from a
 * fork's pull request Seshboard can't push to has push and Create pull request off (the git button, the palette).
 */
interface GithubOriginState {
  origins: Map<string, GithubOrigin | null>;
  set(sessionId: string, origin: GithubOrigin | null): void;
}

export const useGithubOrigins = create<GithubOriginState>()((set) => ({
  origins: new Map(),
  set: (sessionId, origin) => set((s) => ({ origins: new Map(s.origins).set(sessionId, origin) })),
}));

/** Whether a session works on a fork's pull request Seshboard can't push back (read on first use). */
export function useReadOnlyFork(sessionId: string | null): boolean {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const known = useGithubOrigins((s) => (sessionId ? s.origins.has(sessionId) : true));
  const readOnly = useGithubOrigins((s) => (sessionId ? (s.origins.get(sessionId)?.readOnly ?? false) : false));
  useEffect(() => {
    if (!client || !sessionId || known) return;
    client.call('github.origin', { sessionId }).then(
      ({ origin }) => useGithubOrigins.getState().set(sessionId, origin),
      () => {},
    );
  }, [client, sessionId, known]);
  return readOnly;
}

/** Without a hook: what is known now (false until read). */
export const readOnlyFork = (sessionId: string | null) => (sessionId ? (useGithubOrigins.getState().origins.get(sessionId)?.readOnly ?? false) : false);
