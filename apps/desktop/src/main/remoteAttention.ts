import { agentName, isMine, type CompanionStatus, type ComputerNotify, type RemoteSessions } from '@seshboard/protocol/client';
import { askWords, stoppedWords, type AttentionEvent } from './attention.ts';

/**
 * The row id the windows give a session on another computer (`remoteRowId` in apps/ui/src/state/remoteSelection.ts):
 * what a notification opens, and what the window in front reports while it shows that session.
 */
export const remoteRowId = (computerId: string, sessionId: string) => `remote:${computerId}:${sessionId}`;

interface Seen {
  status: Map<string, CompanionStatus>;
  prompts: Set<string>;
}


/**
 * Notifications for the sessions of paired computers (docs/remote-access.md, Other computers), from each computer's
 * session list as it changes: a new prompt is needs you, a turn that ended is finished (or failed), as for a session
 * here. The first list of a computer only sets what was already so. A pipeline step's turn gives no Finished: the run
 * is its news, as here. The computer's notifications choice (Settings › Remote, Other computers) keeps only the
 * sessions that are mine there (Only mine: `isMine`, as the sidebar's Mine filter), only needs you, or nothing; what it leaves out is
 * still seen, so turning them on later doesn't bring old news. Pure, so it is tested without Electron.
 */
export class RemoteAttention {
  private readonly seen = new Map<string, Seen>();

  /** A computer's list, now: the events since the last one. */
  onList(computer: { id: string; name: string; notify?: ComputerNotify; mineHere?: readonly string[] }, list: Pick<RemoteSessions, 'sessions' | 'prompts'>): AttentionEvent[] {
    const before = this.seen.get(computer.id);
    const now: Seen = { status: new Map(list.sessions.map((s) => [s.id, s.status])), prompts: new Set(list.prompts.map((p) => p.requestId)) };
    this.seen.set(computer.id, now);
    if (!before || computer.notify === 'off') return [];
    const titles = new Map(list.sessions.map((s) => [s.id, s.title]));
    const parents = new Map(list.sessions.map((s) => [s.id, s.parentId ?? null]));
    // Only mine: started or acted on from here, or a sub-session of one (a pipeline's step, a fork's agent).
    const mine = { mineHere: computer.mineHere ?? [] };
    const kept = (sessionId: string) => computer.notify !== 'started-here' || isMine(sessionId, parents.get(sessionId), mine);
    // Another provider's sessions there (Codex, Copilot) name it; a newer computer's unknown one, neutrally.
    const providers = new Map(list.sessions.map((s) => [s.id, s.provider ?? null]));
    const agent = (sessionId: string) => agentName(providers.get(sessionId));
    const where = (sessionId: string) => `${titles.get(sessionId) ?? 'A session'} · on ${computer.name}`;
    const events: AttentionEvent[] = [];
    for (const prompt of list.prompts) {
      if (before.prompts.has(prompt.requestId) || !kept(prompt.sessionId)) continue;
      events.push({ kind: 'needs-you', sessionId: remoteRowId(computer.id, prompt.sessionId), title: askWords(prompt.toolName, agent(prompt.sessionId)), body: where(prompt.sessionId) });
    }
    if (computer.notify === 'needs-you') return events;
    for (const session of list.sessions) {
      if (before.status.get(session.id) !== 'working' || !kept(session.id)) continue;
      if (session.status === 'error') events.push({ kind: 'failed', sessionId: remoteRowId(computer.id, session.id), title: stoppedWords(session.provider), body: where(session.id) });
      else if ((session.status === 'unread' || session.status === 'idle') && !session.parentId) {
        events.push({ kind: 'finished', sessionId: remoteRowId(computer.id, session.id), title: `${agent(session.id)} finished`, body: where(session.id) });
      }
    }
    return events;
  }

  /** A computer went away (offline or forgotten): its next list starts over, silently. */
  forget(computerId: string): void {
    this.seen.delete(computerId);
  }
}
