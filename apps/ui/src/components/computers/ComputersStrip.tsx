import { Bell, ChevronDown, ChevronRight, Monitor, User, Users } from 'lucide-react';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { Computer, ComputerNotify } from '@seshboard/protocol/client';
import { thisComputerName } from '../../lib/platform.ts';
import { useComputers } from '../../state/computersStore.ts';
import { offlineLine, scopeOf, showsOnly, shownList, THIS_COMPUTER, toggleOnly, type ComputerScope } from '../../state/remoteRows.ts';
import { useRemoteRowSplit, useSources } from '../../state/useRemoteRows.ts';
import { Popover } from '../ui/Popover.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { computerTint } from './computerColor.ts';
import { waitingCount } from './computerSessions.ts';

const NONE: Computer[] = [];

/** The status dot of a computer: `ok` connected (`caution` when it sent what this version can't read), `faint` pulsing while connecting, `faint` otherwise. */
const DOT: Record<Computer['state'], string> = { connected: 'bg-ok', connecting: 'bg-faint animate-pulse', offline: 'bg-faint', unpaired: 'bg-faint' };
const STATE: Record<Computer['state'], string> = { connected: 'Connected', connecting: 'Connecting', offline: 'Offline', unpaired: 'Pair it again' };
const SCOPE_LABEL: Record<ComputerScope, string> = { mine: 'Mine', all: 'All' };
/** The notifications choice, as Settings › Remote names it. */
const NOTIFY_LABEL: Record<ComputerNotify, string> = { all: 'All', 'started-here': 'Only mine', 'needs-you': 'Needs you', off: 'Off' };
const ScopeIcon = ({ scope, size }: { scope: ComputerScope; size: number }) => (scope === 'mine' ? <User size={size} aria-hidden className="shrink-0" /> : <Users size={size} aria-hidden className="shrink-0" />);

/**
 * The sidebar's Computers strip (docs/remote-access.md, Other computers): a chip for this computer, then one per paired
 * computer with its status dot and, in `warn`, how many of its sessions need you. A chip shows only that computer's
 * sessions, and again everything when it already did; the choice is kept per window. A computer whose sessions can't
 * be listed (none yet, offline before its first list, or to pair again) opens its page instead. Only shows with a
 * paired computer. `joined`: Connected to this Mac is right above it, so the two read as one block without a line between.
 * A paired computer's chip has a second part, its Mine / All filter (others use that computer too): it opens a menu
 * to switch, which also says what Mine means and how many sessions it hides, and leads to its notifications.
 */
export function ComputersStrip({ localWaiting, joined = false }: { localWaiting: number; joined?: boolean }) {
  const computers = useComputers((s) => s.status?.computers ?? NONE);
  const lists = useComputers((s) => s.lists);
  const hidden = useComputers((s) => s.hidden);
  const scopes = useComputers((s) => s.scopes);
  const sources = useSources();
  const others = useRemoteRowSplit().hidden;
  const [menu, setMenu] = useState<{ computerId: string; x: number; y: number } | null>(null);
  const scopeButtons = useRef(new Map<string, HTMLButtonElement | null>());
  if (!computers.length) return null;

  const toggle = (source: string) => useComputers.getState().setHidden(toggleOnly(sources, hidden, source));
  const chip = (source: string, label: string, opts: { dot?: string; waiting: number; remote: boolean; offline?: boolean; tint?: CSSProperties; tooltip: string; onClick(): void; scope?: ReactNode }) => {
    const only = showsOnly(sources, hidden, source);
    const off = hidden.has(source);
    const look = opts.remote ? (opts.offline ? 'text-faint hover:bg-border/45' : 'bg-remote/13 text-remote hover:bg-remote/20') : 'bg-border/45 text-text hover:bg-border/70';
    const name = (
      <button
        key={source}
        type="button"
        aria-pressed={only}
        onClick={opts.onClick}
        data-tooltip={opts.tooltip}
        data-computer-filter={source}
        data-hidden={off || undefined}
        style={opts.tint}
        className={`flex h-6 min-w-0 shrink items-center gap-1.5 rounded-md px-2 text-ui transition-colors ${opts.scope ? 'rounded-r-none pr-1.5' : `${look} ${only ? 'ring-1 ring-current/40 ring-inset' : ''}`} ${off ? 'opacity-45' : ''}`}
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
    if (!opts.scope) return name;
    // One chip in two parts: the name (show only this computer) and, after a thin line, its Mine / All filter.
    return (
      <span key={source} style={opts.tint} className={`flex h-6 min-w-0 shrink items-center rounded-md transition-colors ${look} ${only ? 'ring-1 ring-current/40 ring-inset' : ''}`} data-computer-chip-of={source}>
        {name}
        {opts.scope}
      </span>
    );
  };

  const openMenu = (computerId: string) => {
    const rect = scopeButtons.current.get(computerId)?.getBoundingClientRect();
    if (!rect) return;
    setMenu((open) => (open?.computerId === computerId ? null : { computerId, x: rect.left, y: rect.top - 6 }));
  };

  const here = thisComputerName();
  return (
    <div className={`shrink-0 px-3 pb-2 ${joined ? 'pt-0.5' : 'pt-1.5'}`} data-computers-strip>
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
              : computer.problem
                ? computer.problem
                : page
                ? `${computer.name}: ${computer.message ?? STATE[computer.state]}`
                : only
                  ? 'Show every computer'
                  : `Show only ${computer.name}`;
          const scope = scopeOf(scopes, computer.id);
          return chip(computer.id, computer.name, {
            dot: computer.state === 'connected' && computer.problem ? 'bg-caution' : DOT[computer.state],
            // What needs you among what it shows, so the number matches the list.
            waiting: waitingCount(list && shownList(list, computer, scope)),
            remote: true,
            offline: computer.state !== 'connected',
            tint: computerTint(computer.color),
            tooltip,
            onClick: () => (page ? useComputers.getState().openPage(computer.id) : toggle(computer.id)),
            scope: (
              <button
                ref={(el) => void scopeButtons.current.set(computer.id, el)}
                type="button"
                aria-label={`Sessions from ${computer.name}: ${SCOPE_LABEL[scope]}. Change`}
                aria-haspopup="dialog"
                aria-expanded={menu?.computerId === computer.id}
                data-tooltip={scope === 'mine' ? `Only your sessions on ${computer.name}` : `Everyone’s sessions on ${computer.name}`}
                onClick={() => openMenu(computer.id)}
                data-computer-scope={scope}
                className="flex h-6 shrink-0 items-center gap-0.5 rounded-r-md pr-1.5 text-meta"
              >
                {/* The thin line between the two parts, in the computer's colour. */}
                <span aria-hidden className="mr-1 h-3.5 w-px bg-current opacity-35" />
                <ScopeIcon scope={scope} size={11} />
                <span>{SCOPE_LABEL[scope]}</span>
                <ChevronDown size={11} aria-hidden className="shrink-0 opacity-80" />
              </button>
            ),
          });
        })}
      </div>
      {menu &&
        (() => {
          const computer = computers.find((c) => c.id === menu.computerId);
          if (!computer) return null;
          // Counted as the "+N from others" rows count them: a sub-session goes with its parent.
          const theirs = others.filter((row) => row.remote?.computerId === computer.id);
          const ids = new Set(theirs.map((row) => row.id));
          const count = theirs.filter((row) => !row.remote?.parentRowId || !ids.has(row.remote.parentRowId)).length;
          return (
            <ScopeMenu
              computer={computer}
              scope={scopeOf(scopes, computer.id)}
              hiddenCount={count}
              x={menu.x}
              y={menu.y}
              anchor={{ current: scopeButtons.current.get(computer.id) ?? null }}
              onClose={() => setMenu(null)}
              onOnly={() => {
                setMenu(null);
                if (!showsOnly(sources, hidden, computer.id)) useComputers.getState().setHidden(toggleOnly(sources, hidden, computer.id));
              }}
            />
          );
        })()}
    </div>
  );
}

