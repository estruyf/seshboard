import { ChevronRight, ExternalLink, Maximize2, Minimize2, RefreshCw, Undo2, WrapText, X } from 'lucide-react';
import { memo, useEffect, useId, useMemo, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { create } from 'zustand';
import type { ChangedFile, ChangesBase, GitChanges } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { parseUnifiedDiff } from '../../lib/unifiedDiff.ts';
import { useMemoryView } from '../../state/memoryStore.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { CHANGES_DEFAULT_WIDTH, CHANGES_MAX_SHARE, CHANGES_MIN_WIDTH, changesWidthForKey, clampChangesWidth } from './changesWidth.ts';

const WIDTH_KEY = 'ui.changesWidth';

/** The panel's width (remembered in this browser profile) and whether it fills the session view. */
interface ChangesLayout {
  width: number;
  /** The panel takes the whole session view (the conversation is hidden until it goes back). */
  expanded: boolean;
  setWidth(width: number): void;
  toggleExpanded(expanded?: boolean): void;
}

const readWidth = () => {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY));
    return stored > 0 ? stored : CHANGES_DEFAULT_WIDTH;
  } catch {
    return CHANGES_DEFAULT_WIDTH;
  }
};

export const useChangesLayout = create<ChangesLayout>()((set) => ({
  width: readWidth(),
  expanded: false,
  setWidth: (width) => {
    const next = clampChangesWidth(width, window.innerWidth);
    try {
      localStorage.setItem(WIDTH_KEY, String(next));
    } catch {
      // Remembering the width is a convenience.
    }
    set({ width: next });
  },
  toggleExpanded: (expanded) => set((s) => ({ expanded: expanded ?? !s.expanded })),
}));

const STATUS: Record<ChangedFile['status'], { letter: string; tone: string; label: string }> = {
  added: { letter: 'A', tone: 'text-ok', label: 'Added' },
  untracked: { letter: 'U', tone: 'text-ok', label: 'New, not tracked yet' },
  modified: { letter: 'M', tone: 'text-accent-ink', label: 'Modified' },
  renamed: { letter: 'R', tone: 'text-link', label: 'Renamed' },
  deleted: { letter: 'D', tone: 'text-error', label: 'Deleted' },
  conflicted: { letter: '!', tone: 'text-warn', label: 'Conflict' },
};

/** "3 lines added, 1 removed", for screen readers in place of the coloured "+3 −1". */
/** Counts the change lists the panel has been given, so an open diff reloads whenever git was checked again. */
let changesLoads = 0;

const lineCounts = (added: number, removed: number) => `${added} ${added === 1 ? 'line' : 'lines'} added, ${removed} removed`;

