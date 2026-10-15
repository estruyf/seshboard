import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import type { RemoteSession, RemoteSessions } from '@switchboard/protocol/remote-client';
import { age, Button, StatusDot } from './ui.tsx';

/** The sidebar's groups, most urgent first (AGENTS.md, Layout). */
function groups(sessions: readonly RemoteSession[]): Array<{ title: string; tone: string; sessions: RemoteSession[] }> {
  const needsYou = sessions.filter((s) => s.status === 'needs-you');
  const working = sessions.filter((s) => s.status === 'working');
  const rest = sessions.filter((s) => s.status !== 'needs-you' && s.status !== 'working');
  return [
    { title: 'Needs you', tone: 'text-warn', sessions: needsYou },
    { title: 'Working', tone: 'text-accent-ink', sessions: working },
    { title: 'Recent', tone: 'text-faint', sessions: rest },
  ].filter((g) => g.sessions.length > 0);
}

export function SessionList({
  sessions,
  banner,
  deviceName,
  onOpen,
  onNew,
  onForget,
}: {
  sessions: RemoteSessions;
  banner: ReactNode;
  deviceName: string;
  onOpen: (sessionId: string) => void;
  onNew: () => void;
  onForget: () => void;
}) {
  const waiting = new Set(sessions.prompts.map((p) => p.sessionId));
  return (
    <div className="flex min-h-full flex-col">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-bg/95 px-4 pb-3 backdrop-blur">
        <h1 className="flex-1 text-title font-semibold">Sessions</h1>
        <Button variant="primary" onClick={onNew} className="min-h-9 px-3">
          <Plus className="size-4" aria-hidden />
          New session
        </Button>
      </header>
      {banner}
      <main className="flex-1">
        {sessions.sessions.length === 0 && <p className="px-4 py-10 text-center text-body text-muted">No sessions yet.</p>}
        {groups(sessions.sessions).map((group) => (
          <section key={group.title} aria-labelledby={`group-${group.title}`}>
            <h2 id={`group-${group.title}`} className={`px-4 pt-5 pb-1 text-meta font-semibold tracking-wide uppercase ${group.tone}`}>
              {group.title} <span className="text-faint">{group.sessions.length}</span>
            </h2>
            <ul>
              {group.sessions.map((session) => (
                <li key={session.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(session.id)}
                    className={`flex w-full items-start gap-3 border-l-[3px] px-4 py-3 text-left active:bg-selected ${session.status === 'needs-you' ? 'border-warn' : session.status === 'working' ? 'border-accent-ink' : 'border-transparent'}`}
                  >
                    <span className="mt-2">
                      <StatusDot status={session.status} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-body ${session.status === 'unread' ? 'font-semibold' : ''}`}>{session.title}</span>
                      <span className="block truncate text-meta text-muted">
                        {session.projectName}
                        {session.branch ? ` · ${session.branch}` : ''}
                        {waiting.has(session.id) ? ' · waiting for you' : ''}
                      </span>
                    </span>
                    <span className="mt-1 text-meta text-faint tabular-nums">{age(session.updatedAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
      <footer className="safe-bottom flex items-center justify-between gap-3 border-t border-border px-4 pt-3 text-meta text-faint">
        <span className="truncate">Paired as {deviceName}</span>
        <button type="button" className="min-h-9 text-muted underline-offset-2 active:underline" onClick={() => confirm('Forget this computer? You can pair again from Settings › Remote.') && onForget()}>
          Forget this computer
        </button>
      </footer>
    </div>
  );
}
