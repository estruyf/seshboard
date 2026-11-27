import { CalendarClock, Clock, FolderCog, Globe, House, MessageSquare, Monitor, Plus, Settings, Target } from 'lucide-react';
import type { NavRailItem } from '@seshboard/protocol/bridge';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { ariaKeysFor, formatKeys, keysFor, matches, type ShortcutId } from '../../lib/shortcuts.ts';
import { openActivity } from '../../state/activityStore.ts';
import { openBrowserView, useSidebarList } from '../../state/browserViewStore.ts';
import type { NavList } from './navRail.ts';
import { useComputers } from '../../state/computersStore.ts';
import { remoteFooter } from '../../state/connectedDevices.ts';
import { useFocus } from '../../state/focusGate.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useNavRailMenu } from '../../state/navRailStore.ts';
import { useMinimal, usePreferences } from '../../state/preferencesStore.ts';
import { useRemote } from '../../state/remoteStore.ts';
import { remoteRowId } from '../../state/remoteSelection.ts';
import { useRows } from '../../state/rowsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { needsYouPill } from '../../state/sidebarOrder.ts';
import { inScope, rowStatus } from '../../state/sidebarRows.ts';
import { useShownSidebar, useSidebar } from '../../state/sidebarStore.ts';
import { openUpcoming } from '../../state/upcomingStore.ts';
import { useRemoteRows } from '../../state/useRemoteRows.ts';
import { useSessionsToday } from '../../state/useSessionsToday.ts';
import { useUpcomingSummary } from '../../state/useUpcomingSummary.ts';
import { newSessionDraftTooltip, PenBadge, remoteNewSessionDraftTooltip } from '../drafts/PenBadge.tsx';
import { openDraft, useNewSessionDraft, useRemoteNewSessionDraft } from '../drafts/useUnsent.ts';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useQueueDrag } from '../queue/useQueueDrag.ts';
import { ConnectedDevices, useRemoteFooterShown } from '../remote/ConnectedDevices.tsx';
import { ComputersStrip } from '../computers/ComputersStrip.tsx';
import { Popover } from '../ui/Popover.tsx';
import { FOCUS_RAIL_TEXT } from '../focus/FocusCounter.tsx';
import { Badged } from '../ui/Badged.tsx';
import { Button } from '../ui/Button.tsx';
import { moveNavItem, NAV_RAIL_NAMES, navClick, navRailEntries, navRailIds, resetNav, stepNavItem, toggleNavItem } from './navRail.ts';
import { NavPeek, usePeek } from './NavPeek.tsx';

const ICONS: Record<NavRailItem, ReactNode> = {
  home: <House size={17} aria-hidden />,
  sessions: <MessageSquare size={17} aria-hidden />,
  upcoming: <CalendarClock size={17} aria-hidden />,
  activity: <Clock size={17} aria-hidden />,
  browser: <Globe size={17} aria-hidden />,
  projects: <FolderCog size={17} aria-hidden />,
  computers: <Monitor size={17} aria-hidden />,
  running: <Target size={15} aria-hidden />,
};

/** Re-renders relative counts (today's sessions, what is ready) once a minute. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The sessions that need you, this computer's and other computers' (in the sidebar's scope), as the closed sidebar's
 * pill counted them; and how many of them are here, for the Computers strip.
 */
function useNeedsYou(): { count: number; local: number } {
  const baseRows = useRows((s) => s.rows);
  const permissions = useHosts((s) => s.permissions);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const remoteRows = useRemoteRows();
  const lists = useComputers((s) => s.lists);
  return useMemo(() => {
    const local = baseRows.filter((row) => inScope(row, scope));
    const remoteRequests = [...lists].flatMap(([computerId, list]) => list.prompts.map((p) => ({ ...p, sessionId: remoteRowId({ computerId, sessionId: p.sessionId }) })));
    const pill = needsYouPill([...local, ...remoteRows], [...permissions.values(), ...remoteRequests]);
    return { count: pill?.count ?? 0, local: local.filter((row) => rowStatus(row) === 'needs-you').length };
  }, [baseRows, permissions, scope, remoteRows, lists]);
}

