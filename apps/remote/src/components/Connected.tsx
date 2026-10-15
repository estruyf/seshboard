import { useEffect, useMemo, useState } from 'react';
import type { RemoteContract, RemoteSessions, RpcClient } from '@switchboard/protocol/remote-client';
import { Connection, type ConnectionState } from '../lib/connection.ts';
import type { Paired } from '../lib/link.ts';
import { NewSession } from './NewSession.tsx';
import { SessionList } from './SessionList.tsx';
import { SessionView } from './SessionView.tsx';
import { Button, Message } from './ui.tsx';

export type Route = { kind: 'list' } | { kind: 'session'; sessionId: string } | { kind: 'new' };

/**
 * Connected to the paired computer: the session list, a session, or New session. Each step forward is a history
 * entry, so the phone's back gesture goes back.
 */
export function Connected({ paired, onForget }: { paired: Paired; onForget: () => void }) {
  const connection = useMemo(() => new Connection(paired), [paired]);
  const [state, setState] = useState<ConnectionState>(connection.current);
  const [sessions, setSessions] = useState<RemoteSessions>({ sessions: [], prompts: [] });
  const [route, setRoute] = useState<Route>({ kind: 'list' });

  useEffect(() => {
    const unsubscribe = connection.subscribe(setState);
    connection.start();
    return () => {
      unsubscribe();
      connection.stop();
    };
  }, [connection]);

  const client = state.kind === 'connected' ? state.client : null;

  useEffect(() => {
    if (!client) return;
    void client.call('sessions.list', {}).then(setSessions, () => {});
    return client.on('sessions.changed', setSessions);
  }, [client]);

  useEffect(() => {
    const back = (event: PopStateEvent) => setRoute((event.state as Route | null) ?? { kind: 'list' });
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  const go = (next: Route) => {
    history.pushState(next, '');
    setRoute(next);
  };
  const back = () => history.back();

  if (state.kind === 'unpaired') {
    return (
      <Message title="Pair this phone again" actions={<Button onClick={onForget}>Forget this computer</Button>}>
        {state.message}
      </Message>
    );
  }

  const banner = <ConnectionBanner state={state} />;
  if (route.kind === 'session') return <SessionView key={route.sessionId} client={client} sessionId={route.sessionId} sessions={sessions} banner={banner} onBack={back} />;
  if (route.kind === 'new') return <NewSession client={client} banner={banner} onBack={back} onStarted={(sessionId) => { history.replaceState({ kind: 'session', sessionId }, ''); setRoute({ kind: 'session', sessionId }); }} />;
  return <SessionList sessions={sessions} banner={banner} deviceName={paired.name} onOpen={(sessionId) => go({ kind: 'session', sessionId })} onNew={() => go({ kind: 'new' })} onForget={onForget} />;
}

/** One quiet line while the connection is down; nothing while it is up. */
function ConnectionBanner({ state }: { state: ConnectionState }) {
  if (state.kind === 'connected') return null;
  return (
    <div role="status" className="bg-sidebar px-4 py-2 text-ui text-muted">
      {state.kind === 'connecting' ? 'Connecting to your computer…' : `${state.kind === 'offline' ? state.message : ''} Trying again shortly.`}
    </div>
  );
}

export type Client = RpcClient<RemoteContract> | null;
