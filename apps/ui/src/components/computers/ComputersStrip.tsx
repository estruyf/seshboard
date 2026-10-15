import { Monitor } from 'lucide-react';
import type { Computer } from '@switchboard/protocol/client';
import { thisComputerName } from '../../lib/platform.ts';
import { useComputers } from '../../state/computersStore.ts';
import { offlineLine, showsOnly, THIS_COMPUTER, toggleOnly } from '../../state/remoteRows.ts';
import { useSources } from '../../state/useRemoteRows.ts';
import { waitingCount } from './computerSessions.ts';

const NONE: Computer[] = [];

/** The status dot of a computer: `ok` connected, `faint` pulsing while connecting, `faint` otherwise. */
const DOT: Record<Computer['state'], string> = { connected: 'bg-ok', connecting: 'bg-faint animate-pulse', offline: 'bg-faint', unpaired: 'bg-faint' };
const STATE: Record<Computer['state'], string> = { connected: 'Connected', connecting: 'Connecting', offline: 'Offline', unpaired: 'Pair it again' };

/**
 * The sidebar's Computers strip (docs/remote-access.md, Other computers): a chip for this computer, then one per paired
 * computer with its status dot and, in `warn`, how many of its sessions need you. A chip shows only that computer's
 * sessions, and again everything when it already did; the choice is kept per window. A computer whose sessions can't
 * be listed (none yet, offline before its first list, or to pair again) opens its page instead. Only shows with a
 * paired computer.
 */
export function ComputersStrip({ localWaiting }: { localWaiting: number }) {
  const computers = useComputers((s) => s.status?.computers ?? NONE);
  const lists = useComputers((s) => s.lists);
  const hidden = useComputers((s) => s.hidden);
  const sources = useSources();
  if (!computers.length) return null;

  const toggle = (source: string) => useComputers.getState().setHidden(toggleOnly(sources, hidden, source));
  const chip = (source: string, label: string, opts: { dot?: string; waiting: number; remote: boolean; offline?: boolean; tooltip: string; onClick(): void }) => {
    const only = showsOnly(sources, hidden, source);
    const off = hidden.has(source);
    return (
      <button
        key={source}
        type="button"
        aria-pressed={only}
        onClick={opts.onClick}
        data-tooltip={opts.tooltip}
        data-computer-filter={source}
        data-hidden={off || undefined}
        className={`flex h-6 min-w-0 shrink items-center gap-1.5 rounded-md px-2 text-ui transition-colors ${
          opts.remote ? (opts.offline ? 'text-faint hover:bg-border/45' : 'bg-remote/13 text-remote hover:bg-remote/20') : 'bg-border/45 text-text hover:bg-border/70'
        } ${only ? 'ring-1 ring-current/40 ring-inset' : ''} ${off ? 'opacity-45' : ''}`}
      >
        {opts.dot ? <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${opts.dot}`} /> : <Monitor size={12} aria-hidden className="shrink-0" />}
        <span className="min-w-0 truncate">{label}</span>
        {opts.waiting > 0 && (
          <span className="shrink-0 text-meta font-semibold text-warn tabular-nums" aria-label={`${opts.waiting} need you`}>
            {opts.waiting}
          </span>
        )}
      </button>
    );
  };

  const here = thisComputerName();
  return (
    <div className="shrink-0 border-t border-border px-3 pt-1.5 pb-2" data-computers-strip>
      <p className="px-0.5 pb-1 text-meta font-medium text-faint">Computers</p>
      <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Show sessions from">
        {chip(THIS_COMPUTER, here, {
          waiting: localWaiting,
          remote: false,
          tooltip: showsOnly(sources, hidden, THIS_COMPUTER) ? 'Show every computer' : `Show only ${here}`,
          onClick: () => toggle(THIS_COMPUTER),
        })}
        {computers.map((computer) => {
          const list = lists.get(computer.id);
          // Nothing to filter to: its page says why, and offers to pair again or start there.
          const page = computer.state === 'unpaired' || !list || list.sessions.length === 0;
          const only = showsOnly(sources, hidden, computer.id);
          const tooltip =
            computer.state === 'offline'
              ? offlineLine(computer.name, computer.lastSeen)
              : page
                ? `${computer.name}: ${computer.message ?? STATE[computer.state]}`
                : only
                  ? 'Show every computer'
                  : `Show only ${computer.name}`;
          return chip(computer.id, computer.name, {
            dot: DOT[computer.state],
            waiting: waitingCount(list),
            remote: true,
            offline: computer.state !== 'connected',
            tooltip,
            onClick: () => (page ? useComputers.getState().openPage(computer.id) : toggle(computer.id)),
          });
        })}
      </div>
    </div>
  );
}
