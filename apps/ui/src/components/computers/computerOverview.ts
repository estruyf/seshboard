import type { Computer, RemotePrompt, RemoteSession, RemoteSessions } from '@seshboard/protocol/client';
import { shownList, type ComputerScope } from '../../state/remoteRows.ts';
import { inBackground } from './computerSessions.ts';

/**
 * What a paired computer's page shows (`ComputerView`, opened from Settings › Remote and its chip in the sidebar):
 * that computer's sessions on their own, as its chip's Mine / All filter keeps them. Pure, so the order and the
 * counts can be tested.
 */

/** How many recent sessions the page lists; the sidebar has the rest. */
export const RECENT_LIMIT = 12;

/** A session that waits for you there, with what it asks (oldest first). A session can say needs you without a prompt in the list. */
export interface WaitingSession {
  session: RemoteSession;
  prompts: RemotePrompt[];
}

/** The recent sessions of one project, newest first. */
export interface RecentProject {
  projectId: string;
  projectName: string;
  sessions: RemoteSession[];
}

export interface ComputerOverview {
  /** Waiting for you, the longest wait first, as the most overdue (Home's order). */
  needs: WaitingSession[];
  /** Claude is working, or a task it started still runs: the one set going last first, so they don't trade places. */
  working: RemoteSession[];
  /** The rest, newest first, at most `RECENT_LIMIT`, by project (the project of the newest first). Pipeline steps stay under their session in the sidebar. */
  recent: RecentProject[];
  /** The recent sessions past the limit. */
  more: number;
  /** The others' sessions the Mine filter leaves out. */
  fromOthers: number;
}

/** When a session's wait began: its oldest prompt, else its last change. */
const waitedSince = (w: WaitingSession): number => w.prompts[0]?.createdAt ?? w.session.updatedAt;

/** A computer's list as its page shows it, through its Mine / All filter (`shownList`). */
export function computerOverview(list: RemoteSessions, computer: Pick<Computer, 'mineHere'>, scope: ComputerScope, limit = RECENT_LIMIT): ComputerOverview {
  const shown = shownList(list, computer, scope);
  const asking = new Map<string, RemotePrompt[]>();
  for (const prompt of [...shown.prompts].sort((a, b) => a.createdAt - b.createdAt)) asking.set(prompt.sessionId, [...(asking.get(prompt.sessionId) ?? []), prompt]);

  const needs: WaitingSession[] = [];
  const working: RemoteSession[] = [];
  const rest: RemoteSession[] = [];
  for (const session of shown.sessions) {
    const prompts = asking.get(session.id) ?? [];
    if (prompts.length > 0 || session.status === 'needs-you') needs.push({ session, prompts });
    else if (session.status === 'working' || inBackground(session)) working.push(session);
    else if (!session.parentId) rest.push(session);
  }
  needs.sort((a, b) => waitedSince(a) - waitedSince(b));
  working.sort((a, b) => (b.workingSince ?? b.updatedAt) - (a.workingSince ?? a.updatedAt));
  rest.sort((a, b) => b.updatedAt - a.updatedAt);

  const recent: RecentProject[] = [];
  for (const session of rest.slice(0, limit)) {
    const project = recent.find((p) => p.projectId === session.projectId);
    if (project) project.sessions.push(session);
    else recent.push({ projectId: session.projectId, projectName: session.projectName, sessions: [session] });
  }
  return { needs, working, recent, more: Math.max(0, rest.length - limit), fromOthers: list.sessions.length - shown.sessions.length };
}

const sessions = (n: number) => `${n} ${n === 1 ? 'session' : 'sessions'}`;

/** The line under the computer's name on its page: what needs you and what works there, in plain words. */
export function overviewSummary(overview: Pick<ComputerOverview, 'needs' | 'working'>, name: string): string {
  const needs = overview.needs.length;
  const working = overview.working.length;
  const needVerb = needs === 1 ? 'needs' : 'need';
  const workVerb = working === 1 ? 'is' : 'are';
  if (needs && working) return `${sessions(needs)} ${needVerb} you, ${working} ${workVerb} working.`;
  if (needs) return `${sessions(needs)} ${needVerb} you.`;
  if (working) return `${sessions(working)} ${workVerb} working on ${name}. Nothing needs you.`;
  return `Nothing needs you on ${name}.`;
}

/** "Seshboard 0.9.1" after the computer's state, once it said its version. */
export function versionText(computer: Pick<Computer, 'version'>): string | null {
  return computer.version ? `Seshboard ${computer.version}` : null;
}
