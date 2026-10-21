import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronRight, House, ListTree, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { REMOTE_FEATURE_MARK_UNREAD, REMOTE_FEATURE_PIPELINES } from '@switchboard/protocol/remote-client';
import type { ConnectionState } from '../lib/connection.ts';
import type { ListedPrompt, ListedRun, ListedSession, ListedSessions } from '../lib/everywhere.ts';
import { childLine, keepOpenTrees, listTree, openTrees, runOfRow, treeLine, type ChildTone } from '../lib/runs.ts';
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
import { Button, ComputerTag, Kbd, Logo, PROFILE_RAIL, SectionHeader, STATUS_RAIL, StatusDot } from './ui.tsx';

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
 * - `sidebar`: the wide layout's sidebar. The Home row under the title, the search opens the palette, chips for what needs you and what works,
 *   prompts are rows in Needs you (their cards are on the home view), rows are the desktop's size, and the `⋯` menu
 *   sits at the bottom next to New session.
 * - `drawer`: the sessions drawer. The Home row under the title (on every screen size: Home on a wide screen, the first
 *   screen on a phone), prompts as rows, the open session picked.
 */
export type ListMode = 'phone' | 'sidebar' | 'drawer';

/** What the list needs of a session's computer: its connection, what it takes beyond every version, and its name. */
export interface ListComputer {
  client: Client;
  features: readonly string[];
  name: string;
  /** Connected: a computer that isn't keeps its last rows, dimmed. */
  online: boolean;
}

/**
 * The sessions of every paired computer, in one list: a header with the computer chip (on a phone, the large title),
 * then the list. With more than one computer, a strip of their chips takes the chip's place, and each row says which
 * computer it runs on. New session is a bar at the bottom. Offline (or disconnected), the last list stays, greyed out,
 * and what needs the connection is off; with more than one computer, only the rows of the one that is away.
 *
 * A row's menu (a long press, a right-click, Shift+F10, or the row's own menu button for screen readers) has Mark as
 * read and Archive, as the session's own `⋯` menu does.
 */
