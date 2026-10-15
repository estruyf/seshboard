import { useEffect, useState } from 'react';
import { Monitor, RefreshCw } from 'lucide-react';
import type { Computer, RemoteSessions } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { computerLine, sessionGroups } from './computerSessions.ts';
import { ComputerSession } from './ComputerSession.tsx';

/** Ticks while a computer is offline, so "Trying again in 30s" counts down. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * Another computer's sessions, through its Remote (docs/remote-access.md, Other computers): the list as its sidebar
 * groups it, and the session you open, which you follow, answer and steer from here. Claude runs on that computer.
 */
export function ComputerView() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const computer = useComputers((s) => s.status?.computers.find((c) => c.id === s.openId) ?? null);
  const list = useComputers((s) => (s.openId ? (s.lists.get(s.openId) ?? null) : null));
  const sessionId = useComputers((s) => s.sessionId);
  const now = useNow(computer?.state === 'offline');

  if (!computer) {
    return (
      <div className="flex h-full flex-col">
        <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6">
          <SidebarToggle />
        </header>
        <p className="p-6 text-ui text-muted">This computer is no longer paired.</p>
      </div>
    );
  }

  const session = list?.sessions.find((s) => s.id === sessionId) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col" data-computer-view={computer.id}>
      <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6">
        <SidebarToggle />
        <Monitor size={16} aria-hidden className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-title font-semibold">{computer.name}</h1>
          <p className={`truncate text-meta ${computer.state === 'connected' ? 'text-muted' : 'text-caution'}`} data-computer-state={computer.state}>
            {computerLine(computer, now)}
          </p>
        </div>
        {computer.state === 'offline' && client && (
          <Button className="no-drag" icon={<RefreshCw size={13} aria-hidden />} onClick={() => void client.call('computers.retry', { id: computer.id })}>
            Try again
          </Button>
        )}
        {computer.state === 'unpaired' && (
          <Button className="no-drag" onClick={() => useSessions.getState().openSettings('remote')}>
            Pair again
          </Button>
        )}
      </header>
      <div className="flex min-h-0 flex-1">
        <SessionList computer={computer} list={list} selected={sessionId} />
        {client && session ? (
          <ComputerSession key={session.id} client={client} computer={computer} session={session} prompts={list?.prompts.filter((p) => p.sessionId === session.id) ?? []} />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <p className="max-w-sm text-center text-ui text-muted">
              {list ? `Open a session to follow it here. Claude keeps running on ${computer.name}.` : computer.state === 'connected' ? 'Loading the sessions…' : `The sessions show once ${computer.name} is connected.`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionList({ computer, list, selected }: { computer: Computer; list: RemoteSessions | null; selected: string | null }) {
  const groups = sessionGroups(list);
  const asking = new Set(list?.prompts.map((p) => p.sessionId));
  return (
    <nav className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border bg-sidebar py-2" aria-label={`Sessions on ${computer.name}`} data-computer-sessions>
      {list && groups.length === 0 && <p className="px-4 py-2 text-ui text-muted">No sessions.</p>}
      {groups.map((group) => (
        <div key={group.key} className="grid">
          <p className="px-4 pt-2.5 pb-1 text-meta font-medium text-faint">{group.label}</p>
          {group.sessions.map((session) => {
            const current = session.id === selected;
            const tone = asking.has(session.id) || session.status === 'needs-you' ? 'bg-warn' : session.status === 'working' ? 'bg-accent-ink animate-pulse' : session.status === 'error' ? 'bg-error' : null;
            return (
              <button
                key={session.id}
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => useComputers.getState().selectSession(session.id)}
                className={`mx-2 grid gap-0.5 rounded-lg px-2.5 py-1.5 text-left ${current ? 'bg-selected' : 'hover:bg-border/45'}`}
                data-computer-session-row={session.id}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className={`size-2 shrink-0 rounded-full ${tone ?? ''}`} />
                  <span className={`min-w-0 flex-1 truncate text-ui ${session.unread ? 'font-semibold' : ''}`}>{session.title}</span>
                </span>
                <span className="truncate pl-4 text-meta text-muted">
                  {session.projectName}
                  {session.branch && ` · ${session.branch}`}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
