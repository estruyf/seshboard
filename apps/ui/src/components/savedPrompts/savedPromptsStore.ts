import { useEffect } from 'react';
import { create } from 'zustand';
import type { SavedPrompt } from '@switchboard/protocol/client';
import { engineConnection } from '../../engine/connection.ts';
import { useEngineConnection } from '../../engine/useEngine.ts';

/** The engine's client while connected. */
export function engineClient() {
  const state = engineConnection.getSnapshot();
  return state.status === 'connected' ? state.client : null;
}

/** One list as the engine gave it: the global prompts, plus a project's own when it has a root. */
interface PromptList {
  prompts: SavedPrompt[];
  /** What in the project's .switchboard.json couldn't be read. */
  errors: string[];
}

interface SavedPromptsState {
  /** By project root ('' for the global ones only). */
  lists: Record<string, PromptList>;
  /** Lists that are being read, so ten message boxes on one project ask once. */
  loading: Record<string, boolean>;
  /** The project of the message box you typed in last: what Settings means by "just for you" and "Share" for a prompt of every project. */
  lastRoot: string | null;
  set(key: string, list: PromptList): void;
}

const EMPTY: PromptList = { prompts: [], errors: [] };
const keyOf = (root: string | null | undefined) => root ?? '';

export const useSavedPromptsStore = create<SavedPromptsState>()((set) => ({
  lists: {},
  loading: {},
  lastRoot: null,
  set: (key, list) => set((s) => ({ lists: { ...s.lists, [key]: list }, loading: { ...s.loading, [key]: false } })),
}));

/** Reads one list from the engine (again). */
export function loadPrompts(root: string | null | undefined): Promise<void> {
  const client = engineClient();
  if (!client) return Promise.resolve();
  const key = keyOf(root);
  useSavedPromptsStore.setState((s) => ({ loading: { ...s.loading, [key]: true } }));
  return client.call('savedPrompts.list', root ? { root } : {}).then(
    (list) => useSavedPromptsStore.getState().set(key, list),
    () => useSavedPromptsStore.setState((s) => ({ loading: { ...s.loading, [key]: false } })),
  );
}

/**
 * The saved prompts a message box in this project can use (global ones without a root), most recently used first.
 * Read once, then kept up to date by `useSavedPromptsSync`.
 */
export function useSavedPrompts(root: string | null | undefined): PromptList {
  const key = keyOf(root);
  const list = useSavedPromptsStore((s) => s.lists[key]);
  const connection = useEngineConnection();
  const connected = connection.status === 'connected';
  useEffect(() => {
    if (!connected) return;
    const state = useSavedPromptsStore.getState();
    if (!state.lists[key] && !state.loading[key]) void loadPrompts(root);
  }, [key, connected]);
  return list ?? EMPTY;
}

/** Follows changes from every window: a change to the global prompts reads every list again, a project's only its own. */
export function useSavedPromptsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    // A new connection (an engine restart) reads what is on screen again.
    for (const key of Object.keys(useSavedPromptsStore.getState().lists)) void loadPrompts(key || null);
    return client.on('savedPrompts.changed', ({ root }) => {
      for (const key of Object.keys(useSavedPromptsStore.getState().lists)) {
        if (root === null || key === root) void loadPrompts(key || null);
      }
    });
  }, [client]);
}
