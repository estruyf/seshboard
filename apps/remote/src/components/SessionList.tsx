import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { House, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { REMOTE_FEATURE_MARK_UNREAD, type RemotePrompt, type RemoteSession, type RemoteSessions } from '@switchboard/protocol/remote-client';
import type { ConnectionState } from '../lib/connection.ts';
import { filterCounts, filterList, matchesSearch, visibleFilter, type ListFilter } from '../lib/filter.ts';
import { SLOP } from '../lib/gesture.ts';
import { age, GROUP_LABEL, groupSessions, shortHeadline, type SessionGroup } from '../lib/groups.ts';
import { PROFILE_DOT } from '../lib/options.ts';
import type { SwipeAction } from '../lib/swipe.ts';
import type { Client } from './Connected.tsx';
import { ConnectionLine } from './ConnectionStatus.tsx';
import { LargeTitle } from './LargeTitle.tsx';
import { ContextMenu, MenuButton, menuPoint, type MenuItem, type MenuPoint } from './Menu.tsx';
import { NeedsYouCard } from './NeedsYouCard.tsx';
import { promptShort } from '../lib/prompts.ts';
import { PullToRefresh } from './PullToRefresh.tsx';
import { SwipeRow } from './SwipeRow.tsx';
import { toast } from './Toasts.tsx';
import { useLeaving } from './useLeaving.ts';
import { Button, Kbd, Logo, PROFILE_RAIL, SectionHeader, STATUS_RAIL, StatusDot } from './ui.tsx';

const GROUP_TONE: Record<SessionGroup, string> = {
  'needs-you': 'text-warn',
  working: 'text-accent-ink',
  today: 'text-faint',
  yesterday: 'text-faint',
  earlier: 'text-faint',
};

/** The chip picked, for this tab (it survives a reload). */
const FILTER_KEY = 'switchboard-remote:filter';

function savedFilter(): ListFilter {
  try {
    const value = sessionStorage.getItem(FILTER_KEY);
    return value === 'needs-you' || value === 'working' ? value : 'all';
  } catch {
    return 'all';
  }
}

/** Re-renders every minute, so ages and Today/Yesterday stay right on a page left open. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * - `phone`: the first screen, where the app opens, and a phone's only root. The computer's name as a large title
 *   (it opens the computer's menu), the usage card, every open prompt as a card (oldest first), then the groups the
 *   sidebar on the computer has. Pull it down to refresh; swipe a row to mark it read or archive it. Search takes the
 *   title's place, with the chips for what needs you and what works.
 * - `sidebar`: the wide layout's sidebar. The search opens the palette, chips for what needs you and what works,
 *   prompts are rows in Needs you (their cards are on the home view), rows are the desktop's size, and the `⋯` menu
 *   sits at the bottom next to New session.
 * - `drawer`: the sessions drawer. A search, the Home row on a wide screen, prompts as rows, the open session picked.
 */
export type ListMode = 'phone' | 'sidebar' | 'drawer';

/**
 * The sessions: a header with the computer chip (on a phone, the large title), then the list. New session is a bar at the bottom. Offline (or
 * disconnected), the last list stays, greyed out, and what needs the connection is off.
 *
 * A row's menu (a long press, a right-click, Shift+F10, or the row's own menu button for screen readers) has Mark as
 * read and Archive, as the session's own `⋯` menu does.
 */
export function SessionList({
  mode,
  sessions,
  state,
  banner,
  client,
  features,
  chip,
  title,
  menu,
  selectedId,
  newOpen,
  onOpen,
  onNew,
  onHome,
  homeOpen = false,
  onRefresh,
  update = false,
  onArchived,
  top,
  usage,
  homeRow,
  headerEnd,
  onPalette,
}: {
  mode: ListMode;
  sessions: RemoteSessions;
  state: ConnectionState;
  banner: ReactNode;
  client: Client;
  /** What the computer takes beyond what every version does (its hello): Undo after Mark as read needs one. */
  features: readonly string[];
  /** The computer chip, which opens the computer's menu. */
  chip: ReactNode;
  /** The first screen's title on a phone: the computer's name, large or in the bar once the list scrolled. */
  title?: (size: 'large' | 'compact') => ReactNode;
  menu: MenuItem[];
  selectedId: string | null;
  newOpen: boolean;
  onOpen: (sessionId: string) => void;
  onNew: () => void;
  /** Goes to Home: the sidebar's button, or the drawer's Home row on a wide screen. Without it, no Home row. */
  onHome?: () => void;
  /** Home is on screen: its button or row shows as current. */
  homeOpen?: boolean;
  /** Asks for the list again (pull to refresh); done when the answer is in. */
  onRefresh: () => Promise<unknown>;
  /** A newer remote app is on the site: pull to refresh says Release to update (`onRefresh` reloads the app then). */
  update?: boolean;
  /** A session was archived from its row: leave it if it is open. */
  onArchived: (sessionId: string) => void;
  /** Above everything in the list: the offer to turn on notifications. */
  top?: ReactNode;
  /** The first screen's usage card. */
  usage?: ReactNode;
  /** The drawer's Home row, under its search: every profile's usage in a few words. */
  homeRow?: ReactNode;
  /** At the end of the header (the drawer's button that keeps the sidebar open). */
  headerEnd?: ReactNode;
  /** Opens the ⌘K palette (the sidebar's search). */
  onPalette?: () => void;
}) {
  const now = useNow();
  const sidebar = mode === 'sidebar';
  const drawer = mode === 'drawer';
  const [chosen, setChosen] = useState<ListFilter>(savedFilter);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const counts = filterCounts(sessions.sessions);
  // On a phone the chips only show, and only filter, while you search.
  const filter = sidebar || searching ? visibleFilter(chosen, counts) : 'all';
  const search = drawer || searching ? query : '';
  // In the sidebar and the drawer, a session that waits on you is a row in Needs you rather than a card.
  const shown = mode === 'phone' ? filterList(sessions, filter, search) : { prompts: [], sessions: sessions.sessions.filter((s) => (filter === 'all' || s.status === filter) && matchesSearch(s, search)) };
  const leaving = useLeaving(sessions.prompts);
  const cards = leaving.merge(shown.prompts);
  const promptOf = useMemo(() => {
    const first = new Map<string, RemotePrompt>();
    for (const p of [...sessions.prompts].sort((a, b) => a.createdAt - b.createdAt)) if (!first.has(p.sessionId)) first.set(p.sessionId, p);
    return first;
  }, [sessions.prompts]);
  const byId = useMemo(() => new Map(sessions.sessions.map((s) => [s.id, s])), [sessions.sessions]);
  const offline = state.kind !== 'connected';
  const [rowMenu, setRowMenu] = useState<{ session: RemoteSession; point: MenuPoint; row: HTMLElement } | null>(null);
  const closeRowMenu = useCallback(() => setRowMenu(null), []);
  const failed = () => toast("That didn't reach your computer.", { tone: 'error' });
  const canUnread = features.includes(REMOTE_FEATURE_MARK_UNREAD);

  /** Mark as read, with Undo where the computer can mark it unread again. */
  const markRead = (session: RemoteSession) =>
    void client
      ?.call('session.markRead', { sessionId: session.id })
      .then(() => toast('Marked as read', { detail: session.title, ...(canUnread ? { action: { label: 'Undo', run: () => void client.call('session.markUnread', { sessionId: session.id }).catch(failed) } } : {}) }))
      .catch(failed);
  /** Archive, with Undo. */
  const archive = (session: RemoteSession) =>
    void client
      ?.call('session.setFlags', { sessionId: session.id, archived: true })
      .then(() => {
        toast(`Archived ${session.title}`, { action: { label: 'Undo', run: () => void client.call('session.setFlags', { sessionId: session.id, archived: false }).catch(failed) } });
        onArchived(session.id);
      })
      .catch(failed);
  const rowItems = (session: RemoteSession): MenuItem[] => [
    { label: 'Mark as read', disabled: !client || !session.unread, onSelect: () => markRead(session) },
    { label: 'Archive', disabled: !client, onSelect: () => archive(session) },
  ];
  const onSwipe = (session: RemoteSession) => (action: SwipeAction) => (action === 'read' ? markRead(session) : archive(session));

  const choose = (next: ListFilter) => {
    setChosen(next);
    try {
      sessionStorage.setItem(FILTER_KEY, next);
    } catch {
      // Private browsing without storage: the chip lasts until the page closes.
    }
  };
  const closeSearch = () => {
    setSearching(false);
    setQuery('');
  };

  const chipButton = (value: ListFilter, label: string, count?: number) => (
    <button
      type="button"
      aria-pressed={filter === value}
      onClick={() => choose(value)}
      data-remote-filter={value}
      className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-ui transition-colors pointer-fine:min-h-7 ${filter === value ? 'border-transparent bg-selected font-semibold text-text' : 'border-border text-muted hover:bg-border/45'}`}
    >
      {value === 'needs-you' && <span aria-hidden className="size-1.5 rounded-full bg-warn" />}
      {value === 'working' && <span aria-hidden className="size-1.5 rounded-full bg-accent-ink" />}
      {label}
      {count !== undefined && <span className="tabular-nums text-faint">{count}</span>}
    </button>
  );

  const searchField = (
    <label className="field flex min-h-9 flex-1 items-center gap-2 px-2.5 pointer-fine:min-h-7">
      <Search className="size-4 shrink-0 text-faint" aria-hidden />
      <input
        ref={field}
        autoFocus={mode === 'phone'}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          // In the drawer, Escape clears the search first, then closes the drawer.
          if (event.key !== 'Escape' || (drawer && !query)) return;
          event.preventDefault();
          if (drawer) setQuery('');
          else closeSearch();
        }}
        placeholder="Search title, project or branch"
        aria-label="Search sessions"
        enterKeyHint="search"
        data-remote-search
        className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-faint"
      />
      {query && (
        <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="-mr-1 rounded-md p-1 text-faint hover:text-text">
          <X className="size-4" aria-hidden />
        </button>
      )}
    </label>
  );

  const chips = (
    <div className="scroll-row flex min-w-0 flex-1 gap-1.5">
      {chipButton('all', 'All')}
      {counts.needsYou > 0 && chipButton('needs-you', 'Needs you', counts.needsYou)}
      {counts.working > 0 && chipButton('working', 'Working', counts.working)}
    </div>
  );

  /** A phone's top: the large title, or while you search, the field with Cancel and the chips. */
  const phoneTop = searching ? (
    <div className="safe-top sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-bg px-4 pb-2" data-remote-bar="search">
      <div className="flex items-center gap-1">
        {searchField}
        <Button variant="quiet" size="md" onClick={closeSearch} className="-mr-2 px-2!" data-remote-search-cancel>
          Cancel
        </Button>
      </div>
      <div className="-mx-4 flex px-4">{chips}</div>
    </div>
  ) : (
    <LargeTitle
      title={(size) => title?.(size)}
      line={<ConnectionLine state={state} detail={shortHeadline(sessions.sessions, now)} />}
      actions={
        <>
          <Button variant="quiet" size="md" aria-label="Search sessions" onClick={() => setSearching(true)} className="min-w-11 px-0! pointer-fine:min-w-8" data-remote-search-open>
            <Search className="size-5" aria-hidden />
          </Button>
          <MenuButton items={menu} className="min-w-11 px-0! pointer-fine:min-w-8" />
        </>
      }
    />
  );

  const groups = groupSessions(shown.sessions, now);
  const empty = sessions.sessions.length === 0;
  const nothingMatches = !empty && cards.length === 0 && groups.length === 0;

  const body = (
    <>
      {top}
      {offline && !empty && <p className="px-4 pt-3 text-meta text-muted">{state.kind === 'disconnected' ? 'The list from before you disconnected.' : "The list from before you lost the connection. Answering waits until you're back online."}</p>}
      {mode === 'phone' && !searching && usage && <div className="px-3 pt-3">{usage}</div>}
      {empty && <p className="px-4 py-10 text-center text-body text-muted">{state.kind === 'disconnected' ? 'Connect to see your sessions.' : offline ? 'Waiting for your computer.' : 'No sessions yet. Start one with New session.'}</p>}
      {nothingMatches && <p className="px-4 py-10 text-center text-body text-muted">{search ? 'No session matches.' : 'Nothing here right now.'}</p>}
      {cards.length > 0 && (
        <section aria-labelledby="group-prompts" className="flex flex-col px-3 pb-1">
          <SectionHeader id="group-prompts" label={GROUP_LABEL['needs-you']} count={cards.length} tone="text-warn" className="px-1" />
          {cards.map((prompt) => (
            <div key={prompt.requestId} className="collapse-out mb-2" data-leaving={leaving.isLeaving(prompt.requestId) || undefined} onTransitionEnd={(event) => event.propertyName === 'grid-template-rows' && leaving.gone(prompt.requestId)}>
              <div>
                <NeedsYouCard
                  prompt={prompt}
                  session={byId.get(prompt.sessionId)}
                  client={client}
                  now={now}
                  onOpen={() => onOpen(prompt.sessionId)}
                  onAnswered={(result) => {
                    leaving.leave(prompt);
                    if (result === 'gone') void onRefresh();
                  }}
                />
              </div>
            </div>
          ))}
        </section>
      )}
      {groups.map(({ group, sessions: rows }) => (
        <section key={group} aria-labelledby={`${mode}-group-${group}`}>
          <SectionHeader id={`${mode}-group-${group}`} label={GROUP_LABEL[group]} count={rows.length} tone={GROUP_TONE[group]} />
          <ul>
            {rows.map((session) => {
              const row = (
                <SessionRow
                  session={session}
                  size={mode === 'phone' ? 'phone' : 'compact'}
                  selected={session.id === selectedId}
                  asks={mode === 'phone' ? undefined : promptOf.get(session.id)}
                  now={now}
                  onOpen={() => onOpen(session.id)}
                  onMenu={(point, element) => setRowMenu({ session, point, row: element })}
                />
              );
              return (
                <li key={session.id}>
                  {/* A session that waits on you never swipes away: a prompt can't be dismissed by accident. */}
                  {mode === 'phone' && session.status !== 'needs-you' ? (
                    <SwipeRow allowed={{ read: Boolean(client) && session.unread, archive: Boolean(client) }} onAction={onSwipe(session)}>
                      {row}
                    </SwipeRow>
                  ) : (
                    row
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mode !== 'phone' && (
        <header className={`sticky top-0 z-10 flex items-center gap-2 bg-inherit pb-2 ${drawer ? 'px-3 pt-[max(0.75rem,env(safe-area-inset-top))]' : 'safe-top px-4'}`}>
          <Logo className="size-6" />
          <h1 className="min-w-0 flex-1 truncate text-title font-semibold">Sessions</h1>
          {sidebar && onHome && (
            <Button variant="quiet" size="md" aria-label="Home" title="Home" aria-current={homeOpen ? 'page' : undefined} onClick={onHome} className={`px-2! ${homeOpen ? 'bg-selected text-text' : ''}`} data-remote-home-button>
              <House className="size-4" aria-hidden />
            </Button>
          )}
          {chip}
          {headerEnd}
        </header>
      )}
      {sidebar && (
        <>
          <div className="px-3 pb-2">
            <button type="button" onClick={onPalette} className="field flex min-h-8 w-full items-center gap-2 px-2.5 text-left text-ui text-faint hover:border-faint" data-remote-palette-open>
              <Search className="size-3.5 shrink-0" aria-hidden />
              <span className="flex-1">Search or jump to…</span>
              <Kbd shortcut="mod+k" tone="cap" />
            </button>
          </div>
          <div className="flex items-center gap-2 border-b border-border px-3 pb-2">{chips}</div>
        </>
      )}
      {drawer && (
        <>
          <div className="flex px-3 pb-2">{searchField}</div>
          {!query && onHome && (
            <button
              type="button"
              onClick={onHome}
              aria-current={homeOpen ? 'page' : undefined}
              className={`mx-2 flex min-h-11 items-center gap-2.5 rounded-lg px-2 text-left transition-colors ${homeOpen ? 'bg-selected' : 'hover:bg-border/45 active:bg-selected'}`}
              data-remote-home-row
            >
              <House className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="shrink-0 text-body">Home</span>
              <span className="flex min-w-0 flex-1 justify-end">{homeRow}</span>
            </button>
          )}
          <div className="mt-1 border-b border-border" />
        </>
      )}
      {mode !== 'phone' && banner}
      {mode === 'phone' ? (
        <PullToRefresh onRefresh={onRefresh} update={update} disabled={offline} className="min-h-0 flex-1 pb-3" data-remote-list>
          {phoneTop}
          {banner}
          <nav aria-label="Sessions" aria-busy={offline || undefined} className={`transition-opacity ${offline ? 'opacity-60' : ''}`}>
            {body}
          </nav>
        </PullToRefresh>
      ) : (
        <nav aria-label="Sessions" aria-busy={offline || undefined} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 transition-opacity ${offline ? 'opacity-60' : ''}`} data-remote-list>
          {body}
        </nav>
      )}
      {rowMenu && <ContextMenu label={`Session “${rowMenu.session.title}”`} items={rowItems(rowMenu.session)} point={rowMenu.point} owner={rowMenu.row} onClose={closeRowMenu} />}
      <footer className={`safe-bottom border-t border-border bg-inherit pt-2 ${mode === 'phone' ? 'px-4' : 'px-3'}`}>
        <div className="flex items-center gap-1">
          <Button variant="primary" onClick={onNew} aria-pressed={newOpen} disabled={offline} className="flex-1" data-remote-new>
            <Plus className="size-4" aria-hidden />
            New session
          </Button>
          {sidebar && <MenuButton items={menu} side="above" />}
        </div>
        {offline && <p className="pt-1 text-center text-meta text-faint">New session needs the connection.</p>}
      </footer>
    </div>
  );
}

