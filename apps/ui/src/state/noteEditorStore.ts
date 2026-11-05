import { create } from 'zustand';

/** The session whose note is being written (N on a row or in catch-up, Note… in a menu or the palette), else null. */
export const useNoteEditor = create<{ sessionId: string | null; open(sessionId: string): void; close(): void }>()((set) => ({
  sessionId: null,
  open: (sessionId) => set({ sessionId }),
  close: () => set({ sessionId: null }),
}));

/** Opens the note of a session of this computer; another computer's sessions have none (v1). */
export const openNoteEditor = (sessionId: string): void => useNoteEditor.getState().open(sessionId);
