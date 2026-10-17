import { useEffect, useRef } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { connectedRows, connectionAnnouncement, connectionChanges, connectToastDue, dayKey, type ConnectedDevice } from './connectedDevices.ts';
import { revokeDevice, setToastDay, toastDay, useRemote } from './remoteStore.ts';
import { toast } from './toastStore.ts';
import { popoutSession } from './popoutsStore.ts';

/**
 * Mirrors Remote's status and what paired devices do (`remote.changed`, `remote.fromDevice`) into `useRemote`, for
 * Settings › Remote and the sidebar. A device that connects is announced, with a toast the first time each day.
 */
export function useRemoteSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const clientRef = useRef(client);
  clientRef.current = client;

  useEffect(() => {
    if (!client) return;
    const store = () => useRemote.getState();
    const offs = [client.on('remote.changed', (status) => store().setStatus(status)), client.on('remote.fromDevice', (event) => store().recordAction(event))];
    void client.call('remote.status', {}).then(
      (status) => store().setStatus(status),
      (error: Error) => store().setError(error.message),
    );
    return () => offs.forEach((off) => off());
  }, [client]);

  useEffect(() => {
    // The main window says it; a pop-out would say it twice.
    if (popoutSession) return;
    // Null until the first status: the devices connected at startup are neither announced nor toasted.
    let before: ConnectedDevice[] | null = null;
    return useRemote.subscribe((state, prev) => {
      if (state.status === prev.status || !state.status) return;
      const after = state.status.settings.enabled ? connectedRows(state.status) : [];
      const changes = connectionChanges(before, after);
      before = after;
      const text = connectionAnnouncement(changes);
      if (text) state.announce(text);
      const now = Date.now();
      for (const device of changes.joined) {
        if (!connectToastDue(device, toastDay(device.id), now)) continue;
        setToastDay(device.id, dayKey(now));
        toast(`${device.name} connected`, {
          body: 'It can follow and steer your sessions.',
          icon: device.kind,
          actions: [
            { label: 'OK', onSelect: () => {} },
            { label: 'Revoke', danger: true, onSelect: () => revokeDevice(clientRef.current, device), data: { 'data-device-toast-revoke': true } },
          ],
          data: { 'data-device-toast': device.id },
        });
      }
    });
  }, []);
}
