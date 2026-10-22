import type { ClaudeProfile, Computer, ProfileColor, RemoteSession, RemoteSessions } from '@switchboard/protocol/client';
import { agoText } from '../lib/format.ts';
import { remoteRowId } from './remoteSelection.ts';
import type { SessionRowData } from './sessionsStore.ts';
import type { RowStatus } from './sidebarRows.ts';

/**
 * Sessions on other computers as rows of the sidebar, next to this computer's (docs/remote-access.md, Other
 * computers). Pure, so the merging and the wording can be tested; the store and the views only call these.
 */

/** What a sidebar row knows about the computer a remote session runs on. */
export interface RemoteRowInfo {
  computerId: string;
  computerName: string;
  /** The session's id on that computer (the row's own `id` is `remoteRowId`). */
  sessionId: string;
  projectId: string;
  projectName: string;
  status: RowStatus;
  /** For a session waiting on you: the tool of its oldest open prompt. */
  waitingTool: string | null;
  /** When its turn began on that computer, for the Working section's order (`workingSince`); null when not known. */
  workingSince: number | null;
  /** The Claude profile it runs with there; null while that computer has one profile, or it isn't known. */
  profile: RemoteSession['profile'];
  /** The computer is not connected: the row shows its last known state, dimmed. */
  offline: boolean;
  /** When the computer was last connected, while it is offline. */
  lastSeen: number | null;
}

/** The filter's key for this computer's own sessions; other computers go by their id. */
export const THIS_COMPUTER = 'local';

/** Where a row's sessions run: `THIS_COMPUTER` or a computer's id. */
export const sourceOf = (row: Pick<SessionRowData, 'remote'>): string => row.remote?.computerId ?? THIS_COMPUTER;

/**
 * The project key of a remote project, in the place of a local project's folder (`projectRoot`), so the project
 * filter and the counts work the same. Never a path: it can't match one.
 */
export const remoteProjectKey = (computerId: string, projectId: string): string => `remote-project:${computerId}:${projectId}`;

export const isRemoteProjectKey = (key: string | null | undefined): boolean => !!key && key.startsWith('remote-project:');

/**
 * A remote session's state, with the same rules as the sessions' groups on that computer (`sessionGroups`,
 * `waitingCount`): an open prompt is needs you whatever the status says.
 */
export function remoteRowStatus(session: Pick<RemoteSession, 'status' | 'unread'>, asking: boolean): RowStatus {
  if (asking || session.status === 'needs-you') return 'needs-you';
  if (session.status === 'working') return 'running';
  if (session.status === 'error') return 'error';
  if (session.status === 'unread' || session.unread) return 'unread';
  if (session.status === 'background') return 'background';
  if (session.status === 'idle') return 'idle';
  return null;
}

/** One remote session as a sidebar row. */
export function remoteRow(computer: Pick<Computer, 'id' | 'name' | 'state' | 'lastSeen'>, session: RemoteSession, prompts: RemoteSessions['prompts']): SessionRowData {
  const asking = prompts.filter((p) => p.sessionId === session.id).sort((a, b) => a.createdAt - b.createdAt);
  const status = remoteRowStatus(session, asking.length > 0);
  return {
    id: remoteRowId({ computerId: computer.id, sessionId: session.id }),
    title: session.title,
    projectRoot: remoteProjectKey(computer.id, session.projectId),
    updatedAt: session.updatedAt,
    branch: session.branch,
    isWorktree: false,
    live: null,
    summary: null,
    pinned: session.pinned,
    archivedAt: null,
    restoredAt: null,
    unread: session.unread,
    // Every session that computer lists runs in its Switchboard, so it counts under "Only Switchboard's sessions".
    inApp: true,
    error: status === 'error',
    // Profiles are that computer's own: none of this computer's can match.
    profileId: '',
    remote: {
      computerId: computer.id,
      computerName: computer.name,
      sessionId: session.id,
      projectId: session.projectId,
      projectName: session.projectName,
      status,
      waitingTool: asking[0]?.toolName ?? null,
      workingSince: session.workingSince ?? null,
      profile: session.profile,
      offline: computer.state !== 'connected',
      lastSeen: computer.lastSeen,
    },
  };
}

/**
 * Every remote session as sidebar rows, from each computer's last list. A computer that went offline keeps its last
 * list (its rows dimmed); one that was forgotten has no list any more, so its rows go.
 */
export function remoteRows(computers: readonly Pick<Computer, 'id' | 'name' | 'state' | 'lastSeen'>[], lists: ReadonlyMap<string, RemoteSessions>): SessionRowData[] {
  return computers.flatMap((computer) => {
    const list = lists.get(computer.id);
    return list ? list.sessions.map((session) => remoteRow(computer, session, list.prompts)) : [];
  });
}

/**
 * The colour of a remote session's profile here: when this computer has a profile of the same name (Personal, Work),
 * that profile's colour, so one account reads the same on both; else the colour the other computer gave it.
 */
export function remoteProfileColor(profile: NonNullable<RemoteSession['profile']>, local: readonly Pick<ClaudeProfile, 'name' | 'color'>[]): ProfileColor {
  const name = profile.name.trim().toLowerCase();
  return local.find((p) => p.name.trim().toLowerCase() === name)?.color ?? profile.color;
}

/** Leaves out the rows of the computers the filter hides (`THIS_COMPUTER` for this one's own). */
export function filterBySource<T extends Pick<SessionRowData, 'remote'>>(rows: readonly T[], hidden: ReadonlySet<string>): T[] {
  return hidden.size === 0 ? (rows as T[]) : rows.filter((row) => !hidden.has(sourceOf(row)));
}

/** The filter that shows only one computer's sessions. */
export const onlySource = (sources: readonly string[], keep: string): Set<string> => new Set(sources.filter((source) => source !== keep));

/** Whether the filter shows only that computer's sessions. */
export const showsOnly = (sources: readonly string[], hidden: ReadonlySet<string>, source: string): boolean =>
  !hidden.has(source) && sources.every((other) => other === source || hidden.has(other));

/**
 * A chip in the Computers strip: shows only its computer, or everything again when it already did. Hidden sources
 * that no longer exist are dropped.
 */
export function toggleOnly(sources: readonly string[], hidden: ReadonlySet<string>, source: string): Set<string> {
  return showsOnly(sources, hidden, source) ? new Set() : onlySource(sources, source);
}

/** A checkbox in "Show sessions from": hides or shows one computer's sessions. */
export function toggleSource(hidden: ReadonlySet<string>, source: string): Set<string> {
  const next = new Set(hidden);
  if (!next.delete(source)) next.add(source);
  return next;
}

/** The tooltip of an offline computer's rows: "mystic is offline. Last seen 2h ago." */
export function offlineLine(name: string, lastSeen: number | null, now = Date.now()): string {
  return lastSeen === null ? `${name} is offline.` : `${name} is offline. Last seen ${agoText(lastSeen, now)}.`;
}

/** Why New session can't start on an offline computer: "studio is offline since 2h ago. You can start there once it is back." */
export function offlineStartLine(name: string, lastSeen: number | null, now = Date.now()): string {
  const since = lastSeen === null ? `${name} is offline.` : `${name} is offline since ${agoText(lastSeen, now)}.`;
  return `${since} You can start there once it is back.`;
}

/**
 * The tooltip on what only works on that computer: "Terminal is on mystic. Not available from here." A plural
 * ("Changes", "Files") takes "are".
 */
export function onlyThereLine(feature: string, name: string): string {
  return `${feature} ${/s$/.test(feature) ? 'are' : 'is'} on ${name}. Not available from here.`;
}