/** What one item of the rail is and does, as the rail draws it. */
interface ItemLook {
  label: string;
  /** The tooltip, when it says more than the label ("Sessions · 2 need you"). */
  tip?: string;
  shortcut?: ShortcutId;
  /** Its page is in the main area (Upcoming, Activity, a project, Settings): the text colour while the panel shows another list. */
  current?: boolean;
  badge?: { count?: number; tone?: 'default' | 'ok' | 'warn'; data?: Record<`data-${string}`, boolean | string | number> };
  /** In place of the icon (Running's count under its target). */
  icon?: ReactNode;
  /** The text colour when it is not selected (Running's level). */
  tone?: string;
  data: Record<`data-${string}`, boolean | string>;
  onClick(): void;
}

/**
 * The rail at the window's left edge, always shown in the main window, like VS Code's activity bar: New session and Home
 * are actions, and Computers a menu that opens as the pointer rests on it (it holds too little for a list); every other
 * item shows its list in the panel beside the rail (Sessions, Upcoming's and Activity's project filters, the Browser's
 * tabs, the projects, what is running, Settings' sections), and those with a page
 * open it in the main area. A click opens the closed panel on its list, switches an open one, or closes it when it shows
 * that list already. The item whose list is open is the selected one. One Tab stop, ↑ ↓ Home End move, ⌥↑ ⌥↓ (or a
 * drag) move an item; a right-click picks which items show. With the panel closed, resting on Sessions (or → on it) peeks
 * at the list.
 */
