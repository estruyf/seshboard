import { useEffect, useRef } from 'react';
import type { RemoteSessions } from '@switchboard/protocol/client';
import { callComputer } from '../components/computers/callComputer.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useComputers } from './computersStore.ts';

/** Mirrors the paired computers and the session list of each connected one, for the dock and the Computer view. */
export function useComputersSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const computers = useComputers((s) => s.status?.computers);
  /** The computers whose list was fetched since they last connected. */
  const fetched = useRef(new Set<string>());

  useEffect(() => {
    if (!client) return;
    const store = () => useComputers.getState();
    fetched.current.clear();
    const offs = [
      client.on('computers.changed', (status) => store().setStatus(status)),
      client.on('computers.event', ({ computerId, name, payload }) => {
        if (name === 'sessions.changed') store().setList(computerId, payload as unknown as RemoteSessions);
      }),
    ];
    void client.call('computers.status', {}).then((status) => store().setStatus(status), () => {});
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
}
