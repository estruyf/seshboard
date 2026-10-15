import type { Computer, Contract, RemoteSession, RpcClient } from '@switchboard/protocol/client';
import { useComputers } from '../../state/computersStore.ts';
import { useRunOn } from '../../state/runOnStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import type { MenuEntry } from '../Menu.tsx';
import { callComputer } from './callComputer.ts';

/**
 * What can be done to a session on another computer from here, shared by its sidebar row and its view. Only what the
 * remote contract offers: open, pin, archive (`session.setFlags`), and copy the title. Renaming and deleting stay on
 * that computer.
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

/** The menu entries of a remote session: Open (unless it is open already), Pin, Archive, Copy title, and New session in its project. */
export function remoteSessionEntries(client: RpcClient<Contract> | null, computer: Pick<Computer, 'id' | 'name' | 'state'>, session: Pick<RemoteSession, 'id' | 'title' | 'pinned' | 'projectId' | 'projectName'>, options: { open: boolean }): MenuEntry[] {
  const away = computer.state !== 'connected';
  return [
    ...(options.open ? [{ label: 'Open', onSelect: () => useComputers.getState().openSession({ computerId: computer.id, sessionId: session.id }), data: { 'data-remote-open': true } } satisfies MenuEntry] : []),
    { label: session.pinned ? 'Unpin' : 'Pin', disabled: away, onSelect: () => setRemoteFlags(client, computer.id, session.id, { pinned: !session.pinned }) },
    { label: 'Archive', hint: `on ${computer.name}`, disabled: away, onSelect: () => setRemoteFlags(client, computer.id, session.id, { archived: true, pinned: false }), data: { 'data-remote-archive': true } },
    { label: 'Copy title', onSelect: () => void navigator.clipboard.writeText(session.title) },
    'separator',
    { label: `New session in ${session.projectName}`, disabled: away, onSelect: () => newSessionOn(computer.id, session.projectId), data: { 'data-remote-new-session': true } },
  ];
}
