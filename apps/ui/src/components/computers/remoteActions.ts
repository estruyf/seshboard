import { REMOTE_FEATURE_MARK_UNREAD, runIsActive, type Computer, type Contract, type PermissionDecision, type RemotePrompt, type RemoteRunState, type RemoteSession, type RpcClient } from '@seshboard/protocol/client';
import { useComputers } from '../../state/computersStore.ts';
import { useRunOn } from '../../state/runOnStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import type { MenuEntry } from '../Menu.tsx';
import { callComputer } from './callComputer.ts';

/**
 * What can be done to a session on another computer from here, shared by its sidebar row and its view. Only what the
 * remote contract offers: open, mark read or unread, pin, archive (`session.setFlags`, or `runs.archive` for a pipeline's
 * tree), and copy the title. Renaming and deleting stay on that computer.
 */

/** A row on another computer as these actions need it: its session (a run row's run) and the run whose tree it heads. */
export interface RemoteTarget {
  computerId: string;
  sessionId: string;
  runRow?: boolean;
  treeRunId?: string | null;
}

/** A run on another computer, from its last list; null once that computer no longer lists it. */
export function remoteRunState(computerId: string, runId: string): RemoteRunState | null {
  return useComputers.getState().lists.get(computerId)?.runs?.find((state) => state.run.id === runId) ?? null;
}

/**
 * Done (or back) for a row on another computer: a run row or a pipeline's parent goes with its tree (`runs.archive`,
 * which that computer refuses while the run goes on), any other session by its flags.
 */
export function archiveRemote(client: RpcClient<Contract> | null, target: RemoteTarget, archived: boolean): void {
  if (!client) return;
  if (target.treeRunId) {
    void callComputer(client, target.computerId, 'runs.archive', { runId: target.treeRunId, archived }).catch((e: Error) => toast(e.message));
    return;
  }
  setRemoteFlags(client, target.computerId, target.sessionId, archived ? { archived: true, pinned: false } : { archived: false });
}

/** Stop on another computer: the run that goes on in its tree, and Claude's turn in the session (a run row has none). */
export async function stopRemote(client: RpcClient<Contract> | null, target: RemoteTarget): Promise<void> {
  if (!client) return;
  const run = target.treeRunId ? remoteRunState(target.computerId, target.treeRunId) : null;
  if (run && runIsActive(run)) await callComputer(client, target.computerId, 'runs.stop', { runId: run.run.id });
  if (!target.runRow) await callComputer(client, target.computerId, 'session.interrupt', { sessionId: target.sessionId });
}

/**
 * Answers a prompt of a session on another computer (its session view and its computer's page): true once it is sent;
 * false with a toast when it wasn't, "Already answered" when it was answered elsewhere first.
 */
export async function respondRemote(client: RpcClient<Contract>, computerId: string, prompt: Pick<RemotePrompt, 'requestId'>, decision: PermissionDecision): Promise<boolean> {
  try {
    await callComputer(client, computerId, 'session.respond', { requestId: prompt.requestId, decision });
    return true;
  } catch (e) {
    toast((e as { code?: string }).code === 'NOT_FOUND' ? 'Already answered' : (e as Error).message);
    return false;
  }
}

/** Opens New session with another computer picked in Run on, and one of its projects when given. */
export function newSessionOn(computerId: string, projectId?: string | null): void {
  const runOn = useRunOn.getState();
  if (projectId !== undefined) runOn.setProject(computerId, projectId);
  useSessions.getState().openNewSession();
  runOn.setTarget(computerId);
}

/** Pins or archives a remote session, through its computer. */
export function setRemoteFlags(client: RpcClient<Contract> | null, computerId: string, sessionId: string, flags: { pinned?: boolean; archived?: boolean }): void {
  if (!client) return;
  void callComputer(client, computerId, 'session.setFlags', { sessionId, ...flags }).catch((e: Error) => toast(e.message));
}