/** A finger held this long on a row opens its menu. */
const LONG_PRESS_MS = 500;

/**
 * One session: its status dot, title, project (after the profile's dot, with more than one profile) and branch or
 * what it asks, and its age. A long press, a right-click or Shift+F10 opens its menu; so does its menu button, which
 * only shows while it has keyboard focus (it is there for screen readers and the keyboard).
 */
function SessionRow({ session, size, selected, asks, now, onOpen, onMenu }: { session: RemoteSession; size: 'phone' | 'compact'; selected: boolean; asks: RemotePrompt | undefined; now: number; onOpen: () => void; onMenu: (point: MenuPoint, row: HTMLElement) => void }) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const pressed = useRef(false);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);
  const profile = session.profile;
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={(event) => {
          // The click a long press ends with only opened the menu.
          if (pressed.current) {
            pressed.current = false;
            event.preventDefault();
            return;
          }
          onOpen();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          cancelPress();
          onMenu(menuPoint(event, event.currentTarget), event.currentTarget);
        }}
        onPointerDown={(event) => {
          pressed.current = false;
          if (event.pointerType !== 'touch') return;
          const row = event.currentTarget;
          const timer = setTimeout(() => {
            press.current = null;
            pressed.current = true;
            onMenu(menuPoint({ clientX: 0, clientY: 0 }, row), row);
          }, LONG_PRESS_MS);
          press.current = { timer, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const p = press.current;
          if (p && Math.max(Math.abs(event.clientX - p.x), Math.abs(event.clientY - p.y)) >= SLOP) cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onKeyDown={(event) => {
          // Shift+F10 or the menu key, as a right-click (not every browser sends one for them).
          if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
          event.preventDefault();
          onMenu(menuPoint({ clientX: 0, clientY: 0 }, event.currentTarget), event.currentTarget);
        }}
        aria-current={selected ? 'page' : undefined}
        data-remote-session={session.id}
        data-remote-nav="row"
        data-remote-profile={profile?.id}
        className={`flex w-full items-center gap-2.5 border-l-[3px] text-left transition-colors select-none [-webkit-touch-callout:none] focus-visible:-outline-offset-2 ${size === 'compact' ? 'min-h-11 px-3 py-1' : 'min-h-14 px-4 py-2 pointer-fine:min-h-12'} ${profile ? PROFILE_RAIL[profile.color] : STATUS_RAIL[session.status]} ${selected ? 'bg-selected' : 'hover:bg-border/45 active:bg-selected'}`}
      >
        <StatusDot status={session.status} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-body ${session.unread || asks ? 'font-semibold' : ''}`}>{session.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
            {profile && <span aria-label={`Claude profile: ${profile.name}`} role="img" className={`size-1.5 shrink-0 rounded-full ${PROFILE_DOT[profile.color]}`} />}
            <span className="truncate">
              {session.projectName}
              {asks ? <span className="text-warn"> · {promptShort(asks)}</span> : session.branch ? ` · ${session.branch}` : ''}
            </span>
          </span>
        </span>
        <span className={`self-start pt-0.5 text-meta tabular-nums ${session.status === 'needs-you' ? 'text-warn' : session.unread ? 'text-unread' : 'text-faint'}`}>{age(session.updatedAt, now)}</span>
      </button>
      <button
        type="button"
        aria-label={`Actions for ${session.title}`}
        aria-haspopup="menu"
        onClick={(event) => onMenu(menuPoint({ clientX: 0, clientY: 0 }, event.currentTarget.previousElementSibling ?? event.currentTarget), (event.currentTarget.previousElementSibling as HTMLElement | null) ?? event.currentTarget)}
        className="absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md bg-card text-muted opacity-0 focus-visible:opacity-100"
        data-remote-row-menu
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
    </div>
  );
}
