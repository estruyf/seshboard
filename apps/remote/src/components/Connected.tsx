import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { RemoteContract, RemoteSessions, RpcClient } from '@switchboard/protocol/remote-client';
import { keepDisconnected, nameOf, needsYouOf, pushComputers, type Computer } from '../lib/computers.ts';
import { fromKey, listKey, mergeSessions, mergeUsage, runOnDefault } from '../lib/everywhere.ts';
import { setFaviconDot } from '../lib/favicon.ts';
import { homeRoute, needsYouElsewhere } from '../lib/drawer.ts';
import { nextNeedsYou } from '../lib/groups.ts';
import { listTree } from '../lib/runs.ts';
import { inView, isTypingTarget, keyAction, nextIndex } from '../lib/keys.ts';
import { useFoldable, useWide } from '../lib/media.ts';
import { keys, MAC } from '../lib/platform.ts';
import { DECLINED } from '../lib/prompts.ts';
import { tabTitle } from '../lib/signals.ts';
import { lastRunOn } from '../lib/storage.ts';
import { answer } from './answer.ts';
import { Home, type OpenSession } from './Home.tsx';
import { KeysSheet } from './KeysSheet.tsx';
import { NewSession, type RunOnComputer } from './NewSession.tsx';
import { Palette, type PaletteAction, type PaletteChoice } from './Palette.tsx';
import { SessionList, type ListComputer } from './SessionList.tsx';
import { RunView } from './RunView.tsx';
import { SessionView } from './SessionView.tsx';
import { ComputerChip, ComputerTitle, ConnectionBanner, OfflineHelp, UnpairedBanner, type ComputerProps } from './ConnectionStatus.tsx';
import { connectionOf } from './connectionOf.ts';
import { afterOverlays } from './overlayHistory.ts';
import { DrawerButton, SessionsDrawer, useEdgeSwipe } from './SessionsDrawer.tsx';
import type { MenuItem } from './Menu.tsx';
import { toast, Toasts } from './Toasts.tsx';
import { NotificationsSheet, PushOffer, PushStrip, shouldOffer } from './Notifications.tsx';
import { UsageCard, useUsages } from './Usage.tsx';
import { ThemeSheet } from './ThemeSheet.tsx';
import { UpdateBar } from './UpdateBar.tsx';
import { useUpdate } from './useUpdate.ts';
import { useAskSync } from './askStore.ts';
import { currentSupport, loadPrefs, offered, turnOn } from '../lib/push.ts';
import { Button, Message } from './ui.tsx';

/**
 * `list` and `home` are the roots of a wide screen, both the view next to the sidebar. A phone has one: the first
 * screen (the sessions, where the app opens), and a `home` entry shows it too.
 */
export type Route = { kind: 'home' } | { kind: 'list' } | { kind: 'session'; sessionId: string; changes?: boolean; computer?: string } | { kind: 'new'; projectId?: string; computer?: string };

/** An answer from a notification's Deny or Allow (public/sw.js), sent once connected if the prompt is still open. */
export interface NotificationAnswer {
  sessionId: string;
  requestId: string;
  behavior: 'allow' | 'deny';
}

/**
 * What a notification asks for, on the computer it came from: open a session, or answer a prompt. `launch`: the app
 * opened with it, so the session goes on top of the list rather than of what was on screen.
 */
export interface OpenRequest {
  id: number;
  computer: string;
  sessionId?: string;
  answer?: NotificationAnswer;
  launch?: boolean;
}

/** The last request the view took, so StrictMode's second mount doesn't take it again. */
let handledRequest = 0;

/**
 * Every paired computer at once (App.tsx keeps them all connected): their sessions in one list, as Switchboard's
 * sidebar shows another computer's sessions among its own, each row saying which computer it runs on once there is
 * more than one. A session and New session are on one computer (their route carries it), and so is what they show;
 * the list, Home, the palette and usage are every computer's. On a phone one view at a time, opening on the sessions
 * (its only home), with the other sessions in a drawer (its button in a session's header, or a swipe from the left
 * edge); picking one there swaps it in place, so the back gesture goes back to the sessions, not through every
 * session you looked at. On a wide screen the list stays on the left, as the sidebar does on the computer, with Home
 * next to it while no session is open; below 1024px it can fold away (⌘B), and then it is the drawer. With more than
 * one computer, a chip per computer in the list's header has its menu (Disconnect, Forget), and New session has Run
 * on to pick where it starts.
 */
