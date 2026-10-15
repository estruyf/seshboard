import { Monitor } from 'lucide-react';
import type { Computer } from '@switchboard/protocol/client';
import { useComputers } from '../../state/computersStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { waitingCount } from './computerSessions.ts';

const NONE: Computer[] = [];

/**
 * Under the sidebar's list, a row for each computer this app paired with: its name, whether it is connected, and how
 * many of its sessions need you. A click shows its sessions. Nothing shows without a paired computer.
 */
export function ComputersDock() {
  const computers = useComputers((s) => s.status?.computers ?? NONE);
  const lists = useComputers((s) => s.lists);
  const openId = useComputers((s) => s.openId);
  const view = useSessions((s) => s.view);
  if (!computers.length) return null;
  return (
    <div className="shrink-0 border-t border-border px-2 py-1.5" data-computers-dock>
      <p className="px-2.5 pb-1 text-meta font-medium text-faint">Other computers</p>
      {computers.map((computer) => {
        const waiting = waitingCount(lists.get(computer.id));
        const current = view === 'computer' && openId === computer.id;
        const dot = computer.state === 'connected' ? 'bg-ok' : computer.state === 'connecting' ? 'bg-faint animate-pulse' : 'bg-faint';
        const state = computer.state === 'connected' ? 'Connected' : computer.state === 'connecting' ? 'Connecting' : computer.state === 'unpaired' ? 'Pair it again' : 'Not connected';
        return (
          <button
            key={computer.id}
            type="button"
            aria-current={current ? 'page' : undefined}
            onClick={() => useComputers.getState().open(computer.id)}
            className={`flex h-7 w-full items-center gap-2 rounded-md px-2.5 text-left text-ui ${current ? 'bg-selected' : 'hover:bg-border/45'}`}
            data-tooltip={computer.message ?? state}
            data-computer-row={computer.id}
          >
            <Monitor size={13} aria-hidden className="shrink-0 text-muted" />
            <span className="min-w-0 flex-1 truncate">{computer.name}</span>
            {waiting > 0 && (
              <span className="shrink-0 text-meta font-medium text-warn tabular-nums" aria-label={`${waiting} need you`}>
                {waiting}
              </span>
            )}
            <span role="img" aria-label={state} className={`size-1.5 shrink-0 rounded-full ${dot}`} />
          </button>
        );
      })}
    </div>
  );
}
