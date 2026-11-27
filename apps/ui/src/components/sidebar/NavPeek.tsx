import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { shortAge } from '../../lib/format.ts';
import { quickInfoOf, useCatchUp } from '../../state/catchUpStore.ts';
import { useKeptSessions } from '../../state/keptSessions.ts';
import { usePipelines } from '../../state/pipelinesStore.ts';
import { useMinimal, usePreferences } from '../../state/preferencesStore.ts';
import { filterBySource } from '../../state/remoteRows.ts';
import { useRows } from '../../state/rowsStore.ts';
import { markKept, type SessionRowData } from '../../state/sessionsStore.ts';
import { sidebarGroups } from '../../state/sidebarOrder.ts';
import { GROUP_LABEL, inScope, rowStatus } from '../../state/sidebarRows.ts';
import { useComputers } from '../../state/computersStore.ts';
import { openRow, useRemoteRows, useRemoteTreeRuns, useShownRowId } from '../../state/useRemoteRows.ts';
import { Popover } from '../ui/Popover.tsx';
import { StatusIcon } from './StatusIcon.tsx';

/** How long the pointer rests on Sessions before the peek opens, and how long it may be away before it closes. */
const OPEN_DELAY = 400;
const CLOSE_DELAY = 300;
/** The rows the peek lists before "Show all". */
export const PEEK_ROWS = 12;
/** The peek lists parents only, as the old rail did: no pipeline's sub-sessions. */
const NO_OPEN_PARENTS: ReadonlySet<string> = new Set();

export interface Peek {
  open: boolean;
  /** Where it shows: beside the Sessions button. */
  at: { x: number; y: number } | null;
  /** Opened from the keys (→ on Sessions): focus goes into it, and back to the button when it closes. */
  keyboard: boolean;
  anchor: React.RefObject<HTMLElement | null>;
  show(button: HTMLElement, keyboard: boolean): void;
  close(): void;
  /** For the peek itself: the pointer coming back keeps it open, leaving it closes it after a moment. */
  hold(): void;
  release(): void;
  /** For the Sessions button. */
  triggerProps: { onPointerEnter(event: React.PointerEvent<HTMLElement>): void; onPointerLeave(): void };
}

/**
 * The peek's timing: open after resting on Sessions for 400ms (only while `enabled`, the panel closed), close 300ms
 * after the pointer leaves both the button and the peek.
 */
