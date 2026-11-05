import { useEffect } from 'react';
import { create } from 'zustand';
import type { EngineClient as Client } from '../engine/connection.ts';

/** What this window knows about a reply's highlights: rows outside the viewport aren't mounted, so it can't be theirs. */
export interface SkimHighlight {
  state: 'loading' | 'ready' | 'none' | 'failed';
  keep: readonly number[] | null;
}

const useEntries = create<{ entries: ReadonlyMap<string, SkimHighlight> }>()(() => ({ entries: new Map() }));

const keyOf = (sessionId: string, replyKey: string) => `${sessionId}:${replyKey}`;

const put = (key: string, entry: SkimHighlight) => useEntries.setState((state) => ({ entries: new Map(state.entries).set(key, entry) }));

export interface SkimHighlightRequest {
  sessionId: string;
  replyKey: string;
  total: number;
  /** Ask Haiku when there is no answer yet; otherwise only a stored answer comes back. */
  ask: boolean;
  message: string;
  outline: string;
}

/** Fetches a reply's highlights. A failure stays until Try again, so a reply that fails isn't asked about on every scroll. */
export function requestSkimHighlight(client: Client, request: SkimHighlightRequest): void {
  const key = keyOf(request.sessionId, request.replyKey);
  put(key, { state: 'loading', keep: null });
  client
    .call('skim.highlights', { ...request, message: request.ask ? request.message : '', outline: request.ask ? request.outline : '' })
    .then(({ state, keep }) => put(key, { state, keep }))
    .catch(() => put(key, { state: 'failed', keep: null }));
}

/** A reply's highlights; fetches them once while `active` (the setting is on and the reply is long enough). */
export function useSkimHighlight(client: Client | null, request: SkimHighlightRequest, active: boolean): SkimHighlight | null {
  const key = keyOf(request.sessionId, request.replyKey);
  const entry = useEntries((state) => state.entries.get(key) ?? null);
  // A reply already seen without an answer gets asked once it may be: Try it, on a reply that was only read until then.
  const wanted = active && (entry === null || (entry.state === 'none' && request.ask));
  useEffect(() => {
    if (wanted && client) requestSkimHighlight(client, request);
  }, [wanted, client, key]);
  return active ? entry : null;
}

/** Which sessions have which model to offer: another provider's is asked once, Claude Code's is always Haiku. */
const useModels = create<{ models: ReadonlyMap<string, string | null> }>()(() => ({ models: new Map() }));

/** The model that picks a session's sentences; null until it is known, and when its account has none cheap enough. */
export function useSkimModel(client: Client | null, sessionId: string, provider: string | null, wanted: boolean): string | null {
  const known = useModels((state) => state.models.get(sessionId));
  useEffect(() => {
    if (!wanted || !client || provider === null || known !== undefined) return;
    void client.call('skim.model', { sessionId }).then(({ model }) => useModels.setState((state) => ({ models: new Map(state.models).set(sessionId, model) })), () => {});
  }, [wanted, client, sessionId, provider, known]);
  return provider === null ? 'Haiku' : (known ?? null);
}
