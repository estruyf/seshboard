import { cleanNote } from '@seshboard/protocol/client';
import { useSessions } from './sessionsStore.ts';

/**
 * Sets a session's note at once (the row follows) and tells the engine; null clears it. When the engine can't save it,
 * the row goes back to the note it had, and the error goes to the caller.
 */
export async function saveNote(client: { call(method: 'sessions.setNote', params: { sessionId: string; note: string | null }): Promise<unknown> } | null, sessionId: string, text: string | null): Promise<void> {
  const note = text === null ? null : cleanNote(text);
  const previous = useSessions.getState().sessions.get(sessionId)?.note ?? null;
  useSessions.getState().patchSummary(sessionId, { note });
  try {
    if (!client) throw new Error('Not connected to the engine');
    await client.call('sessions.setNote', { sessionId, note });
  } catch (error) {
    // Only when nothing newer came in meanwhile (another save, or the engine's own change).
    if ((useSessions.getState().sessions.get(sessionId)?.note ?? null) === note) useSessions.getState().patchSummary(sessionId, { note: previous });
    throw error;
  }
}
