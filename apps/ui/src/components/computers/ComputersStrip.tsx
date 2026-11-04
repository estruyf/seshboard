import { Bell, ChevronDown, ChevronRight, Monitor, User, Users } from 'lucide-react';
import { useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import type { Computer, ComputerNotify, RemoteSessions } from '@seshboard/protocol/client';
import { contextMenuPoint, isContextMenuKey } from '../../lib/contextMenu.ts';
import { thisComputerName } from '../../lib/platform.ts';
import { useComputers } from '../../state/computersStore.ts';
import { offlineLine, scopeOf, showsOnly, shownList, THIS_COMPUTER, toggleOnly, type ComputerScope } from '../../state/remoteRows.ts';
import { useRemoteRowSplit, useSources } from '../../state/useRemoteRows.ts';
import { Menu } from '../Menu.tsx';
import { Popover } from '../ui/Popover.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { computerTint } from './computerColor.ts';
import { waitingCount } from './computerSessions.ts';
import { fitComputerChips, MIN_NAME, moreLabel } from './stripFit.ts';

const NONE: Computer[] = [];

/** The status dot of a computer: `ok` connected (`caution` when it sent what this version can't read), `faint` pulsing while connecting, `faint` otherwise. */
const DOT: Record<Computer['state'], string> = { connected: 'bg-ok', connecting: 'bg-faint animate-pulse', offline: 'bg-faint', unpaired: 'bg-faint' };
const STATE: Record<Computer['state'], string> = { connected: 'Connected', connecting: 'Connecting', offline: 'Offline', unpaired: 'Pair it again' };
const SCOPE_LABEL: Record<ComputerScope, string> = { mine: 'Mine', all: 'All' };
/** The filter in a sentence, for a chip's tooltip and accessible name. */
const SCOPE_LINE: Record<ComputerScope, string> = { mine: 'your sessions only', all: 'everyone’s sessions' };
/** The notifications choice, as Settings › Remote names it. */
const NOTIFY_LABEL: Record<ComputerNotify, string> = { all: 'All', 'started-here': 'Only mine', 'needs-you': 'Needs you', off: 'Off' };
const ScopeIcon = ({ scope, size }: { scope: ComputerScope; size: number }) => (scope === 'mine' ? <User size={size} aria-hidden className="shrink-0" /> : <Users size={size} aria-hidden className="shrink-0" />);

/** Every chip of the strip, This Mac's too: one neutral tint, whatever the computer's colour. */
const CHIP = 'flex h-6 items-center rounded-md bg-border/45 text-ui text-text transition-colors hover:bg-border/70';
/** The chip's own button: the dot, the name, the needs-you count and, with Mine, the person. */
const FACE = 'flex h-6 min-w-0 items-center gap-1.5 rounded-md px-2 whitespace-nowrap';
/** How much a computer's chip grows while hovered or focused: its ▾ (`w-4`). The fold keeps room for one. */
const MENU_BUTTON = 16;

/** A paired computer, as its chip and the "+N" menu show it. */
interface StripComputer {
  computer: Computer;
  list: RemoteSessions | undefined;
  scope: ComputerScope;
  /** What needs you among what it shows, so the number matches the list. */
  waiting: number;
  dot: string;
  /** Nothing to filter to: its page says why, and offers to pair again or start there. */
  page: boolean;
}

/**
 * What a chip shows, the same for the chip and its copy measured out of sight. A paired computer's name is in its own
 * colour (`text-remote`, under its tint), or `faint` while it isn't connected; This Mac's has a monitor for a dot and its
 * full name. The person after the count says Mine is on; All shows nothing, since nothing is hidden.
 */
function ChipFace({ name, dot, waiting, scope, offline = false }: { name: string; dot?: string; waiting: number; scope?: ComputerScope; offline?: boolean }) {
  return (
    <>
      {dot ? <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dot}`} /> : <Monitor size={12} aria-hidden className="shrink-0" />}
      <span className={dot ? `min-w-0 max-w-[9rem] truncate ${offline ? 'text-faint' : 'text-remote'}` : undefined} data-strip-name>
        {name}
      </span>
      {waiting > 0 && <span className="shrink-0 text-meta font-semibold text-warn tabular-nums">{waiting}</span>}
      {scope === 'mine' && <User size={12} aria-hidden className="shrink-0 text-muted" data-computer-scope-icon />}
    </>
  );
}

/**
 * The sidebar's Computers strip (docs/remote-access.md, Other computers): one line with a chip for this computer, then
 * one per paired computer with its status dot, its name in its colour, in `warn` how many of its sessions need you, and
 * a person while its Mine filter is on. A chip shows only that computer's sessions, and again everything when it already
 * did; the choice is kept per window. A computer whose sessions can't be listed (none yet, offline before its first
 * list, or to pair again) opens its page instead. A paired computer's menu (Mine or All, what Mine hides, notifications)
 * opens from the ▾ that shows on hover and focus, a right-click, or Shift+F10. The chips never wrap: the last ones fold
 * into "+N" (`fitComputerChips`, measured on resize). Only shows with a paired computer. `joined`: Connected to this Mac
 * is right above it, so the two read as one block without a line between.
 */
export function ComputersStrip({ localWaiting, joined = false }: { localWaiting: number; joined?: boolean }) {
  const computers = useComputers((s) => s.status?.computers ?? NONE);
  const lists = useComputers((s) => s.lists);
  const hidden = useComputers((s) => s.hidden);
  const scopes = useComputers((s) => s.scopes);
  const sources = useSources();
  const others = useRemoteRowSplit().hidden;
  const [menu, setMenu] = useState<{ computerId: string; x: number; y: number; above: boolean; anchor: HTMLElement | null } | null>(null);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const [shown, setShown] = useState(computers.length);
  const menuButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const rowRef = useRef<HTMLDivElement>(null);
  const copiesRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const key = computers.map((c) => c.id).join('\n');

  // Measured once on resize, from copies of every chip at rest kept out of sight, so what shows can't change the answer.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const copies = copiesRef.current;
    if (!row || !copies) return;
    const measure = () => {
      const width = (el: Element | undefined) => el?.getBoundingClientRect().width ?? 0;
      const chips = [...copies.children];
      const plus = width(chips.at(-1));
      const remote = chips.slice(1, -1);
      // The same chip with its name cut to MIN_NAME, which the last chip that shows may do before it folds.
      const least = remote.map((chip) => width(chip) - Math.max(0, width(chip.querySelector('[data-strip-name]') ?? undefined) - MIN_NAME));
      setShown(fitComputerChips(row.clientWidth, { here: width(chips[0]), widths: remote.map(width), least, plusWidth: () => plus, menuButton: MENU_BUTTON }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const copy of copies.children) observer.observe(copy);
    return () => observer.disconnect();
  }, [key]);

  if (!computers.length) return null;

  const toggle = (source: string) => useComputers.getState().setHidden(toggleOnly(sources, hidden, source));
  const items: StripComputer[] = computers.map((computer) => {
    const list = lists.get(computer.id);
    const scope = scopeOf(scopes, computer.id);
    return {
      computer,
      list,
      scope,
      waiting: waitingCount(list && shownList(list, computer, scope)),
      dot: computer.state === 'connected' && computer.problem ? 'bg-caution' : DOT[computer.state],
      page: computer.state === 'unpaired' || !list || list.sessions.length === 0,
    };
  });
  const open = (item: StripComputer) => (item.page ? useComputers.getState().openPage(item.computer.id) : toggle(item.computer.id));
  /** `toggle`: the ▾ closes the menu it opened; a right-click or the keys always open it where they are. */
  const openMenu = (computerId: string, at: { x: number; y: number; above: boolean }, anchor: HTMLElement | null, toggle = false) =>
    setMenu((current) => (toggle && current?.computerId === computerId && current.anchor === anchor ? null : { computerId, ...at, anchor }));
  /** From the ▾ or the keys: above the chip, as the strip sits at the bottom of the sidebar. */
  const menuAt = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top - 6, above: true };
  };
  const pointerAt = (event: ReactMouseEvent<HTMLElement>) => contextMenuPoint({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), window.innerHeight);

  /** `last`: the last chip that shows, which may cut its name further to stay on the line (`fitComputerChips`). */
  const remoteChip = (item: StripComputer, last: boolean) => {
    const { computer, scope, waiting } = item;
    const source = computer.id;
    const only = showsOnly(sources, hidden, source);
    const off = hidden.has(source);
    const offline = computer.state !== 'connected';
    const tooltip =
      computer.state === 'offline'
        ? offlineLine(computer.name, computer.lastSeen)
        : computer.problem
          ? computer.problem
          : item.page
            ? `${computer.name}: ${computer.message ?? STATE[computer.state]}`
            : `${computer.name}: ${SCOPE_LINE[scope]}. Click to show ${only ? 'every computer' : `only ${computer.name}`}, ▾ for more.`;
    const label = [computer.name, STATE[computer.state].toLowerCase(), waiting > 0 ? `${waiting} need you` : null, SCOPE_LINE[scope]].filter(Boolean).join(', ');
    return (
      <span
        key={source}
        style={computerTint(computer.color)}
        className={`group/chip ${CHIP} ${last ? 'min-w-0 shrink' : 'shrink-0'} ${only ? 'ring-1 ring-current/40 ring-inset' : ''} ${off ? 'opacity-45' : ''}`}
        data-computer-chip-of={source}
        data-computer-scope={scope}
      >
        <button
          type="button"
          aria-pressed={only}
          aria-label={label}
          onClick={() => open(item)}
          onContextMenu={(event) => {
            event.preventDefault();
            openMenu(source, pointerAt(event), event.currentTarget.parentElement);
          }}
          onKeyDown={(event) => {
            if (!isContextMenuKey(event)) return;
            event.preventDefault();
            const chip = event.currentTarget.parentElement!;
            openMenu(source, menuAt(chip), chip);
          }}
          data-tooltip={tooltip}
          data-computer-filter={source}
          data-hidden={off || undefined}
          className={FACE}
        >
          <ChipFace name={computer.name} dot={item.dot} waiting={waiting} scope={scope} offline={offline} />
        </button>
        {/* Out of sight at rest but in the tab order after its chip; it shows on hover, on focus and while its menu is open. */}
        <button
          ref={(el) => void menuButtons.current.set(source, el)}
          type="button"
          aria-label={`Options for ${computer.name}`}
          aria-haspopup="dialog"
          aria-expanded={menu?.computerId === source}
          data-tooltip={`Options for ${computer.name}`}
          onClick={(event) => openMenu(source, menuAt(event.currentTarget.parentElement!), event.currentTarget, true)}
          data-computer-menu-button
          className="flex h-6 w-0 shrink-0 items-center justify-center overflow-hidden rounded-r-md text-muted hover:text-text focus-visible:w-4 group-hover/chip:w-4 group-has-[:focus-visible]/chip:w-4 aria-expanded:w-4"
        >
          <ChevronDown size={11} aria-hidden className="shrink-0" />
        </button>
      </span>
    );
  };

  const here = thisComputerName();
  const hereOnly = showsOnly(sources, hidden, THIS_COMPUTER);
  const folded = items.slice(shown);
  const foldedWaiting = folded.reduce((sum, item) => sum + item.waiting, 0);
  const allWaiting = items.reduce((sum, item) => sum + item.waiting, 0);
  return (
    <div className={`relative shrink-0 px-3 pb-2 ${joined ? 'pt-0.5' : 'pt-1.5'}`} data-computers-strip>
      <p className="px-0.5 pb-1 text-meta font-medium text-faint">Computers</p>
      <div ref={rowRef} className="flex min-w-0 flex-nowrap items-center gap-1" role="group" aria-label="Show sessions from">
        <button
          type="button"
          aria-pressed={hereOnly}
          aria-label={localWaiting > 0 ? `${here}, ${localWaiting} need you` : here}
          onClick={() => toggle(THIS_COMPUTER)}
          data-tooltip={hereOnly ? 'Show every computer' : `Show only ${here}`}
          data-computer-filter={THIS_COMPUTER}
          data-hidden={hidden.has(THIS_COMPUTER) || undefined}
          className={`${CHIP} ${FACE} shrink-0 ${hereOnly ? 'ring-1 ring-current/40 ring-inset' : ''} ${hidden.has(THIS_COMPUTER) ? 'opacity-45' : ''}`}
        >
          <ChipFace name={here} waiting={localWaiting} />
        </button>
        {items.slice(0, shown).map((item, i) => remoteChip(item, i === shown - 1))}
        {folded.length > 0 && (
          <button
            ref={moreRef}
            type="button"
            aria-label={moreLabel(folded.length, foldedWaiting)}
            aria-haspopup="menu"
            aria-expanded={more !== null}
            onClick={() => {
              const rect = moreRef.current!.getBoundingClientRect();
              setMore(more ? null : { x: rect.left, y: rect.top - 4 });
            }}
            data-tooltip={folded.map((item) => item.computer.name).join(', ')}
            data-computers-more={folded.length}
            className={`${CHIP} ${FACE} shrink-0 text-muted hover:text-text`}
          >
            +{folded.length}
            {foldedWaiting > 0 && <span className="text-meta font-semibold text-warn tabular-nums">{foldedWaiting}</span>}
          </button>
        )}
      </div>
      {/* Every chip at rest and the "+N" chip, measured out of sight (fitComputerChips). */}
      <div aria-hidden className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden">
        <div ref={copiesRef} className="absolute flex w-max items-center gap-1">
          <span className={`${CHIP} ${FACE}`}>
            <ChipFace name={here} waiting={localWaiting} />
          </span>
          {items.map((item) => (
            <span key={item.computer.id} className={`${CHIP} ${FACE}`}>
              <ChipFace name={item.computer.name} dot={item.dot} waiting={item.waiting} scope={item.scope} />
            </span>
          ))}
          <span className={`${CHIP} ${FACE}`}>
            +{items.length}
            {allWaiting > 0 && <span className="text-meta font-semibold tabular-nums">{allWaiting}</span>}
          </span>
        </div>
      </div>
      {more && folded.length > 0 && (
        <Menu
          x={more.x}
          y={more.y}
          above
          width={240}
          label="More computers"
          anchor={moreRef}
          onClose={() => setMore(null)}
          entries={folded.map((item) => ({
            label: item.computer.name,
            icon: <span className={`block size-1.5 rounded-full ${item.dot}`} />,
            end: (
              <>
                {item.scope === 'mine' && (
                  <>
                    <User size={12} aria-hidden className="shrink-0 text-muted" />
                    <span className="sr-only">, {SCOPE_LINE.mine}</span>
                  </>
                )}
                {item.waiting > 0 && <span className="shrink-0 text-meta font-semibold text-warn tabular-nums">{item.waiting}</span>}
              </>
            ),
            onSelect: () => open(item),
            contextMenu: (at) => openMenu(item.computer.id, at, moreRef.current),
            action: { label: `Options for ${item.computer.name}`, icon: <ChevronDown size={12} aria-hidden />, onSelect: () => openMenu(item.computer.id, menuAt(moreRef.current!), moreRef.current), data: { 'data-computers-more-options': item.computer.id } },
            data: { 'data-computers-more-item': item.computer.id },
          }))}
        />
      )}
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
              above={menu.above}
              anchor={{ current: menu.anchor }}
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
  above,
  anchor,
  onClose,
  onOnly,
}: {
  computer: Computer;
  scope: ComputerScope;
  hiddenCount: number;
  x: number;
  y: number;
  above: boolean;
  anchor: { current: HTMLElement | null };
  onClose(): void;
  onOnly(): void;
}) {
  const here = thisComputerName().replace(/^This /, 'this ');
  const hiddenLine = hiddenCount === 0 ? '' : hiddenCount === 1 ? ' 1 other is hidden.' : ` ${hiddenCount} others are hidden.`;
  return (
    <Popover x={x} y={y} above={above} width={272} onClose={onClose} anchor={anchor} role="dialog" aria-label={`Sessions from ${computer.name}`} data-computer-scope-menu={computer.id}>
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
