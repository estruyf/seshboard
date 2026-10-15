import { useEffect, useState } from 'react';
import { Monitor, Plus, RefreshCw } from 'lucide-react';
import type { Computer } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { Button } from '../ui/Button.tsx';
import { computerLine } from './computerSessions.ts';
import { newSessionOn } from './remoteActions.ts';

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
 * A paired computer's page, for when its sessions can't be in the sidebar: it has none, it is still connecting, it
 * is offline, or it has to be paired again (docs/remote-access.md, Other computers). Its chip in the sidebar's
 * Computers strip opens it then. `missing`: the remote session that was open is no longer listed there; `starting`: New
 * session just started it there, and its list doesn't have it yet.
 */
export function ComputerView({ computerId, missing = false, starting = false }: { computerId: string | null; missing?: boolean; starting?: boolean }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const computer = useComputers((s) => s.status?.computers.find((c) => c.id === computerId) ?? null);
  const list = useComputers((s) => (computerId ? (s.lists.get(computerId) ?? null) : null));
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

  return (
    <div className="flex h-full min-h-0 flex-col" data-computer-view={computer.id}>
      <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6 shadow-[inset_0_2px_0_var(--sb-remote)]">
        <SidebarToggle />
        <Monitor size={16} aria-hidden className="shrink-0 text-remote" />
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
        {computer.state === 'connected' && (
          <Button variant="primary" className="no-drag" icon={<Plus size={14} aria-hidden />} onClick={() => newSessionOn(computer.id)} data-computer-new-session>
            New session on {computer.name}
          </Button>
        )}
      </header>
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="max-w-sm text-center text-ui text-muted" data-computer-empty>
          {starting ? `Starting the session on ${computer.name}…` : emptyLine(computer, list !== null && list.sessions.length > 0, missing)}
        </p>
      </div>
    </div>
  );
}

function emptyLine(computer: Computer, hasSessions: boolean, missing: boolean): string {
  if (missing) return `This session is no longer listed on ${computer.name}. It may be archived there.`;
  if (computer.state === 'unpaired') return `${computer.name} no longer knows this computer. Pair it again in Settings › Remote.`;
  if (computer.state !== 'connected') return `Its sessions show in the sidebar once ${computer.name} is connected.`;
  if (hasSessions) return `Its sessions are in the sidebar, marked with ${computer.name}. Claude keeps running there.`;
  return `No sessions on ${computer.name} yet. Start one here, and Claude runs there.`;
}
