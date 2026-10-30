import { REMOTE_FEATURE_MARK_UNREAD, type Computer, type Contract, type RemoteSession, type RpcClient } from '@seshboard/protocol/client';
import { useComputers } from '../../state/computersStore.ts';
import { useRunOn } from '../../state/runOnStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import type { MenuEntry } from '../Menu.tsx';
import { callComputer } from './callComputer.ts';

/**
 * What can be done to a session on another computer from here, shared by its sidebar row and its view. Only what the
 * remote contract offers: open, mark read or unread, pin, archive (`session.setFlags`), and copy the title. Renaming
 * and deleting stay on that computer.
 */

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
export function remoteSessionEntries(client: RpcClient<Contract> | null, computer: Pick<Computer, 'id' | 'name' | 'state' | 'features'>, session: Pick<RemoteSession, 'id' | 'title' | 'pinned' | 'unread' | 'projectId' | 'projectName'>, options: { open: boolean }): MenuEntry[] {
  const away = computer.state !== 'connected';
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
    { label: 'Archive', hint: `on ${computer.name}`, disabled: away, onSelect: () => setRemoteFlags(client, computer.id, session.id, { archived: true, pinned: false }), data: { 'data-remote-archive': true } },
    { label: 'Copy title', onSelect: () => void navigator.clipboard.writeText(session.title) },
    'separator',
    { label: `New session in ${session.projectName}`, disabled: away, onSelect: () => newSessionOn(computer.id, session.projectId), data: { 'data-remote-new-session': true } },
  ];
}
