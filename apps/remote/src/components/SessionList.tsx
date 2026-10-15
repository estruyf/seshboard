import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus, Search, X } from 'lucide-react';
import type { RemotePrompt, RemoteSessions } from '@switchboard/protocol/remote-client';
import type { ConnectionState } from '../lib/connection.ts';
import { filterCounts, filterList, visibleFilter, type ListFilter } from '../lib/filter.ts';
import { age, GROUP_LABEL, groupSessions, type SessionGroup } from '../lib/groups.ts';
import type { Client } from './Connected.tsx';
import { ConnectionChip } from './ConnectionStatus.tsx';
import { MenuButton, type MenuItem } from './Menu.tsx';
import { NeedsYouCard } from './NeedsYouCard.tsx';
import { Button, Logo, SectionHeader, STATUS_RAIL, StatusDot } from './ui.tsx';

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
  onHelp,
  onRefresh,
  top,
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
  onHelp: () => void;
  onRefresh: () => void;
  /** Above everything in the list: the offer to turn on notifications. */
  top?: ReactNode;
}) {
  const now = useNow();
  const [chosen, setChosen] = useState<ListFilter>(savedFilter);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const counts = filterCounts(sessions.sessions);
  const filter = visibleFilter(chosen, counts);
  const shown = filterList(sessions, filter, searching ? query : '');
  const leaving = useLeaving(sessions.prompts);
  const cards = leaving.merge(shown.prompts);
  const byId = useMemo(() => new Map(sessions.sessions.map((s) => [s.id, s])), [sessions.sessions]);
  const offline = state.kind !== 'connected';

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
        <ConnectionChip state={state} computer={computer} onHelp={onHelp} />
        <MenuButton items={menu} />
      </header>
      <div className="flex items-center gap-2 border-b border-border px-4 pb-2">
        {searching ? (
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
            <Button variant="quiet" size="md" aria-label="Search sessions" onClick={() => setSearching(true)} className="-mr-2 px-2!">
              <Search className="size-4" aria-hidden />
            </Button>
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
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(session.id)}
                      aria-current={selected ? 'page' : undefined}
                      data-remote-session={session.id}
                      className={`flex min-h-14 w-full items-center gap-2.5 border-l-[3px] px-4 py-2 text-left transition-colors focus-visible:-outline-offset-2 pointer-fine:min-h-12 ${STATUS_RAIL[session.status]} ${selected ? 'bg-selected' : 'hover:bg-border/45 active:bg-selected'}`}
                    >
                      <StatusDot status={session.status} />
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-body ${session.unread ? 'font-semibold' : ''}`}>{session.title}</span>
                        <span className="block truncate text-meta text-muted">
                          {session.projectName}
                          {session.branch ? ` · ${session.branch}` : ''}
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
      <footer className="safe-bottom border-t border-border bg-inherit px-4 pt-2">
        <Button variant="primary" onClick={onNew} aria-pressed={newOpen} disabled={offline} className="w-full" data-remote-new>
          <Plus className="size-4" aria-hidden />
          New session
        </Button>
        {offline && <p className="pt-1 text-center text-meta text-faint">New session needs the connection.</p>}
      </footer>
    </div>
  );
}

/**
 * Cards that were answered fold away before they leave: they stay in the list (even once the computer dropped the
 * prompt) until their animation ends, or at once when motion is reduced.
 */
function useLeaving(current: readonly RemotePrompt[]) {
  const [leaving, setLeaving] = useState<Map<string, RemotePrompt>>(new Map());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Forget what the computer no longer lists, so the sets stay small.
  useEffect(() => {
    const open = new Set(current.map((p) => p.requestId));
    setHidden((h) => (h.size && [...h].some((id) => !open.has(id)) ? new Set([...h].filter((id) => open.has(id))) : h));
  }, [current]);
  const gone = (id: string) => {
    setLeaving((m) => {
      const next = new Map(m);
      next.delete(id);
      return next;
    });
    setHidden((h) => new Set(h).add(id));
  };
  return {
    isLeaving: (id: string) => leaving.has(id),
    leave: (prompt: RemotePrompt) => (reduced ? gone(prompt.requestId) : setLeaving((m) => new Map(m).set(prompt.requestId, prompt))),
    gone,
    merge: (shown: readonly RemotePrompt[]) => {
      const ids = new Set(shown.map((p) => p.requestId));
      return [...shown, ...[...leaving.values()].filter((p) => !ids.has(p.requestId))].filter((p) => !hidden.has(p.requestId)).sort((a, b) => a.createdAt - b.createdAt);
    },
  };
}
