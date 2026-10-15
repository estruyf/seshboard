import { useEffect, useRef, useState } from 'react';
import type { RemoteContract, RemoteSessions, RpcClient } from '@switchboard/protocol/remote-client';
import { Plus } from 'lucide-react';
import { Connection, type ConnectionState } from '../lib/connection.ts';
import type { Paired } from '../lib/link.ts';
import { useWide } from '../lib/media.ts';
import { NewSession } from './NewSession.tsx';
import { SessionList } from './SessionList.tsx';
import { SessionView } from './SessionView.tsx';
import { ConnectionBanner, OfflineHelp } from './ConnectionStatus.tsx';
import type { MenuItem } from './Menu.tsx';
import { Toasts } from './Toasts.tsx';
import { NotificationsSheet, PushOffer, shouldOffer } from './Notifications.tsx';
import { offered, resync, turnOff } from '../lib/push.ts';
import { Button, Logo, Message } from './ui.tsx';

export type Route = { kind: 'list' } | { kind: 'session'; sessionId: string } | { kind: 'new' };

/**
 * Connected to the paired computer: the session list, a session, or New session. On a phone one at a time, each step
 * forward a history entry so the back gesture goes back; on a wide screen the list stays on the left, as the sidebar
 * does on the computer.
 */
export function Connected({ paired, openSession, onForget, onPaired }: { paired: Paired; openSession: string | null; onForget: () => void; onPaired: (paired: Paired) => void }) {
  const [state, setState] = useState<ConnectionState>({ kind: 'connecting', attempt: 0 });
  const connection = useRef<Connection | null>(null);
  const [sessions, setSessions] = useState<RemoteSessions>(cachedSessions);
  const [route, setRoute] = useState<Route>({ kind: 'list' });
  const [help, setHelp] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [offer, setOffer] = useState(() => shouldOffer(offered()));
  const wide = useWide();

  // A connection per effect run, so a stopped one is never started again (StrictMode runs effects twice). Keeping the
  // computer's name changes `paired`, which mustn't reconnect: only another device or address does.
  const latestPaired = useRef(paired);
  latestPaired.current = paired;
  useEffect(() => {
    const current = new Connection(latestPaired.current);
    connection.current = current;
    const unsubscribe = current.subscribe(setState);
    current.start();
    return () => {
      unsubscribe();
      current.stop();
    };
  }, [paired.deviceId, paired.address]);
  const retryNow = () => connection.current?.retryNow();

  const client = state.kind === 'connected' ? state.client : null;
  const computer = (state.kind === 'connected' && state.computerName) || paired.computerName || '';
  const needsYou = sessions.sessions.filter((s) => s.status === 'needs-you').length;

  // Keep the computer's name, so the offline help can name it after a reload.
  useEffect(() => {
    if (state.kind === 'connected' && state.computerName && state.computerName !== paired.computerName) onPaired({ ...paired, computerName: state.computerName });
  }, [state, paired, onPaired]);

  // The tab's title counts what waits on you, so it shows from another tab or the app switcher.
  useEffect(() => {
    document.title = needsYou > 0 ? `(${needsYou}) Switchboard Remote` : 'Switchboard Remote';
  }, [needsYou]);

  // The computer pushes nothing to a device that has the app on screen: tell it when that changes.
  useEffect(() => {
    if (!client) return;
    const tell = () => void client.call('device.visibility', { visible: document.visibilityState === 'visible' }).catch(() => {});
    tell();
    void resync(client);
    document.addEventListener('visibilitychange', tell);
    return () => document.removeEventListener('visibilitychange', tell);
  }, [client]);

  const refresh = () => void client?.call('sessions.list', {}).then(setSessions, () => {});
  useEffect(() => {
    if (!client) return;
    void client.call('sessions.list', {}).then(setSessions, () => {});
    return client.on('sessions.changed', setSessions);
  }, [client]);
  useEffect(() => cacheSessions(sessions), [sessions]);

  useEffect(() => {
    const back = (event: PopStateEvent) => setRoute(routeOf(event.state));
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  const go = (next: Route) => {
    history.pushState(next, '');
    setRoute(next);
  };

  // Opened from a notification: that session, with the list one step back. A tap while the app is open comes from the
  // service worker as a message.
  const opened = useRef(false);
  useEffect(() => {
    if (openSession && !opened.current) {
      opened.current = true;
      history.replaceState({ kind: 'list' }, '');
      go({ kind: 'session', sessionId: openSession });
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; sessionId?: unknown } | null;
      if (data?.type === 'open-session' && typeof data.sessionId === 'string') go({ kind: 'session', sessionId: data.sessionId });
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);
  const back = () => history.back();
  /** Back to the list: one step back on a phone, the empty view on a wide screen (where picking replaces the entry). */
  const leave = () => {
    if (!wide) return back();
    history.replaceState({ kind: 'list' }, '');
    setRoute({ kind: 'list' });
  };

  if (state.kind === 'unpaired') {
    return (
      <Message title="Pair again" actions={<Button onClick={onForget}>Forget this computer</Button>}>
        {state.message}
      </Message>
    );
  }

  const forget = async () => {
    if (!confirm('Forget this computer? You can pair again from Settings › Remote.')) return;
    await turnOff(client).catch(() => {});
    onForget();
  };
  const menu: MenuItem[] = [
    { label: 'Notifications', onSelect: () => setNotifications(true) },
    { kind: 'separator' },
    { kind: 'note', label: `Paired as ${paired.name}` },
    { label: 'Forget this computer', danger: true, onSelect: () => void forget() },
  ];
  const banner = <ConnectionBanner state={state} computer={computer} onHelp={() => setHelp(true)} onRetry={retryNow} />;
  const startNew = () => go({ kind: 'new' });
  const started = (sessionId: string) => {
    history.replaceState({ kind: 'session', sessionId }, '');
    setRoute({ kind: 'session', sessionId });
  };
  const main =
    route.kind === 'session' ? (
      <SessionView
        key={route.sessionId}
        client={client}
        sessionId={route.sessionId}
        sessions={sessions}
        banner={wide ? null : banner}
        onBack={wide ? null : back}
        onLeave={leave}
        onRefresh={refresh}
      />
    ) : route.kind === 'new' ? (
      <NewSession client={client} sessions={sessions.sessions} banner={wide ? null : banner} onBack={wide ? null : back} onStarted={started} />
    ) : null;
  const list = (
    <SessionList
      sessions={sessions}
      state={state}
      banner={wide ? null : banner}
      client={client}
      computer={computer}
      menu={menu}
      selectedId={route.kind === 'session' ? route.sessionId : null}
      newOpen={route.kind === 'new'}
      // On a wide screen, picking another session replaces the open one rather than stacking up history.
      onOpen={(sessionId) => (wide && route.kind !== 'list' ? (history.replaceState({ kind: 'session', sessionId }, ''), setRoute({ kind: 'session', sessionId })) : go({ kind: 'session', sessionId }))}
      onNew={startNew}
      onHelp={() => setHelp(true)}
      onRefresh={refresh}
      top={offer && state.kind === 'connected' ? <PushOffer client={client} onDone={() => setOffer(false)} /> : null}
    />
  );
  const overlays = (
    <>
      <Toasts />
      {notifications && <NotificationsSheet client={client} onClose={() => setNotifications(false)} />}
      {help && <OfflineHelp state={state} computer={computer} address={paired.address} onClose={() => setHelp(false)} onRetry={retryNow} />}
    </>
  );

  if (!wide)
    return (
      <>
        {main ?? list}
        {overlays}
      </>
    );
  return (
    <div className="flex h-full">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-sidebar lg:w-[340px]">{list}</aside>
      <div className="flex min-w-0 flex-1 flex-col">
        {banner}
        <div className="min-h-0 flex-1">{main ?? <Pick needsYou={needsYou} onNew={startNew} />}</div>
      </div>
      {overlays}
    </div>
  );
}

/** A history entry's route (a sheet adds its own entry on top of one). */
function routeOf(state: unknown): Route {
  const route = state as Route | null;
  return route && (route.kind === 'session' || route.kind === 'new') ? route : { kind: 'list' };
}

/** The last list, for this tab: shown greyed out while offline, also after a reload. */
const CACHE = 'switchboard-remote:sessions';

function cachedSessions(): RemoteSessions {
  try {
    const value = JSON.parse(sessionStorage.getItem(CACHE) ?? 'null') as RemoteSessions | null;
    if (value && Array.isArray(value.sessions) && Array.isArray(value.prompts)) return value;
  } catch {
    // Nothing kept, or storage is off.
  }
  return { sessions: [], prompts: [] };
}

function cacheSessions(sessions: RemoteSessions): void {
  try {
    sessionStorage.setItem(CACHE, JSON.stringify(sessions));
  } catch {
    // Storage is full or off: the list just isn't kept.
  }
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

export type Client = RpcClient<RemoteContract> | null;
