import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { House, Plus, Search, X } from 'lucide-react';
import type { RemotePrompt, RemoteSession, RemoteSessions } from '@switchboard/protocol/remote-client';
import type { ConnectionState } from '../lib/connection.ts';
import { filterCounts, filterList, visibleFilter, type ListFilter } from '../lib/filter.ts';
import { age, GROUP_LABEL, groupSessions, type SessionGroup } from '../lib/groups.ts';
import type { Client } from './Connected.tsx';
import { ConnectionChip } from './ConnectionStatus.tsx';
import { ContextMenu, MenuButton, menuPoint, type MenuItem, type MenuPoint } from './Menu.tsx';
import { NeedsYouCard } from './NeedsYouCard.tsx';
import { promptShort } from '../lib/prompts.ts';
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
 * The sessions: a header with the connection, chips for what needs you and what works (and a search), every open
 * prompt as a card at the top, then the groups the sidebar on the computer has. New session is a bar at the bottom.
 * Offline, the last list stays, greyed out, and what needs the connection is off.
 *
 * On a wide screen it is the sidebar: the search opens the palette, prompts are rows in Needs you (their cards are on
 * the home view), rows are the desktop's size, and New session sits at the bottom next to the `⋯` menu.
 *
 * A right-click on a row (a long press, where the browser allows it) has Mark as read and Archive, as the session's
 * own `⋯` menu does.
 */
