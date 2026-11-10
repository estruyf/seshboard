import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ChevronLeft, RotateCcw, Search, X } from 'lucide-react';
import { REMOTE_FEATURE_ARCHIVED, type RemoteArchivedSession } from '@seshboard/protocol/remote-client';
import { doneAgo, mergeDone, reopenLabel, searchDone, type DoneSession } from '../lib/done.ts';
import type { Client } from './Connected.tsx';
import { useNow } from './SessionList.tsx';
import { toast } from './Toasts.tsx';
import { Button, ComputerTag, RoundButton } from './ui.tsx';

/** A paired computer as the Done page needs it. `list` changes whenever its sessions do, so Done is read again. */
export interface DoneComputer {
  id: string;
  name: string;
  client: Client;
  features: readonly string[];
  list: unknown;
}

/**
 * The Done page: the sessions in Done (the sidebar's Archived) on every connected computer, most recently done first,
 * each with Reopen, which puts it back in the list (with a pipeline's sessions, as on the computer). A session in Done
 * can't be read from here: reopen it, then open it. A route of its own, as Settings is, so the back gesture returns.
 */
export function DoneView({ computers, labels, onOpen, onBack, banner }: { computers: readonly DoneComputer[]; labels: boolean; onOpen: (computer: string, sessionId: string) => void; onBack: () => void; banner: ReactNode }) {
  const now = useNow();
  const [lists, setLists] = useState<ReadonlyMap<string, readonly RemoteArchivedSession[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  /** Reopened here: gone from the page before the computer's list says so. */
  const [reopened, setReopened] = useState<ReadonlySet<string>>(new Set());
  const able = computers.filter((c) => c.client && c.features.includes(REMOTE_FEATURE_ARCHIVED));
  const older = computers.filter((c) => c.client && !c.features.includes(REMOTE_FEATURE_ARCHIVED));
  // Again whenever a computer's list changes: what was archived or reopened elsewhere shows here too.
  const changes = able.map((c) => c.list);
  useEffect(() => {
    let current = true;
    void Promise.all(able.map((c) => c.client!.call('sessions.archived', {}).then((r): [string, readonly RemoteArchivedSession[]] => [c.id, r.sessions], (): null => null))).then((results) => {
      if (!current) return;
      setLists(new Map(results.filter((r) => r !== null)));
      setLoading(false);
    });
    return () => {
      current = false;
    };
  }, [able.map((c) => c.id).join(' '), ...changes]);
  const all = useMemo(() => mergeDone([...lists].map(([computer, sessions]) => ({ computer, sessions }))).filter((s) => !reopened.has(s.key)), [lists, reopened]);
  const shown = searchDone(all, query);
  const nameOf = (computer: string) => computers.find((c) => c.id === computer)?.name || 'Your computer';

  const reopen = (session: DoneSession) => {
    const client = computers.find((c) => c.id === session.computer)?.client;
    if (!client) return;
    setReopened((keys) => new Set(keys).add(session.key));
    client.call('session.setFlags', { sessionId: session.id, archived: false }).then(
      () => toast('Reopened', { detail: session.title, action: { label: 'Open', run: () => onOpen(session.computer, session.id) } }),
      () => {
        setReopened((keys) => {
          const next = new Set(keys);
          next.delete(session.key);
          return next;
        });
        toast("That didn't reach your computer.", { tone: 'error' });
      },
    );
  };

  return (
    <div className="flex h-full flex-col bg-bg" data-remote-done>
      <header className="safe-top flex items-center gap-1 px-2 pb-2">
        <RoundButton aria-label="Back" onClick={onBack} data-remote-done-back>
          <ChevronLeft aria-hidden />
        </RoundButton>
        <h1 className="min-w-0 flex-1 truncate pl-1 text-title font-semibold">Done</h1>
      </header>
      {banner}
      <main className="safe-bottom min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto flex w-full max-w-xl flex-col gap-3 px-4 pt-2 pb-6">
          <p className="text-meta text-muted">Sessions you marked as done, and those that went quiet. Reopen one to put it back in your list.</p>
          {all.length > 0 && (
            <label className="flex min-h-11 items-center gap-2 rounded-lg border border-edge bg-card px-3 focus-within:border-accent">
              <Search className="size-4 shrink-0 text-faint" aria-hidden />
              <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search done sessions" aria-label="Search done sessions" enterKeyHint="search" className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-faint" data-remote-done-search />
              {query && (
                <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="-mr-1 rounded-md p-1 text-faint hover:text-text">
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </label>
          )}
          {shown.length > 0 ? (
            <ul className="overflow-hidden rounded-xl border border-border bg-card" data-remote-done-list>
              {shown.map((session, index) => (
                <li key={session.key} className={`flex min-h-14 items-center gap-3 py-2 pr-2 pl-3 ${index ? 'border-t border-border' : ''}`} data-remote-done-session={session.id}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body">{session.title}</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
                      {labels && <ComputerTag name={nameOf(session.computer)} />}
                      {/* When it went to Done stays whole: the branch gives way first. */}
                      <span className="flex min-w-0 whitespace-pre">
                        <span className="truncate">
                          {session.projectName}
                          {session.branch ? ` · ${session.branch}` : ''}
                        </span>
                        <span className="shrink-0"> · {doneAgo(session.archivedAt, now)}</span>
                      </span>
                    </span>
                  </span>
                  <Button variant="secondary" size="md" onClick={() => reopen(session)} className="shrink-0" data-remote-reopen={session.id}>
                    <RotateCcw className="size-4" aria-hidden />
                    {reopenLabel(session.steps)}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-8 text-center text-body text-muted" data-remote-done-empty>
              {loading && able.length ? 'Loading…' : query ? 'No done sessions match.' : able.length ? 'Nothing is done yet.' : 'No computer that can show its done sessions is connected.'}
            </p>
          )}
          {older.map((c) => (
            <p key={c.id} className="text-meta text-muted" data-remote-done-older={c.id}>
              Update Seshboard on {c.name || 'your computer'} to see its done sessions here.
            </p>
          ))}
        </div>
      </main>
    </div>
  );
}
