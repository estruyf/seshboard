import type { CompanionStatus, RemoteProfileUsage, RemotePrompt, RemoteRun, RemoteRunState, RemoteSession, RemoteSessions } from '@seshboard/protocol/remote-client';

/**
 * Every paired computer's sessions as one list, as Seshboard's sidebar shows another computer's sessions among its
 * own. Pure, with tests. A session or a prompt keeps its own ids for its computer (`sessionId`, `original`); its `id`
 * (a prompt's `requestId` and `sessionId`) is its key in the list, the computer's id and its own, since two computers
 * can have the same ids. A session's `parentId` stays its computer's own: the tree is made per computer (`lib/runs.ts`).
 */

/** `runRow`: a pipeline run started from New session, a row of its own with no session behind it yet; `sessionId` is the run's id. */
export type ListedSession = RemoteSession & { computer: string; sessionId: string; runRow?: boolean };
export type ListedPrompt = RemotePrompt & { computer: string; original: RemotePrompt };
/** A pipeline run, with its computer and its parent's key in the list: the session it started from, or its run row. */
export type ListedRun = RemoteRunState & { computer: string; parent: string };

export interface ListedSessions {
  sessions: ListedSession[];
  prompts: ListedPrompt[];
  runs: ListedRun[];
}

/** A run row's state as a session's: waiting for you is needs you, running is working. */
export function runRowStatus(run: Pick<RemoteRun, 'status'>): CompanionStatus {
  if (run.status === 'waiting') return 'needs-you';
  if (run.status === 'running') return 'working';
  if (run.status === 'stopped') return 'stopped';
  return 'idle';
}

/** A run started from New session as a row of the list, keyed by the run's id. */
export function runRowSession(computer: string, { run }: RemoteRunState): ListedSession {
  return {
    id: listKey(computer, run.id),
    sessionId: run.id,
    computer,
    runRow: true,
    title: run.title,
    projectId: run.projectId,
    projectName: run.projectName,
    branch: null,
    status: runRowStatus(run),
    updatedAt: run.updatedAt,
    workingSince: run.status === 'running' ? run.createdAt : null,
    unread: false,
    pinned: false,
    model: null,
    permissionMode: null,
    profile: null,
    parentId: null,
  };
}

/** A session's key in the list. A computer's id is hex, so the first `:` ends it. */
export const listKey = (computer: string, id: string): string => `${computer}:${id}`;

export function fromKey(key: string): { computer: string; id: string } | null {
  const at = key.indexOf(':');
  return at > 0 && at < key.length - 1 ? { computer: key.slice(0, at), id: key.slice(at + 1) } : null;
}

/** The computers' lists as one, in the order they were paired: the groups sort them by status and time. */
export function mergeSessions(computers: ReadonlyArray<{ id: string; sessions: RemoteSessions }>): ListedSessions {
  const sessions: ListedSession[] = [];
  const prompts: ListedPrompt[] = [];
  const runs: ListedRun[] = [];
  for (const { id: computer, sessions: list } of computers) {
    for (const session of list.sessions) sessions.push({ ...session, id: listKey(computer, session.id), computer, sessionId: session.id });
    for (const prompt of list.prompts) prompts.push({ ...prompt, requestId: listKey(computer, prompt.requestId), sessionId: listKey(computer, prompt.sessionId), computer, original: prompt });
    for (const state of list.runs ?? []) {
      runs.push({ ...state, computer, parent: listKey(computer, state.run.parentSessionId ?? state.run.id) });
      if (!state.run.parentSessionId) sessions.push(runRowSession(computer, state));
    }
  }
  return { sessions, prompts, runs };
}

/** A profile's usage on Home, with the computers that sign in to its account when more than one does. */
export type ListedUsage = RemoteProfileUsage & { computers?: string[] };

/**
 * Every computer's plan usage as one list. With one computer, its own. With more, each profile is named after its
 * computer ("mystic"), and after its profile too when that computer has more than one ("mystic · Work"). Profiles of
 * the same account on more than one computer are one entry: the first one's name and colour, the newest numbers, and
 * the computers in `computers`. Null until a computer answered.
 */
export function mergeUsage(computers: ReadonlyArray<{ id: string; name: string; usage: RemoteProfileUsage[] | null }>): ListedUsage[] | null {
  if (computers.length === 1) return computers[0]!.usage;
  if (computers.every((c) => c.usage === null)) return null;
  const listed = computers.flatMap(({ id, name, usage }) =>
    (usage ?? []).map((entry) => {
      const computer = name || 'Your computer';
      return { entry, computer, profile: { ...entry.profile, id: listKey(id, entry.profile.id), name: usage!.length === 1 ? computer : `${computer} · ${entry.profile.name}` } };
    }),
  );
  const shared = new Map<string, typeof listed>();
  for (const item of listed) if (item.entry.account) shared.set(item.entry.account, [...(shared.get(item.entry.account) ?? []), item]);
  const merged: ListedUsage[] = [];
  for (const item of listed) {
    const same = item.entry.account ? shared.get(item.entry.account)! : [item];
    const names = [...new Set(same.map((s) => s.computer))];
    if (names.length < 2) {
      merged.push({ ...item.entry, profile: item.profile });
      continue;
    }
    if (same[0] !== item) continue;
    const newest = same.map((s) => s.entry).reduce((a, b) => ((b.usage?.fetchedAt ?? -1) > (a.usage?.fetchedAt ?? -1) ? b : a));
    merged.push({ ...newest, profile: { ...item.entry.profile, id: item.profile.id }, computers: names });
  }
  return merged;
}

/**
 * The computer New session starts on: the one asked for (Run on, the palette), else the one it started on last while
 * that one is connected, else the first connected one. With none connected, the last one or the first, so the page
 * can say it waits for it.
 */
export function runOnDefault(computers: ReadonlyArray<{ id: string; connected: boolean }>, asked: string | null | undefined, last: string | null): string | null {
  const known = (id: string | null | undefined) => (id ? computers.find((c) => c.id === id) : undefined);
  if (known(asked)) return asked!;
  if (known(last)?.connected) return last;
  return computers.find((c) => c.connected)?.id ?? known(last)?.id ?? computers[0]?.id ?? null;
}
