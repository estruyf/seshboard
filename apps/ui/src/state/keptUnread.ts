/**
 * Sessions you marked as unread while looking at them: opening a session marks it read, which would undo it at once.
 * They stay unread until you leave the session (the session view clears it).
 */
const kept = new Set<string>();

export const keepUnread = (sessionId: string) => void kept.add(sessionId);
export const releaseUnread = (sessionId: string) => void kept.delete(sessionId);
export const isKeptUnread = (sessionId: string) => kept.has(sessionId);
