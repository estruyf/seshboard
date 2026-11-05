import { isMine, REMOTE_FEATURE_STARTED_BY, runOfParent, triggerOriginOf, type ClaudeProfile, type Computer, type ProfileColor, type RemoteRun, type RemoteRunState, type RemoteSession, type RemoteSessions } from '@seshboard/protocol/client';
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
  /**
   * The row it sits under (`remoteRowId`): a pipeline step's sub-session under the session the run started from, or
   * under its run row.
   */
  parentRowId?: string | null;
  /** Started or acted on from here (`isMine`): what the computer's Mine filter keeps. */
  mine?: boolean;
  /** Who started it, for a session that isn't mine: a person's device, that computer itself, or "another device". */
  startedBy?: string | null;
  /** One of the others' sessions its computer's Mine filter leaves out, listed because a search found it. */
  fromOthers?: boolean;
  /** A pipeline run started from New session there: `sessionId` is the run's id, and no session is behind it yet. */
  runRow?: boolean;
  /** The run whose tree this row heads (a run row's own, or the newest started from the session): Done archives it with `runs.archive`. */
  treeRunId?: string | null;
  /** The name of the trigger that started it there (the bolt on its row); null when none did. */
  trigger?: string | null;
}

/**
 * Which of a computer's sessions the sidebar shows (its chip's menu, `ComputersStrip`): `mine` (started or acted on
 * from here, `isMine`) or `all` (everyone's, on a computer other people use too). Kept per computer; `mine` at first.
 */
export type ComputerScope = 'mine' | 'all';
export const DEFAULT_SCOPE: ComputerScope = 'mine';

/** What a row needs to know of its computer. Without `mineHere` nothing there is mine yet. */
export type RowComputer = Pick<Computer, 'id' | 'name' | 'state' | 'lastSeen'> & Partial<Pick<Computer, 'mineHere' | 'ownName' | 'features'>>;

/**
 * Who started a session that isn't mine, after its branch in All: the device that did (a person's phone or computer),
 * that computer itself when it says nobody did from afar, or "another device" when it doesn't say (an older version).
 */
export function startedByOf(session: Pick<RemoteSession, 'startedBy'>, computer: RowComputer): string {
  if (session.startedBy) return session.startedBy;
  return session.startedBy === null && computer.features?.includes(REMOTE_FEATURE_STARTED_BY) ? (computer.ownName ?? computer.name) : 'another device';
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

/** One remote session as a sidebar row; `runs`, that computer's, give the run whose tree it heads. */
export function remoteRow(computer: RowComputer, session: RemoteSession, prompts: RemoteSessions['prompts'], runs: readonly RemoteRunState[] = []): SessionRowData {
  const asking = prompts.filter((p) => p.sessionId === session.id).sort((a, b) => a.createdAt - b.createdAt);
  const status = remoteRowStatus(session, asking.length > 0);
  const mine = isMine(session.id, session.parentId, { mineHere: computer.mineHere ?? [] });
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
    // Every session that computer lists runs in its Seshboard, so it counts under "Only Seshboard's sessions".
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
      parentRowId: session.parentId ? remoteRowId({ computerId: computer.id, sessionId: session.parentId }) : null,
      mine,
      startedBy: mine ? null : startedByOf(session, computer),
      treeRunId: runOfParent(runs, session.id)?.run.id ?? null,
      trigger: triggerOriginOf(session.trigger)?.name ?? null,
    },
  };
}

/** A run row's state as a row's: waiting for you (a stop, a confirm, Push) is needs you, running is working. */
export function remoteRunRowStatus(run: Pick<RemoteRun, 'status'>): RowStatus {
  if (run.status === 'waiting') return 'needs-you';
  if (run.status === 'running') return 'running';
  return null;
}

/**
 * A run started from New session on another computer as a sidebar row, as this computer's run rows are
 * (`runRowData`): keyed by the run's id on that computer, with no session behind it until you write in it there.
 */
