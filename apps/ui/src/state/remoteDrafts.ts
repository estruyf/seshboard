import { create } from 'zustand';
import type { FillState } from '../components/savedPrompts/fillModel.ts';

/**
 * What you typed for another computer and didn't send: a session's message box there, or New session with Run on set
 * to it. Kept in localStorage, read and written only when asked (so nothing touches storage at load), which every
 * window shares. Sending, or starting the session, clears it.
 */
export const REMOTE_DRAFTS_STORAGE_KEY = 'ui.remoteDrafts';

export interface RemoteDraft {
  text: string;
  /** A saved prompt being filled in; `text` is then what goes after it. */
  fill?: FillState;
}

/** A session's message box on another computer. */
export const remoteSessionDraftKey = (computerId: string, sessionId: string) => `${computerId}:session:${sessionId}`;
/** New session on another computer: one prompt per computer. */
export const remoteNewDraftKey = (computerId: string) => `${computerId}:new`;

/** The saved drafts, skipping anything that isn't one (an older or broken value). */
export function parseRemoteDrafts(raw: string | null): Record<string, RemoteDraft> {
  let value: unknown;
  try {
    value = JSON.parse(raw ?? '{}');
  } catch {
    return {};
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const drafts: Record<string, RemoteDraft> = {};
  for (const [key, draft] of Object.entries(value)) {
    if (!draft || typeof draft !== 'object' || typeof (draft as RemoteDraft).text !== 'string') continue;
    const { text, fill } = draft as RemoteDraft;
    drafts[key] = fill && typeof fill === 'object' ? { text, fill } : { text };
  }
  return drafts;
}

/** The drafts with `key` set to `draft`, or without it when there is nothing to send (only spaces and no saved prompt). */
export function withRemoteDraft(drafts: Record<string, RemoteDraft>, key: string, draft: RemoteDraft): Record<string, RemoteDraft> {
  const next = { ...drafts };
  if (draft.text.trim() || draft.fill) next[key] = draft.fill ? { text: draft.text, fill: draft.fill } : { text: draft.text };
  else delete next[key];
  return next;
}

export function loadRemoteDraft(key: string): RemoteDraft {
  try {
    return parseRemoteDrafts(localStorage.getItem(REMOTE_DRAFTS_STORAGE_KEY))[key] ?? { text: '' };
  } catch {
    return { text: '' };
  }
}

/** True while New session on that computer holds a prompt that wasn't sent (the pen on the sidebar's +). */
export const hasRemoteNewDraft = (computerId: string) => {
  const draft = loadRemoteDraft(remoteNewDraftKey(computerId));
  return !!draft.text.trim() || !!draft.fill;
};

/**
 * Bumped when a draft comes or goes (not on every keystroke), so what shows a pen for one reads storage again. Another
 * window's change arrives through the `storage` event on `REMOTE_DRAFTS_STORAGE_KEY`.
 */
export const useRemoteDraftsChanged = create<{ version: number; bump(): void }>()((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

export function saveRemoteDraft(key: string, draft: RemoteDraft): void {
  try {
    const before = parseRemoteDrafts(localStorage.getItem(REMOTE_DRAFTS_STORAGE_KEY));
    const drafts = withRemoteDraft(before, key, draft);
    if (Object.keys(drafts).length) localStorage.setItem(REMOTE_DRAFTS_STORAGE_KEY, JSON.stringify(drafts));
    else localStorage.removeItem(REMOTE_DRAFTS_STORAGE_KEY);
    if (key in before !== key in drafts) useRemoteDraftsChanged.getState().bump();
  } catch {
    // Storage is full or off: the draft just isn't kept.
  }
}

export const clearRemoteDraft = (key: string) => saveRemoteDraft(key, { text: '' });
