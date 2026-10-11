import { useVirtualizer } from '@tanstack/react-virtual';
import { Copy, Ellipsis, FolderOpen, GitBranch, GitMerge, HardDrive, Lock, MessagesSquare, RefreshCw, Search, SquarePen, Trash2, ArrowUp } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { isSameOrInside, type WorktreeEntry, type WorktreeRemoveResult } from '@switchboard/protocol/client';
import type { EngineClient } from '../../engine/connection.ts';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { isContextMenuKey } from '../../lib/contextMenu.ts';
import { agoText, tildify } from '../../lib/format.ts';
import { fileManagerName } from '../../lib/platform.ts';
import { localizeKeys } from '../../lib/shortcuts.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useProjectPage } from '../../state/projectPageStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { useTerminals } from '../../state/terminalsStore.ts';
import { toast } from '../../state/toastStore.ts';
import { loadWorktrees, requestSizes, useAllSessionRows, useWorktreeRows, useWorktreeSizes } from '../../state/worktreesStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader, type SectionTone } from '../ui/SectionHeader.tsx';
import { CleanupDialog } from './CleanupDialog.tsx';
import {
  aheadLabel,
  defaultSelection,
  formatBytes,
  freedBytes,
  GROUP_LABEL,
  GROUP_NOTE,
  groupRows,
  mainCheckoutBytes,
  mergeLabel,
  sessionsLabel,
  toggleSelection,
  validSelection,
  worktreeSummary,
  type WorktreeGroup,
  type WorktreeRow,
} from './worktreeGroups.ts';

/** Above this many worktrees the table only renders the rows in view. */
const VIRTUALIZE_FROM = 50;
const GROUP_TONE: Record<Exclude<WorktreeGroup, 'main'>, SectionTone> = { safe: 'ok', done: 'info', keep: 'caution', stale: 'error' };
/** The table's columns; a narrow pane drops Ahead and Last active. */
const COLUMNS =
  'grid items-center gap-x-3 grid-cols-[24px_minmax(0,2.6fr)_minmax(0,1.2fr)_84px_minmax(0,1.1fr)_minmax(0,1.2fr)_72px_80px_28px] @max-[900px]:grid-cols-[24px_minmax(0,2.6fr)_minmax(0,1.2fr)_84px_minmax(0,1.2fr)_72px_28px]';
const NARROW_HIDDEN = '@max-[900px]:hidden';
const DOT: Record<'working' | 'needs-you' | 'idle', string> = { working: 'bg-accent-ink', 'needs-you': 'bg-warn', idle: 'bg-faint' };

type Line = { kind: 'header'; group: Exclude<WorktreeGroup, 'main'>; rows: WorktreeRow[] } | { kind: 'row'; row: WorktreeRow };

/** Shows a folder in Finder (File Explorer on Windows), through the engine's list of apps that open folders. */
async function revealInFileManager(client: EngineClient, path: string): Promise<void> {
  const known = useHosts.getState().editors;
  const editors = known.length ? known : (await client.call('editors.list', {})).editors;
  const finder = editors.find((editor) => editor.kind === 'finder');
  if (!finder) throw new Error(`${fileManagerName()} is not available`);
  await client.call('editors.open', { path, editorId: finder.id });
}

const dash = <span className="text-faint">—</span>;

function Stat({ value, label, tone = '' }: { value: ReactNode; label: string; tone?: string }) {
  return (
    <div className="grid">
      <span className={`text-title font-semibold tabular-nums ${tone}`}>{value}</span>
      <span className="text-meta text-muted">{label}</span>
    </div>
  );
}

/**
 * A project's worktrees: every entry of `git worktree list`, grouped by what to do with it (Safe to remove, Probably
 * done, Keep with its reason, Stale), with their sessions, changes, commits, merge or PR state, size and last
 * activity. Rows that can go are picked with checkboxes (shift-click for a range, Space on a row) and removed after
 * one confirmation; nothing here is ever deleted any other way than `git worktree remove` or `prune`.
 */
