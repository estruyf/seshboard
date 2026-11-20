import { useEffect, useRef } from 'react';
import { REMOTE_FEATURE_ARCHIVED, type ComputersStatus, type RemoteSessions } from '@seshboard/protocol/client';
import { callComputer } from '../components/computers/callComputer.ts';
import { newProblems } from '../components/computers/computerSessions.ts';
import { toast } from './toastStore.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useComputers } from './computersStore.ts';
import { doneKey } from './remoteRows.ts';

/**
 * Mirrors the paired computers and the session list of each connected one, for the dock and the Computer view. After
 * Update there (Settings › Remote), says it updated once it is back on the new version.
 */
export function useComputersSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const computers = useComputers((s) => s.status?.computers);
  const asks = useComputers((s) => s.updateAsks);
  const lists = useComputers((s) => s.lists);
  /** The computers whose list was fetched since they last connected. */
  const fetched = useRef(new Set<string>());
  /** Each computer's list when its Done was read last (`doneKey`): Done changes when a session leaves or joins it. */
  const doneRead = useRef(new Map<string, string>());

  useEffect(() => {
    if (!client) return;
    const store = () => useComputers.getState();
    fetched.current.clear();
    const setStatus = (status: ComputersStatus) => {
      // A computer that sent what this version can't read says so once; its page and its chip keep saying it.
      for (const computer of newProblems(store().status?.computers, status.computers)) {
        toast(`Can’t read what ${computer.name} sent`, {
          icon: 'computer',
          tone: 'error',
          body: computer.problem!,
          durationMs: 10_000,
          actions: [{ label: 'Show', onSelect: () => useComputers.getState().openPage(computer.id) }],
          data: { 'data-computer-problem-toast': computer.id },
        });
      }
      store().setStatus(status);
    };
    const offs = [
      client.on('computers.changed', setStatus),
      // The engine checked it against the remote contract (`computerData.ts`).
      client.on('computers.event', ({ computerId, name, payload }) => {
        if (name === 'sessions.changed') store().setList(computerId, payload as unknown as RemoteSessions);
      }),
    ];
    void client.call('computers.status', {}).then(setStatus, () => {});
    return () => offs.forEach((off) => off());
  }, [client]);

  // A computer that (re)connects: its list now, then `sessions.changed` keeps it current.
  useEffect(() => {
    if (!client || !computers) return;
    for (const computer of computers) {
      if (computer.state !== 'connected') {
        fetched.current.delete(computer.id);
        continue;
      }
      if (fetched.current.has(computer.id)) continue;
      fetched.current.add(computer.id);
      void callComputer(client, computer.id, 'sessions.list', {}).then(
        (list) => useComputers.getState().setList(computer.id, list),
        () => fetched.current.delete(computer.id),
      );
    }
  }, [client, computers]);

  // A computer's Done (`sessions.archived`), for the sidebar's Done: when it connects, and when a session leaves its
  // list or comes back. An offline computer keeps the last one, dimmed, as its list.
  useEffect(() => {
    if (!client || !computers) return;
    for (const computer of computers) {
      if (computer.state !== 'connected' || !computer.features.includes(REMOTE_FEATURE_ARCHIVED)) {
        doneRead.current.delete(computer.id);
        continue;
      }
      const list = lists.get(computer.id);
      if (!list) continue;
      const key = doneKey(list);
      if (doneRead.current.get(computer.id) === key) continue;
      doneRead.current.set(computer.id, key);
      void callComputer(client, computer.id, 'sessions.archived', {}).then(
        ({ sessions }) => useComputers.getState().setDone(computer.id, sessions),
        () => doneRead.current.delete(computer.id),
      );
    }
  }, [client, computers, lists]);

  // An update asked from this window: once the computer is back on another version, its row says Updated for the rest
  // of the app session, and a toast says so wherever you are.
  useEffect(() => {
    if (!computers) return;
    for (const [id, ask] of asks) {
      const computer = computers.find((c) => c.id === id);
      if (!computer) {
        useComputers.getState().setUpdateAsk(id, null);
        continue;
      }
      if (ask.kind !== 'install' || computer.state !== 'connected' || !computer.version || computer.version === ask.from) continue;
      useComputers.getState().setUpdateAsk(id, null);
      useComputers.getState().setUpdatedTo(id, computer.version);
      toast(`Updated ${computer.name} to ${computer.version}`, { icon: 'computer', tone: 'ok', durationMs: 8_000, data: { 'data-computer-update-toast': 'updated' } });
    }
  }, [computers, asks]);
}