/** One file's diff, loaded when it's opened. */
const FileDiff = memo(function FileDiff({ id, cwd, base, path, version }: { id: string; cwd: string; base: ChangesBase; path: string; version: string }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ diff: string; truncated: boolean } | { error: string } | null>(null);
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    client.call('git.diff', { cwd, base, path }).then(
      (result) => !cancelled && setState(result),
      (error: Error) => !cancelled && setState({ error: `Couldn't load the diff: ${error.message}` }),
    );
    return () => {
      cancelled = true;
    };
    // `version` changes whenever git is checked again, so an open diff follows new edits.
  }, [client, cwd, base, path, version]);
  const rows = useMemo(() => (state && 'diff' in state ? parseUnifiedDiff(state.diff) : []), [state]);
  const wrap = useOverlay((s) => s.diffWrap);

  if (!state)
    return (
      <p id={id} className="px-3 py-2 text-meta text-muted">
        Loading…
      </p>
    );
  if ('error' in state)
    return (
      <p id={id} role="alert" className="px-3 py-2 text-meta text-error">
        {state.error}
      </p>
    );
  if (rows.length === 0)
    return (
      <p id={id} className="px-3 py-2 text-meta text-muted">
        No line changes (only the file mode changed, or the file is empty).
      </p>
    );
  // Unwrapped, the inner block is as wide as the longest line, so every row's colour runs the full
  // width while scrolling sideways; the line numbers stay put.
  const gutter = 'sticky left-0 z-[1] flex shrink-0 self-stretch bg-code';
  return (
    <div id={id} className="overflow-x-auto overscroll-x-contain border-t border-border bg-code font-mono text-ui select-text" data-file-diff data-diff-wrap={wrap}>
      <div className={wrap ? '' : 'w-max min-w-full'}>
        {rows.map((row, i) =>
          row.kind === 'hunk' ? (
            <div key={i} className={`bg-border/30 px-3 text-faint ${wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'}`}>
              @@ {row.text}
            </div>
          ) : row.kind === 'note' ? (
            <div key={i} className="px-3 text-faint italic">
              {row.text}
            </div>
          ) : (
            <div key={i} className={`flex ${row.kind === 'add' ? 'bg-diff-added' : row.kind === 'del' ? 'bg-diff-removed text-text/80' : 'text-muted'}`}>
              {/* The gutter is opaque (it covers lines scrolling under it), so it repeats the row's tint. */}
              <span className={gutter}>
                <span className={`flex ${row.kind === 'add' ? 'bg-diff-added' : row.kind === 'del' ? 'bg-diff-removed' : ''}`}>
                  <span className="w-9 shrink-0 pr-1.5 text-right text-faint/70 select-none">{row.newLine ?? row.oldLine}</span>
                  <span className={`w-4 shrink-0 text-center select-none ${row.kind === 'add' ? 'text-ok' : row.kind === 'del' ? 'text-error' : 'text-faint'}`}>
                    {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                  </span>
                </span>
              </span>
              <span className={`pr-3 ${wrap ? 'min-w-0 break-all whitespace-pre-wrap' : 'whitespace-pre'}`}>{row.text || ' '}</span>
            </div>
          ),
        )}
        {state.truncated && <div className="px-3 py-1 text-muted">… diff shortened (too long to show in full)</div>}
      </div>
    </div>
  );
});

/**
 * The session's changes in git: uncommitted work (stage, unstage, revert), or the
 * whole branch compared with where it left its base branch (what a merge or PR contains).
 */
