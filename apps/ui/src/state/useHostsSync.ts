import { useEffect } from 'react';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useHosts } from './hostsStore.ts';
import { clearStreaming, queueStream, resetStreaming } from './streamingStore.ts';

/** Mirrors the engine's running sessions, permission prompts, live output, models, editors and skill reloads. */
export function useHostsSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;

  useEffect(() => {
    if (!client) return;
    const store = () => useHosts.getState();
    const offs = [
      client.on('session.host', (info) => {
        store().upsertHost(info);
        // A turn that ended, or a session that closed or failed, writes nothing more.
        if (info.state === 'idle' || info.state === 'closed' || info.state === 'error') clearStreaming(info.sessionId);
      }),
      // Applied once per frame, in a store of its own: only what shows the streaming text renders again.
      client.on('session.stream', (delta) => queueStream(delta)),
      client.on('session.permission', (request) => store().addPermission(request)),
      client.on('session.permissionResolved', ({ requestId }) => store().removePermission(requestId)),
      client.on('models.changed', ({ models }) => store().setModels(models)),
      client.on('commands.changed', () => store().bumpCommands()),
    ];
    void client.call('hosts.list', {}).then(({ hosts, permissions }) => {
      store().reset(hosts, permissions);
      resetStreaming();
    });
    void client.call('models.list', {}).then(({ models }) => store().setModels(models));
    void client.call('editors.list', {}).then(({ editors, defaultId }) => store().setEditors(editors, defaultId));
    return () => offs.forEach((off) => off());
  }, [client]);
}