export function usePeek(enabled: boolean): Peek {
  const [state, setState] = useState<{ at: { x: number; y: number }; keyboard: boolean } | null>(null);
  const anchor = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const clear = () => window.clearTimeout(timer.current);
  const close = useCallback(() => {
    window.clearTimeout(timer.current);
    setState(null);
  }, []);
  const show = useCallback((button: HTMLElement, keyboard: boolean) => {
    window.clearTimeout(timer.current);
    anchor.current = button;
    const rect = button.getBoundingClientRect();
    setState({ at: { x: rect.right + 8, y: rect.top - 4 }, keyboard });
  }, []);
  // The panel opened (a click on Sessions, ⌘B): the list is on screen, the peek goes.
  useEffect(() => {
    if (!enabled) close();
  }, [enabled, close]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const later = (run: () => void, ms: number) => {
    clear();
    timer.current = window.setTimeout(run, ms);
  };
  return {
    open: state !== null,
    at: state?.at ?? null,
    keyboard: state?.keyboard ?? false,
    anchor,
    show,
    close,
    hold: clear,
    release: () => later(close, CLOSE_DELAY),
    triggerProps: {
      onPointerEnter: (event) => {
        if (!enabled) return;
        const button = event.currentTarget;
        if (state) return clear();
        later(() => show(button, false), OPEN_DELAY);
      },
      onPointerLeave: () => (state ? later(close, CLOSE_DELAY) : clear()),
    },
  };
}

/** Re-renders the ages once a minute while it is open. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/** The sessions in the sidebar's groups and order, without Done, as the panel would list them. */
function usePeekGroups(now: number) {
  const baseRows = useRows((s) => s.rows);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const archiveAfterDays = usePreferences((s) => s.prefs.archiveAfterDays);
  const sort = usePreferences((s) => s.prefs.sidebarSort);
  const kept = useKeptSessions();
  const remoteRows = useRemoteRows();
  const remoteRuns = useRemoteTreeRuns();
  const hidden = useComputers((s) => s.hidden);
  const catchUps = useCatchUp((s) => s.cards);
  const runs = usePipelines((s) => s.runs);
  return useMemo(() => {
    const all = markKept(baseRows, kept).filter((row) => inScope(row, scope));
    const listed = filterBySource([...all, ...remoteRows], hidden);
    return sidebarGroups(listed, { now, archiveAfterDays, sort, quick: quickInfoOf(catchUps), runs: runs.values(), remoteRuns, openParents: NO_OPEN_PARENTS, kept });
  }, [baseRows, kept, scope, remoteRows, hidden, now, archiveAfterDays, sort, catchUps, runs, remoteRuns]);
}

/**
 * A look at the sessions while the panel is closed, beside the rail's Sessions: their groups in the sidebar's order, a
 * line each (the state, the title, the age), at most 12, then Show all, which opens the panel. A click opens the session.
 */
export function NavPeek({ peek, onShowAll }: { peek: Peek; onShowAll(): void }) {
  const now = useNow();
  const minimal = useMinimal();
  const groups = usePeekGroups(now);
  const shownId = useShownRowId();
  const list = useRef<HTMLDivElement>(null);
  let left = PEEK_ROWS;
  const shown = groups.flatMap(({ group, rows }) => {
    if (left <= 0) return [];
    const take = rows.slice(0, left);
    left -= take.length;
    return [{ group, rows: take }];
  });
  const total = groups.reduce((sum, g) => sum + g.rows.length, 0);

  // From the keys, the first row takes focus; ↑ ↓ move between rows.
  useEffect(() => {
    if (peek.keyboard) list.current?.querySelector<HTMLElement>('[data-peek-row], [data-peek-all]')?.focus();
  }, [peek.keyboard]);

  const close = (refocus: boolean) => {
    peek.close();
    if (refocus && peek.keyboard) peek.anchor.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      return close(true);
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-peek-row], [data-peek-all]')];
    const at = all.indexOf(document.activeElement as HTMLElement);
    all[Math.max(0, Math.min(all.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  const pick = (row: SessionRowData) => {
    peek.close();
    openRow(row.id);
  };

  return (
    <Popover
      x={peek.at!.x}
      y={peek.at!.y}
      width={300}
      anchor={peek.anchor}
      onClose={() => close(true)}
      role="dialog"
      aria-label="Sessions"
      className="py-1.5!"
      onPointerEnter={peek.hold}
      onPointerLeave={peek.release}
      data-nav-peek
    >
      <div ref={list} onKeyDown={onKeyDown}>
        {total === 0 && <p className="px-3 py-1.5 text-ui text-muted">No sessions yet.</p>}
        {shown.map(({ group, rows }) => (
          <div key={group} role="group" aria-label={GROUP_LABEL[group]}>
            <p aria-hidden className="px-3 pt-1.5 pb-0.5 text-meta font-semibold text-faint">
              {GROUP_LABEL[group]}
            </p>
            {rows.map((row) => (
              <button
                key={row.id}
                type="button"
                onClick={() => pick(row)}
                aria-current={row.id === shownId ? 'true' : undefined}
                className={`flex h-7 w-full items-center gap-2 px-3 text-left text-ui hover:bg-border/45 focus-visible:bg-border/45 ${row.id === shownId ? 'bg-selected' : ''}`}
                data-peek-row={row.id}
              >
                <StatusIcon status={rowStatus(row)} variant={minimal ? 'minimal' : 'standard'} />
                <span className="min-w-0 flex-1 truncate text-text">{row.title || 'Untitled session'}</span>
                <span className="shrink-0 text-meta text-faint tabular-nums">{shortAge(row.updatedAt, now)}</span>
              </button>
            ))}
          </div>
        ))}
        <button type="button" onClick={onShowAll} className="mt-1 flex h-7 w-full items-center px-3 text-left text-ui text-link hover:bg-border/45 focus-visible:bg-border/45" data-peek-all>
          {total > PEEK_ROWS ? `Show all ${total}` : 'Show all'}
        </button>
      </div>
    </Popover>
  );
}
