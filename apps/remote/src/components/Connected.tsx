import { useEffect, useRef, useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { RemoteContract, RemoteSessions, RpcClient } from '@switchboard/protocol/remote-client';
import { Connection, type ConnectionState } from '../lib/connection.ts';
import { setFaviconDot } from '../lib/favicon.ts';
import { needsYouElsewhere } from '../lib/drawer.ts';
import { nextNeedsYou } from '../lib/groups.ts';
import { inView, isTypingTarget, keyAction, nextIndex } from '../lib/keys.ts';
import type { Paired } from '../lib/link.ts';
import { useFoldable, useWide } from '../lib/media.ts';
import type { PaletteItem } from '../lib/palette.ts';
import { keys, MAC } from '../lib/platform.ts';
import { DECLINED } from '../lib/prompts.ts';
import { tabTitle } from '../lib/signals.ts';
import { answer } from './answer.ts';
import { Home, type OpenSession } from './Home.tsx';
import { KeysSheet } from './KeysSheet.tsx';
import { NewSession } from './NewSession.tsx';
import { Palette, type PaletteAction } from './Palette.tsx';
import { SessionList } from './SessionList.tsx';
import { SessionView } from './SessionView.tsx';
import { ComputerChip, ConnectionBanner, OfflineHelp } from './ConnectionStatus.tsx';
import { afterOverlays } from './overlayHistory.ts';
import { DrawerButton, SessionsDrawer, useEdgeSwipe } from './SessionsDrawer.tsx';
import type { MenuItem } from './Menu.tsx';
import { toast, Toasts } from './Toasts.tsx';
import { NotificationsSheet, PushOffer, PushStrip, shouldOffer } from './Notifications.tsx';
import { PhoneHome } from './PhoneHome.tsx';
import { ProfileStrip, UsageCard, useUsage } from './Usage.tsx';
import { UpdateBar } from './UpdateBar.tsx';
import { useUpdate } from './useUpdate.ts';
import { useAskSync } from './askStore.ts';
import { currentSupport, loadPrefs, offered, resync, turnOff, turnOn } from '../lib/push.ts';
import { Button, Message } from './ui.tsx';

/**
 * `list` and `home` are the two roots: on a phone the first screen (the sessions, where the app opens) and Home (from
 * the drawer's Home row); on a wide screen both are the view next to the sidebar.
 */
export type Route = { kind: 'home' } | { kind: 'list' } | { kind: 'session'; sessionId: string; changes?: boolean } | { kind: 'new'; projectId?: string };

/** An answer from a notification's Deny or Allow (public/sw.js), sent once connected if the prompt is still open. */
interface NotificationAnswer {
  sessionId: string;
  requestId: string;
  behavior: 'allow' | 'deny';
}

/**
 * Connected to the paired computer: the sessions, a session, Home or New session. On a phone one at a time, opening
 * on the sessions, with the other sessions in a drawer (its button in a session's header, or a swipe from the left
 * edge); picking one there swaps it in place, so the back gesture goes back to the sessions, not through every
 * session you looked at. On a wide screen the list stays on the left, as the sidebar does on the computer, with Home
 * next to it while no session is open; below 1024px it can fold away (⌘B), and then it is the drawer.
 */
export function Connected({ paired, openSession, onForget, onPaired }: { paired: Paired; openSession: string | null; onForget: () => void; onPaired: (paired: Paired) => void }) {
  const [state, setState] = useState<ConnectionState>(() => (wasDisconnected() ? { kind: 'disconnected' } : { kind: 'connecting', attempt: 0 }));
  const connection = useRef<Connection | null>(null);
  const [sessions, setSessions] = useState<RemoteSessions>(cachedSessions);
  // A reload keeps the history entry's state: back on the screen you were on (Reload after an update).
  const [route, setRoute] = useState<Route>(() => routeOf(history.state));
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** How far an edge swipe has pulled the drawer out, while the finger is down. */
  const [edge, setEdge] = useState<number | null>(null);
  const [folded, setFolded] = useState(wasFolded);
  const [help, setHelp] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [offer, setOffer] = useState(() => shouldOffer(offered()));
  const [palette, setPalette] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [fromNotification, setFromNotification] = useState<NotificationAnswer | null>(null);
  const wide = useWide();
  const foldable = useFoldable();
  /** The sessions are in a drawer: on a phone, and on a wide screen whose sidebar folded away. */
  const drawerMode = !wide || (foldable && folded);

  // A connection per effect run, so a stopped one is never started again (StrictMode runs effects twice). Keeping the
  // computer's name changes `paired`, which mustn't reconnect: only another device or address does.
  const latestPaired = useRef(paired);
  latestPaired.current = paired;
  useEffect(() => {
    const current = new Connection(latestPaired.current);
    connection.current = current;
    const unsubscribe = current.subscribe(setState);
    // A reload after Disconnect stays disconnected; a new launch connects again (sessionStorage).
    current.start({ disconnected: wasDisconnected() });
    return () => {
      unsubscribe();
      current.stop();
    };
  }, [paired.deviceId, paired.address]);
  const retryNow = () => connection.current?.retryNow();
  /** Disconnect: closes the connection and keeps the pairing, until Connect. */
  const disconnect = () => {
    keepDisconnected(true);
    connection.current?.disconnect();
  };
  const reconnect = () => {
    keepDisconnected(false);
    connection.current?.reconnect();
  };

  const client = state.kind === 'connected' ? state.client : null;
  const features = state.kind === 'connected' ? state.features : NO_FEATURES;
  const computer = (state.kind === 'connected' && state.computerName) || paired.computerName || '';
  const needsYou = sessions.sessions.filter((s) => s.status === 'needs-you').length;
  const usage = useUsage(client);
  const update = useUpdate();
  /** Loads the newer remote app, on this screen: the route is in the history entry, which a reload keeps. */
  const reloadApp = () => {
    history.replaceState(route, '');
    location.reload();
  };
  useAskSync(client);

  // Keep the computer's name, so the offline help can name it after a reload.
  useEffect(() => {
    if (state.kind === 'connected' && state.computerName && state.computerName !== paired.computerName) onPaired({ ...paired, computerName: state.computerName });
  }, [state, paired, onPaired]);

  // The tab's title counts what waits on you, so it shows from another tab or the app switcher; its icon gets a dot.
  const openTitle = route.kind === 'session' ? (sessions.sessions.find((s) => s.id === route.sessionId)?.title ?? null) : null;
  useEffect(() => {
    document.title = tabTitle(needsYou, openTitle);
  }, [needsYou, openTitle]);
  useEffect(() => void setFaviconDot(needsYou > 0), [needsYou]);

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
  /** The same refresh, as a promise: pull to refresh shows its spinner until the list is in. */
  const reload = () => (client ? client.call('sessions.list', {}).then(setSessions) : Promise.resolve());
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
      const data = event.data as { type?: string; sessionId?: unknown; requestId?: unknown; behavior?: unknown } | null;
      if (data?.type === 'open-session' && typeof data.sessionId === 'string') go({ kind: 'session', sessionId: data.sessionId });
      // Deny or Allow on a notification: answered once connected, if nobody answered first.
      if (data?.type === 'answer' && typeof data.sessionId === 'string' && typeof data.requestId === 'string' && (data.behavior === 'allow' || data.behavior === 'deny'))
        setFromNotification({ sessionId: data.sessionId, requestId: data.requestId, behavior: data.behavior });
    };
    navigator.serviceWorker?.addEventListener('message', onMessage);
    // Opened by a notification's button: the service worker holds the answer until this page asks for it.
    navigator.serviceWorker?.controller?.postMessage({ type: 'take-answer' });
    return () => navigator.serviceWorker?.removeEventListener('message', onMessage);
  }, []);

  // Only on a fresh list: the cached one may still have a prompt someone answered meanwhile.
  useEffect(() => {
    if (!client || !fromNotification) return;
    setFromNotification(null);
    void client.call('sessions.list', {}).then(async (list) => {
      setSessions(list);
      const prompt = list.prompts.find((p) => p.requestId === fromNotification.requestId);
      const title = list.sessions.find((s) => s.id === fromNotification.sessionId)?.title;
      if (!prompt) return toast('Already answered', { detail: title });
      await answer(client, prompt, fromNotification.behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: DECLINED }, title);
      refresh();
    }, () => toast("The answer didn't reach your computer.", { tone: 'error' }));
  }, [client, fromNotification]);
  const back = () => history.back();
  /** Back to the list: one step back on a phone, the empty view on a wide screen (where picking replaces the entry). */
  const leave = () => {
    if (!wide) return back();
    history.replaceState({ kind: 'list' }, '');
    setRoute({ kind: 'list' });
  };
  const atRoot = route.kind === 'home' || route.kind === 'list';
  /** Home or the list in the root's place, without a history entry: they are not steps of each other. */
  const root = (kind: 'home' | 'list') => {
    history.replaceState({ kind }, '');
    setRoute({ kind });
  };
  /** Home: from the list on a phone, from anywhere on a wide screen (where it is the view next to the sidebar). */
  const goHome = () => (wide || atRoot ? root('home') : back());


  const forget = async () => {
    if (!confirm('Forget this computer? You can pair again from Settings › Remote.')) return;
    await turnOff(client).catch(() => {});
    keepDisconnected(false);
    onForget();
  };
  const menu: MenuItem[] = [
    { label: 'Notifications', onSelect: () => setNotifications(true) },
    { kind: 'separator' },
    { kind: 'note', label: `Paired as ${paired.name}` },
    { label: 'Forget this computer…', danger: true, onSelect: () => void forget() },
  ];
  const connectionBanner = <ConnectionBanner state={state} computer={computer} onHelp={() => setHelp(true)} onRetry={retryNow} onConnect={reconnect} />;
  const banner = (
    <>
      {update.state === 'ready' && <UpdateBar onReload={reloadApp} onLater={update.later} />}
      {connectionBanner}
    </>
  );
  const chip = <ComputerChip state={state} computer={computer} onDisconnect={disconnect} onConnect={reconnect} onForget={() => void forget()} />;
  const startNew = (projectId?: string) => (wide && !atRoot ? (history.replaceState({ kind: 'new', projectId }, ''), setRoute({ kind: 'new', projectId })) : go({ kind: 'new', projectId }));
  /** On a wide screen, picking another session replaces the open one rather than stacking up history. */
  const showSession: OpenSession = (sessionId, options = {}) => {
    const next: Route = { kind: 'session', sessionId, ...(options.changes ? { changes: true } : {}) };
    if (wide && !atRoot) {
      history.replaceState(next, '');
      setRoute(next);
    } else go(next);
  };
  const currentId = route.kind === 'session' ? route.sessionId : null;
  const nextId = nextNeedsYou(sessions, currentId);

  /** What you pick in the drawer replaces the entry under it, once the drawer has closed and taken back its own. */
  const fromDrawer = (run: () => void) => {
    setDrawerOpen(false);
    setTimeout(() =>
      afterOverlays(() => {
        refocusDrawer.current = true;
        run();
      }),
    );
  };
  // After a pick, the new view's drawer button takes the focus back, where it was before the drawer opened.
  const refocusDrawer = useRef(false);
  useEffect(() => {
    if (!refocusDrawer.current) return;
    refocusDrawer.current = false;
    document.querySelector<HTMLElement>('[data-remote-drawer-button]')?.focus({ preventScroll: true });
  }, [route]);
  const swap = (next: Route) => {
    history.replaceState(next, '');
    setRoute(next);
  };
  const pick = (sessionId: string) => fromDrawer(() => swap({ kind: 'session', sessionId }));
  const pickHome = () => fromDrawer(() => swap({ kind: 'home' }));
  const pickNew = () => fromDrawer(() => (wide ? swap({ kind: 'new' }) : go({ kind: 'new' })));
  /** ⌘B, or the toggle in the session's header: the sidebar folds into the drawer, or comes back. */
  const toggleFold = () => {
    setFolded((current) => {
      keepFolded(!current);
      return !current;
    });
    setDrawerOpen(false);
  };
  // A screen that turns wide (an iPad rotated) has its sidebar again.
  useEffect(() => {
    if (!drawerMode) setDrawerOpen(false);
  }, [drawerMode]);
  // An edge swipe opens the drawer where its button is: a session or Home on a phone, anywhere on a folded wide screen.
  const drawerHere = drawerMode && (wide || route.kind === 'session' || route.kind === 'home');
  useEdgeSwipe({ enabled: drawerHere && !drawerOpen, onDrag: setEdge, onSettle: setDrawerOpen });

  // The wide layout's keys (lib/keys.ts): one handler, reading the latest state through a ref.
  const onKey = useRef<(event: KeyboardEvent) => void>(() => {});
  onKey.current = (event) => {
    if (event.defaultPrevented) return;
    const action = keyAction(event, { mac: MAC, inField: isTypingTarget(document.activeElement as HTMLElement | null) });
    if (!action || action === 'escape') return;
    if (action === 'palette') {
      event.preventDefault();
      setPalette((open) => !open);
      return;
    }
    if (action === 'sidebar') {
      if (!foldable) return;
      event.preventDefault();
      toggleFold();
      return;
    }
    // Under the palette, a sheet or a menu, the letters are theirs.
    if (palette || document.querySelector('[role=dialog],[role=menu],[role=listbox]:not([data-remote-files])')) return;
    if (action === 'next-needs-you') {
      event.preventDefault();
      if (nextId) showSession(nextId);
      else toast('Nothing needs you');
    } else if (action === 'new') {
      if (!client) return;
      event.preventDefault();
      startNew();
    } else if (action === 'help') {
      event.preventDefault();
      setKeysOpen(true);
    } else if (action === 'down' || action === 'up') {
      event.preventDefault();
      moveFocus(action === 'down' ? 1 : -1, atRoot);
    } else if (action === 'allow' || action === 'deny') {
      if (pressPrompt(action, route.kind === 'session')) event.preventDefault();
    } else if (action === 'open') {
      const card = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-remote-nav]');
      const open = card && card === document.activeElement ? card.querySelector<HTMLButtonElement>('[data-remote-open]') : null;
      if (open) {
        event.preventDefault();
        open.click();
      }
    }
  };
  useEffect(() => {
    if (!wide) return;
    const listener = (event: KeyboardEvent) => onKey.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [wide]);

  // After every hook: a refused device only gets this message.
  if (state.kind === 'unpaired') {
    return (
      <Message title="Pair again" actions={<Button onClick={onForget}>Forget this computer</Button>}>
        {state.message}
      </Message>
    );
  }

  const paletteActions: PaletteAction[] = [
    ...(nextId ? [{ id: 'next', title: 'Next that needs you' }] : []),
    { id: 'new', title: 'New session' },
    { id: 'home', title: 'Go to Home' },
    ...(currentSupport() === 'ready' && !loadPrefs().on ? [{ id: 'notify', title: 'Turn on notifications' }] : []),
    ...(sessions.sessions.some((s) => s.unread) ? [{ id: 'read-all', title: 'Mark all as read' }] : []),
    { id: 'forget', title: 'Forget this computer' },
  ];
  const choose = (item: PaletteItem) => {
    setPalette(false);
    if (item.kind === 'session') return showSession(item.session.id);
    if (item.kind === 'start') return startNew(item.project.id);
    switch (item.id) {
      case 'action:next':
        if (nextId) showSession(nextId);
        return;
      case 'action:new':
        return startNew();
      case 'action:home':
        return goHome();
      case 'action:notify':
        if (client)
          void turnOn(client).then(
            () => toast('Notifications are on'),
            (error: Error) => toast(error.message, { tone: 'error' }),
          );
        return;
      case 'action:read-all': {
        const unread = sessions.sessions.filter((s) => s.unread);
        void Promise.all(unread.map((s) => client?.call('session.markRead', { sessionId: s.id }))).then(
          () => toast(unread.length === 1 ? 'Marked 1 session as read' : `Marked ${unread.length} sessions as read`),
          () => toast("That didn't reach your computer.", { tone: 'error' }),
        );
        return;
      }
      case 'action:forget':
        return void forget();
    }
  };
  const drawerButton = <DrawerButton needsYou={needsYouElsewhere(sessions.sessions, currentId)} onOpen={() => setDrawerOpen(true)} />;
  /** The session header's left corner: the drawer button, or where the sidebar can fold, its toggle. */
  const sessionLead = drawerMode ? (
    drawerButton
  ) : foldable ? (
    <Button variant="quiet" onClick={toggleFold} aria-label="Hide the sessions" title={`Hide the sessions (${keys('mod+b')})`} className="px-2!" data-remote-fold>
      <PanelLeftClose className="size-5" aria-hidden />
    </Button>
  ) : null;
  /** Home's and New session's on a wide screen whose sidebar folded away. */
  const viewLead = wide && drawerMode ? drawerButton : null;
  const started = (sessionId: string) => {
    history.replaceState({ kind: 'session', sessionId }, '');
    setRoute({ kind: 'session', sessionId });
  };
  const main =
    route.kind === 'session' ? (
      <SessionView
        key={route.sessionId}
        client={client}
        features={features}
        sessionId={route.sessionId}
        sessions={sessions}
        banner={wide ? null : banner}
        lead={sessionLead}
        onLeave={leave}
        onRefresh={refresh}
        wide={wide}
        initialChanges={route.changes ?? false}
      />
    ) : route.kind === 'new' ? (
      <NewSession key={route.projectId ?? ''} client={client} features={features} sessions={sessions.sessions} banner={wide ? null : banner} onBack={wide ? null : back} lead={viewLead} onStarted={started} initialProject={route.projectId ?? null} />
    ) : null;
  // A wide screen offers notifications in a strip over the main view; an iPad outside the Home Screen keeps the card,
  // which explains how to add it.
  const offering = offer && state.kind === 'connected';
  const stripOffer = wide && currentSupport() === 'ready';
  const list = (
    <SessionList
      mode={wide ? 'sidebar' : 'phone'}
      sessions={sessions}
      state={state}
      banner={wide ? null : banner}
      client={client}
      features={features}
      chip={chip}
      menu={menu}
      selectedId={currentId}
      newOpen={route.kind === 'new'}
      onOpen={(sessionId) => showSession(sessionId)}
      onNew={() => startNew()}
      onHome={goHome}
      homeOpen={wide && atRoot}
      onRefresh={update.state === 'none' ? reload : async () => reloadApp()}
      update={update.state !== 'none'}
      onArchived={(sessionId) => sessionId === currentId && leave()}
      top={offering && !stripOffer ? <PushOffer client={client} onDone={() => setOffer(false)} /> : null}
      usage={<UsageCard usage={usage} offline={state.kind !== 'connected'} />}
      onPalette={() => setPalette(true)}
    />
  );
  const drawer = drawerMode && (
    <SessionsDrawer open={drawerOpen} edge={edge} onClose={() => setDrawerOpen(false)}>
      <SessionList
        mode="drawer"
        sessions={sessions}
        state={state}
        banner={connectionBanner}
        client={client}
        features={features}
        chip={chip}
        menu={menu}
        selectedId={currentId}
        newOpen={route.kind === 'new'}
        onOpen={pick}
        onNew={pickNew}
        onHome={pickHome}
        homeOpen={route.kind === 'home' || (wide && atRoot)}
        onRefresh={reload}
        onArchived={(sessionId) => sessionId === currentId && leave()}
        homeRow={<ProfileStrip usage={usage} />}
        headerEnd={
          wide && (
            <Button variant="quiet" size="md" onClick={toggleFold} aria-label="Keep the sessions open" title={`Keep the sessions open (${keys('mod+b')})`} className="px-2!" data-remote-unfold-sidebar>
              <PanelLeftOpen className="size-4" aria-hidden />
            </Button>
          )
        }
      />
    </SessionsDrawer>
  );
  const overlays = (
    <>
      <Toasts />
      {notifications && <NotificationsSheet client={client} onClose={() => setNotifications(false)} />}
      {help && <OfflineHelp state={state} computer={computer} address={paired.address} onClose={() => setHelp(false)} onRetry={retryNow} />}
      {keysOpen && <KeysSheet onClose={() => setKeysOpen(false)} />}
      {palette && <Palette client={client} sessions={sessions.sessions} actions={paletteActions} onChoose={choose} onClose={() => setPalette(false)} />}
    </>
  );

  if (!wide)
    return (
      <>
        {main ?? (route.kind === 'home' ? <PhoneHome lead={drawerButton} banner={banner} sessions={sessions} usage={usage} offline={state.kind !== 'connected'} client={client} onOpen={showSession} onNew={() => startNew()} onRefresh={refresh} /> : list)}
        {drawer}
        {overlays}
      </>
    );
  return (
    <div className="flex h-full">
      {!drawerMode && (
        <aside className="flex w-[300px] shrink-0 flex-col border-r border-border bg-sidebar" data-remote-sidebar>
          {list}
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {offering && stripOffer && <PushStrip client={client} onDone={() => setOffer(false)} />}
        {banner}
        <div className="min-h-0 flex-1">{main ?? <Home sessions={sessions} usage={usage} offline={state.kind !== 'connected'} client={client} onOpen={showSession} onNew={() => startNew()} onRefresh={refresh} lead={viewLead} />}</div>
      </div>
      {drawer}
      {overlays}
    </div>
  );
}

/** A history entry's route (a sheet or the drawer adds its own entry on top of one). The first entry, with none yet, is the sessions. */
function routeOf(state: unknown): Route {
  const route = state as Route | null;
  return route && (route.kind === 'session' || route.kind === 'new' || route.kind === 'home') ? route : { kind: 'list' };
}

/** Disconnect, for this tab: a reload stays disconnected, a new launch connects again. */
const DISCONNECTED = 'switchboard-remote:disconnected';

function wasDisconnected(): boolean {
  try {
    return sessionStorage.getItem(DISCONNECTED) === '1';
  } catch {
    return false;
  }
}

function keepDisconnected(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(DISCONNECTED, '1');
    else sessionStorage.removeItem(DISCONNECTED);
  } catch {
    // Storage is off: a reload connects again.
  }
}

/** The sidebar folded away where it can (an iPad in portrait), kept in this browser. */
const FOLDED = 'switchboard-remote:sidebar-folded';

function wasFolded(): boolean {
  try {
    return localStorage.getItem(FOLDED) === '1';
  } catch {
    return false;
  }
}

function keepFolded(on: boolean): void {
  try {
    localStorage.setItem(FOLDED, on ? '1' : '0');
  } catch {
    // Storage is off: it stays the way it is until the page closes.
  }
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

const NO_FEATURES: string[] = [];

export type Client = RpcClient<RemoteContract> | null;

/**
 * J and K: the next or previous card on the home view, or session in the sidebar (also from the sidebar on the home
 * view). With nothing focused yet, the sidebar starts at the open session.
 */
function moveFocus(step: 1 | -1, home: boolean): void {
  const active = document.activeElement as HTMLElement | null;
  const scope = home && !active?.closest('[data-remote-sidebar]') ? 'card' : 'row';
  const items = [...document.querySelectorAll<HTMLElement>(`[data-remote-nav="${scope}"]`)].filter((el) => !el.closest('[data-leaving]'));
  let at = items.findIndex((el) => el === active || el.contains(active));
  if (at < 0 && scope === 'row') at = items.findIndex((el) => el.getAttribute('aria-current') === 'page');
  const next = items[nextIndex(at, items.length, step)];
  next?.focus();
  next?.scrollIntoView({ block: 'nearest' });
}

/**
 * A and D: the focused card's Allow or Deny on the home view, or the docked prompt's in a session. Only when that
 * button is in view: allowing something you can't see is never what a key should do. True when it pressed one.
 */
function pressPrompt(kind: 'allow' | 'deny', inSession: boolean): boolean {
  const card = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('[data-remote-prompt-card]');
  const target = card ?? (inSession ? document.querySelector<HTMLElement>('[data-remote-prompt]') : null);
  const button = target?.querySelector<HTMLButtonElement>(kind === 'allow' ? '[data-remote-allow]' : '[data-remote-deny]');
  if (!button || button.disabled) return false;
  const scroller = target!.closest('[data-remote-scroll]');
  const viewport = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
  if (!inView(button.getBoundingClientRect(), viewport)) return false;
  button.click();
  return true;
}