export function WorktreesTab({ root, name, scrollRef }: { root: string; name: string; scrollRef: RefObject<HTMLDivElement | null> }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const openIn = useOpenIn();
  const { state, rows } = useWorktreeRows(root);
  const sizes = useWorktreeSizes(state.list);
  const sessionRows = useAllSessionRows();
  const home = useMemo(() => /^(\/Users\/[^/]+|\/home\/[^/]+)/.exec(root)?.[1] ?? null, [root]);
  const pendingCleanup = useProjectPage((s) => s.pendingCleanup);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  const anchor = useRef<string | null>(null);
  const shift = useRef(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: WorktreeRow } | null>(null);
  const [cleanup, setCleanup] = useState<WorktreeEntry[] | null>(null);
  const [failures, setFailures] = useState<WorktreeRemoveResult[]>([]);
  const [merging, setMerging] = useState<{ entry: WorktreeEntry; sessionId: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Safe and stale rows start picked, the first time the list is read; later reads keep your picks where still allowed.
  useEffect(() => {
    if (!state.list) return;
    if (!seeded.current) {
      seeded.current = true;
      setSelected(defaultSelection(rows));
    } else setSelected((s) => validSelection(s, rows));
  }, [rows, state.list]);

  // "Clean up worktrees in …" from the palette: the confirmation for what is suggested, once the list is here.
  useEffect(() => {
    if (pendingCleanup !== root || !state.list) return;
    useProjectPage.getState().clearCleanup();
    const picks = rows.filter((r) => defaultSelection(rows).has(r.entry.path)).map((r) => r.entry);
    if (picks.length) setCleanup(picks);
    else toast(`Nothing to clean up in ${name}`);
  }, [pendingCleanup, root, state.list, rows, name]);

  const groups = useMemo(() => groupRows(rows), [rows]);
  const order = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const lines = useMemo<Line[]>(() => groups.flatMap((g): Line[] => (g.group === 'main' ? g.rows.map((row) => ({ kind: 'row', row })) : [{ kind: 'header', group: g.group, rows: g.rows }, ...g.rows.map((row): Line => ({ kind: 'row', row }))])), [groups]);
  const summary = worktreeSummary(rows, sizes);
  const picked = order.filter((r) => selected.has(r.entry.path));
  const frees = freedBytes(
    picked.filter((r) => !r.entry.missing).map((r) => r.entry.path),
    sizes,
  );
  const measured = rows.filter((r) => !r.entry.missing).map((r) => sizes.get(r.entry.path));
  const sizesNote = measured.some((s) => !s) ? 'Measuring sizes…' : measured.length ? `Sizes updated ${agoText(Math.min(...measured.map((s) => s!.at)))}` : null;
  const tabStop = focused && order.some((r) => r.entry.path === focused) ? focused : (order[0]?.entry.path ?? null);
  const baseName = state.list?.baseBranch ?? 'the base branch';

  // Virtualised only for long lists; the page scrolls, so the list's place in it is the scroll margin.
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  const virtual = order.length > VIRTUALIZE_FROM;
  useLayoutEffect(() => {
    const list = listRef.current;
    const scroller = scrollRef.current;
    if (!virtual || !list || !scroller) return;
    setScrollMargin(list.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop);
  }, [virtual, scrollRef, lines.length, failures.length]);
  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (lines[i]!.kind === 'header' ? 40 : 58),
    getItemKey: (i) => {
      const line = lines[i]!;
      return line.kind === 'header' ? `header:${line.group}` : line.row.entry.path;
    },
    overscan: 8,
    scrollMargin,
    enabled: virtual,
  });

  const refresh = async () => {
    if (!client) return;
    setRefreshing(true);
    const list = await loadWorktrees(client, root, { fetch: true });
    if (list) requestSizes(client, list, true);
    setRefreshing(false);
  };

  const pick = (row: WorktreeRow, range: boolean) => {
    setSelected((s) => toggleSelection(s, order, row.entry.path, anchor.current, range));
    anchor.current = row.entry.path;
  };

  const focusRow = (path: string) => {
    setFocused(path);
    const index = lines.findIndex((l) => l.kind === 'row' && l.row.entry.path === path);
    if (virtual && index !== -1) virtualizer.scrollToIndex(index, { align: 'auto' });
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-worktree-row="${CSS.escape(path)}"]`)?.focus());
  };

  const openMenu = (row: WorktreeRow, at: { x: number; y: number }) => setMenu({ ...at, row });
  const menuBelow = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + 24, y: rect.top + Math.min(rect.height, 40) };
  };

  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, row: WorktreeRow) => {
    if (event.target !== event.currentTarget) return;
    const index = order.indexOf(row);
    if (event.key === ' ') {
      event.preventDefault();
      if (!row.locked) pick(row, event.shiftKey);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = order[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) focusRow(next.entry.path);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? order[0] : order.at(-1);
      if (next) focusRow(next.entry.path);
    } else if (isContextMenuKey(event)) {
      event.preventDefault();
      openMenu(row, menuBelow(event.currentTarget));
    }
  };

  /** The newest session in a worktree, to open it or run a merge in its terminal. */
  const newestSession = (entry: WorktreeEntry) =>
    entry.sessions
      .map((id) => sessionRows.get(id))
      .filter((r) => r !== undefined)
      .sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? entry.sessions[0] ?? null;

  const push = async (entry: WorktreeEntry) => {
    if (!client) return;
    try {
      await client.call('worktrees.push', { path: entry.path });
      toast(`Pushed ${entry.branch}`);
      void loadWorktrees(client, root);
    } catch (e) {
      toast(`Couldn't push ${entry.branch}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const menuEntries = (row: WorktreeRow): MenuEntry[] => {
    const { entry } = row;
    const session = newestSession(entry);
    const fail = (what: string) => (e: unknown) => toast(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
    const general: MenuEntry[] = [
      { title: entry.isMain ? 'Main checkout' : entry.name, detail: entry.branch ?? 'detached HEAD' },
      { label: 'Open its session', icon: <MessagesSquare size={13} />, disabled: !session, onSelect: () => session && useSessions.getState().select(session), data: { 'data-worktree-open-session': true } },
      {
        label: 'New session in this worktree',
        icon: <SquarePen size={13} />,
        disabled: entry.missing,
        onSelect: () => {
          useProjects.getState().startIn(entry.path);
          useSessions.getState().openNewSession();
        },
      },
      { label: 'Open in editor', icon: <FolderOpen size={13} />, disabled: entry.missing, onSelect: () => void openIn(entry.path).catch(fail('open the editor')) },
      { label: `Reveal in ${fileManagerName()}`, icon: <Search size={13} />, disabled: entry.missing || !client, onSelect: () => client && void revealInFileManager(client, entry.path).catch(fail(`show the folder in ${fileManagerName()}`)) },
      { label: 'Copy path', icon: <Copy size={13} />, onSelect: () => void navigator.clipboard.writeText(entry.path).then(() => toast('Copied the path'), fail('copy the path')) },
    ];
    if (entry.isMain) return general;
    const mergeBlocked = entry.missing
      ? 'The folder is gone'
      : !entry.branch
        ? 'HEAD is detached'
        : entry.uncommitted > 0
          ? 'Commit or revert the uncommitted changes first'
          : entry.merged || entry.ahead === 0
            ? `Nothing to merge into ${baseName}`
            : !session
              ? 'A merge runs in the terminal of a session here; start one first'
              : null;
    const pushBlocked = entry.missing ? 'The folder is gone' : !entry.branch ? 'HEAD is detached' : entry.upstream && entry.pushed && entry.unpushed === 0 ? 'Everything is pushed' : null;
    const why = [mergeBlocked && `Merge: ${mergeBlocked}.`, pushBlocked && entry.branch && !entry.missing && `Push: ${pushBlocked}.`, row.locked && `Remove: ${row.locked}.`].filter((t): t is string => !!t);
    return [
      ...general,
      'separator',
      { label: `Merge into ${baseName}…`, icon: <GitMerge size={13} />, disabled: mergeBlocked !== null, onSelect: () => session && setMerging({ entry, sessionId: session }) },
      { label: 'Push branch', icon: <ArrowUp size={13} />, disabled: pushBlocked !== null, onSelect: () => void push(entry) },
      { label: 'Remove worktree…', icon: <Trash2 size={13} />, danger: true, disabled: row.locked !== null, onSelect: () => setCleanup([entry]), data: { 'data-worktree-remove-one': true } },
      ...(why.length ? (['separator', ...why.map((note) => ({ note }))] as MenuEntry[]) : []),
    ];
  };

  const renderRow = (row: WorktreeRow) => {
    const { entry } = row;
    const isPicked = selected.has(entry.path);
    const sessions = sessionsLabel(row.sessions);
    const ahead = aheadLabel(entry);
    const merge = mergeLabel(entry);
    const size = entry.missing ? 0 : entry.isMain ? mainCheckoutBytes(rows, sizes) : (sizes.get(entry.path)?.bytes ?? null);
    const where = entry.path !== root && isSameOrInside(entry.path, root) ? entry.path.slice(root.replace(/[\\/]+$/, '').length + 1) : tildify(entry.path, home);
    const label = entry.isMain ? 'Main checkout' : entry.name;
    return (
      <div
        role="row"
        tabIndex={tabStop === entry.path ? 0 : -1}
        aria-selected={row.locked ? undefined : isPicked}
        aria-label={[label, entry.branch, row.reason].filter(Boolean).join(', ')}
        data-worktree-row={entry.path}
        data-group={row.group}
        data-locked={row.locked ? true : undefined}
        data-picked={isPicked || undefined}
        onFocus={(e) => e.target === e.currentTarget && setFocused(entry.path)}
        onKeyDown={(e) => onRowKey(e, row)}
        onContextMenu={(e: MouseEvent<HTMLDivElement>) => {
          e.preventDefault();
          openMenu(row, e.clientX === 0 && e.clientY === 0 ? menuBelow(e.currentTarget) : { x: e.clientX, y: e.clientY });
        }}
        className={`${COLUMNS} min-h-14 border-t border-border px-4 py-2.5 ${isPicked ? 'bg-selected' : 'hover:bg-border/45'}`}
      >
        <span role="cell" className="flex justify-center" onClickCapture={(e) => (shift.current = e.shiftKey)}>
          {row.locked ? (
            <span role="img" aria-label={row.locked} data-tooltip={row.locked} className="text-faint">
              <Lock size={13} aria-hidden />
            </span>
          ) : (
            <Checkbox checked={isPicked} onChange={() => pick(row, shift.current)} label={`Pick ${label}`} tooltip={`Pick ${label} (${localizeKeys('⇧-click')} for a range)`} dataAttrs={{ 'data-worktree-pick': entry.path }} />
          )}
        </span>
        <span role="cell" className="grid min-w-0 gap-px">
          <span className="truncate text-ui font-semibold">{label}</span>
          <span className="flex min-w-0 items-center gap-1 font-mono text-meta text-muted" data-tooltip={entry.path}>
            <GitBranch size={11} className="shrink-0" aria-hidden />
            <span className="truncate">
              {entry.branch ?? 'detached HEAD'} · {where}
            </span>
          </span>
          {row.reason && <span className="truncate text-meta text-caution">{row.reason}</span>}
        </span>
        <span role="cell" className="flex min-w-0 items-center gap-1.5 text-ui">
          {sessions ? (
            <>
              <span className={`size-1.5 shrink-0 rounded-full ${DOT[sessions.tone]}`} aria-hidden />
              <span className={`truncate ${sessions.tone === 'working' ? 'text-accent-ink' : sessions.tone === 'needs-you' ? 'text-warn' : 'text-text'}`}>{sessions.text}</span>
            </>
          ) : (
            dash
          )}
        </span>
        <span role="cell" className="min-w-0">
          {entry.missing ? (
            <span className="text-ui text-muted">missing</span>
          ) : entry.uncommitted > 0 ? (
            <Pill tone="caution">{entry.uncommitted === 1 ? '1 file' : `${entry.uncommitted} files`}</Pill>
          ) : (
            <Pill tone="ok">clean</Pill>
          )}
        </span>
        <span role="cell" className={`truncate text-ui ${ahead?.caution ? 'text-caution' : ''} ${NARROW_HIDDEN}`}>
          {ahead ? ahead.text : dash}
        </span>
        <span role="cell" className="min-w-0">
          {merge ? (
            <Pill tone={merge.tone === 'muted' ? 'muted' : merge.tone} shrink icon={merge.tone === 'ok' ? <GitMerge size={11} aria-hidden /> : undefined} data-tooltip={entry.pr?.url}>
              <span className="truncate">{merge.text}</span>
            </Pill>
          ) : (
            dash
          )}
        </span>
        <span role="cell" className="font-mono text-meta text-muted tabular-nums">
          {size === null ? '…' : formatBytes(size)}
        </span>
        <span role="cell" className={`truncate text-ui text-muted ${NARROW_HIDDEN}`}>
          {entry.lastActivity ? agoText(entry.lastActivity) : dash}
        </span>
        <span role="cell" className="flex justify-end">
          {!entry.isMain && (
            <Button
              variant="quiet"
              size="sm"
              iconOnly
              icon={<Ellipsis size={14} aria-hidden />}
              aria-label={`Options for ${label}`}
              aria-haspopup="menu"
              tabIndex={-1}
              onClick={(e) => openMenu(row, menuBelow(e.currentTarget))}
              data-worktree-more={entry.path}
            />
          )}
        </span>
      </div>
    );
  };

  const renderHeader = (line: Extract<Line, { kind: 'header' }>) => {
    const pickable = line.rows.filter((r) => !r.locked).map((r) => r.entry.path);
    const all = pickable.length > 0 && pickable.every((p) => selected.has(p));
    return (
      <div className="border-t border-border bg-border/20 px-4 py-2" data-worktree-group={line.group}>
        <SectionHeader
          as="h3"
          tone={GROUP_TONE[line.group]}
          count={line.rows.length}
          className="h-6"
          action={
            <>
              {GROUP_NOTE[line.group] && <span className="ml-1.5 min-w-0 truncate font-normal tracking-normal text-muted normal-case">{GROUP_NOTE[line.group]}</span>}
              {line.group === 'safe' && pickable.length > 0 && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="ml-auto tracking-normal normal-case"
                  onClick={() =>
                    setSelected((s) => {
                      const next = new Set(s);
                      for (const path of pickable) {
                        if (all) next.delete(path);
                        else next.add(path);
                      }
                      return next;
                    })
                  }
                  data-worktree-select-all
                >
                  {all ? 'Deselect all' : 'Select all'}
                </Button>
              )}
              {line.group === 'stale' && pickable.length > 0 && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="ml-auto tracking-normal normal-case"
                  data-tooltip="Clears git's entries for folders that are gone (git worktree prune)"
                  onClick={() => setCleanup(line.rows.filter((r) => !r.locked).map((r) => r.entry))}
                  data-worktree-prune
                >
                  Prune
                </Button>
              )}
            </>
          }
        >
          {GROUP_LABEL[line.group]}
        </SectionHeader>
      </div>
    );
  };

  const renderLine = (line: Line) => (line.kind === 'header' ? renderHeader(line) : renderRow(line.row));

  if (state.notRepo) {
    return (
      <Notice tone="info" icon={<GitBranch size={13} aria-hidden />} data-worktrees-not-repo>
        {name} isn't a git repository, so it has no worktrees.
      </Notice>
    );
  }
  if (!state.list) {
    return state.error ? (
      <Notice tone="error" actions={<Button size="sm" onClick={() => client && void loadWorktrees(client, root)}>Try again</Button>}>
        Couldn't read the worktrees: {state.error}
      </Notice>
    ) : (
      <p className="text-ui text-muted" data-worktrees-loading>
        Reading worktrees…
      </p>
    );
  }

  const onlyMain = rows.length === 1;
  return (
    <div className="grid gap-4" data-worktrees-tab>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-5 py-3.5" data-worktree-summary>
        <Stat value={summary.count} label={summary.count === 1 ? 'worktree' : 'worktrees'} />
        <Stat value={summary.bytes === 0 && summary.unknown ? '…' : `${formatBytes(summary.bytes)}${summary.unknown ? '…' : ''}`} label="on disk" />
        <Stat value={summary.safe} label="safe to remove" tone={summary.safe ? 'text-ok' : ''} />
        <Stat value={summary.stale} label="stale" tone={summary.stale ? 'text-error' : ''} />
        <span className="ml-auto flex items-center gap-1.5 text-meta text-muted">
          <HardDrive size={12} aria-hidden />
          {sizesNote && <span>{sizesNote} ·</span>}
          <Button variant="quiet" size="sm" icon={<RefreshCw size={12} aria-hidden className={refreshing ? 'animate-spin' : ''} />} disabled={refreshing || state.loading} onClick={() => void refresh()} data-tooltip="Fetch, then read every worktree and measure them again" data-worktree-refresh>
            Refresh
          </Button>
        </span>
        <Button variant="danger" disabled={picked.length === 0} onClick={() => setCleanup(picked.map((r) => r.entry))} data-worktree-remove>
          {picked.length ? `Remove ${picked.length} selected…` : 'Remove selected…'}
          {frees.bytes > 0 && <span className="font-normal opacity-80">frees {formatBytes(frees.bytes)}</span>}
        </Button>
      </div>

      {failures.length > 0 && (
        <Notice tone="error" onDismiss={() => setFailures([])} data-worktree-failures>
          <p className="font-semibold">{failures.length === 1 ? 'One worktree was not removed:' : `${failures.length} worktrees were not removed:`}</p>
          <ul className="mt-1 grid gap-0.5">
            {failures.map((f) => (
              <li key={f.path}>
                <span className="font-mono">{rows.find((r) => r.entry.path === f.path)?.entry.name ?? f.path}</span>: {f.error}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <p className="text-meta text-muted" data-worktrees-memory-note>
        Worktrees of this project share one memory folder.
      </p>
      <div role="table" aria-label={`Worktrees of ${name}`} aria-rowcount={order.length + 1} className="@container rounded-xl border border-border bg-card" data-worktrees-table>
        <div role="row" className={`${COLUMNS} sticky top-0 z-10 rounded-t-xl border-b border-border bg-card px-4 py-2.5 text-meta font-semibold tracking-wider text-faint uppercase`}>
          {/* The cell keeps its place in the grid; only its text is for screen readers. */}
          <span role="columnheader">
            <span className="sr-only">Picked</span>
          </span>
          <span role="columnheader">Worktree</span>
          <span role="columnheader">Sessions</span>
          <span role="columnheader">Changes</span>
          <span role="columnheader" className={NARROW_HIDDEN}>
            Ahead of {state.list.baseBranch ?? 'base'}
          </span>
          <span role="columnheader">Merged / PR</span>
          <span role="columnheader">Size</span>
          <span role="columnheader" className={NARROW_HIDDEN}>
            Last active
          </span>
          <span role="columnheader">
            <span className="sr-only">Options</span>
          </span>
        </div>
        <div ref={listRef} role="rowgroup" className="[&>*:first-child]:border-t-0">
          {virtual ? (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((item) => (
                <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start - scrollMargin}px)` }}>
                  {renderLine(lines[item.index]!)}
                </div>
              ))}
            </div>
          ) : (
            lines.map((line) => <div key={line.kind === 'header' ? `header:${line.group}` : line.row.entry.path}>{renderLine(line)}</div>)
          )}
        </div>
        {onlyMain && (
          <p className="border-t border-border px-4 py-5 text-center text-ui text-muted" data-worktrees-empty>
            No worktrees besides the main checkout.
          </p>
        )}
      </div>

      {menu && <Menu x={menu.x} y={menu.y} width={240} entries={menuEntries(menu.row)} label={`Worktree ${menu.row.entry.name}`} onClose={() => setMenu(null)} />}
      {cleanup && (
        <CleanupDialog
          root={root}
          entries={cleanup}
          sizes={sizes}
          onClose={() => setCleanup(null)}
          onDone={(results) => {
            setFailures(results.filter((r) => !r.ok));
            setSelected((s) => new Set([...s].filter((path) => !results.some((r) => r.ok && r.path === path))));
            if (client) void loadWorktrees(client, root);
          }}
        />
      )}
      {merging && client && (
        <ConfirmDialog
          title={`Merge ${merging.entry.branch} into ${baseName}?`}
          confirmLabel="Merge"
          body={
            <p>
              Merges {merging.entry.ahead === 1 ? '1 commit' : `${merging.entry.ahead} commits`} into {baseName} in the main checkout (<span className="font-mono">{tildify(root, home)}</span>), in a terminal tab of
              its session so you can see the result. The worktree stays; remove it afterwards.
            </p>
          }
          onConfirm={async () => {
            await client.call('worktree.finish', { sessionId: merging.sessionId, cwd: merging.entry.path, action: 'merge', deleteBranch: false });
            useSessions.getState().select(merging.sessionId);
            useTerminals.getState().togglePanel(merging.sessionId, true);
          }}
          onClose={() => setMerging(null)}
        />
      )}
    </div>
  );
}