export function remoteRunRow(computer: RowComputer, { run }: RemoteRunState): SessionRowData {
  const status = remoteRunRowStatus(run);
  // Started (or acted on) from here: the run's id is what this computer remembers.
  const mine = isMine(run.id, null, { mineHere: computer.mineHere ?? [] });
  const trigger = triggerOriginOf(run.trigger)?.name ?? null;
  return {
    id: remoteRowId({ computerId: computer.id, sessionId: run.id }),
    title: run.title,
    projectRoot: remoteProjectKey(computer.id, run.projectId),
    updatedAt: run.updatedAt,
    workingSince: status === 'running' ? run.createdAt : null,
    branch: null,
    isWorktree: run.worktree,
    live: null,
    summary: null,
    pinned: false,
    archivedAt: null,
    restoredAt: null,
    unread: false,
    inApp: true,
    error: false,
    profileId: '',
    remote: {
      computerId: computer.id,
      computerName: computer.name,
      sessionId: run.id,
      projectId: run.projectId,
      projectName: run.projectName,
      status,
      waitingTool: null,
      workingSince: status === 'running' ? run.createdAt : null,
      profile: null,
      offline: computer.state !== 'connected',
      lastSeen: computer.lastSeen,
      parentRowId: null,
      runRow: true,
      treeRunId: run.id,
      trigger,
      mine,
      // A run says who started it only when a trigger did.
      startedBy: mine ? null : trigger,
    },
  };
}

/**
 * Every remote session as sidebar rows, from each computer's last list. A computer that went offline keeps its last
 * list (its rows dimmed); one that was forgotten has no list any more, so its rows go.
 */
export function remoteRows(computers: readonly RowComputer[], lists: ReadonlyMap<string, RemoteSessions>): SessionRowData[] {
  return computers.flatMap((computer) => {
    const list = lists.get(computer.id);
    if (!list) return [];
    const runs = list.runs ?? [];
    return [...list.sessions.map((session) => remoteRow(computer, session, list.prompts, runs)), ...runs.filter((state) => !state.run.parentSessionId).map((state) => remoteRunRow(computer, state))];
  });
}

/**
 * Every computer's runs with their ids as the sidebar's rows have them (`remoteRowId`: the run, its parent and its
 * steps' sessions), so the sidebar's tree puts a run's steps in order under their parent and lifts the parent while
 * its run works or waits for you, as for a run here.
 */
export function remoteTreeRuns(computers: readonly Pick<Computer, 'id'>[], lists: ReadonlyMap<string, RemoteSessions>): RemoteRunState[] {
  return computers.flatMap((computer) => {
    const key = (sessionId: string) => remoteRowId({ computerId: computer.id, sessionId });
    return (lists.get(computer.id)?.runs ?? []).map((state) => ({
      run: { ...state.run, id: key(state.run.id), parentSessionId: state.run.parentSessionId ? key(state.run.parentSessionId) : null },
      steps: state.steps.map((step) => (step.sessionId ? { ...step, sessionId: key(step.sessionId) } : step)),
    }));
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

/** The Mine / All filter of a computer: what was picked for it, else Mine. */
export const scopeOf = (scopes: ReadonlyMap<string, ComputerScope>, computerId: string): ComputerScope => scopes.get(computerId) ?? DEFAULT_SCOPE;

/**
 * Splits remote rows by each computer's Mine / All filter: `shown`, and `hidden`, the others' sessions on a computer
 * set to Mine (for the chip's count and search). A session that isn't mine stays shown while one of mine
 * sits under it, so a sub-session never loses its parent.
 */
export function splitByScope<T extends Pick<SessionRowData, 'id' | 'remote'>>(rows: readonly T[], scopes: ReadonlyMap<string, ComputerScope>): { shown: T[]; hidden: T[] } {
  const filtered = (row: T) => !!row.remote && scopeOf(scopes, row.remote.computerId) === 'mine';
  const parents = new Set(rows.flatMap((row) => (filtered(row) && row.remote?.mine && row.remote.parentRowId ? [row.remote.parentRowId] : [])));
  const shown: T[] = [];
  const hidden: T[] = [];
  for (const row of rows) (filtered(row) && !row.remote?.mine && !parents.has(row.id) ? hidden : shown).push(row);
  return { shown, hidden };
}

/** A remote row a search found among the others' sessions its computer's Mine filter leaves out: marked as theirs. */
export const markFromOthers = <T extends Pick<SessionRowData, 'remote'>>(row: T): T => (row.remote ? { ...row, remote: { ...row.remote, fromOthers: true } } : row);

/** A computer's list as its Mine / All filter shows it, for its chip's count of sessions that need you. */
export function shownList(list: RemoteSessions, computer: Pick<Computer, 'mineHere'>, scope: ComputerScope): RemoteSessions {
  if (scope === 'all') return list;
  const kept = new Set(list.sessions.filter((s) => isMine(s.id, s.parentId, computer)).map((s) => s.id));
  for (const s of list.sessions) if (s.parentId && kept.has(s.id)) kept.add(s.parentId);
  return { ...list, sessions: list.sessions.filter((s) => kept.has(s.id)), prompts: list.prompts.filter((p) => kept.has(p.sessionId)) };
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
