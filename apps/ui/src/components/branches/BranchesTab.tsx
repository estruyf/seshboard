import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowRightLeft, Copy, Ellipsis, ExternalLink, GitBranch, Lock, RefreshCw, Search, Trash2 } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import type { BranchDeleteResult } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { isContextMenuKey } from '../../lib/contextMenu.ts';
import { agoText } from '../../lib/format.ts';
import { localizeKeys } from '../../lib/shortcuts.ts';
import { loadBranches, useBranchRows } from '../../state/branchesStore.ts';
import { useCheckoutBranches } from '../../state/checkoutBranchesStore.ts';
import { toast } from '../../state/toastStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader, type SectionTone } from '../ui/SectionHeader.tsx';
import {
  baseLabel,
  branchSummary,
  defaultSelection,
  filterRows,
  GROUP_LABEL,
  GROUP_NOTE,
  groupRows,
  localLabel,
  prLabel,
  switchAction,
  toggleSelection,
  validSelection,
  type BranchGroup,
  type BranchRow,
  type DeleteScope,
} from './branchGroups.ts';
import { sharedWarning } from '../worktree/branchMenu.ts';
import { useSharingCheckout } from '../worktree/useSharingCheckout.ts';
import { DeleteBranchesDialog } from './DeleteBranchesDialog.tsx';

/** Above this many branches the table only renders the rows in view. */
const VIRTUALIZE_FROM = 50;
const GROUP_TONE: Record<BranchGroup, SectionTone> = { 'in-use': 'neutral', safe: 'ok', gone: 'info', inactive: 'caution', active: 'neutral' };
/** The table's columns; a narrow pane drops PR and Last commit. */
const COLUMNS =
  'grid items-center gap-x-3 grid-cols-[24px_minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,0.9fr)_84px_28px] @max-[900px]:grid-cols-[24px_minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_28px]';
const NARROW_HIDDEN = '@max-[900px]:hidden';

type Line = { kind: 'header'; group: BranchGroup; rows: BranchRow[] } | { kind: 'row'; row: BranchRow };

const dash = <span className="text-faint">—</span>;

function Stat({ value, label, tone = '' }: { value: number; label: string; tone?: string }) {
  return (
    <div className="grid">
      <span className={`text-title font-semibold tabular-nums ${tone}`}>{value}</span>
      <span className="text-meta text-muted">{label}</span>
    </div>
  );
}

/**
 * A project's branches, here and on its remotes: one row per branch with its local copy (pushed or not, checked out,
 * upstream gone), its copy on the remote, where it stands against the base, its pull request and its last commit,
 * grouped by what to do with it (In use, Safe to delete, Deleted on the remote, Inactive, Active). Rows are picked
 * with checkboxes (shift-click for a range, Space on a row) and deleted after one confirmation, which says whether
 * the local copies, the remote ones or both go. A row's menu switches the main checkout to its branch, or, on the
 * branch checked out there, back to the base so that branch can be deleted.
 */
