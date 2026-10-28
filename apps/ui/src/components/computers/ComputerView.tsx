import { useEffect, useState } from 'react';
import { Monitor, Plus, RefreshCw } from 'lucide-react';
import type { Computer } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { SidebarToggle } from '../sidebar/SidebarToggle.tsx';
import { PaneClose } from '../split/PaneClose.tsx';
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
 * Where a view of another computer sits in the panes (`SplitPanes`): its leaf's id, whether there are several panes
 * (its header is then the handle to drag it by, with a close for the pane), whether it is the active one, and whether
 * it is at the window's top left, where the sidebar toggle is.
 */
export interface PaneProps {
  id: string;
  tiled: boolean;
  active: boolean;
  leading: boolean;
}

/** The header attributes of a view in a pane, as a local session's (`TranscriptView`). */
export function paneHeader(pane: PaneProps | undefined) {
  return { 'data-pane': pane?.tiled ? pane.id : undefined, 'data-pane-active': pane?.tiled ? pane.active : undefined };
}

/**
 * The 2px `remote` line along the top of a view of another computer (an inset shadow, so nothing moves); as the active
 * one of several panes, the accent line of the active pane comes first, over it.
 */
export function remoteLine(pane: PaneProps | undefined): string {
  return pane?.tiled && pane.active ? 'shadow-[inset_0_2px_0_var(--sb-accent),inset_0_4px_0_var(--sb-remote)]' : 'shadow-[inset_0_2px_0_var(--sb-remote)]';
}

/** The part of a header to drag a pane by, with several panes: never part of the window's drag region, which takes the mouse. */
export function paneHandle(pane: PaneProps | undefined) {
  return pane?.tiled ? { className: 'no-drag cursor-grab select-none', 'data-pane-handle': true } : { className: '', 'data-pane-handle': undefined };
}

/**
 * A paired computer's page, for when its sessions can't be in the sidebar: it has none, it is still connecting, it
 * is offline, or it has to be paired again (docs/remote-access.md, Other computers). Its chip in the sidebar's
 * Computers strip opens it then. In a pane (`pane`), it stands in for a session of it: `missing`, the session is no
 * longer listed there; `starting`, New session just started it there, and its list doesn't have it yet.
 */
export function ComputerView({ computerId, missing = false, starting = false, pane }: { computerId: string | null; missing?: boolean; starting?: boolean; pane?: PaneProps }) {
  const handle = paneHandle(pane);
  const toggle = !pane || pane.leading;
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const computer = useComputers((s) => s.status?.computers.find((c) => c.id === computerId) ?? null);
  const list = useComputers((s) => (computerId ? (s.lists.get(computerId) ?? null) : null));
  const now = useNow(computer?.state === 'offline');

  if (!computer) {
    return (
      <div className="flex h-full flex-col">
        <header className="drag flex h-13 shrink-0 items-center gap-3 border-b border-border px-6" {...paneHeader(pane)}>
          {toggle && <SidebarToggle />}
          <div className={`min-w-0 flex-1 self-stretch ${handle.className}`} data-pane-handle={handle['data-pane-handle']} />
          {pane && <PaneClose id={pane.id} tiled={pane.tiled} closeTooltip="Close and go Home" />}
        </header>
        <p className="p-6 text-ui text-muted">This computer is no longer paired.</p>
      </div>
    );
  }

  return (
    <div className="@container flex h-full min-h-0 flex-col" data-computer-view={computer.id}>
      <header className={`drag flex h-13 shrink-0 items-center gap-3 overflow-hidden border-b border-border px-6 ${remoteLine(pane)} @max-[860px]:gap-2 @max-[860px]:px-4`} {...paneHeader(pane)}>
        {toggle && <SidebarToggle />}
        <Monitor size={16} aria-hidden className="shrink-0 text-remote" />
        <div className={`min-w-0 flex-1 ${handle.className}`} data-pane-handle={handle['data-pane-handle']}>
          <h1 className="truncate text-title font-semibold">{computer.name}</h1>
          <p
            className={`truncate text-meta ${computer.state === 'connected' && !computer.problem ? 'text-muted' : 'text-caution'}`}
            data-computer-state={computer.state}
            data-computer-problem={computer.problem ? true : undefined}
            data-tooltip={computer.problem ?? undefined}
          >
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
          <Button variant="primary" className="no-drag @max-[420px]:hidden" icon={<Plus size={14} aria-hidden />} onClick={() => newSessionOn(computer.id)} data-computer-new-session>
            New session on {computer.name}
          </Button>
        )}
        {pane && <PaneClose id={pane.id} tiled={pane.tiled} closeTooltip={`Close session and go Home (it keeps running on ${computer.name})`} />}
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