export function SessionList({
  mode,
  sessions,
  state,
  banner,
  computerOf,
  labels = false,
  chip,
  strip,
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
  headerEnd,
  onPalette,
}: {
  mode: ListMode;
  sessions: ListedSessions;
  /** The list's connection: the computer's, or with more than one, a connected one's while there is one. */
  state: ConnectionState;
  banner: ReactNode;
  /** A session's computer, by its id. Undo after Mark as read needs a computer that can mark it unread again. */
  computerOf: (computer: string) => ListComputer;
  /** More than one computer is paired: each row and card says which it runs on. */
  labels?: boolean;
  /** The computer chip, which opens the computer's menu. */
  chip: ReactNode;
  /** With more than one computer, a chip for each, in the chip's place (on a phone, under the title). */
  strip?: ReactNode;
  /** The first screen's title on a phone: the computer's name, large or in the bar once the list scrolled. */
  title?: (size: 'large' | 'compact') => ReactNode;
  menu: MenuItem[];
  selectedId: string | null;
  newOpen: boolean;
  onOpen: (sessionId: string) => void;
  onNew: () => void;
  /**
   * The Home row under the title of the sidebar and the drawer, which shows on every screen size: Home on a wide screen, the
   * first screen on a phone.
   */
  onHome: () => void;
  /** Home is on screen: its row shows as current. */
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
  // Pipeline runs (#179): sub-sessions under their parent, closed until you open the tree; a search lists every
  // session on its own, so a step is found by its name too.
  const tree = useMemo(() => listTree(sessions.sessions, sessions.runs), [sessions.sessions, sessions.runs]);
  const [open, setOpen] = useState(openTrees);
  const toggleTree = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      keepOpenTrees(next);
      return next;
    });
  const search = drawer || searching ? query : '';
  const flat = search.trim() !== '';
  const listed = flat ? sessions.sessions : tree.roots;
  const counts = filterCounts(listed);
  // On a phone the chips only show, and only filter, while you search.
  const filter = sidebar || searching ? visibleFilter(chosen, counts) : 'all';
  // In the sidebar and the drawer, a session that waits on you is a row in Needs you rather than a card.
  const filtered = mode === 'phone' ? filterList({ sessions: listed, prompts: sessions.prompts }, filter, search) : { prompts: [] as ListedPrompt[], sessions: listed.filter((s) => (filter === 'all' || s.status === filter) && matchesSearch(s, search)) };
  // A sub-session's prompt is a card too, though its row sits in its parent's tree.
  const kidPrompts = mode === 'phone' && !flat ? filterList({ sessions: [...tree.children.values()].flat(), prompts: sessions.prompts }, filter, '').prompts : [];
  const shown = kidPrompts.length ? { ...filtered, prompts: [...filtered.prompts, ...kidPrompts].sort((a, b) => a.createdAt - b.createdAt) } : filtered;
  const leaving = useLeaving(sessions.prompts);
  const cards = leaving.merge(shown.prompts);
  const promptOf = useMemo(() => {
    const first = new Map<string, ListedPrompt>();
    for (const p of [...sessions.prompts].sort((a, b) => a.createdAt - b.createdAt)) if (!first.has(p.sessionId)) first.set(p.sessionId, p);
    return first;
  }, [sessions.prompts]);
  const byId = useMemo(() => new Map(sessions.sessions.map((s) => [s.id, s])), [sessions.sessions]);
  const offline = state.kind !== 'connected';
  const [rowMenu, setRowMenu] = useState<{ session: ListedSession; point: MenuPoint; row: HTMLElement } | null>(null);
  const closeRowMenu = useCallback(() => setRowMenu(null), []);
  const failed = () => toast("That didn't reach your computer.", { tone: 'error' });
  const clientOf = (session: ListedSession) => computerOf(session.computer).client;

  /** Mark as read, with Undo where the computer can mark it unread again. */
  const markRead = (session: ListedSession) => {
    const { client, features } = computerOf(session.computer);
    const sessionId = session.sessionId;
    void client
      ?.call('session.markRead', { sessionId })
      .then(() => toast('Marked as read', { detail: session.title, ...(features.includes(REMOTE_FEATURE_MARK_UNREAD) ? { action: { label: 'Undo', run: () => void client.call('session.markUnread', { sessionId }).catch(failed) } } : {}) }))
      .catch(failed);
  };
  /** The run a row's Archive takes along: a run row's own, or the one started from that session (its tree goes as one). */
  const treeRun = (session: ListedSession): ListedRun | null => (computerOf(session.computer).features.includes(REMOTE_FEATURE_PIPELINES) ? runOfRow(sessions.runs, session) : null);
  /** Archive, with Undo. A run's parent or run row goes with its sub-sessions, as on the computer. */
  const archive = (session: ListedSession) => {
    const client = clientOf(session);
    if (!client) return;
    const run = treeRun(session);
    const sessionId = session.sessionId;
    const flags = (archived: boolean) => (run ? client.call('runs.archive', { runId: run.run.id, archived }) : client.call('session.setFlags', { sessionId, archived }));
    void flags(true)
      .then(() => {
        toast(`Archived ${session.title}`, { action: { label: 'Undo', run: () => void flags(false).catch(failed) } });
        onArchived(session.id);
      })
      // A run that still goes on can't be archived: its own words say so ("Stop it first").
      .catch((error: Error) => (run && (error as { code?: string }).code !== 'DISCONNECTED' ? toast(error.message, { tone: 'error' }) : failed()));
  };
  const archiveLabel = (session: ListedSession) => {
    const steps = tree.children.get(session.id)?.length ?? 0;
    return treeRun(session) && steps ? `Archive with ${steps === 1 ? 'its step' : `its ${steps} steps`}` : 'Archive';
  };
  const rowItems = (session: ListedSession): MenuItem[] => [
    ...(session.runRow ? [] : [{ label: 'Mark as read', disabled: !clientOf(session) || !session.unread, onSelect: () => markRead(session) }]),
    { label: archiveLabel(session), disabled: !clientOf(session), onSelect: () => archive(session) },
  ];
  const onSwipe = (session: ListedSession) => (action: SwipeAction) => (action === 'read' ? markRead(session) : archive(session));
  /** What the line under the title counts: not what a computer that is away said last. */
  const live = labels ? tree.roots.filter((s) => computerOf(s.computer).online) : tree.roots;
  /** A row or card of a computer that is away, while another is connected: dimmed. */
  const isAway = (computer: string) => !offline && !computerOf(computer).online;
  /** The name on a row or a card, with more than one computer. */
  const tagOf = (computer: string) => (labels ? computerOf(computer).name || 'Your computer' : undefined);

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
      line={
        strip ? (
          <div className="scroll-row -mx-4 flex min-w-0 items-center gap-1.5 px-4 pt-0.5" data-remote-computers>
            {strip}
            <span className="shrink-0 text-meta text-muted">{shortHeadline(live, now)}</span>
          </div>
        ) : (
          <ConnectionLine state={state} detail={shortHeadline(live, now)} />
        )
      }
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
  const needsYouRows = groups.find((g) => g.group === 'needs-you')?.sessions.length ?? 0;
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
          <SectionHeader id="group-prompts" label={GROUP_LABEL['needs-you']} count={cards.length + needsYouRows} tone="text-warn" className="px-1" />
          {cards.map((prompt) => (
            <div key={prompt.requestId} className={`collapse-out mb-2 ${isAway(prompt.computer) ? 'opacity-60' : ''}`} data-remote-away={isAway(prompt.computer) || undefined} data-leaving={leaving.isLeaving(prompt.requestId) || undefined} onTransitionEnd={(event) => event.propertyName === 'grid-template-rows' && leaving.gone(prompt.requestId)}>
              <div>
                <NeedsYouCard
                  prompt={prompt}
                  session={byId.get(prompt.sessionId)}
                  client={computerOf(prompt.computer).client}
                  computer={tagOf(prompt.computer)}
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
        // Under the cards, what needs you without a prompt (a run waiting at Push) goes on in their section.
        <section key={group} aria-labelledby={group === 'needs-you' && cards.length ? 'group-prompts' : `${mode}-group-${group}`}>
          {!(group === 'needs-you' && cards.length) && <SectionHeader id={`${mode}-group-${group}`} label={GROUP_LABEL[group]} count={rows.length} tone={GROUP_TONE[group]} />}
          <ul>
            {rows.map((session) => {
              const away = isAway(session.computer);
              const kids = flat ? [] : (tree.children.get(session.id) ?? []);
              // A step that is open stays in view under its parent.
              const isOpen = kids.length > 0 && (open.has(session.id) || kids.some((kid) => kid.id === selectedId));
              const size = mode === 'phone' ? 'phone' : 'compact';
              const row = (
                <SessionRow
                  session={session}
                  computer={tagOf(session.computer)}
                  size={size}
                  selected={session.id === selectedId}
                  asks={mode === 'phone' ? undefined : promptOf.get(session.id)}
                  detail={flat ? null : treeLine(session, runOfRow(sessions.runs, session), kids, sessions.prompts)}
                  tree={kids.length ? { open: isOpen, count: kids.length, onToggle: () => toggleTree(session.id) } : undefined}
                  now={now}
                  onOpen={() => onOpen(session.id)}
                  onMenu={(point, element) => setRowMenu({ session, point, row: element })}
                />
              );
              return (
                <li key={session.id} className={away ? 'opacity-60' : undefined} data-remote-away={away || undefined}>
                  {/* A session that waits on you never swipes away: a prompt can't be dismissed by accident. */}
                  {mode === 'phone' && session.status !== 'needs-you' ? (
                    <SwipeRow allowed={{ read: Boolean(clientOf(session)) && session.unread, archive: Boolean(clientOf(session)) }} onAction={onSwipe(session)}>
                      {row}
                    </SwipeRow>
                  ) : (
                    row
                  )}
                  {isOpen && (
                    <ul aria-label={`Steps of ${session.title}`} data-remote-tree={session.sessionId}>
                      {kids.map((kid) => (
                        <li key={kid.id}>
                          <ChildRow session={kid} runs={sessions.runs} size={size} selected={kid.id === selectedId} now={now} onOpen={() => onOpen(kid.id)} onMenu={(point, element) => setRowMenu({ session: kid, point, row: element })} />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );

  // Home is the first row under the title, in the sidebar and the drawer alike, above the computers and the search.
  const homeButton = (
    <button
      type="button"
      onClick={onHome}
      aria-current={homeOpen ? 'page' : undefined}
      className={`mx-2 flex items-center gap-2.5 rounded-lg px-2 text-left transition-colors ${drawer ? 'min-h-11' : 'min-h-8'} ${homeOpen ? 'bg-selected' : 'hover:bg-border/45 active:bg-selected'}`}
      data-remote-home-row
    >
      <House className="size-4 shrink-0 text-muted" aria-hidden />
      <span className={drawer ? 'text-body' : 'text-ui'}>Home</span>
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      {mode !== 'phone' && (
        <header className={`sticky top-0 z-10 flex items-center gap-2 bg-inherit pb-2 ${drawer ? 'px-3 pt-[max(0.75rem,env(safe-area-inset-top))]' : 'safe-top px-4'}`}>
          <Logo className="size-6" />
          <h1 className="min-w-0 flex-1 truncate text-title font-semibold">Sessions</h1>
          {chip}
          {headerEnd}
        </header>
      )}
      {(sidebar || (drawer && !query)) && <div className="pb-2">{homeButton}</div>}
      {mode !== 'phone' && strip && (
        <div className="scroll-row flex gap-1.5 px-3 pb-2" data-remote-computers>
          {strip}
        </div>
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
          <div className="border-b border-border" />
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
function SessionRow({
  session,
  computer,
  size,
  selected,
  asks,
  detail = null,
  tree,
  now,
  onOpen,
  onMenu,
}: {
  session: ListedSession;
  /** The computer's name, with more than one. */
  computer: string | undefined;
  size: 'phone' | 'compact';
  selected: boolean;
  asks: ListedPrompt | undefined;
  /** A run's parent or run row: where the run is, or why it needs you, in the project's place (`treeLine`). */
  detail?: string | null;
  /** A parent with sub-sessions: its tree's disclosure. */
  tree?: { open: boolean; count: number; onToggle: () => void } | undefined;
  now: number;
  onOpen: () => void;
  onMenu: (point: MenuPoint, row: HTMLElement) => void;
}) {
  const press = useLongPress(onMenu);
  const profile = session.profile;
  const needsYou = detail?.startsWith('Needs you');
  return (
    <div className="group relative">
      <button
        type="button"
        {...press.handlers(onOpen)}
        aria-current={selected ? 'page' : undefined}
        data-remote-session={session.sessionId}
        data-remote-session-computer={session.computer}
        data-remote-run-row={session.runRow || undefined}
        data-remote-nav="row"
        data-remote-profile={profile?.id}
        className={`flex w-full items-center gap-2.5 border-l-[3px] text-left transition-colors select-none [-webkit-touch-callout:none] focus-visible:-outline-offset-2 ${size === 'compact' ? 'min-h-11 px-3 py-1' : 'min-h-14 px-4 py-2 pointer-fine:min-h-12'} ${tree ? (size === 'compact' ? 'pr-9' : 'pr-12 pointer-fine:pr-10') : ''} ${profile ? PROFILE_RAIL[profile.color] : STATUS_RAIL[session.status]} ${selected ? 'bg-selected' : 'hover:bg-border/45 active:bg-selected'}`}
      >
        <StatusDot status={session.status} />
        <span className="min-w-0 flex-1">
          <span className={`flex min-w-0 items-center gap-1.5 text-body ${session.unread || asks ? 'font-semibold' : ''}`}>
            {session.runRow && <ListTree className="size-3.5 shrink-0 text-pipeline" aria-label="Pipeline run" role="img" />}
            <span className="truncate">{session.title}</span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
            {computer && <ComputerTag name={computer} />}
            {profile && <span aria-label={`Claude profile: ${profile.name}`} role="img" className={`size-1.5 shrink-0 rounded-full ${PROFILE_DOT[profile.color]}`} />}
            {detail ? (
              <span className={`truncate ${needsYou ? 'text-warn' : ''}`} data-remote-tree-line>
                {detail}
              </span>
            ) : (
              <span className="truncate">
                {session.projectName}
                {asks ? <span className="text-warn"> · {promptShort(asks)}</span> : session.branch ? ` · ${session.branch}` : ''}
              </span>
            )}
          </span>
        </span>
        <span className={`self-start pt-0.5 text-meta tabular-nums ${session.status === 'needs-you' ? 'text-warn' : session.unread ? 'text-unread' : 'text-faint'}`}>{age(session.updatedAt, now)}</span>
      </button>
      {tree && (
        <button
          type="button"
          onClick={tree.onToggle}
          aria-expanded={tree.open}
          aria-label={`${tree.open ? 'Hide' : 'Show'} the ${tree.count === 1 ? 'step' : `${tree.count} steps`} of ${session.title}`}
          className={`absolute top-1/2 right-0 flex -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-border/50 hover:text-text active:bg-selected ${size === 'compact' ? 'size-9' : 'size-11 pointer-fine:size-9'}`}
          data-remote-tree-toggle={session.sessionId}
        >
          <ChevronRight className={`size-4 transition-transform ${tree.open ? 'rotate-90' : ''}`} aria-hidden />
        </button>
      )}
      <RowMenuButton title={session.title} onMenu={onMenu} className={tree ? (size === 'compact' ? 'right-9' : 'right-12') : 'right-2'} />
    </div>
  );
}

/** A sub-session's dot, as in the sidebar's tree: a step the run finished is done (green), even before you read it. */
const CHILD_DOT: Record<ChildTone, string> = { 'needs-you': 'bg-warn pulse-dot', working: 'bg-accent-ink pulse-dot', done: 'bg-ok', failed: 'bg-error', unread: 'bg-unread', idle: 'bg-faint' };
const CHILD_WORD: Record<ChildTone, string> = { 'needs-you': 'Needs you', working: 'Working', done: 'Done', failed: 'Failed', unread: 'Finished', idle: 'Idle' };

/**
 * A step's sub-session under its parent: indented, its step's state as the dot, and what it did on the second line
 * ("Opus · plan approved"). It opens and has the menu of any row.
 */
function ChildRow({ session, runs, size, selected, now, onOpen, onMenu }: { session: ListedSession; runs: readonly ListedRun[]; size: 'phone' | 'compact'; selected: boolean; now: number; onOpen: () => void; onMenu: (point: MenuPoint, row: HTMLElement) => void }) {
  const press = useLongPress(onMenu);
  const { tone, line } = childLine(runs, session);
  return (
    <div className="group relative">
      <button
        type="button"
        {...press.handlers(onOpen)}
        aria-current={selected ? 'page' : undefined}
        data-remote-session={session.sessionId}
        data-remote-session-computer={session.computer}
        data-remote-step-tone={tone}
        data-remote-nav="row"
        className={`flex w-full items-center gap-2.5 border-l-[3px] border-transparent text-left transition-colors select-none [-webkit-touch-callout:none] focus-visible:-outline-offset-2 ${size === 'compact' ? 'min-h-10 py-1 pr-3 pl-8' : 'min-h-12 py-1.5 pr-4 pl-10 pointer-fine:min-h-10'} ${selected ? 'bg-selected' : 'hover:bg-border/45 active:bg-selected'}`}
      >
        <span role="img" aria-label={CHILD_WORD[tone]} className={`inline-block size-1.5 shrink-0 rounded-full ${CHILD_DOT[tone]}`} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-ui ${session.unread || tone === 'needs-you' ? 'font-semibold' : ''}`}>{session.title}</span>
          {line && <span className={`block truncate text-meta ${tone === 'needs-you' ? 'text-warn' : tone === 'failed' ? 'text-error' : 'text-muted'}`}>{line}</span>}
        </span>
        <span className={`self-start pt-0.5 text-meta tabular-nums ${tone === 'needs-you' ? 'text-warn' : 'text-faint'}`}>{age(session.updatedAt, now)}</span>
      </button>
      <RowMenuButton title={session.title} onMenu={onMenu} className="right-2" />
    </div>
  );
}

/** A row's menu button: only shown while it has keyboard focus (it is there for screen readers and the keyboard). */
function RowMenuButton({ title, onMenu, className }: { title: string; onMenu: (point: MenuPoint, row: HTMLElement) => void; className: string }) {
  return (
    <button
      type="button"
      aria-label={`Actions for ${title}`}
      aria-haspopup="menu"
      onClick={(event) => {
        const row = (event.currentTarget.parentElement?.firstElementChild as HTMLElement | null) ?? event.currentTarget;
        onMenu(menuPoint({ clientX: 0, clientY: 0 }, row), row);
      }}
      className={`absolute top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md bg-card text-muted opacity-0 focus-visible:opacity-100 ${className}`}
      data-remote-row-menu
    >
      <MoreHorizontal className="size-4" aria-hidden />
    </button>
  );
}

/**
 * A row's long press, right-click and Shift+F10 open its menu; a click opens the row, except the click a long press
 * ends with.
 */
function useLongPress(onMenu: (point: MenuPoint, row: HTMLElement) => void) {
  const press = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null);
  const pressed = useRef(false);
  const cancelPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(() => cancelPress, []);
  return {
    handlers: (onOpen: () => void) => ({
      onClick: (event: MouseEvent<HTMLButtonElement>) => {
        // The click a long press ends with only opened the menu.
        if (pressed.current) {
          pressed.current = false;
          event.preventDefault();
          return;
        }
        onOpen();
      },
      onContextMenu: (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        cancelPress();
        onMenu(menuPoint(event, event.currentTarget), event.currentTarget);
      },
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
        pressed.current = false;
        if (event.pointerType !== 'touch') return;
        const row = event.currentTarget;
        const timer = setTimeout(() => {
          press.current = null;
          pressed.current = true;
          onMenu(menuPoint({ clientX: 0, clientY: 0 }, row), row);
        }, LONG_PRESS_MS);
        press.current = { timer, x: event.clientX, y: event.clientY };
      },
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
        const p = press.current;
        if (p && Math.max(Math.abs(event.clientX - p.x), Math.abs(event.clientY - p.y)) >= SLOP) cancelPress();
      },
      onPointerUp: cancelPress,
      onPointerCancel: cancelPress,
      onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => {
        // Shift+F10 or the menu key, as a right-click (not every browser sends one for them).
        if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return;
        event.preventDefault();
        onMenu(menuPoint({ clientX: 0, clientY: 0 }, event.currentTarget), event.currentTarget);
      },
    }),
  };
}