export function NavRail({ inert = false }: { inert?: boolean }) {
  const now = useNow();
  const minimal = useMinimal();
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  const view = useSessions((s) => s.view);
  const behind = useSessions((s) => (s.view === 'settings' ? s.settingsFrom : s.view));
  const panelOpen = useShownSidebar().state === 'open';
  const list = useSidebarList((s) => (s.list === 'browser' && !prefs.browserEnabled ? 'sessions' : s.list));
  const summary = useUpcomingSummary(now);
  const today = useSessionsToday(now);
  const needsYou = useNeedsYou();
  const newDraft = useNewSessionDraft();
  const remoteNewDraft = useRemoteNewSessionDraft();
  const focus = useFocus();
  const remoteStatus = useRemote((s) => s.status);
  const remoteOn = remoteFooter(remoteStatus, true) !== 'hidden' && remoteFooter(remoteStatus, true) !== 'problem';
  const remoteFooterShown = useRemoteFooterShown();
  const computerCount = useComputers((s) => s.status?.computers.length ?? 0);
  const available = { browser: prefs.browserEnabled, computers: remoteFooterShown || computerCount > 0, running: focus.limit !== null };
  const entries = navRailEntries(available, prefs.navRailHidden, prefs.navRailOrder);
  const ids = navRailIds(entries);
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const menu = useNavRailMenu((s) => s.at);
  const [focused, setFocused] = useState(0);
  const peek = usePeek(!panelOpen);
  // Computers holds too little for a list: a menu that opens as the pointer rests on it, or on a click.
  const computers = usePeek(true);

  const move = (item: NavRailItem, to: number) => update({ navRailOrder: moveNavItem(prefs.navRailOrder, item, to, idsRef.current) });
  const drag = useQueueDrag({ ids: () => idsRef.current, move: (id, to) => move(id as NavRailItem, to), mime: 'application/x-seshboard-nav-rail' });

  /** An item's click: its page in the main area (if it has one) and its list in the panel, or the panel closed. */
  const select = (item: NavList) => {
    peek.close();
    const step = navClick(item, { panelOpen, list });
    // Settings is a sheet over the view: its second click closes it, and the panel shows that view's list again.
    if (step === 'close' && item === 'settings') return useSessions.getState().closeSettings();
    if (step === 'close') return useSidebar.getState().setState('closed');
    if (item === 'browser') openBrowserView({ toggle: false });
    // The projects list goes with a project's page: the one open last, or the first (the `projects` view picks it).
    else if (item === 'projects' && behind !== 'projects' && behind !== 'project') useSessions.getState().setView('projects');
    else if (item === 'upcoming' && view !== 'upcoming') openUpcoming();
    else if (item === 'activity' && view !== 'activity') openActivity();
    else if (item === 'settings' && view !== 'settings') useSessions.getState().openSettings();
    useSidebarList.getState().setList(item);
    if (step === 'open') useSidebar.getState().setState('open');
  };

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const going = focus.limit === null ? '' : `${focus.count} of ${focus.limit} going`;
  const looks: Record<NavRailItem, ItemLook> = {
    // Home is an action: it shows the Home page with the sessions beside it, and is never the one selected.
    home: {
      label: 'Home',
      shortcut: 'home',
      data: { 'data-go-home': true, 'data-nav': 'home' },
      onClick: () => {
        useSidebarList.getState().setList('sessions');
        useSessions.getState().goHome();
      },
    },
    sessions: {
      label: needsYou.count > 0 ? `Sessions, ${plural(needsYou.count, 'needs', 'need')} you` : 'Sessions',
      tip: needsYou.count > 0 ? `Sessions · ${needsYou.count} need${needsYou.count === 1 ? 's' : ''} you` : 'Sessions',
      shortcut: 'sidebar.toggle',
      badge: { count: needsYou.count, tone: 'warn', data: { 'data-needs-you-pill': needsYou.count } },
      data: { 'data-nav': 'sessions' },
      onClick: () => select('sessions'),
    },
    upcoming: {
      label: summary.label,
      tip: `Upcoming · ${summary.hint?.text ?? (summary.count > 0 ? `${summary.count} planned` : 'nothing planned')}`,
      shortcut: 'upcoming',
      current: behind === 'upcoming',
      badge: { count: summary.count, tone: summary.ready > 0 ? 'ok' : 'default', data: { 'data-nav-upcoming-count': true } },
      data: { 'data-upcoming-nav': true, 'data-nav': 'upcoming' },
      onClick: () => select('upcoming'),
    },
    activity: {
      label: today > 0 ? `Activity, ${today} today` : 'Activity',
      tip: today > 0 ? `Activity · ${today} today` : 'Activity',
      shortcut: 'activity',
      current: behind === 'activity',
      data: { 'data-activity-nav': true, 'data-nav': 'activity' },
      onClick: () => select('activity'),
    },
    browser: { label: 'Browser', shortcut: 'browser.view', current: behind === 'browser', data: { 'data-nav': 'browser' }, onClick: () => select('browser') },
    projects: { label: 'Projects', current: behind === 'projects' || behind === 'project', data: { 'data-open-projects': true }, onClick: () => select('projects') },
    computers: {
      label: remoteOn ? 'Computers, Remote on' : 'Computers',
      tip: remoteOn ? 'Computers · Remote on' : 'Computers',
      data: { 'data-nav': 'computers', 'data-nav-computers': true },
      onClick: () => (computers.open ? computers.close() : computers.show(document.querySelector<HTMLElement>('[data-nav-rail] [data-nav-computers]')!, false)),
    },
    running: {
      label: `Running: ${going}`,
      tip: `Running · ${going}`,
      tone: FOCUS_RAIL_TEXT[focus.level],
      icon: (
        <span className="flex flex-col items-center gap-0.5 tabular-nums">
          <Target size={15} aria-hidden />
          <span aria-hidden className="text-[10px] leading-none font-semibold">
            {focus.count}/{focus.limit}
          </span>
        </span>
      ),
      data: { 'data-nav': 'running', 'data-focus-counter': focus.level },
      onClick: () => select('running'),
    },
  };

  // The popovers (the peek, menus) are portals: React still bubbles their events here. Only the rail's own count.
  const own = (event: { currentTarget: HTMLElement; target: EventTarget }) => event.currentTarget.contains(event.target as Node);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!own(event)) return;
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-nav-button]')];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const item = (document.activeElement as HTMLElement | null)?.dataset.navItem as NavRailItem | undefined;
    if (matches(event.nativeEvent, 'rail.move')) {
      event.preventDefault();
      const to = item ? stepNavItem(idsRef.current, item, event.key === 'ArrowUp' ? -1 : 1) : null;
      if (item && to !== null) {
        move(item, to);
        // React moves the button in the DOM, which can drop focus: keep it on the button.
        requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-nav-rail] [data-nav-item="${CSS.escape(item)}"]`)?.focus());
      }
      return;
    }
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      event.preventDefault();
      const rect = (document.activeElement as HTMLElement | null)?.getBoundingClientRect() ?? event.currentTarget.getBoundingClientRect();
      useNavRailMenu.getState().open({ x: rect.right + 8, y: rect.top });
      return;
    }
    // → on Sessions with the panel closed: the peek, with focus in it.
    if (event.key === 'ArrowRight' && item === 'sessions' && !panelOpen) {
      event.preventDefault();
      peek.show(document.activeElement as HTMLElement, true);
      return;
    }
    const next = event.key === 'ArrowDown' ? at + 1 : event.key === 'ArrowUp' ? at - 1 : event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : null;
    if (next === null || at === -1) return;
    event.preventDefault();
    const index = (next + all.length) % all.length;
    setFocused(index);
    all[index]?.focus();
  };

  // New session is button 0, the items follow, Settings is last.
  const tabStop = Math.min(focused, ids.length + 1);
  const roving = (index: number) => ({ tabIndex: index === tabStop ? 0 : -1, onFocus: () => setFocused(index), 'data-nav-button': true });

  /**
   * One button: selected (the fill and the bar at the rail's edge) while the panel shows its list; the text colour while
   * its page is in the main area beside another list. `movable` items can be dragged.
   */
  const itemButton = (id: NavRailItem | 'settings', look: ItemLook, index: number, movable: boolean) => {
    // Computers opens a menu: pressed while it shows, never a list.
    const selected = id === 'computers' ? computers.open : id !== 'home' && panelOpen && list === id;
    const hint = !selected && !!look.current;
    const kbd = look.shortcut ? formatKeys(keysFor(look.shortcut)) : undefined;
    const mark = movable ? drag.markFor(id) : null;
    const hover = id === 'sessions' ? peek.triggerProps : id === 'computers' ? computers.triggerProps : {};
    return (
      <button
        key={id}
        type="button"
        {...(movable ? drag.props(id) : {})}
        {...roving(index)}
        {...hover}
        aria-label={look.label}
        aria-pressed={id === 'home' ? undefined : selected}
        aria-current={look.current ? 'page' : undefined}
        aria-keyshortcuts={look.shortcut ? ariaKeysFor(look.shortcut) : undefined}
        aria-haspopup={id === 'computers' ? 'dialog' : undefined}
        aria-expanded={id === 'computers' ? computers.open : undefined}
        data-tooltip={(peek.open && id === 'sessions') || (computers.open && id === 'computers') ? undefined : (look.tip ?? look.label)}
        data-tooltip-kbd={kbd}
        data-tooltip-placement="right"
        data-nav-item={id}
        data-selected={selected || undefined}
        onClick={look.onClick}
        className={`relative flex shrink-0 items-center justify-center rounded-[9px] ${id === 'running' ? 'w-9 py-1' : 'size-9'} ${selected ? 'bg-selected text-text' : hint ? 'text-text hover:bg-border/50' : `${look.tone ?? 'text-muted'} hover:bg-border/50 hover:text-text`} ${drag.dragging === id ? 'shadow-lg ring-1 ring-border' : ''}`}
        {...look.data}
      >
        {mark && <span aria-hidden className={`pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-accent-ink ${mark === 'before' ? '-top-[3px]' : '-bottom-[3px]'}`} data-nav-drop={mark} />}
        {/* The 3px bar at the rail's edge: 8px out from the button, the rail's own padding. */}
        {selected && id !== 'computers' && <span aria-hidden className="absolute inset-y-2 -left-2 w-[3px] rounded-r bg-text" data-nav-current />}
        {look.badge ? <Badged icon={ICONS[id as NavRailItem]} count={look.badge.count} tone={look.badge.tone} ring="chrome" minimal={minimal} data={look.badge.data} /> : (look.icon ?? (id === 'settings' ? <Settings size={17} aria-hidden /> : ICONS[id]))}
        {/* Remote on: a green dot (Minimal mode's dots are in the text colour). */}
        {id === 'computers' && remoteOn && <span aria-hidden className={`pointer-events-none absolute top-1.5 right-1.5 rounded-full ring-2 ring-chrome ${minimal ? 'size-1.5 bg-text' : 'size-2 bg-ok'}`} data-nav-remote-on />}
      </button>
    );
  };

  let index = 0;
  const rows = entries.map((entry, i) => {
    if (entry.kind === 'divider') return <span key={`divider-${i}`} aria-hidden className="my-0.5 h-px w-5.5 shrink-0 bg-border" data-nav-divider />;
    if (entry.kind === 'spacer') return <span key={`spacer-${i}`} aria-hidden className="min-h-2 flex-1" data-nav-spacer />;
    index++;
    return itemButton(entry.id, looks[entry.id], index, true);
  });

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (!own(event)) return;
    event.preventDefault();
    useNavRailMenu.getState().open({ x: event.clientX, y: event.clientY });
  };

  const reasons: Partial<Record<NavRailItem, string>> = {
    browser: available.browser ? undefined : 'Shows while the browser is on',
    computers: available.computers ? undefined : 'Shows with Remote on or a paired computer',
    running: available.running ? undefined : 'Shows while the focus limit is on',
  };
  const menuEntries: MenuEntry[] = [
    { heading: 'Customize the rail' },
    ...prefs.navRailOrder.map(
      (id): MenuEntry => ({
        label: NAV_RAIL_NAMES[id],
        icon: ICONS[id],
        checkbox: true,
        checked: !prefs.navRailHidden.includes(id),
        keepOpen: true,
        disabledReason: reasons[id],
        data: { 'data-nav-menu-item': id },
        onSelect: () => update({ navRailHidden: toggleNavItem(prefs.navRailHidden, id) }),
      }),
    ),
    'separator',
    { label: 'Reset to default', data: { 'data-nav-menu-reset': true }, onSelect: () => update(resetNav()) },
    { note: 'Always shown: New session, Settings', tone: 'faint' },
  ];

  const settings: ItemLook = { label: 'Settings', shortcut: 'settings', current: view === 'settings', data: { 'data-open-settings': true }, onClick: () => select('settings') };
  const newLabel = newDraft ? newSessionDraftTooltip(newDraft.name) : remoteNewDraft ? remoteNewSessionDraftTooltip(remoteNewDraft.name) : 'New session';
  return (
    <nav
      aria-label="Views"
      onKeyDown={onKeyDown}
      onContextMenu={onContextMenu}
      inert={inert}
      className="flex h-full w-13 shrink-0 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto border-r border-border bg-chrome py-2.5 [scrollbar-width:none] forced-colors:border-r"
      data-nav-rail
    >
      {/* The window's one primary action: a yellow fill. With an unsent New session prompt it carries a pen, and opens New
          session on that prompt's project (or on the computer Run on last picked, for a prompt typed for it). */}
      <span className="relative mb-1 flex shrink-0">
        <Button
          variant="primary"
          size="lg"
          iconOnly
          icon={<Plus size={17} strokeWidth={2.4} aria-hidden />}
          aria-label={newLabel}
          shortcut="session.new"
          data-tooltip-placement="right"
          data-new-session
          {...roving(0)}
          onClick={() => (newDraft ? openDraft(newDraft.item) : useSessions.getState().openNewSession({ runOn: 'last' }))}
          className={`size-9! rounded-[9px]! ${view === 'new' ? 'ring-2 ring-accent/40 ring-offset-1 ring-offset-chrome' : ''}`}
        />
        {newDraft ? (
          <PenBadge className="absolute -top-1.5 -right-1.5" data-new-session-draft={newDraft.item.root ?? ''} />
        ) : (
          remoteNewDraft && <PenBadge className="absolute -top-1.5 -right-1.5" data-remote-new-session-draft={remoteNewDraft.computerId} />
        )}
      </span>
      {rows}
      {itemButton('settings', settings, ids.length + 1, false)}

      {peek.open && <NavPeek peek={peek} onShowAll={() => select('sessions')} />}
      {computers.open && computers.at && (
        <Popover
          x={computers.at.x}
          y={computers.at.y}
          width={320}
          anchor={computers.anchor}
          // A computer's menu or a device's details open from inside: they take Escape and clicks first.
          yieldToNested
          onClose={computers.close}
          onPointerEnter={computers.hold}
          onPointerLeave={computers.release}
          role="dialog"
          aria-label="Computers"
          className="grid gap-1 py-1.5!"
          data-nav-computers-popover
        >
          <ConnectedDevices />
          <ComputersStrip localWaiting={needsYou.local} joined={remoteFooterShown} />
        </Popover>
      )}
      {menu && <Menu x={menu.x} y={menu.y} width={240} label="Customize the rail" entries={menuEntries} onClose={() => useNavRailMenu.getState().close()} />}
    </nav>
  );
}
