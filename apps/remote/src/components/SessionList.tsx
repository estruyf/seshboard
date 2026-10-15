import { useEffect, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { RemoteSessions } from '@switchboard/protocol/remote-client';
import { age, GROUP_LABEL, groupSessions, type SessionGroup } from '../lib/groups.ts';
import { Button, Logo, SectionHeader, STATUS_RAIL, StatusDot } from './ui.tsx';

const GROUP_TONE: Record<SessionGroup, string> = {
  'needs-you': 'text-warn',
  working: 'text-accent-ink',
  today: 'text-faint',
  yesterday: 'text-faint',
  earlier: 'text-faint',
};

/** Re-renders every minute, so ages and Today/Yesterday stay right on a page left open. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The sessions, grouped as the sidebar on the computer groups them: what needs you, what works, then by day. Each row
 * has the sidebar's status rail; the open one is selected.
 */
export function SessionList({
  sessions,
  banner,
  deviceName,
  selectedId,
  newOpen,
  onOpen,
  onNew,
  onForget,
}: {
  sessions: RemoteSessions;
  banner: ReactNode;
  deviceName: string;
  selectedId: string | null;
  newOpen: boolean;
  onOpen: (sessionId: string) => void;
  onNew: () => void;
  onForget: () => void;
}) {
  const now = useNow();
  const waiting = new Set(sessions.prompts.map((p) => p.sessionId));
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-inherit px-4 pb-3 pointer-fine:pb-2.5">
        <Logo className="size-6" />
        <h1 className="flex-1 text-title font-semibold">Sessions</h1>
        <Button variant="primary" size="md" onClick={onNew} aria-pressed={newOpen} data-remote-new>
          <Plus className="size-4" aria-hidden />
          New session
        </Button>
      </header>
      {banner}
      <nav aria-label="Sessions" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-2">
        {sessions.sessions.length === 0 && <p className="px-4 py-10 text-center text-body text-muted">No sessions yet. Start one with New session.</p>}
        {groupSessions(sessions.sessions, now).map(({ group, sessions: rows }) => (
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
                      className={`flex w-full items-start gap-2.5 border-l-[3px] px-4 py-2.5 text-left pointer-fine:py-2 ${STATUS_RAIL[session.status]} ${selected ? 'bg-selected' : 'hover:bg-border/45 active:bg-selected'}`}
                    >
                      <span className="mt-[7px] pointer-fine:mt-[6px]">
                        <StatusDot status={session.status} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-body ${session.status === 'unread' ? 'font-semibold' : ''}`}>{session.title}</span>
                        <span className="block truncate text-meta text-muted">
                          {session.projectName}
                          {session.branch ? ` · ${session.branch}` : ''}
                          {waiting.has(session.id) && <span className="text-warn"> · waiting for you</span>}
                        </span>
                      </span>
                      <span className={`mt-0.5 text-meta tabular-nums ${session.status === 'needs-you' ? 'text-warn' : 'text-faint'}`}>{age(session.updatedAt, now)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>
      <footer className="safe-bottom flex items-center justify-between gap-3 border-t border-border px-4 pt-2 text-meta text-faint">
        <span className="truncate">Paired as {deviceName}</span>
        <Button variant="quiet" size="md" className="-mr-2" onClick={() => confirm('Forget this computer? You can pair again from Settings › Remote.') && onForget()}>
          Forget this computer
        </Button>
      </footer>
    </div>
  );
}
