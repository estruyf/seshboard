import { useEffect, useMemo, useState } from 'react';
import type { RemoteContract, RemoteSessions, RpcClient } from '@switchboard/protocol/remote-client';
import { Plus } from 'lucide-react';
import { Connection, type ConnectionState } from '../lib/connection.ts';
import type { Paired } from '../lib/link.ts';
import { useWide } from '../lib/media.ts';
import { NewSession } from './NewSession.tsx';
import { SessionList } from './SessionList.tsx';
import { SessionView } from './SessionView.tsx';
import { Button, Logo, Message } from './ui.tsx';

export type Route = { kind: 'list' } | { kind: 'session'; sessionId: string } | { kind: 'new' };

/**
 * Connected to the paired computer: the session list, a session, or New session. On a phone one at a time, each step
 * forward a history entry so the back gesture goes back; on a wide screen the list stays on the left, as the sidebar
 * does on the computer.
 */
export function Connected({ paired, onForget }: { paired: Paired; onForget: () => void }) {
  const connection = useMemo(() => new Connection(paired), [paired]);
  const [state, setState] = useState<ConnectionState>(connection.current);
  const [sessions, setSessions] = useState<RemoteSessions>({ sessions: [], prompts: [] });
  const [route, setRoute] = useState<Route>({ kind: 'list' });
  const wide = useWide();

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
      <Message title="Pair again" actions={<Button onClick={onForget}>Forget this computer</Button>}>
        {state.message}
      </Message>
    );
  }

  const banner = <ConnectionBanner state={state} />;
  const startNew = () => go({ kind: 'new' });
  const started = (sessionId: string) => {
    history.replaceState({ kind: 'session', sessionId }, '');
    setRoute({ kind: 'session', sessionId });
  };
  const main =
    route.kind === 'session' ? (
      <SessionView key={route.sessionId} client={client} sessionId={route.sessionId} sessions={sessions} banner={wide ? null : banner} onBack={wide ? null : back} />
    ) : route.kind === 'new' ? (
      <NewSession client={client} sessions={sessions.sessions} banner={wide ? null : banner} onBack={wide ? null : back} onStarted={started} />
    ) : null;
  const list = (
    <SessionList
      sessions={sessions}
      banner={wide ? null : banner}
      deviceName={paired.name}
      selectedId={route.kind === 'session' ? route.sessionId : null}
      newOpen={route.kind === 'new'}
      // On a wide screen, picking another session replaces the open one rather than stacking up history.
      onOpen={(sessionId) => (wide && route.kind !== 'list' ? (history.replaceState({ kind: 'session', sessionId }, ''), setRoute({ kind: 'session', sessionId })) : go({ kind: 'session', sessionId }))}
      onNew={startNew}
      onForget={onForget}
    />
  );

  if (!wide) return main ?? list;
  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-sidebar lg:w-[340px]">{list}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        <div className="min-h-0 flex-1">{main ?? <Pick needsYou={sessions.sessions.filter((s) => s.status === 'needs-you').length} onNew={startNew} />}</div>
      </div>
    </div>
  );
}

/** The right side of a wide screen before a session is open. */
function Pick({ needsYou, onNew }: { needsYou: number; onNew: () => void }) {
  return (
    <main className="mx-auto flex h-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <Logo className="size-12" />
      <h1 className="text-hero font-semibold">Switchboard Remote</h1>
      <p className="text-body text-muted">{needsYou > 0 ? `${needsYou === 1 ? 'One session needs' : `${needsYou} sessions need`} you. Pick it on the left.` : 'Pick a session on the left, or start a new one.'}</p>
      <Button variant="primary" onClick={onNew}>
        <Plus className="size-4" aria-hidden />
        New session
      </Button>
    </main>
  );
}

/** One quiet line while the connection is down; nothing while it is up. */
function ConnectionBanner({ state }: { state: ConnectionState }) {
  if (state.kind === 'connected') return null;
  return (
    <div role="status" className="border-b border-border bg-sidebar px-4 py-2 text-ui text-muted">
      {state.kind === 'connecting' ? 'Connecting to your computer…' : `${state.kind === 'offline' ? state.message : ''} Trying again shortly.`}
    </div>
  );
}

export type Client = RpcClient<RemoteContract> | null;