export function ChangesPanel({
  cwd,
  changes,
  base,
  onBase,
  onRefresh,
  onClose,
}: {
  cwd: string;
  changes: GitChanges | null;
  base: ChangesBase;
  onBase(base: ChangesBase): void;
  onRefresh(): void;
  onClose(): void;
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const openIn = useOpenIn();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reverting, setReverting] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrap = useOverlay((s) => s.diffWrap);
  const toggleWrap = useOverlay((s) => s.toggleDiffWrap);
  const width = useChangesLayout((s) => s.width);
  const setWidth = useChangesLayout((s) => s.setWidth);
  const expanded = useChangesLayout((s) => s.expanded);
  const toggleExpanded = useChangesLayout((s) => s.toggleExpanded);
  const files = changes?.files ?? [];
  const added = files.reduce((n, f) => n + f.additions, 0);
  const removed = files.reduce((n, f) => n + f.deletions, 0);
  const editable = base === 'uncommitted';
  const allStaged = files.length > 0 && files.every((f) => f.staged);
  // Each check of git gives a new list: open diffs reload then, even when a file's +/− counts stay the same.
  const load = useMemo(() => ++changesLoads, [changes]);
  // File paths have spaces and slashes, which don't make good ids for aria-controls.
  const idBase = useId();

  /** Runs a git call, then refreshes; `what` finishes "Couldn't …" when it fails. */
  const run = (call: Promise<unknown>, what: string) =>
    void call.then(
      () => (setError(null), onRefresh()),
      (e: Error) => setError(`Couldn't ${what}: ${e.message}`),
    );
  const toggle = (path: string) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  // Show in Changes (after sharing a memory): open that file's diff once the list has it.
  const changesFocus = useMemoryView((s) => s.changesFocus);
  useEffect(() => {
    if (!changesFocus || !files.some((f) => f.path === changesFocus.path)) return;
    const { path } = changesFocus;
    useMemoryView.setState({ changesFocus: null });
    setOpen((s) => new Set(s).add(path));
    requestAnimationFrame(() => document.querySelector(`[data-changed-file="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [changesFocus, files]);

  // Closing the panel (or moving it to the other pane) brings the conversation back.
  useEffect(() => () => useChangesLayout.getState().toggleExpanded(false), []);

  // Drag the left edge to resize; ← → do the same from the keyboard.
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width;
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => setWidth(startWidth + (startX - e.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = changesWidthForKey(event.key, width, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    setWidth(next);
  };

  return (
    <aside
      aria-label="Changes"
      // Expanded, it fills the session view; otherwise its own width, leaving the conversation some room in a narrow pane.
      className={`relative flex min-w-0 flex-col border-l border-border bg-bg ${expanded ? 'flex-1' : 'max-w-[85%] shrink-0'}`}
      style={expanded ? undefined : { width }}
      data-changes-panel
      data-changes-expanded={expanded}
    >
      {!expanded && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Changes panel width"
          aria-valuenow={width}
          aria-valuemin={CHANGES_MIN_WIDTH}
          aria-valuemax={Math.round(window.innerWidth * CHANGES_MAX_SHARE)}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeByKey}
          className="absolute inset-y-0 -left-0.5 z-10 w-1 cursor-col-resize hover:bg-accent/40 focus-visible:bg-accent/40"
          data-tooltip="Drag (or use ← →) to resize"
          data-changes-resize
        />
      )}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        {/* Arrow keys move between the two, like any radio group; only the chosen one is a Tab stop. */}
        <SegmentedControl
          mode="radio"
          size="sm"
          label="Changes to show"
          value={base}
          onChange={onBase}
          segments={[
            { value: 'uncommitted', label: 'Uncommitted', tooltip: 'Changes not committed yet', data: { 'data-changes-base': 'uncommitted' } },
            { value: 'branch', label: `vs ${changes?.baseBranch ?? 'base'}`, tooltip: `Everything since this branch left ${changes?.baseBranch ?? 'its base'}`, data: { 'data-changes-base': 'branch' } },
          ]}
        />
        <span className="min-w-0 flex-1 truncate text-meta text-muted">
          <span aria-hidden>
            {files.length} {files.length === 1 ? 'file' : 'files'} <span className="text-ok">+{added}</span> <span className="text-error">−{removed}</span>
          </span>
          <span className="sr-only">
            {files.length} {files.length === 1 ? 'file' : 'files'}, {lineCounts(added, removed)}
          </span>
        </span>
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon={<WrapText size={13} />}
          selected={wrap}
          onClick={toggleWrap}
          aria-pressed={wrap}
          data-tooltip={wrap ? 'Wrapping long lines (click to scroll sideways instead)' : 'Wrap long lines'}
          aria-label="Wrap long lines"
          data-diff-wrap-toggle
        />
        <Button
          variant="quiet"
          size="sm"
          iconOnly
          icon={expanded ? <Minimize2 size={13} aria-hidden /> : <Maximize2 size={13} aria-hidden />}
          selected={expanded}
          onClick={() => toggleExpanded()}
          aria-pressed={expanded}
          data-tooltip={expanded ? 'Back to a side panel' : 'Expand to the whole view'}
          aria-label={expanded ? 'Back to a side panel' : 'Expand changes to the whole view'}
          data-changes-expand
        />
        <Button variant="quiet" size="sm" iconOnly icon={<RefreshCw size={12} />} onClick={onRefresh} data-tooltip="Check git for changes again" aria-label="Refresh changes" />
        <Button variant="quiet" size="sm" iconOnly icon={<X size={13} />} shortcut="changes.toggle" onClick={onClose} aria-label="Close changes" />
      </div>

      {(error ?? changes?.error) && (
        <p role="alert" className="border-b border-border px-3 py-2 text-meta text-error">
          {error ?? changes?.error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {changes === null ? (
          <p className="p-4 text-ui text-muted">Loading…</p>
        ) : files.length === 0 ? (
          <p className="p-4 text-ui text-muted">{base === 'uncommitted' ? 'No uncommitted changes.' : `Nothing on ${changes.branch ?? 'this branch'} that isn't on ${changes.baseBranch ?? 'its base'}.`}</p>
        ) : (
          files.map((file, index) => {
            const status = STATUS[file.status];
            const slash = file.path.lastIndexOf('/');
            const isOpen = open.has(file.path);
            const name = file.path.slice(slash + 1);
            const diffId = `${idBase}-diff-${index}`;
            return (
              <div key={file.path} className="border-b border-border" data-changed-file={file.path}>
                <div className="group flex h-8 items-center gap-2 pr-2 pl-1.5 text-ui hover:bg-border/30">
                  {editable && (
                    <Checkbox
                      checked={file.staged}
                      label={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
                      tooltip={file.staged ? 'Staged: click to unstage' : 'Stage'}
                      onChange={(staged) => client && run(client.call('git.stage', { cwd, paths: [file.path], staged }), `${staged ? 'stage' : 'unstage'} ${name}`)}
                      className="ml-0.5 shrink-0 p-0.5"
                      dataAttrs={{ 'data-stage-file': file.path }}
                    />
                  )}
                  <button
                    type="button"
                    data-file-toggle
                    onClick={() => toggle(file.path)}
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? diffId : undefined}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  >
                    <ChevronRight size={12} className={`shrink-0 text-muted transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                    <span aria-hidden className={`w-3 shrink-0 text-center font-mono text-meta font-semibold ${status.tone}`} data-tooltip={status.label}>
                      {status.letter}
                    </span>
                    <span className="sr-only">{status.label}:</span>
                    <span className="min-w-0 truncate">
                      {slash >= 0 && <span className="text-muted">{file.path.slice(0, slash + 1)}</span>}
                      <span className="text-text">{name}</span>
                    </span>
                  </button>
                  <span className="shrink-0 font-mono text-meta tabular-nums">
                    <span aria-hidden>
                      {file.additions > 0 && <span className="text-ok">+{file.additions}</span>} {file.deletions > 0 && <span className="text-error">−{file.deletions}</span>}
                    </span>
                    <span className="sr-only">{lineCounts(file.additions, file.deletions)}</span>
                  </span>
                  {/* Shown on hover, and while the row has keyboard focus so Tab can reach them. */}
                  <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
                    {file.status !== 'deleted' && changes.root && (
                      <Button
                        variant="quiet"
                        size="sm"
                        iconOnly
                        icon={<ExternalLink size={12} />}
                        data-tooltip="Open in editor"
                        aria-label={`Open ${name} in editor`}
                        onClick={() => void openIn(`${changes.root}/${file.path}`).catch((e: Error) => setError(`Couldn't open ${name}: ${e.message}`))}
                      />
                    )}
                    {editable && (
                      <Button variant="quiet" size="sm" iconOnly icon={<Undo2 size={12} />} data-tooltip="Revert this file…" aria-label={`Revert ${name}`} onClick={() => setReverting([file.path])} className="hover:text-error!" />
                    )}
                  </span>
                </div>
                {isOpen && <FileDiff id={diffId} cwd={cwd} base={base} path={file.path} version={`${load}:${file.additions}:${file.deletions}:${file.staged}`} />}
              </div>
            );
          })
        )}
      </div>

      {editable && files.length > 0 && client && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-t border-border px-3 text-ui">
          <Button size="sm" onClick={() => run(client.call('git.stage', { cwd, paths: files.map((f) => f.path), staged: !allStaged }), allStaged ? 'unstage the files' : 'stage the files')}>
            {allStaged ? 'Unstage all' : 'Stage all'}
          </Button>
          <span className="flex-1" />
          <Button variant="danger" size="sm" onClick={() => setReverting(files.map((f) => f.path))}>
            Revert all…
          </Button>
        </div>
      )}

      {reverting && client && (
        <ConfirmDialog
          title={reverting.length === 1 ? `Revert ${reverting[0]}?` : `Revert ${reverting.length} files?`}
          danger
          confirmLabel="Revert"
          body={
            <p>
              {reverting.length === 1 ? 'Its' : 'Their'} uncommitted changes are lost. New files go to the Trash, so you can get them back from there.
            </p>
          }
          onConfirm={async () => {
            await client.call('git.revert', { cwd, paths: reverting });
            onRefresh();
          }}
          onClose={() => setReverting(null)}
        />
      )}
    </aside>
  );
}