/** Marks a remote session read or unread, through its computer. */
export function setRemoteUnread(client: RpcClient<Contract> | null, computerId: string, sessionId: string, unread: boolean): void {
  if (!client) return;
  void callComputer(client, computerId, unread ? 'session.markUnread' : 'session.markRead', { sessionId }).catch((e: Error) => toast(e.message));
}

/**
 * The menu entries of a remote session: Open and Open beside (unless it is open already), Mark as read or unread
 * (unread only on a computer that takes it), Pin, Archive, Copy title, and New session in its project.
 */
export function remoteSessionEntries(
  client: RpcClient<Contract> | null,
  computer: Pick<Computer, 'id' | 'name' | 'state' | 'features'>,
  session: Pick<RemoteSession, 'id' | 'title' | 'pinned' | 'unread' | 'projectId' | 'projectName'> & Pick<RemoteTarget, 'runRow' | 'treeRunId'>,
  options: { open: boolean },
): MenuEntry[] {
  const away = computer.state !== 'connected';
  const target: RemoteTarget = { computerId: computer.id, sessionId: session.id, runRow: session.runRow ?? false, treeRunId: session.treeRunId ?? null };
  // A run row (a run started from New session there) has no session yet: it opens, stops and goes to Done with its tree.
  if (session.runRow) {
    const run = remoteRunState(computer.id, session.id);
    return [
      ...(options.open
        ? ([
            { label: 'Open', onSelect: () => useComputers.getState().openSession({ computerId: computer.id, sessionId: session.id }), data: { 'data-remote-open': true } },
            { label: 'Open beside', hint: '⌥-click', onSelect: () => useComputers.getState().openSession({ computerId: computer.id, sessionId: session.id }, { beside: true }) },
          ] satisfies MenuEntry[])
        : []),
      ...(run && runIsActive(run) ? [{ label: 'Stop the run', disabled: away, onSelect: () => void stopRemote(client, target).catch((e: Error) => toast(e.message)), data: { 'data-remote-run-stop': true } } satisfies MenuEntry] : []),
      { label: 'Done', hint: `with its steps, on ${computer.name}`, disabled: away, onSelect: () => archiveRemote(client, target, true), data: { 'data-remote-archive': true } },
      { label: 'Copy title', onSelect: () => void navigator.clipboard.writeText(session.title) },
      'separator',
      { label: `New session in ${session.projectName}`, disabled: away, onSelect: () => newSessionOn(computer.id, session.projectId), data: { 'data-remote-new-session': true } },
    ];
  }
  const read: MenuEntry[] = session.unread
    ? [{ label: 'Mark as read', disabled: away, onSelect: () => setRemoteUnread(client, computer.id, session.id, false), data: { 'data-mark-read': true } }]
    : computer.features.includes(REMOTE_FEATURE_MARK_UNREAD)
      ? [{ label: 'Mark as unread', disabled: away, onSelect: () => setRemoteUnread(client, computer.id, session.id, true), data: { 'data-mark-unread': true } }]
      : [];
  return [
    ...(options.open
      ? ([
          { label: 'Open', onSelect: () => useComputers.getState().openSession({ computerId: computer.id, sessionId: session.id }), data: { 'data-remote-open': true } },
          { label: 'Open beside', hint: '⌥-click', onSelect: () => useComputers.getState().openSession({ computerId: computer.id, sessionId: session.id }, { beside: true }) },
        ] satisfies MenuEntry[])
      : []),
    ...read,
    { label: session.pinned ? 'Unpin' : 'Pin', disabled: away, onSelect: () => setRemoteFlags(client, computer.id, session.id, { pinned: !session.pinned }) },
    { label: 'Done', hint: target.treeRunId ? `with its steps, on ${computer.name}` : `on ${computer.name}`, disabled: away, onSelect: () => archiveRemote(client, target, true), data: { 'data-remote-archive': true } },
    { label: 'Copy title', onSelect: () => void navigator.clipboard.writeText(session.title) },
    'separator',
    { label: `New session in ${session.projectName}`, disabled: away, onSelect: () => newSessionOn(computer.id, session.projectId), data: { 'data-remote-new-session': true } },
  ];
}
