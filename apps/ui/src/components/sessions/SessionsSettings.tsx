import { useVirtualizer } from '@tanstack/react-virtual';
import { Archive, ArchiveRestore, Ellipsis, FolderSearch, Info, PanelLeft, Pin, PinOff, Search, Trash2, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { ARCHIVE_AFTER_DAYS, DELETE_AFTER_DAYS } from '@switchboard/protocol/bridge';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { isContextMenuKey } from '../../lib/contextMenu.ts';
import { shortAge } from '../../lib/format.ts';
import { fileManagerName, trashName } from '../../lib/platform.ts';
import { sessionsWithDrafts } from '../../state/drafts.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { isActiveHost, useHosts } from '../../state/hostsStore.ts';
import { useLater } from '../../state/laterStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessionManager } from '../../state/sessionManagerStore.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { useProjectName } from '../../state/useQueue.ts';
import { archiveSessions } from '../drafts/ArchiveDraftDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { ARCHIVE } from '../sidebar/useSessionMenu.tsx';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { CountBadge, Pill } from '../ui/Pill.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { Select } from '../ui/Select.tsx';
import { Stepper } from '../ui/Stepper.tsx';
import { Switch } from '../ui/Toggle.tsx';
import { formatBytes } from '../worktrees/worktreeGroups.ts';
import { CLAUDE_CLEANUP_DEFAULT, CleanupPeriodDialog, DeleteArchivedDialog, MoveToTrashDialog, type ProfileCleanup } from './SessionDialogs.tsx';
import {
  APP_LABEL,
  DEFAULT_FILTERS,
  dueToday,
  filterRows,
  groupByMonth,
  groupState,
  lockReason,
  managerRows,
  overviewSummary,
  paceText,
  STATUS_LABEL,
  toggleGroup,
  type AppFilter,
  type Holds,
  type ManagerRow,
  type ManagerStatus,
  type MonthGroup,
  type StatusFilter,
  type TimeFilter,
} from './sessionManager.ts';

function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Everything the overview and the settings need: every session as a row, with what keeps it. */
function useManagerRows(now: number, archiveAfterDays: number): ManagerRow[] {
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const items = useLater((s) => s.items);
  const drafts = useDrafts((s) => s.drafts);
  return useMemo(() => {
    const rows = toRows(sessions, live, hosts);
    const holds: Holds = {
      queued: new Set(items.flatMap((item) => (item.waitFor.kind === 'session' ? [item.waitFor.sessionId] : []))),
      drafts: new Set(sessionsWithDrafts(Object.keys(drafts), drafts)),
      // A Claude Code process this app doesn't run: a terminal, an editor or Claude desktop has it open.
      elsewhere: new Set([...live.keys()].filter((id) => !isActiveHost(hosts.get(id)))),
    };
    return managerRows(rows, holds, now, archiveAfterDays);
  }, [sessions, live, hosts, items, drafts, now, archiveAfterDays]);
}

function Heading({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h2 className="text-body font-semibold">{title}</h2>
        {children && <p className="mt-0.5 text-ui text-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}

function SettingRow({ label, detail, children }: { label: string; detail: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-t border-border py-3 first:border-t-0 first:pt-0" data-setting-row>
      <span className="min-w-0">
        <span className="block text-ui text-text">{label}</span>
        <span className="block text-meta text-muted">{detail}</span>
      </span>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

/** A setting change that sends more sessions to the Trash today asks first. */
type Asking = { mode: 'turn-on' | 'shorter' | 'archive'; afterDays: number; due: ManagerRow[]; apply(): void };

/**
 * Settings › Sessions: how long finished sessions stay in the sidebar, whether archived ones go to the Trash and when,
 * Claude Code's own clean-up per profile, and every session in one table to find, unarchive and delete.
 */
export function SessionsSettings({ scrollRef }: { scrollRef: RefObject<HTMLDivElement | null> }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const prefs = usePreferences((s) => s.prefs);
  const update = usePreferences((s) => s.update);
  const now = useNow();
  const rows = useManagerRows(now, prefs.archiveAfterDays);
  const profiles = useProfiles((s) => s.profiles);
  const deleting = prefs.deleteArchived;
  const [asking, setAsking] = useState<Asking | null>(null);
  const [periods, setPeriods] = useState<ProfileCleanup[] | null>(null);
  const [editingCleanup, setEditingCleanup] = useState(false);
  const archiveInput = useRef<HTMLInputElement>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const focus = useSessionManager((s) => s.focus);

  const readPeriods = () => {
    if (client) void client.call('profiles.cleanupPeriods', {}).then(({ profiles: list }) => setPeriods(list), () => setPeriods([]));
  };
  // Read again when profiles change: one may have been added, or its folder moved.
  useEffect(readPeriods, [client, profiles]);

  // The palette and the sidebar ask for a control: the delete switch or the archive days.
  useEffect(() => {
    if (!focus) return;
    const target = focus.target === 'archive' ? archiveInput.current : document.querySelector<HTMLElement>('[data-auto-delete]');
    target?.focus();
    target?.scrollIntoView({ block: 'center' });
    useSessionManager.getState().clearFocus();
  }, [focus]);

  const setDeleting = (enabled: boolean, afterDays: number) => update({ deleteArchived: { enabled, afterDays } });
  const onSwitch = (on: boolean) => {
    if (!on) return setDeleting(false, deleting.afterDays);
    setAsking({ mode: 'turn-on', afterDays: deleting.afterDays, due: dueToday(rows, now, prefs.archiveAfterDays, deleting.afterDays), apply: () => setDeleting(true, deleting.afterDays) });
  };
  // While deleting is on, fewer days can send sessions to the Trash at once: ask when more would go today.
  const onDeleteDays = (afterDays: number) => {
    const before = deleting.enabled ? dueToday(rows, now, prefs.archiveAfterDays, deleting.afterDays).length : 0;
    const due = deleting.enabled ? dueToday(rows, now, prefs.archiveAfterDays, afterDays) : [];
    if (due.length > before) setAsking({ mode: 'shorter', afterDays, due, apply: () => setDeleting(true, afterDays) });
    else setDeleting(deleting.enabled, afterDays);
  };
  const onArchiveDays = (archiveAfterDays: number) => {
    const before = deleting.enabled ? dueToday(rows, now, prefs.archiveAfterDays, deleting.afterDays).length : 0;
    const due = deleting.enabled ? dueToday(rows, now, archiveAfterDays, deleting.afterDays) : [];
    if (due.length > before) setAsking({ mode: 'archive', afterDays: archiveAfterDays, due, apply: () => update({ archiveAfterDays }) });
    else update({ archiveAfterDays });
  };

  const review = (due: readonly ManagerRow[]) => {
    useSessionManager.getState().setFilters({ ...DEFAULT_FILTERS, review: { ids: new Set(due.map((row) => row.id)), label: `Due for deletion (${due.length.toLocaleString()})` } });
    setAsking(null);
    requestAnimationFrame(() => overviewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  };

  const profileName = (id: string) => profiles.find((p) => p.id === id)?.name ?? id;
  const readable = periods?.filter((p) => !p.error) ?? [];
  const cleanupText =
    readable.length === 1
      ? `after ${readable[0]!.days ?? CLAUDE_CLEANUP_DEFAULT} days`
      : readable.map((p) => `${profileName(p.profileId)} after ${p.days ?? CLAUDE_CLEANUP_DEFAULT} days`).join(', ');

  return (
    <>
      <section className="grid grid-cols-[minmax(0,1fr)] gap-3 py-6" aria-label="Keep the list short" data-sessions-settings>
        <Heading title="Keep the list short">
          Archived sessions leave the sidebar but stay on disk. Deleting one moves its transcript to the {trashName()}, so <code className="font-mono text-meta">claude --resume</code> no longer lists it.
        </Heading>
        <div className="grid gap-3 rounded-xl border border-border bg-card px-4 py-3.5">
          <div>
            <SettingRow label="Archive finished sessions after" detail="Working, needs you, unread and pinned sessions stay in the list. New activity brings a session back.">
              <Stepper
                ref={archiveInput}
                value={prefs.archiveAfterDays}
                min={ARCHIVE_AFTER_DAYS.min}
                max={ARCHIVE_AFTER_DAYS.max}
                onChange={onArchiveDays}
                label="Days before a finished session is archived"
                less="Fewer days"
                more="More days"
                hook="auto-archive"
              />
              <span className="w-8 text-ui text-muted">days</span>
            </SettingRow>
            <SettingRow
              label="Delete archived sessions"
              detail={`${deleting.enabled ? 'An' : 'Off. When on, an'} archived session goes to the ${trashName()} after the days you set. Pinned and working sessions, and ones with a queued prompt or an unsent message, are kept.`}
            >
              <Stepper
                value={deleting.afterDays}
                min={DELETE_AFTER_DAYS.min}
                max={DELETE_AFTER_DAYS.max}
                onChange={onDeleteDays}
                label="Days in Archived before a session is deleted"
                less="Fewer days"
                more="More days"
                disabled={!deleting.enabled}
                hook="auto-delete-days"
              />
              <span className={`w-8 text-ui ${deleting.enabled ? 'text-muted' : 'text-faint'}`}>days</span>
              <Switch checked={deleting.enabled} onChange={onSwitch} label="Delete archived sessions" dataAttrs={{ 'data-auto-delete': true, 'data-on': deleting.enabled }} />
            </SettingRow>
          </div>
          {periods && readable.length > 0 && (
            <Notice
              tone="info"
              icon={<Info size={13} aria-hidden />}
              actions={
                <Button variant="quiet" size="sm" className="text-link" onClick={() => setEditingCleanup(true)} data-claude-cleanup-change>
                  Change…
                </Button>
              }
              data-claude-cleanup
            >
              Claude Code deletes old transcripts on its own, even with this off: {cleanupText} (<code className="font-mono text-meta">cleanupPeriodDays</code>).
            </Notice>
          )}
        </div>
      </section>

      <div ref={overviewRef} className="scroll-mt-4">
        <SessionOverview rows={rows} now={now} scrollRef={scrollRef} />
      </div>

      {asking && (
        <DeleteArchivedDialog
          mode={asking.mode}
          afterDays={asking.afterDays}
          deleteDays={asking.mode === 'archive' ? deleting.afterDays : asking.afterDays}
          due={asking.due}
          pace={paceText(rows, now)}
          onReview={() => review(asking.due)}
          onConfirm={asking.apply}
          onClose={() => setAsking(null)}
        />
      )}
      {editingCleanup && periods && (
        <CleanupPeriodDialog periods={periods} deleteAfter={deleting.enabled ? deleting.afterDays + prefs.archiveAfterDays : null} onClose={() => setEditingCleanup(false)} onSaved={readPeriods} />
      )}
    </>
  );
}

const COLUMNS = 'grid items-center gap-x-3 grid-cols-[20px_minmax(0,3fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,0.8fr)_minmax(0,1fr)_28px] @max-[720px]:grid-cols-[20px_minmax(0,3fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_28px]';
const NARROW_HIDDEN = '@max-[720px]:hidden';
const FIELD = 'h-7 rounded-md border border-edge bg-bg px-2.5 text-ui text-text';

type Line = { kind: 'month'; group: MonthGroup } | { kind: 'row'; row: ManagerRow };

const STATUS_ICON: Record<ManagerStatus, ReactNode> = {
  'needs-you': <span className="size-2 rounded-full bg-warn" aria-hidden />,
  working: <span className="size-2 animate-pulse rounded-full bg-accent-ink" aria-hidden />,
  listed: <PanelLeft size={12} aria-hidden />,
  archived: <Archive size={12} aria-hidden />,
  pinned: <Pin size={12} aria-hidden />,
};

/** "1,284 sessions · 2.4 GB on disk · 214 archived, 89 of them for more than 30 days". */
function summaryText(summary: ReturnType<typeof overviewSummary>): string {
  const parts = [`${summary.count.toLocaleString()} ${summary.count === 1 ? 'session' : 'sessions'}`, `${formatBytes(summary.bytes)} on disk`];
  if (summary.archived) parts.push(`${summary.archived.toLocaleString()} archived${summary.archivedLong ? `, ${summary.archivedLong.toLocaleString()} of them for more than 30 days` : ''}`);
  return parts.join(' · ');
}

/**
 * Every session (whatever the sidebar's scope), filtered and grouped by month, newest first. Rows are picked with
 * their checkbox (a month's box picks what the filters show of it) and unarchived or moved to the Trash from the bar
 * at the bottom; a click opens the session.
 */
function SessionOverview({ rows, now, scrollRef }: { rows: readonly ManagerRow[]; now: number; scrollRef: RefObject<HTMLDivElement | null> }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const filters = useSessionManager((s) => s.filters);
  const setFilters = useSessionManager((s) => s.setFilters);
  const projects = useProjects((s) => s.projects);
  const profiles = useProfiles((s) => s.profiles);
  const defaultProfile = useProfiles((s) => s.defaultId);
  const projectName = useProjectName();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: MenuEntry[]; label: string } | null>(null);
  const [trashing, setTrashing] = useState<ManagerRow[] | null>(null);
  const filterId = useId();

  const shown = useMemo(() => filterRows(rows, filters, now, projectName), [rows, filters, now, projectName]);
  const groups = useMemo(() => groupByMonth(shown, now), [shown, now]);
  const lines = useMemo<Line[]>(() => groups.flatMap((group): Line[] => [{ kind: 'month', group }, ...group.rows.map((row): Line => ({ kind: 'row', row }))]), [groups]);
  const order = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);
  const summary = useMemo(() => overviewSummary(rows, now), [rows, now]);
  const projectRoots = useMemo(() => [...new Set(rows.map((row) => row.projectRoot))].sort((a, b) => projectName(a).localeCompare(projectName(b))), [rows, projectName]);

  // Picks of sessions that are gone, or can no longer be picked (one started working), drop out.
  useEffect(() => {
    setSelected((s) => {
      const next = new Set([...s].filter((id) => {
        const row = byId.get(id);
        return row && !lockReason(row);
      }));
      return next.size === s.size ? s : next;
    });
  }, [byId]);

  const picked = useMemo(() => [...selected].flatMap((id) => byId.get(id) ?? []), [selected, byId]);
  const pickedBytes = picked.reduce((sum, row) => sum + row.fileSize, 0);
  const pickedKept = picked.filter((row) => row.keep).length;
  const pickedArchived = picked.filter((row) => row.status === 'archived');

  // Esc clears the picks before it closes Settings (dialogs and menus take it first).
  useEffect(() => {
    if (selected.size === 0) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[role=dialog]:not([data-settings]), [role=alertdialog], [role=menu], [role=listbox]')) return;
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea')) return;
      event.preventDefault();
      setSelected(new Set());
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [selected.size]);

  // The page scrolls; the table's place in it is the virtualiser's scroll margin.
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = scrollRef.current;
    if (!list || !scroller) return;
    setScrollMargin(list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
  }, [scrollRef, lines.length, filters.review]);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (lines[i]!.kind === 'month' ? 40 : 52),
    getItemKey: (i) => {
      const line = lines[i]!;
      return line.kind === 'month' ? `month:${line.group.key}` : line.row.id;
    },
    overscan: 10,
    scrollMargin,
  });

  const tabStop = focused && order.some((r) => r.id === focused) ? focused : (order[0]?.id ?? null);
  const focusRow = (id: string) => {
    setFocused(id);
    const index = lines.findIndex((l) => l.kind === 'row' && l.row.id === id);
    if (index !== -1) virtualizer.scrollToIndex(index, { align: 'auto' });
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-session-manager-row="${CSS.escape(id)}"]`)?.focus());
  };

  const toggle = (row: ManagerRow) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });

  const open = (row: ManagerRow) => useSessions.getState().select(row.id);
  const fail = (what: string) => (e: unknown) => toast(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
  const setFlags = (targets: readonly ManagerRow[], change: { pinned?: boolean; archived?: boolean }) => {
    const apply = () => {
      for (const row of targets) void client?.call('sessions.setFlags', { sessionId: row.id, ...change }).catch(fail('change the session'));
    };
    // Archiving a session with an unsent message asks first, as in the sidebar.
    if (change.archived) archiveSessions(targets.map((row) => row.data), apply);
    else apply();
  };
  const unarchive = (targets: readonly ManagerRow[]) => {
    setFlags(targets, { archived: false });
    toast(targets.length === 1 ? 'Unarchived 1 session' : `Unarchived ${targets.length.toLocaleString()} sessions`);
    setSelected(new Set());
  };

  const menuEntries = (row: ManagerRow): MenuEntry[] => {
    const why = row.keep ? lockReason(row) : null;
    return [
      { label: 'Open session', onSelect: () => open(row), data: { 'data-session-manager-open': true } },
      row.status === 'archived'
        ? { label: 'Unarchive', icon: <ArchiveRestore size={13} aria-hidden />, onSelect: () => unarchive([row]) }
        : { label: 'Archive', icon: <Archive size={13} aria-hidden />, disabled: row.status === 'working' || row.status === 'needs-you', onSelect: () => setFlags([row], ARCHIVE) },
      { label: row.data.pinned ? 'Unpin' : 'Pin', icon: row.data.pinned ? <PinOff size={13} aria-hidden /> : <Pin size={13} aria-hidden />, onSelect: () => setFlags([row], { pinned: !row.data.pinned }) },
      { label: `Reveal transcript in ${fileManagerName()}`, onSelect: () => void client?.call('session.reveal', { sessionId: row.id }).catch(fail(`show it in ${fileManagerName()}`)) },
      { label: 'Copy session ID', onSelect: () => void navigator.clipboard.writeText(row.id).then(() => toast('Copied the session ID'), fail('copy the session ID')) },
      'separator',
      { label: `Move to ${trashName()}…`, icon: <Trash2 size={13} aria-hidden />, danger: true, disabled: row.keep !== null, onSelect: () => setTrashing([row]), data: { 'data-session-manager-trash-one': true } },
      ...(row.keep && !why ? [{ note: `Kept: it ${keepNote(row)}.` } as MenuEntry] : why ? [{ note: why } as MenuEntry] : []),
    ];
  };
  const openMenu = (row: ManagerRow, at: { x: number; y: number }) => setMenu({ ...at, entries: menuEntries(row), label: `Session “${row.title}”` });
  const menuBelow = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.right - 220, y: rect.bottom };
  };

  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, row: ManagerRow) => {
    if (event.target !== event.currentTarget) return;
    const index = order.indexOf(row);
    if (event.key === 'Enter') {
      event.preventDefault();
      open(row);
    } else if (event.key === ' ') {
      event.preventDefault();
      if (!lockReason(row)) toggle(row);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = order[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) focusRow(next.id);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? order[0] : order.at(-1);
      if (next) focusRow(next.id);
    } else if (isContextMenuKey(event)) {
      event.preventDefault();
      openMenu(row, menuBelow(event.currentTarget));
    }
  };

  const renderMonth = (group: MonthGroup) => {
    const state = groupState(group, selected);
    const pickable = group.rows.some((row) => !lockReason(row));
    return (
      <div className={`${COLUMNS} border-t border-border bg-border/20 px-4 py-2`} data-session-manager-month={group.key}>
        <span className="flex justify-center">
          <Checkbox
            checked={state}
            disabled={!pickable}
            onChange={() => setSelected((s) => toggleGroup(group, s))}
            label={state === true ? `Unpick every session from ${group.label}` : `Pick every session from ${group.label}`}
            dataAttrs={{ 'data-session-manager-month-pick': group.key, 'data-state': String(state) }}
          />
        </span>
        <span className="col-span-full col-start-2 flex min-w-0 items-center gap-2 text-meta font-semibold tracking-wider text-muted uppercase">
          <span className="truncate">{group.label}</span>
          <CountBadge count={group.rows.length} />
          <span className="font-normal tracking-normal normal-case text-faint">· {formatBytes(group.bytes)}</span>
        </span>
      </div>
    );
  };

  const renderRow = (row: ManagerRow) => {
    const isPicked = selected.has(row.id);
    const locked = lockReason(row);
    const dim = locked ? 'opacity-55' : '';
    return (
      <div
        role="row"
        tabIndex={tabStop === row.id ? 0 : -1}
        aria-selected={locked ? undefined : isPicked}
        aria-label={`${row.title}, ${STATUS_LABEL[row.status]}`}
        data-session-manager-row={row.id}
        data-status={row.status}
        data-picked={isPicked || undefined}
        onFocus={(e) => e.target === e.currentTarget && setFocused(row.id)}
        onKeyDown={(e) => onRowKey(e, row)}
        onClick={() => open(row)}
        onContextMenu={(e: MouseEvent<HTMLDivElement>) => {
          e.preventDefault();
          openMenu(row, e.clientX === 0 && e.clientY === 0 ? menuBelow(e.currentTarget) : { x: e.clientX, y: e.clientY });
        }}
        className={`${COLUMNS} min-h-13 cursor-default border-t border-border px-4 py-2 ${isPicked ? 'bg-selected' : 'hover:bg-border/45'}`}
      >
        <span role="cell" className="flex justify-center" onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={isPicked}
            disabled={!!locked}
            onChange={() => toggle(row)}
            label={`Pick ${row.title}`}
            tooltip={locked ?? `Pick ${row.title}`}
            dataAttrs={{ 'data-session-manager-pick': row.id }}
          />
        </span>
        <span role="cell" className={`flex min-w-0 items-center gap-2.5 ${dim}`}>
          <ProjectIcon project={projects.get(row.projectRoot)} root={row.projectRoot} size={20} />
          <span className="grid min-w-0 gap-px">
            <span className="truncate text-ui font-medium text-text" data-tooltip={row.title}>
              {row.title}
            </span>
            <span className="truncate font-mono text-meta text-muted">
              {row.branch ? `${row.branch} · ` : ''}
              {projectName(row.projectRoot)}
            </span>
          </span>
        </span>
        <span role="cell" className={`flex min-w-0 items-center gap-1.5 text-ui ${row.status === 'needs-you' ? 'text-warn' : 'text-muted'} ${dim}`}>
          <span className="flex size-3 shrink-0 items-center justify-center">{STATUS_ICON[row.status]}</span>
          <span className="truncate">{STATUS_LABEL[row.status]}</span>
        </span>
        <span role="cell" className={`truncate text-ui text-muted ${dim}`} data-tooltip={new Date(row.updatedAt).toLocaleString()}>
          {shortAge(row.updatedAt, now)}
        </span>
        <span role="cell" className={`truncate font-mono text-meta tabular-nums text-muted ${NARROW_HIDDEN} ${dim}`}>
          {formatBytes(row.fileSize)}
        </span>
        <span role="cell" className={`truncate text-ui text-muted ${NARROW_HIDDEN} ${dim}`}>
          {APP_LABEL[row.app]}
        </span>
        <span role="cell" className="flex justify-end" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<Ellipsis size={14} aria-hidden />}
            aria-label={`Options for ${row.title}`}
            aria-haspopup="menu"
            tabIndex={-1}
            onClick={(e) => openMenu(row, menuBelow(e.currentTarget))}
            data-session-manager-more={row.id}
          />
        </span>
      </div>
    );
  };

  const revealProjects = (profileId: string) => void client?.call('profiles.revealProjects', { profileId }).catch(fail(`show the folder in ${fileManagerName()}`));
  const revealButton = (
    <Button
      variant="quiet"
      size="sm"
      icon={<FolderSearch size={13} aria-hidden />}
      onClick={(e) => {
        // One profile: its folder. Several: pick which.
        if (profiles.length <= 1) return revealProjects(profiles[0]?.id ?? defaultProfile);
        const rect = e.currentTarget.getBoundingClientRect();
        setMenu({ x: rect.right - 220, y: rect.bottom, label: 'Projects folders', entries: profiles.map((p) => ({ label: p.name, hint: p.configDir.split(/[\\/]/).at(-1), onSelect: () => revealProjects(p.id) })) });
      }}
      data-reveal-projects
    >
      Reveal in {fileManagerName()}
    </Button>
  );

  return (
    <section className="grid grid-cols-[minmax(0,1fr)] gap-3 pt-2 pb-6" aria-label="All sessions" data-session-manager>
      <Heading title="All sessions" action={revealButton}>
        <span data-session-manager-summary>{summaryText(summary)}</span>
      </Heading>

      <div className="flex flex-wrap items-center gap-2" role="toolbar" aria-label="Filter sessions">
        <label htmlFor={filterId} className={`${FIELD} flex min-w-44 flex-1 items-center gap-2 text-faint focus-within:border-accent-ink/60`}>
          <Search size={13} className="shrink-0" aria-hidden />
          <input
            id={filterId}
            type="search"
            value={filters.query}
            onChange={(e) => setFilters({ query: e.target.value })}
            placeholder="Filter by title, branch or project"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-muted"
            data-session-manager-filter
          />
        </label>
        <SegmentedControl<TimeFilter>
          mode="radio"
          label="Last active"
          value={filters.time}
          onChange={(time) => setFilters({ time })}
          segments={[
            { value: 'any', label: 'Any time', data: { 'data-session-time': 'any' } },
            { value: 'week', label: '7 days', data: { 'data-session-time': 'week' } },
            { value: 'month', label: '30 days', data: { 'data-session-time': 'month' } },
            { value: 'older', label: 'Older than 30 days', data: { 'data-session-time': 'older' } },
          ]}
          className="shrink-0"
        />
        <Select<string>
          label="Project"
          value={filters.project ?? ''}
          onChange={(project) => setFilters({ project: project || null })}
          options={[{ value: '', label: 'All projects' }, ...projectRoots.map((root) => ({ value: root, label: projectName(root), icon: <ProjectIcon project={projects.get(root)} root={root} size={12} /> }))]}
          menuWidth={240}
          className={`${FIELD} max-w-48`}
          dataAttrs={{ 'data-session-project-filter': true }}
        />
        <Select<AppFilter>
          label="From"
          value={filters.app}
          onChange={(app) => setFilters({ app })}
          options={[{ value: 'all', label: 'From any app' }, ...(Object.keys(APP_LABEL) as Array<Exclude<AppFilter, 'all'>>).map((app) => ({ value: app, label: APP_LABEL[app] }))]}
          className={FIELD}
          dataAttrs={{ 'data-session-app-filter': true }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl<StatusFilter>
          mode="radio"
          label="Status"
          value={filters.status}
          onChange={(status) => setFilters({ status })}
          segments={[
            { value: 'all', label: 'All', data: { 'data-session-status-filter': 'all' } },
            { value: 'listed', label: 'In the list', data: { 'data-session-status-filter': 'listed' } },
            { value: 'archived', label: 'Archived', data: { 'data-session-status-filter': 'archived' } },
            { value: 'pinned', label: 'Pinned', data: { 'data-session-status-filter': 'pinned' } },
          ]}
          className="shrink-0"
        />
        {filters.review && (
          <Pill tone="link" icon={<X size={11} aria-hidden />} onClick={() => setFilters({ review: null })} aria-label={`${filters.review.label}. Show every session again`} data-session-review>
            {filters.review.label}
          </Pill>
        )}
        {shown.length !== rows.length && (
          <span className="ml-auto text-meta text-muted">
            {shown.length.toLocaleString()} of {rows.length.toLocaleString()}
          </span>
        )}
      </div>

      <div role="table" aria-label="All sessions" aria-rowcount={order.length + 1} className="@container rounded-xl border border-border bg-card" data-session-manager-table>
        <div role="row" className={`${COLUMNS} sticky top-0 z-10 rounded-t-xl border-b border-border bg-card px-4 py-2.5 text-meta font-semibold tracking-wider text-faint uppercase`}>
          <span role="columnheader">
            <span className="sr-only">Picked</span>
          </span>
          <span role="columnheader">Session</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Last active</span>
          <span role="columnheader" className={NARROW_HIDDEN}>
            Size
          </span>
          <span role="columnheader" className={NARROW_HIDDEN}>
            From
          </span>
          <span role="columnheader">
            <span className="sr-only">Options</span>
          </span>
        </div>
        <div ref={listRef} role="rowgroup" className="[&>div>div:first-child>*]:border-t-0">
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const line = lines[item.index]!;
              return (
                <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start - scrollMargin}px)` }}>
                  {line.kind === 'month' ? renderMonth(line.group) : renderRow(line.row)}
                </div>
              );
            })}
          </div>
        </div>
        {order.length === 0 && (
          <p className="px-4 py-6 text-center text-ui text-muted" data-session-manager-empty>
            {rows.length === 0 ? 'No sessions yet.' : 'No sessions match these filters.'}
          </p>
        )}
      </div>

      {selected.size > 0 && (
        <div className="sticky bottom-4 z-20 mx-auto flex w-fit max-w-full items-center gap-2 rounded-xl border overlay px-3 py-2" role="toolbar" aria-label="Picked sessions" data-session-selection-bar>
          <span className="truncate text-ui text-muted">
            <span className="font-semibold text-text" data-session-selection-count={selected.size}>
              {selected.size.toLocaleString()} selected
            </span>
            {` · ${formatBytes(pickedBytes)}`}
            {pickedKept > 0 && ` · ${pickedKept.toLocaleString()} skipped`}
          </span>
          <Button icon={<ArchiveRestore size={13} aria-hidden />} disabled={pickedArchived.length === 0} onClick={() => unarchive(pickedArchived)} data-session-unarchive-selected>
            Unarchive
          </Button>
          <Button variant="danger" icon={<Trash2 size={13} aria-hidden />} onClick={() => setTrashing(picked)} data-session-move-to-trash>
            Move to {trashName()}…
          </Button>
          <Button variant="quiet" kbd="Esc" onClick={() => setSelected(new Set())} data-session-clear-selection>
            Clear
          </Button>
        </div>
      )}

      {menu && <Menu x={menu.x} y={menu.y} width={240} entries={menu.entries} label={menu.label} onClose={() => setMenu(null)} />}
      {trashing && <MoveToTrashDialog rows={trashing} onClose={() => setTrashing(null)} onDone={() => setSelected(new Set())} />}
    </section>
  );
}

/** Why a pickable row is kept anyway: "has an unsent message". */
function keepNote(row: ManagerRow): string {
  switch (row.keep) {
    case 'open-elsewhere':
      return 'is open in another window';
    case 'queued':
      return 'has a queued prompt';
    case 'draft':
      return 'has an unsent message';
    default:
      return 'is in use';
  }
}