/**
 * A paired computer's chip menu: its name and state, Sessions in the sidebar (Mine or All, kept per computer), what Mine
 * means and how many it hides, then its notifications (they open Settings › Remote at it) and Show only its sessions.
 */
function ScopeMenu({
  computer,
  scope,
  hiddenCount,
  x,
  y,
  anchor,
  onClose,
  onOnly,
}: {
  computer: Computer;
  scope: ComputerScope;
  hiddenCount: number;
  x: number;
  y: number;
  anchor: { current: HTMLElement | null };
  onClose(): void;
  onOnly(): void;
}) {
  const here = thisComputerName().replace(/^This /, 'this ');
  const hiddenLine = hiddenCount === 0 ? '' : hiddenCount === 1 ? ' 1 other is hidden.' : ` ${hiddenCount} others are hidden.`;
  return (
    <Popover x={x} y={y} above width={272} onClose={onClose} anchor={anchor} role="dialog" aria-label={`Sessions from ${computer.name}`} data-computer-scope-menu={computer.id}>
      <div className="grid gap-0.5 px-2 py-1">
      <div className="flex min-w-0 items-center gap-2 px-1 pb-2 pt-0.5">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${DOT[computer.state]}`} />
        <span className="min-w-0 truncate text-ui font-semibold text-text">{computer.name}</span>
        <span className="shrink-0 text-meta text-faint">{STATE[computer.state]}</span>
      </div>
      <p className="px-1 pb-1 text-meta text-faint">Sessions in the sidebar</p>
      <SegmentedControl
        mode="radio"
        label="Sessions in the sidebar"
        fill
        value={scope}
        onChange={(next) => useComputers.getState().setScope(computer.id, next)}
        segments={(['mine', 'all'] as const).map((value) => ({ value, label: SCOPE_LABEL[value], icon: <ScopeIcon scope={value} size={12} />, data: { 'data-computer-scope-option': value } }))}
      />
      <p className="px-1 pt-2 pb-1 text-meta text-muted" data-computer-scope-line>
        Mine: started from {here}, or that you sent a message to from here.{hiddenLine}
      </p>
      <div aria-hidden className="mx-0.5 my-1.5 h-px bg-border" />
      <button
        type="button"
        onClick={() => {
          onClose();
          useComputers.getState().openNotifications(computer.id);
        }}
        className="flex items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-ui text-text hover:bg-border/45"
        data-computer-scope-notify
      >
        <Bell size={12} aria-hidden className="shrink-0 text-muted" />
        <span className="flex-1">Notifications</span>
        <span className="flex items-center gap-0.5 text-muted">
          {NOTIFY_LABEL[computer.notify]}
          <ChevronRight size={12} aria-hidden />
        </span>
      </button>
      <button type="button" onClick={onOnly} className="rounded-md px-1.5 py-1.5 text-left text-ui text-muted hover:bg-border/45 hover:text-text" data-computer-scope-only>
        Show only {computer.name}’s sessions
      </button>
      </div>
    </Popover>
  );
}
