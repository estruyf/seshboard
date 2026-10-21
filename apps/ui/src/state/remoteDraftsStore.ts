import { create } from 'zustand';
import type { RemoteAttachment } from '../components/computers/remoteAttachments.ts';

/** What is in a message box to another computer: the text, and the images and files attached. */
export interface RemoteDraft {
  text: string;
  items: RemoteAttachment[];
}

const EMPTY: RemoteDraft = { text: '', items: [] };

/** New session on another computer: one box per computer, as the project picked there (`useRunOn`). */
export const remoteNewDraftKey = (computerId: string) => `new:${computerId}`;
/** A session on another computer. */
export const remoteSessionDraftKey = (computerId: string, sessionId: string) => `${computerId}:${sessionId}`;

interface RemoteDraftsState {
  /** By `remoteNewDraftKey` or `remoteSessionDraftKey`; an empty box has none. */
  drafts: Readonly<Record<string, RemoteDraft>>;
  /** The box changed: keeps it, or forgets it once it is empty. */
  update(key: string, change: Partial<RemoteDraft>): void;
}

/**
 * What you typed and attached in a message box to another computer, kept while you look at another session or copy
 * something from it, as the local boxes keep theirs. Only in this window, and only until Switchboard quits: the images
 * are large, and a local draft's machinery (the Unsent list, saving to disk) is about this computer's sessions.
 */
export const useRemoteDrafts = create<RemoteDraftsState>()((set) => ({
  drafts: {},
  update: (key, change) =>
    set((s) => {
      const next = { ...(s.drafts[key] ?? EMPTY), ...change };
      const drafts = { ...s.drafts };
      if (next.text === '' && next.items.length === 0) delete drafts[key];
      else drafts[key] = next;
      return { drafts };
    }),
}));

/** The draft under `key`, read once (a box starts from it, then keeps it up to date). */
export const remoteDraft = (key: string): RemoteDraft => useRemoteDrafts.getState().drafts[key] ?? EMPTY;