export function BranchesTab({ root, name, scrollRef }: { root: string; name: string; scrollRef: RefObject<HTMLDivElement | null> }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const { state, rows } = useBranchRows(root);

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const seeded = useRef(false);
  const anchor = useRef<string | null>(null);
  const shift = useRef(false);
  const [focused, setFocused] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: BranchRow } | null>(null);
  const [deleting, setDeleting] = useState<{ rows: BranchRow[]; scope: DeleteScope } | null>(null);
  const [failures, setFailures] = useState<BranchDeleteResult[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  // Live sessions in the main checkout see a switch too, so it's asked first.
  const [confirmSwitch, setConfirmSwitch] = useState<string | null>(null);
  const sharers = useSharingCheckout(state.list?.root ?? root);

  // Safe local branches start picked, the first time the list is read; later reads keep your picks where still allowed.
  useEffect(() => {
    if (!state.list) return;
    if (!seeded.current) {
      seeded.current = true;
      setSelected(defaultSelection(rows));
    } else setSelected((s) => validSelection(s, rows));
  }, [rows, state.list]);

  const shown = useMemo(() => filterRows(rows, query), [rows, query]);
  const groups = useMemo(() => groupRows(shown), [shown]);
  const order = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const lines = useMemo<Line[]>(() => groups.flatMap((g): Line[] => [{ kind: 'header', group: g.group, rows: g.rows }, ...g.rows.map((row): Line => ({ kind: 'row', row }))]), [groups]);
  const summary = branchSummary(rows);
  // Picks hidden by the filter still count: the button says what it deletes.
  const picked = rows.filter((r) => selected.has(r.key));
  const tabStop = focused && order.some((r) => r.key === focused) ? focused : (order[0]?.key ?? null);
  const base = state.list?.baseBranch ?? null;
  const remoteName = state.list?.remotes.includes('origin') ? 'origin' : (state.list?.remotes[0] ?? 'the remote');

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
    estimateSize: (i) => (lines[i]!.kind === 'header' ? 40 : 54),
    getItemKey: (i) => {
      const line = lines[i]!;
      return line.kind === 'header' ? `header:${line.group}` : line.row.key;
    },
    overscan: 8,
    scrollMargin,
    enabled: virtual,
  });

  const refresh = async () => {
    if (!client) return;
    setRefreshing(true);
    await loadBranches(client, root, { fetch: true });
    setRefreshing(false);
  };

  /** Switches the main checkout to `branch`; git keeps uncommitted changes, or refuses when they'd be lost. */
  const switchTo = async (branch: string) => {
    if (!client || !state.list) return;
    setSwitching(branch);
    try {
      const result = await client.call('git.switch', { cwd: state.list.root, branch });
      // Session headers and sidebar rows of the sessions in this checkout show the new branch too.
      useCheckoutBranches.getState().set([state.list.root, ...sharers.cwds], result.current);
      useCheckoutBranches.getState().switched();
      toast(`Switched to ${branch}`);
    } finally {
      setSwitching(null);
      void loadBranches(client, root);
    }
  };

  const askSwitch = (branch: string) => {
    if (sharers.ids.length > 0) return setConfirmSwitch(branch);
    switchTo(branch).catch((e: unknown) => toast(`Couldn't switch to ${branch}: ${e instanceof Error ? e.message : String(e)}`));
  };

  const pick = (row: BranchRow, range: boolean) => {
    setSelected((s) => toggleSelection(s, order, row.key, anchor.current, range));
    anchor.current = row.key;
  };

  const focusRow = (key: string) => {
    setFocused(key);
    const index = lines.findIndex((l) => l.kind === 'row' && l.row.key === key);
    if (virtual && index !== -1) virtualizer.scrollToIndex(index, { align: 'auto' });
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-branch-row="${CSS.escape(key)}"]`)?.focus());
  };

  const openMenu = (row: BranchRow, at: { x: number; y: number }) => setMenu({ ...at, row });
  const menuBelow = (el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + 24, y: rect.top + Math.min(rect.height, 40) };
  };

  const onRowKey = (event: KeyboardEvent<HTMLDivElement>, row: BranchRow) => {
    if (event.target !== event.currentTarget) return;
    const index = order.indexOf(row);
    if (event.key === ' ') {
      event.preventDefault();
      if (!row.locked) pick(row, event.shiftKey);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = order[index + (event.key === 'ArrowDown' ? 1 : -1)];
      if (next) focusRow(next.key);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? order[0] : order.at(-1);
      if (next) focusRow(next.key);
    } else if (isContextMenuKey(event)) {
      event.preventDefault();
      openMenu(row, menuBelow(event.currentTarget));
    }
  };

  const menuEntries = (row: BranchRow): MenuEntry[] => {
    const { entry } = row;
    const fail = (what: string) => (e: unknown) => toast(`Couldn't ${what}: ${e instanceof Error ? e.message : String(e)}`);
    const canLocal = !!entry.local && !row.localLock;
    const canRemote = !!entry.remote && !row.remoteLock;
    const remote = entry.remote?.ref ?? `${remoteName}/${entry.name}`;
    const toSwitch = state.list ? switchAction(entry, state.list.branches, state.list.root) : null;
    const switchBlocked = toSwitch?.blocked ?? (switching ? `Switching to ${switching}` : null);
    const why = [
      toSwitch?.blocked && `Switch: ${toSwitch.blocked}.`,
      entry.local && row.localLock && `Here: ${row.localLock}.`,
      entry.remote && row.remoteLock && `${entry.remote.ref}: ${row.remoteLock}.`,
    ].filter((t): t is string => !!t);
    return [
      { title: entry.name, detail: entry.subject ?? undefined },
      ...(toSwitch
        ? [{ label: toSwitch.label, icon: <ArrowRightLeft size={13} />, disabled: switchBlocked !== null, onSelect: () => askSwitch(toSwitch.branch), data: { 'data-branch-switch': toSwitch.branch } }]
        : []),
      { label: 'Copy branch name', icon: <Copy size={13} />, onSelect: () => void navigator.clipboard.writeText(entry.name).then(() => toast('Copied the branch name'), fail('copy the branch name')) },
      ...(entry.pr ? [{ label: `Open pull request #${entry.pr.number}`, icon: <ExternalLink size={13} />, onSelect: () => void window.open(entry.pr!.url, '_blank') }] : []),
      'separator',
      { label: 'Delete local branch…', icon: <Trash2 size={13} />, danger: true, disabled: !canLocal, onSelect: () => setDeleting({ rows: [row], scope: { local: true, remote: false } }), data: { 'data-branch-delete-local-one': true } },
      { label: `Delete ${remote}…`, icon: <Trash2 size={13} />, danger: true, disabled: !canRemote, onSelect: () => setDeleting({ rows: [row], scope: { local: false, remote: true } }), data: { 'data-branch-delete-remote-one': true } },
      ...(entry.local && entry.remote ? [{ label: 'Delete both…', icon: <Trash2 size={13} />, danger: true, disabled: !canLocal || !canRemote, onSelect: () => setDeleting({ rows: [row], scope: { local: true, remote: true } }) }] : []),
      ...(why.length ? (['separator', ...why.map((note) => ({ note }))] as MenuEntry[]) : []),
    ];
  };

  const renderRow = (row: BranchRow) => {
    const { entry } = row;
    const isPicked = selected.has(row.key);
    const here = localLabel(entry);
    const vsBase = baseLabel(entry);
    const pr = prLabel(entry);
    return (
      <div
        role="row"
        tabIndex={tabStop === row.key ? 0 : -1}
        aria-selected={row.locked ? undefined : isPicked}
        aria-label={[entry.name, entry.local ? null : 'only on the remote', row.locked].filter(Boolean).join(', ')}
        data-branch-row={row.key}
        data-group={row.group}
        data-locked={row.locked ? true : undefined}
        data-base={row.entry.isBase ? true : undefined}
        data-picked={isPicked || undefined}
        onFocus={(e) => e.target === e.currentTarget && setFocused(row.key)}
        onKeyDown={(e) => onRowKey(e, row)}
        onContextMenu={(e: MouseEvent<HTMLDivElement>) => {
          e.preventDefault();
          openMenu(row, e.clientX === 0 && e.clientY === 0 ? menuBelow(e.currentTarget) : { x: e.clientX, y: e.clientY });
        }}
        className={`${COLUMNS} min-h-13 border-t border-border px-4 py-2 ${isPicked ? 'bg-selected' : 'hover:bg-border/45'}`}
      >
        <span role="cell" className="flex justify-center" onClickCapture={(e) => (shift.current = e.shiftKey)}>
          {row.locked ? (
            <span role="img" aria-label={row.locked} data-tooltip={row.locked} className="text-faint">
              <Lock size={13} aria-hidden />
            </span>
          ) : (
            <Checkbox checked={isPicked} onChange={() => pick(row, shift.current)} label={`Pick ${entry.name}`} tooltip={`Pick ${entry.name} (${localizeKeys('⇧-click')} for a range)`} dataAttrs={{ 'data-branch-pick': row.key }} />
          )}
        </span>
        <span role="cell" className="grid min-w-0 gap-px">
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranch size={12} className="shrink-0 text-muted" aria-hidden />
            <span className="truncate font-mono text-ui font-semibold" data-tooltip={entry.name}>
              {entry.name}
            </span>
          </span>
          {entry.subject && (
            <span className="truncate text-meta text-muted" data-tooltip={entry.author ? `${entry.subject} (${entry.author})` : entry.subject}>
              {entry.subject}
            </span>
          )}
        </span>
        <span role="cell" className="flex min-w-0">
          {here ? (
            <Pill tone={here.tone === 'default' ? 'default' : here.tone} shrink data-tooltip={entry.local?.checkedOutIn ?? (row.localLock || undefined)}>
              <span className="truncate">{here.text}</span>
            </Pill>
          ) : (
            dash
          )}
        </span>
        <span role="cell" className="flex min-w-0 items-center gap-1 font-mono text-meta text-muted">
          {entry.remote ? (
            <>
              <span className="truncate">{entry.remote.ref}</span>
              {row.remoteLock && (
                <span role="img" aria-label={row.remoteLock} data-tooltip={row.remoteLock} className="shrink-0 text-faint">
                  <Lock size={11} aria-hidden />
                </span>
              )}
            </>
          ) : (
            dash
          )}
        </span>
        <span role="cell" className={`truncate text-ui ${vsBase?.tone === 'ok' ? 'text-ok' : vsBase?.tone === 'muted' ? 'text-muted' : ''}`}>
          {vsBase ? vsBase.text : dash}
        </span>
        <span role="cell" className={`flex min-w-0 ${NARROW_HIDDEN}`}>
          {pr ? (
            <Pill tone={pr.tone} shrink onClick={() => void window.open(entry.pr!.url, '_blank')} data-tooltip={entry.pr!.url}>
              <span className="truncate">{pr.text}</span>
            </Pill>
          ) : (
            dash
          )}
        </span>
        <span role="cell" className={`truncate text-ui text-muted ${NARROW_HIDDEN}`}>
          {entry.lastCommitAt ? agoText(entry.lastCommitAt) : dash}
        </span>
        <span role="cell" className="flex justify-end">
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<Ellipsis size={14} aria-hidden />}
            aria-label={`Options for ${entry.name}`}
            aria-haspopup="menu"
            tabIndex={-1}
            onClick={(e) => openMenu(row, menuBelow(e.currentTarget))}
            data-branch-more={row.key}
          />
        </span>
      </div>
    );
  };

  const renderHeader = (line: Extract<Line, { kind: 'header' }>) => {
    const pickable = line.rows.filter((r) => !r.locked).map((r) => r.key);
    const all = pickable.length > 0 && pickable.every((key) => selected.has(key));
    return (
      <div className="border-t border-border bg-border/20 px-4 py-2" data-branch-group={line.group}>
        <SectionHeader
          as="h3"
          tone={GROUP_TONE[line.group]}
          count={line.rows.length}
          className="h-6"
          action={
            <>
              {GROUP_NOTE[line.group] && <span className="ml-1.5 min-w-0 truncate font-normal tracking-normal text-muted normal-case">{GROUP_NOTE[line.group]}</span>}
              {line.group !== 'in-use' && pickable.length > 1 && (
                <Button
                  variant="quiet"
                  size="sm"
                  className="ml-auto tracking-normal normal-case"
                  onClick={() =>
                    setSelected((s) => {
                      const next = new Set(s);
                      for (const key of pickable) {
                        if (all) next.delete(key);
                        else next.add(key);
                      }
                      return next;
                    })
                  }
                  data-branch-select-all={line.group}
                >
                  {all ? 'Deselect all' : 'Select all'}
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
      <Notice icon={<GitBranch size={13} aria-hidden />} data-branches-not-repo>
        {name} isn't a git repository, so it has no branches.
      </Notice>
    );
  }
  if (!state.list) {
    return state.error ? (
      <Notice tone="error" actions={<Button size="sm" onClick={() => client && void loadBranches(client, root)}>Try again</Button>}>
        Couldn't read the branches: {state.error}
      </Notice>
    ) : (
      <p className="text-ui text-muted" data-branches-loading>
        Reading branches…
      </p>
    );
  }

  const noRemote = state.list.remotes.length === 0;
  return (
    <div className="grid gap-4" data-branches-tab>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border border-border bg-card px-5 py-3.5" data-branch-summary>
        <Stat value={summary.local} label={summary.local === 1 ? 'local branch' : 'local branches'} />
        <Stat value={summary.remote} label={noRemote ? 'no remote' : `on ${state.list.remotes.length === 1 ? state.list.remotes[0] : 'remotes'}`} />
        <Stat value={summary.safe} label="safe to delete" tone={summary.safe ? 'text-ok' : ''} />
        <Stat value={summary.gone} label="deleted on the remote" tone={summary.gone ? 'text-link' : ''} />
        <span className="ml-auto flex items-center gap-1.5 text-meta text-muted">
          {state.loadedAt && <span>Read {agoText(state.loadedAt)} ·</span>}
          <Button
            variant="quiet"
            size="sm"
            icon={<RefreshCw size={12} aria-hidden className={refreshing ? 'animate-spin' : ''} />}
            disabled={refreshing || state.loading}
            onClick={() => void refresh()}
            data-tooltip="Fetch from every remote (dropping branches deleted there), then read the branches again"
            data-branch-refresh
          >
            Refresh
          </Button>
        </span>
        <Button variant="danger" disabled={picked.length === 0} onClick={() => setDeleting({ rows: picked, scope: { local: true, remote: false } })} data-branch-delete-selected>
          {picked.length ? `Delete ${picked.length} selected…` : 'Delete selected…'}
        </Button>
      </div>

      {failures.length > 0 && (
        <Notice tone="error" onDismiss={() => setFailures([])} data-branch-failures>
          <p className="font-semibold">{failures.length === 1 ? 'One branch was not deleted:' : `${failures.length} branches were not deleted:`}</p>
          <ul className="mt-1 grid gap-0.5">
            {failures.map((f) => (
              <li key={f.name}>
                <span className="font-mono">{f.name}</span>: {f.error}
              </li>
            ))}
          </ul>
        </Notice>
      )}

      <div role="table" aria-label={`Branches of ${name}`} aria-rowcount={order.length + 1} className="@container rounded-xl border border-border bg-card" data-branches-table>
        <div className="flex items-center gap-2 border-b border-border px-4 py-2">
          <label className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-border bg-bg px-2 text-faint focus-within:border-accent-ink/60">
            <Search size={13} className="shrink-0" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter branches"
              aria-label="Filter branches by name, remote or last commit"
              spellCheck={false}
              className="h-full min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-muted"
              data-branch-filter
            />
          </label>
          {query && (
            <span className="shrink-0 text-meta text-muted">
              {order.length} of {rows.length}
            </span>
          )}
        </div>
        <div role="row" className={`${COLUMNS} sticky top-0 z-10 border-b border-border bg-card px-4 py-2.5 text-meta font-semibold tracking-wider text-faint uppercase`}>
          {/* The cell keeps its place in the grid; only its text is for screen readers. */}
          <span role="columnheader">
            <span className="sr-only">Picked</span>
          </span>
          <span role="columnheader">Branch</span>
          <span role="columnheader">Local</span>
          <span role="columnheader">Remote</span>
          <span role="columnheader">vs {base ?? 'base'}</span>
          <span role="columnheader" className={NARROW_HIDDEN}>
            Pull request
          </span>
          <span role="columnheader" className={NARROW_HIDDEN}>
            Last commit
          </span>
          <span role="columnheader">
            <span className="sr-only">Options</span>
          </span>
        </div>
        <div ref={listRef} role="rowgroup" className="[&>*:first-child>*]:border-t-0">
          {virtual ? (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((item) => (
                <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${item.start - scrollMargin}px)` }}>
                  {renderLine(lines[item.index]!)}
                </div>
              ))}
            </div>
          ) : (
            lines.map((line) => <div key={line.kind === 'header' ? `header:${line.group}` : line.row.key}>{renderLine(line)}</div>)
          )}
        </div>
        {order.length === 0 && (
          <p className="px-4 py-5 text-center text-ui text-muted" data-branches-empty>
            {query ? 'No branches match.' : 'No branches.'}
          </p>
        )}
      </div>

      {menu && <Menu x={menu.x} y={menu.y} width={260} entries={menuEntries(menu.row)} label={`Branch ${menu.row.entry.name}`} onClose={() => setMenu(null)} />}
      {confirmSwitch && (
        <ConfirmDialog
          title={`Switch to ${confirmSwitch}?`}
          confirmLabel="Switch"
          body={<p>{sharedWarning(sharers.ids.length)}</p>}
          onConfirm={() => switchTo(confirmSwitch)}
          onClose={() => setConfirmSwitch(null)}
        />
      )}
      {deleting && (
        <DeleteBranchesDialog
          root={root}
          rows={deleting.rows}
          initialScope={deleting.scope}
          baseBranch={base}
          onClose={() => setDeleting(null)}
          onDone={(results) => {
            setFailures(results.filter((r) => !r.ok));
            if (client) void loadBranches(client, root);
          }}
        />
      )}
    </div>
  );
}
