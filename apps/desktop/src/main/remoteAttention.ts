import type { CompanionStatus, RemoteSessions } from '@seshboard/protocol/client';
import type { AttentionEvent } from './attention.ts';

/**
 * The row id the windows give a session on another computer (`remoteRowId` in apps/ui/src/state/remoteSelection.ts):
 * what a notification opens, and what the window in front reports while it shows that session.
 */
export const remoteRowId = (computerId: string, sessionId: string) => `remote:${computerId}:${sessionId}`;

interface Seen {
  status: Map<string, CompanionStatus>;
  prompts: Set<string>;
}

/** What a waiting prompt asks, as the local notification says it (`Attention.onPermission`). */
const askWords = (toolName: string) => (toolName === 'AskUserQuestion' ? 'Claude has a question' : toolName === 'ExitPlanMode' ? 'Claude has a plan for you' : `Claude wants to use ${toolName}`);

/**
 * Notifications for the sessions of paired computers (docs/remote-access.md, Other computers), from each computer's
 * session list as it changes: a new prompt is needs you, a turn that ended is finished (or failed), as for a session
 * here. The first list of a computer only sets what was already so. A pipeline step's turn gives no Finished: the run
 * is its news, as here. Pure, so it is tested without Electron.
 */
export class RemoteAttention {
  private readonly seen = new Map<string, Seen>();

  /** A computer's list, now: the events since the last one. */
  onList(computer: { id: string; name: string }, list: Pick<RemoteSessions, 'sessions' | 'prompts'>): AttentionEvent[] {
    const before = this.seen.get(computer.id);
    const now: Seen = { status: new Map(list.sessions.map((s) => [s.id, s.status])), prompts: new Set(list.prompts.map((p) => p.requestId)) };
    this.seen.set(computer.id, now);
    if (!before) return [];
    const titles = new Map(list.sessions.map((s) => [s.id, s.title]));
    const where = (sessionId: string) => `${titles.get(sessionId) ?? 'A session'} · on ${computer.name}`;
    const events: AttentionEvent[] = [];
    for (const prompt of list.prompts) {
      if (before.prompts.has(prompt.requestId)) continue;
      events.push({ kind: 'needs-you', sessionId: remoteRowId(computer.id, prompt.sessionId), title: askWords(prompt.toolName), body: where(prompt.sessionId) });
    }
    for (const session of list.sessions) {
      if (before.status.get(session.id) !== 'working') continue;
      if (session.status === 'error') events.push({ kind: 'failed', sessionId: remoteRowId(computer.id, session.id), title: 'Claude Code stopped with an error', body: where(session.id) });
      else if ((session.status === 'unread' || session.status === 'idle') && !session.parentId) {
        events.push({ kind: 'finished', sessionId: remoteRowId(computer.id, session.id), title: 'Claude finished', body: where(session.id) });
      }
    }
    return events;
  }

  /** A computer went away (offline or forgotten): its next list starts over, silently. */
  forget(computerId: string): void {
    this.seen.delete(computerId);
  }
}
