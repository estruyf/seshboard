/** What's left in a session, in your words (session triage): plain TypeScript, for the engine and the renderer. */

/** The longest note a session keeps: one line. */
export const SESSION_NOTE_MAX = 120;

/** A note as stored: one line (line breaks become spaces), trimmed, at most `SESSION_NOTE_MAX`; empty is no note. */
export function cleanNote(text: string): string | null {
  const line = text.replace(/\s+/g, ' ').trim().slice(0, SESSION_NOTE_MAX).trim();
  return line === '' ? null : line;
}