export function SessionList({
  sessions,
  state,
  banner,
  client,
  computer,
  menu,
  selectedId,
  newOpen,
  onOpen,
  onNew,
  onHome,
  homeOpen = false,
  onHelp,
  onRefresh,
  onArchived,
  top,
  wide = false,
  onPalette,
}: {
  sessions: RemoteSessions;
  state: ConnectionState;
  banner: ReactNode;
  client: Client;
  computer: string;
  menu: MenuItem[];
  selectedId: string | null;
  newOpen: boolean;
  onOpen: (sessionId: string) => void;
  onNew: () => void;
  /** Goes to Home: the phone's own screen, or the view next to the sidebar on a wide screen. */
  onHome: () => void;
  /** Home is on screen (the wide layout): its button shows as pressed. */
  homeOpen?: boolean;
  onHelp: () => void;
  onRefresh: () => void;
  /** A session was archived from its row: leave it if it is open. */
  onArchived: (sessionId: string) => void;
  /** Above everything in the list: the offer to turn on notifications. */
  top?: ReactNode;
  /** The sidebar of the wide layout. */
  wide?: boolean;
  /** Opens the ⌘K palette (the wide layout's search). */
  onPalette?: () => void;
}) {
  const now = useNow();
  const [chosen, setChosen] = useState<ListFilter>(savedFilter);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const counts = filterCounts(sessions.sessions);
  const filter = visibleFilter(chosen, counts);
  const filtered = filterList(sessions, filter, searching ? query : '');
  // Wide, a session that waits on you is a row in Needs you rather than a card.
  const shown = wide ? { prompts: [], sessions: sessions.sessions.filter((s) => filter === 'all' || s.status === filter) } : filtered;
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
  const rowItems = (session: RemoteSession): MenuItem[] => [
    { label: 'Mark as read', disabled: !client || !session.unread, onSelect: () => void client?.call('session.markRead', { sessionId: session.id }).catch(failed) },
    {
      label: 'Archive',
      disabled: !client,
      onSelect: () =>
        void client
          ?.call('session.setFlags', { sessionId: session.id, archived: true })
          .then(() => {
            toast('Archived', { detail: session.title });
            onArchived(session.id);
          })
          .catch(failed),
    },
  ];

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
  useEffect(() => {
    if (searching) field.current?.focus();
  }, [searching]);

  const chip = (value: ListFilter, label: string, count?: number) => (
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

  const groups = groupSessions(shown.sessions, now);
  const empty = sessions.sessions.length === 0;
  const nothingMatches = !empty && cards.length === 0 && groups.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-2 bg-inherit px-4 pb-2">
        <Logo className="size-6" />
        <h1 className="flex-1 text-title font-semibold">Sessions</h1>
        <Button variant="quiet" size="md" aria-label="Home" title="Home" aria-current={homeOpen ? 'page' : undefined} onClick={onHome} className={`px-2! ${homeOpen ? 'bg-selected text-text' : ''}`} data-remote-home-button>
          <House className="size-4" aria-hidden />
        </Button>
        <ConnectionChip state={state} computer={computer} onHelp={onHelp} />
        {!wide && <MenuButton items={menu} />}
      </header>
      {wide && (
        <div className="px-3 pb-2">
          <button type="button" onClick={onPalette} className="field flex min-h-8 w-full items-center gap-2 px-2.5 text-left text-ui text-faint hover:border-faint" data-remote-palette-open>
            <Search className="size-3.5 shrink-0" aria-hidden />
            <span className="flex-1">Search or jump to…</span>
            <Kbd shortcut="mod+k" tone="cap" />
          </button>
        </div>
      )}
      <div className={`flex items-center gap-2 border-b border-border pb-2 ${wide ? 'px-3' : 'px-4'}`}>
        {searching && !wide ? (
          <label className="field flex min-h-9 flex-1 items-center gap-2 px-2.5 pointer-fine:min-h-7">
            <Search className="size-4 shrink-0 text-faint" aria-hidden />
            <input
              ref={field}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeSearch();
                }
              }}
              placeholder="Search title, project or branch"
              aria-label="Search sessions"
              enterKeyHint="search"
              data-remote-search
              className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-faint"
            />
            <button type="button" aria-label="Close search" onClick={closeSearch} className="-mr-1 rounded-md p-1 text-faint hover:text-text">
              <X className="size-4" aria-hidden />
            </button>
          </label>
        ) : (
          <>
            <div className="scroll-row flex min-w-0 flex-1 gap-1.5">
              {chip('all', 'All')}
              {counts.needsYou > 0 && chip('needs-you', 'Needs you', counts.needsYou)}
              {counts.working > 0 && chip('working', 'Working', counts.working)}
            </div>
            {!wide && (
              <Button variant="quiet" size="md" aria-label="Search sessions" onClick={() => setSearching(true)} className="-mr-2 px-2!">
                <Search className="size-4" aria-hidden />
              </Button>
            )}
          </>
        )}
      </div>
      {banner}
      <nav aria-label="Sessions" aria-busy={offline || undefined} className={`min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3 transition-opacity ${offline ? 'opacity-60' : ''}`}>
        {top}
        {offline && !empty && <p className="px-4 pt-3 text-meta text-muted">The list from before you lost the connection. Answering waits until you're back online.</p>}
        {empty && <p className="px-4 py-10 text-center text-body text-muted">{offline ? 'Waiting for your computer.' : 'No sessions yet. Start one with New session.'}</p>}
        {nothingMatches && <p className="px-4 py-10 text-center text-body text-muted">{searching && query ? 'No session matches.' : 'Nothing here right now.'}</p>}
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
                      if (result === 'gone') onRefresh();
                    }}
                  />
                </div>
              </div>
            ))}
          </section>
        )}
        {groups.map(({ group, sessions: rows }) => (
          <section key={group} aria-labelledby={`group-${group}`}>
            <SectionHeader id={`group-${group}`} label={GROUP_LABEL[group]} count={rows.length} tone={GROUP_TONE[group]} />
            <ul>
              {rows.map((session) => {
                const selected = session.id === selectedId;
                const asks = wide ? promptOf.get(session.id) : undefined;
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(session.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setRowMenu({ session, point: menuPoint(event, event.currentTarget), row: event.currentTarget });
                      }}
                      onKeyDown={(event) => {
                        // Shift+F10 or the menu key, as a right-click (not every browser sends one for them).
                        if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
                        event.preventDefault();
                        setRowMenu({ session, point: menuPoint({ clientX: 0, clientY: 0 }, event.currentTarget), row: event.currentTarget });
                      }}
                      aria-haspopup="menu"
                      aria-current={selected ? 'page' : undefined}
                      data-remote-session={session.id}
                      data-remote-nav="row"
                      data-remote-profile={session.profile?.id}
                      title={session.profile ? `Claude profile: ${session.profile.name}` : undefined}
                      className={`flex w-full items-center gap-2.5 border-l-[3px] text-left transition-colors focus-visible:-outline-offset-2 ${wide ? 'min-h-11 px-3 py-1' : 'min-h-14 px-4 py-2 pointer-fine:min-h-12'} ${session.profile ? PROFILE_RAIL[session.profile.color] : STATUS_RAIL[session.status]} ${selected ? 'bg-selected' : 'hover:bg-border/45 active:bg-selected'}`}
                    >
                      <StatusDot status={session.status} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-body ${session.unread || asks ? 'font-semibold' : ''}`}>{session.title}</span>
                        <span className="block truncate text-meta text-muted">
                          {session.projectName}
                          {asks ? <span className="text-warn"> · {promptShort(asks)}</span> : session.branch ? ` · ${session.branch}` : ''}
                        </span>
                      </span>
                      <span className={`self-start pt-0.5 text-meta tabular-nums ${session.status === 'needs-you' ? 'text-warn' : session.unread ? 'text-unread' : 'text-faint'}`}>{age(session.updatedAt, now)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
      {rowMenu && <ContextMenu label={`Session “${rowMenu.session.title}”`} items={rowItems(rowMenu.session)} point={rowMenu.point} owner={rowMenu.row} onClose={closeRowMenu} />}
      <footer className={`safe-bottom border-t border-border bg-inherit pt-2 ${wide ? 'px-3' : 'px-4'}`}>
        <div className="flex items-center gap-1">
          <Button variant="primary" onClick={onNew} aria-pressed={newOpen} disabled={offline} className="flex-1" data-remote-new>
            <Plus className="size-4" aria-hidden />
            New session
          </Button>
          {wide && <MenuButton items={menu} side="above" />}
        </div>
        {offline && <p className="pt-1 text-center text-meta text-faint">New session needs the connection.</p>}
      </footer>
    </div>
  );
}
