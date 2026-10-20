/**
 * What you typed and didn't send yet, for this tab: New session's prompt and each session's message box keep it when
 * you go to another view and come back, also after a reload. Sending (or starting the session) clears it.
 */
const DRAFT = 'switchboard-remote:draft';

/** New session's prompt, or a session's message box. */
export type DraftKey = { kind: 'new' } | { kind: 'session'; sessionId: string };

const storageKey = (key: DraftKey) => (key.kind === 'new' ? `${DRAFT}:new` : `${DRAFT}:session:${key.sessionId}`);

export function loadDraft(key: DraftKey): string {
  try {
    return sessionStorage.getItem(storageKey(key)) ?? '';
  } catch {
    return '';
  }
}

/** Keeps the text, or forgets it when it is only spaces. */
export function saveDraft(key: DraftKey, text: string): void {
  try {
    if (text.trim()) sessionStorage.setItem(storageKey(key), text);
    else sessionStorage.removeItem(storageKey(key));
  } catch {
    // Storage is full or off: the draft just isn't kept.
  }
}

export const clearDraft = (key: DraftKey) => saveDraft(key, '');