export function Connected({
  computers,
  focus,
  onFocus,
  onSessions: setSessions,
  request,
  onAdd,
  onForget,
}: {
  /** Every paired computer. */
  computers: readonly Computer[];
  /** The computer looked at last (App.tsx keeps it): what isn't on a computer of its own is on this one. */
  focus: string;
  /** A session or New session on another computer is on screen now. */
  onFocus: (id: string) => void;
  /** A computer's list asked for here (pull to refresh, after an answer). */
  onSessions: (computer: string, sessions: RemoteSessions) => void;
  request: OpenRequest | null;
  onAdd: () => void;
  onForget: (computer: string) => void;
}) {
  const multi = computers.length > 1;
  const byId = (computer: string | null | undefined) => (computer ? computers.find((c) => c.id === computer) : undefined);
  // A reload keeps the history entry's state: back on the screen you were on (Reload after an update).
  const [route, setRoute] = useState<Route>(() => routeOf(history.state, computers));
  const routeComputer = route.kind === 'session' || route.kind === 'new' ? route.computer : undefined;
  /** The computer of what is on screen: the open session's, New session's, else the one looked at last. */
  const current = byId(routeComputer) ?? byId(focus) ?? computers[0]!;
  const { id, state, paired, sessions } = current;
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** How far an edge swipe has pulled the drawer out, while the finger is down. */
  const [edge, setEdge] = useState<number | null>(null);
  const [folded, setFolded] = useState(wasFolded);
  /** The computer whose Help sheet is open. */
  const [help, setHelp] = useState<string | null>(null);
  const [notifications, setNotifications] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const [offer, setOffer] = useState(() => shouldOffer(offered()));
  const [palette, setPalette] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [fromNotification, setFromNotification] = useState<(NotificationAnswer & { computer: string }) | null>(null);
  const wide = useWide();
  const foldable = useFoldable();
  /** The sessions are in a drawer: on a phone, and on a wide screen whose sidebar folded away. */
  const drawerMode = !wide || (foldable && folded);

  /** Disconnect: closes the connection and keeps the pairing, until Connect. A reload stays disconnected (sessionStorage). */
  const disconnect = (computer: Computer) => {
    keepDisconnected(computer.id, true);
    computer.connection.disconnect();
  };
  const reconnect = (computer: Computer) => {
    keepDisconnected(computer.id, false);
    computer.connection.reconnect();
  };

  const client = clientOf(current);
  const features = featuresOf(current);
  const computer = nameOf(current);
  /** Every computer's sessions and prompts, keyed by computer (`lib/everywhere.ts`). */
  const merged = useMemo(() => mergeSessions(computers.map((c) => ({ id: c.id, sessions: c.sessions }))), [computers]);
  const listComputers = useMemo(() => new Map(computers.map((c): [string, ListComputer] => [c.id, { client: clientOf(c), features: featuresOf(c), name: nameOf(c), online: c.state.kind === 'connected' }])), [computers]);
  const computerOf = (computer: string): ListComputer => listComputers.get(computer) ?? NOWHERE;
  /** What the list's connection is: with more than one computer, a connected one's while there is one. */
  const listState = multi ? (computers.find((c) => c.state.kind === 'connected') ?? current).state : state;
  const listOffline = listState.kind !== 'connected';
  /** What waits on you, for the tab's title and the drawer button: not what an offline computer last said. */
  const counted = multi ? merged.sessions.filter((s) => computerOf(s.computer).online) : merged.sessions;
  // A tree counts once: a run's parent that waits at Push, or whose step asks, is one thing that needs you (#179).
  const needsYou = useMemo(() => listTree(counted, merged.runs).roots.filter((s) => s.status === 'needs-you').length, [counted, merged.runs]);
  const push = pushComputers(computers);
  const usages = useUsages(computers.map((c) => ({ id: c.id, client: clientOf(c) })));
  const usage = useMemo(() => mergeUsage(computers.map((c) => ({ id: c.id, name: nameOf(c), usage: usages.get(c.id) ?? null }))), [computers, usages]);
  const update = useUpdate();
  /** Loads the newer remote app, on this screen: the route is in the history entry, which a reload keeps. */
  const reloadApp = () => {
    history.replaceState(route, '');
    location.reload();
  };
  useAskSync(client);

  // What is on screen is on this computer: the app opens there next time.
  useEffect(() => {
    if (routeComputer && routeComputer !== focus && byId(routeComputer)) onFocus(routeComputer);
  }, [routeComputer]);
  // A forgotten computer's session or New session goes, back to the sessions.
  useEffect(() => {
    if (routeComputer && !byId(routeComputer)) root('list');
  }, [routeComputer, computers]);

  // The tab's title counts what waits on you, so it shows from another tab or the app switcher; its icon gets a dot.
  const openTitle = route.kind === 'session' ? (sessions.sessions.find((s) => s.id === route.sessionId)?.title ?? sessions.runs?.find((r) => r.run.id === route.sessionId)?.run.title ?? null) : null;
  useEffect(() => {
    document.title = tabTitle(needsYou, openTitle);
  }, [needsYou, openTitle]);
  useEffect(() => void setFaviconDot(needsYou > 0), [needsYou]);

  // A computer pushes nothing to a device that has the app on screen: every computer's sessions are on screen, so
  // each one is told when that changes, and that it isn't once its connection or the app goes.
  const connections = computers.map((c) => `${c.id}#${connectionOf(clientOf(c))}`).join(' ');
  const latestComputers = useRef(computers);
  latestComputers.current = computers;
  useEffect(() => {
    const clients = latestComputers.current.map(clientOf).filter((c): c is NonNullable<Client> => c !== null);
    const tell = (visible: boolean) => clients.forEach((c) => void c.call('device.visibility', { visible }).catch(() => {}));
    const changed = () => tell(document.visibilityState === 'visible');
    changed();
    document.addEventListener('visibilitychange', changed);
    return () => {
      document.removeEventListener('visibilitychange', changed);
      tell(false);
    };
  }, [connections]);

  /** Every connected computer's list again; done when they are all in. */
  const reload = () =>
    Promise.all(
      computers.map((c) => {
        const there = clientOf(c);
        return there ? there.call('sessions.list', {}).then((list) => setSessions(c.id, list)) : undefined;
      }),
    );
  const refresh = () => void reload().catch(() => {});

  // Back to an entry shows its screen, on its computer.
  useEffect(() => {
    const back = (event: PopStateEvent) => setRoute(routeOf(event.state, latestComputers.current));
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);

  const go = (next: Route) => {
    history.pushState(next, '');
    setRoute(next);
  };
  const swap = (next: Route) => {
    history.replaceState(next, '');
    setRoute(next);
  };

  // A notification, on the computer it came from: that session, or its answer. Opened with one, the list is one step back.
  useEffect(() => {
    if (!request || request.id <= handledRequest || !byId(request.computer)) return;
    handledRequest = request.id;
    if (request.sessionId && !request.answer) {
      if (request.launch) history.replaceState({ kind: 'list' }, '');
      go({ kind: 'session', sessionId: request.sessionId, computer: request.computer });
    }
    if (request.answer) setFromNotification({ ...request.answer, computer: request.computer });
  }, [request, computers]);

  // Only on a fresh list: the cached one may still have a prompt someone answered meanwhile.
  const notified = fromNotification ? byId(fromNotification.computer) : undefined;
  const notifiedClient = notified ? clientOf(notified) : null;
  useEffect(() => {
    if (!notifiedClient || !fromNotification) return;
    const asked = fromNotification;
    setFromNotification(null);
    void notifiedClient.call('sessions.list', {}).then(async (list) => {
      setSessions(asked.computer, list);
      const prompt = list.prompts.find((p) => p.requestId === asked.requestId);
      const title = list.sessions.find((s) => s.id === asked.sessionId)?.title;
      if (!prompt) return toast('Already answered', { detail: title });
      await answer(notifiedClient, prompt, asked.behavior === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', message: DECLINED }, title);
      refresh();
    }, () => toast("The answer didn't reach your computer.", { tone: 'error' }));
  }, [notifiedClient, fromNotification]);
  const back = () => history.back();
  /** Back to the list: one step back on a phone, the empty view on a wide screen (where picking replaces the entry). */
  const leave = () => {
    if (!wide) return back();
    swap({ kind: 'list' });
  };
  const atRoot = route.kind === 'home' || route.kind === 'list';
  /** Home or the list in the root's place, without a history entry: they are not steps of each other. */
  const root = (kind: 'home' | 'list') => swap({ kind });
  /** Home on a wide screen, the view next to the sidebar. A phone's home is the list: back to it from a session. */
  const goHome = () => (wide ? root('home') : atRoot ? root('list') : back());
  // A phone has one home: a `home` entry (from a wide screen, an iPad turned, or an older version) is the list.
  useEffect(() => {
    if (!wide && route.kind === 'home') root('list');
  }, [wide, route.kind]);

  const forget = (target: Computer) => {
    if (!confirm(`Forget ${nameOf(target) || 'this computer'}? You can pair again from Settings › Remote.`)) return;
    onForget(target.id);
  };
  const menu: MenuItem[] = multi
    ? [{ label: 'Notifications', onSelect: () => setNotifications(true) }, { label: 'Theme', onSelect: () => setThemeOpen(true) }, { kind: 'separator' }, { label: 'Pair another computer…', onSelect: onAdd }]
    : [
        { label: 'Notifications', onSelect: () => setNotifications(true) },
        { label: 'Theme', onSelect: () => setThemeOpen(true) },
        { kind: 'separator' },
        { kind: 'note', label: `Paired as ${paired.name}` },
        { label: 'Forget this computer…', danger: true, onSelect: () => void forget(current) },
      ];
  /** A computer's connection under the header: why it is away, or with more than one, that it refused this phone. */
  const bannerOf = (c: Computer) => (
    <Fragment key={c.id}>
      <ConnectionBanner state={c.state} computer={nameOf(c)} onHelp={() => setHelp(c.id)} onRetry={() => c.connection.retryNow()} onConnect={() => reconnect(c)} />
      {multi && <UnpairedBanner state={c.state} computer={nameOf(c)} onForget={() => forget(c)} />}
    </Fragment>
  );
  /** The list is every computer's, so it says how each one is; a session or New session only its own. */
  const listBanner = multi ? <>{computers.map(bannerOf)}</> : bannerOf(current);
  const withUpdate = (connection: ReactNode) => (
    <>
      {update.state === 'ready' && <UpdateBar onReload={reloadApp} onLater={update.later} />}
      {connection}
    </>
  );
  const banner = withUpdate(bannerOf(current));
  const listTopBanner = withUpdate(listBanner);
  const propsOf = (c: Computer): ComputerProps => ({ state: c.state, computer: nameOf(c), strip: multi, needsYou: needsYouOf(c), onDisconnect: () => disconnect(c), onConnect: () => reconnect(c), onAdd, onForget: () => forget(c) });
  const chip = multi ? null : <ComputerChip {...propsOf(current)} />;
  const strip = multi ? computers.map((c) => <ComputerChip key={c.id} {...propsOf(c)} />) : undefined;
  const title = (size: 'large' | 'compact') =>
    multi ? (
      <span className={`truncate font-semibold ${size === 'large' ? 'text-hero' : 'text-title'}`} data-remote-list-title={size}>
        Sessions
      </span>
    ) : (
      <ComputerTitle size={size} {...propsOf(current)} />
    );
  const computerStates = computers.map((c) => ({ id: c.id, connected: c.state.kind === 'connected' }));
  /**
   * New session, on the computer asked for (Run on, the palette), else where it started last (or, the first time, the
   * one looked at last) while that one is connected, else a connected one.
   */
  const newRoute = (projectId?: string, on?: string): Route => ({ kind: 'new', ...(projectId ? { projectId } : {}), computer: runOnDefault(computerStates, on, lastRunOn() ?? focus) ?? id });
  const startNew = (projectId?: string, on?: string) => (wide && !atRoot ? swap(newRoute(projectId, on)) : go(newRoute(projectId, on)));
  /** On a wide screen, picking another session replaces the open one rather than stacking up history. */
  const openSession = (on: string, sessionId: string, options: { changes?: boolean } = {}) => {
    const next: Route = { kind: 'session', sessionId, computer: on, ...(options.changes ? { changes: true } : {}) };
    if (wide && !atRoot) swap(next);
    else go(next);
  };
  /** A session by its key in the list (`lib/everywhere.ts`). */
  const showSession: OpenSession = (key, options = {}) => {
    const at = fromKey(key);
    if (at) openSession(at.computer, at.id, options);
  };
  const currentKey = route.kind === 'session' ? listKey(id, route.sessionId) : null;
  const nextKey = nextNeedsYou({ sessions: counted, prompts: merged.prompts }, currentKey);

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
  const pick = (key: string) =>
    fromDrawer(() => {
      const at = fromKey(key);
      if (at) swap({ kind: 'session', sessionId: at.id, computer: at.computer });
    });
  /** The drawer's Home row: Home on a wide screen, the first screen on a phone (its only home). */
  const pickHome = () => fromDrawer(() => swap(homeRoute(wide)));
  const pickNew = () => fromDrawer(() => (wide ? swap(newRoute()) : go(newRoute())));
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
  // An edge swipe opens the drawer where its button is: a session on a phone, anywhere on a folded wide screen.
  const drawerHere = drawerMode && (wide || route.kind === 'session');
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
      if (nextKey) showSession(nextKey);
      else toast('Nothing needs you');
    } else if (action === 'new') {
      if (listOffline) return;
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

  // After every hook: the only computer refused this device, so that is all there is to say. With more than one, its banner says it.
  if (!multi && state.kind === 'unpaired') {
    return (
      <Message title={computer ? `Pair again with ${computer}` : 'Pair again'} actions={<Button variant="danger" onClick={() => onForget(id)}>Forget this computer</Button>}>
        {state.message}
      </Message>
    );
  }

  const unread = merged.sessions.filter((s) => s.unread && computerOf(s.computer).client);
  const paletteActions: PaletteAction[] = [
    ...(nextKey ? [{ id: 'next', title: 'Next that needs you' }] : []),
    { id: 'new', title: 'New session' },
    { id: 'home', title: 'Go to Home' },
    ...(currentSupport() === 'ready' && !loadPrefs().on ? [{ id: 'notify', title: 'Turn on notifications' }] : []),
    ...(unread.length ? [{ id: 'read-all', title: 'Mark all as read' }] : []),
    { id: 'theme', title: 'Theme' },
    { id: 'add', title: 'Pair another computer' },
    ...(multi ? [] : [{ id: 'forget', title: 'Forget this computer' }]),
  ];
  const choose = (item: PaletteChoice) => {
    setPalette(false);
    if (item.kind === 'session') return showSession(item.session.id);
    if (item.kind === 'start') return startNew(item.project.projectId, item.project.computer);
    switch (item.id) {
      case 'action:next':
        if (nextKey) showSession(nextKey);
        return;
      case 'action:new':
        return startNew();
      case 'action:home':
        return goHome();
      case 'action:notify':
        if (push.targets.length)
          void turnOn(push).then(
            () => toast('Notifications are on'),
            (error: Error) => toast(error.message, { tone: 'error' }),
          );
        return;
      case 'action:read-all':
        void Promise.all(unread.map((s) => computerOf(s.computer).client?.call('session.markRead', { sessionId: s.sessionId }))).then(
          () => toast(unread.length === 1 ? 'Marked 1 session as read' : `Marked ${unread.length} sessions as read`),
          () => toast("That didn't reach your computer.", { tone: 'error' }),
        );
        return;
      case 'action:theme':
        return setThemeOpen(true);
      case 'action:add':
        return onAdd();
      case 'action:forget':
        return forget(current);
    }
  };
  const drawerButton = <DrawerButton needsYou={needsYouElsewhere(counted, currentKey)} onOpen={() => setDrawerOpen(true)} />;
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
  const started = (on: string, sessionId: string) => swap({ kind: 'session', sessionId, computer: on });
  const runOn: RunOnComputer[] = computers.map((c) => ({ id: c.id, name: nameOf(c), state: c.state, client: clientOf(c), features: featuresOf(c), sessions: c.sessions.sessions }));
  // A pipeline run (#179) has the session route too: a run row's id (from the list or a notification) opens the run.
  const openRun = route.kind === 'session' && sessions.runs?.some((r) => r.run.id === route.sessionId);
  const main =
    route.kind === 'session' && openRun ? (
      <RunView
        key={`${id}:${route.sessionId}`}
        client={client}
        runId={route.sessionId}
        sessions={sessions}
        banner={wide ? null : banner}
        lead={sessionLead}
        onLeave={leave}
        onOpenSession={(sessionId, options = {}) => (options.replace ? swap({ kind: 'session', sessionId, computer: id }) : openSession(id, sessionId))}
        computerName={multi ? computer || 'Your computer' : undefined}
      />
    ) : route.kind === 'session' ? (
      <SessionView
        key={`${id}:${route.sessionId}`}
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
        computerName={multi ? computer || 'Your computer' : undefined}
        onOpenSession={(sessionId) => openSession(id, sessionId)}
      />
    ) : route.kind === 'new' ? (
      <NewSession
        key={route.projectId ?? ''}
        computers={runOn}
        computer={id}
        onComputer={(next) => swap({ ...route, computer: next })}
        banner={wide ? null : banner}
        onBack={wide ? null : back}
        lead={viewLead}
        onStarted={started}
        initialProject={route.projectId ?? null}
      />
    ) : null;
  // A wide screen offers notifications in a strip over the main view; an iPad outside the Home Screen keeps the card,
  // which explains how to add it.
  const offering = offer && !listOffline;
  const stripOffer = wide && currentSupport() === 'ready';
  const list = (
    <SessionList
      mode={wide ? 'sidebar' : 'phone'}
      sessions={merged}
      state={listState}
      banner={wide ? null : listTopBanner}
      computerOf={computerOf}
      labels={multi}
      chip={chip}
      strip={strip}
      title={title}
      menu={menu}
      selectedId={currentKey}
      newOpen={route.kind === 'new'}
      onOpen={(key) => showSession(key)}
      onNew={() => startNew()}
      onHome={goHome}
      homeOpen={wide && atRoot}
      onRefresh={update.state === 'none' ? reload : async () => reloadApp()}
      update={update.state !== 'none'}
      onArchived={(key) => key === currentKey && leave()}
      top={offering && !stripOffer && <PushOffer push={push} onDone={() => setOffer(false)} />}
      usage={<UsageCard usage={usage} offline={listOffline} />}
      onPalette={() => setPalette(true)}
    />
  );
  const drawer = drawerMode && (
    <SessionsDrawer open={drawerOpen} edge={edge} onClose={() => setDrawerOpen(false)}>
      <SessionList
        mode="drawer"
        sessions={merged}
        state={listState}
        banner={listBanner}
        computerOf={computerOf}
        labels={multi}
        chip={chip}
        strip={strip}
        menu={menu}
        selectedId={currentKey}
        newOpen={route.kind === 'new'}
        onOpen={pick}
        onNew={pickNew}
        onHome={pickHome}
        homeOpen={atRoot}
        onRefresh={reload}
        onArchived={(key) => key === currentKey && leave()}
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
  const helpFor = byId(help);
  const overlays = (
    <>
      <Toasts />
      {notifications && <NotificationsSheet push={push} onClose={() => setNotifications(false)} />}
      {themeOpen && <ThemeSheet computers={computers} onClose={() => setThemeOpen(false)} />}
      {helpFor && <OfflineHelp state={helpFor.state} computer={nameOf(helpFor)} address={helpFor.paired.address} onClose={() => setHelp(null)} onRetry={() => helpFor.connection.retryNow()} />}
      {keysOpen && <KeysSheet onClose={() => setKeysOpen(false)} />}
      {palette && <Palette computers={computers.map((c) => ({ id: c.id, name: nameOf(c), client: clientOf(c) }))} labels={multi} sessions={merged.sessions} actions={paletteActions} onChoose={choose} onClose={() => setPalette(false)} />}
    </>
  );

  if (!wide)
    return (
      <>
        {main ?? list}
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
        {offering && stripOffer && <PushStrip push={push} onDone={() => setOffer(false)} />}
        {main ? banner : listTopBanner}
        <div className="min-h-0 flex-1">{main ?? <Home sessions={merged} usage={usage} offline={listOffline} computerOf={computerOf} labels={multi} onOpen={showSession} onNew={() => startNew()} onRefresh={refresh} lead={viewLead} />}</div>
      </div>
      {drawer}
      {overlays}
    </div>
  );
}

const clientOf = (computer: Computer): Client => (computer.state.kind === 'connected' ? computer.state.client : null);
const featuresOf = (computer: Computer): readonly string[] => (computer.state.kind === 'connected' ? computer.state.features : NO_FEATURES);
/** A computer that isn't paired any more, for a row that outlived it by a render. */
const NOWHERE: ListComputer = { client: null, features: [], name: '', online: false };

/**
 * A history entry's route (a sheet or the drawer adds its own entry on top of one). The first entry, with none yet, is
 * the sessions; so is one of a computer this phone isn't paired with any more.
 */
function routeOf(state: unknown, computers: readonly Computer[]): Route {
  const route = state as Route | null;
  if (route && (route.kind === 'session' || route.kind === 'new') && route.computer && !computers.some((c) => c.id === route.computer)) return { kind: 'list' };
  return route && (route.kind === 'session' || route.kind === 'new' || route.kind === 'home') ? route : { kind: 'list' };
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
