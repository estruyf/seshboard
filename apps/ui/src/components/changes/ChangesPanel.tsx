import { trashName } from '../../lib/platform.ts';
import { ChevronRight, ExternalLink, Maximize2, MessageSquareText, Minimize2, RefreshCw, TriangleAlert, Undo2, WrapText, X } from 'lucide-react';
import { Fragment, memo, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import { joinPath, type ChangedFile, type ChangesBase, type GitChanges } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { claim, release } from '../../lib/inFlight.ts';
import { formatKeys, keysFor, matches } from '../../lib/shortcuts.ts';
import { parseUnifiedDiff } from '../../lib/unifiedDiff.ts';
import { useComposerTargets } from '../../state/composerTargets.ts';
import { useDiffComments, useSessionComments } from '../../state/diffCommentsStore.ts';
import { useMemoryView } from '../../state/memoryStore.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { popoutSession } from '../../state/popoutsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { useOpenIn } from '../OpenInButton.tsx';
import { Button } from '../ui/Button.tsx';
import { Checkbox } from '../ui/Checkbox.tsx';
import { Notice } from '../ui/Notice.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { useScrollEdge } from '../ui/useScrollEdge.ts';
import { CHANGES_DEFAULT_WIDTH, CHANGES_MAX_SHARE, CHANGES_MIN_WIDTH, changesWidthForKey, clampChangesWidth } from './changesWidth.ts';
import { CommentCard, CommentEditor } from './DiffCommentParts.tsx';
import { anchorOf, reviewSummary, targetFromRows, type CommentTarget, type DiffComment } from './diffComments.ts';
import { submitReview } from './submitReview.ts';

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
    // Remembered by the main window only: a pop-out is narrower, and its clamped width would shrink the next launch's.
    if (!popoutSession) {
      try {
        localStorage.setItem(WIDTH_KEY, String(next));
      } catch {
        // Remembering the width is a convenience.
      }
    }
    set({ width: next });
  },
  toggleExpanded: (expanded) => set((s) => ({ expanded: expanded ?? !s.expanded })),
}));

/** How a changed file shows: its letter, colour and name (also in `RemoteChangesPanel`). */
export const STATUS: Record<ChangedFile['status'], { letter: string; tone: string; label: string }> = {
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
const FileDiff = memo(function FileDiff({ id, sessionId, root, cwd, base, path, version }: { id: string; sessionId: string; root: string; cwd: string; base: ChangesBase; path: string; version: string }) {
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
  const containerRef = useRef<HTMLDivElement>(null);

  // Review comments on this file, each at its lines (wherever Claude's edits moved them), or stale once they are gone.
  const all = useSessionComments(sessionId);
  const comments = useMemo(() => all.filter((c) => c.root === root && c.path === path), [all, root, path]);
  const anchors = useMemo(() => new Map(comments.map((c) => [c.id, rows.length ? anchorOf(c, rows) : null])), [comments, rows]);
  useEffect(() => {
    // The message names the lines where they are now.
    const moves = comments.flatMap((c) => {
      const anchor = anchors.get(c.id);
      return anchor && (anchor.start !== c.start || anchor.end !== c.end) ? [{ id: c.id, start: anchor.start, end: anchor.end }] : [];
    });
    if (moves.length) useDiffComments.getState().move(sessionId, moves);
  }, [anchors, comments, sessionId]);

  // Lines picked for a new comment: dragged over the line numbers (rows, while the button is down), then the lines
  // themselves, so the editor stays with them when the diff reloads. Shift-click extends from where the last pick began.
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const [target, setTarget] = useState<CommentTarget | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const pickFrom = useRef<number | null>(null);
  const targetAnchor = useMemo(() => (target && rows.length ? anchorOf(target, rows) : null), [target, rows]);
  // Read when the button comes up, which can be before the next render.
  const dragRef = useRef(drag);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const dragTo = (next: { from: number; to: number } | null) => {
    dragRef.current = next;
    setDrag(next);
  };
  const pickDown = (event: MouseEvent, index: number) => {
    if (event.button !== 0) return;
    // A drag over the numbers picks lines, not text.
    event.preventDefault();
    const from = event.shiftKey && pickFrom.current !== null ? pickFrom.current : index;
    pickFrom.current = from;
    dragTo({ from, to: index });
    const up = () => {
      window.removeEventListener('mouseup', up);
      const picked = dragRef.current;
      dragTo(null);
      if (!picked) return;
      setTarget(targetFromRows(rowsRef.current, picked.from, picked.to));
      setEditing(null);
    };
    window.addEventListener('mouseup', up);
  };

  // ⌘⇧M with lines of this diff selected: a comment on them.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (!matches(event, 'changes.comment')) return;
      const selection = window.getSelection();
      const rowOf = (node: Node | null | undefined) => (node instanceof Element ? node : node?.parentElement)?.closest<HTMLElement>('[data-diff-row]');
      const [a, b] = [rowOf(selection?.anchorNode), rowOf(selection?.focusNode)];
      if (!selection || selection.isCollapsed || !a || !b || !containerRef.current?.contains(a) || !containerRef.current.contains(b)) return;
      const picked = targetFromRows(rows, Number(a.dataset.diffRow), Number(b.dataset.diffRow));
      if (!picked) return;
      event.preventDefault();
      selection.removeAllRanges();
      pickFrom.current = Number(a.dataset.diffRow);
      setTarget(picked);
      setEditing(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows]);

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
  // The diff sits on the conversation's surface, inset in the panel's darker one (the code surface is the panel's own
  // colour in dark mode): set apart without a line.
  const gutter = 'sticky left-0 z-[1] flex shrink-0 self-stretch bg-bg';
  const picked = drag ? { first: Math.min(drag.from, drag.to), last: Math.max(drag.from, drag.to) } : targetAnchor;
  const { add, edit, remove } = useDiffComments.getState();
  const editor = (t: CommentTarget) => (
    <CommentEditor
      key="editor"
      target={t}
      onSave={(body) => {
        add(sessionId, root, path, t, body);
        setTarget(null);
      }}
      onCancel={() => setTarget(null)}
    />
  );
  const card = (comment: DiffComment, stale: boolean) =>
    editing === comment.id ? (
      <CommentEditor
        key={comment.id}
        target={comment}
        initial={comment.body}
        onSave={(body) => {
          edit(sessionId, comment.id, body);
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    ) : (
      <CommentCard key={comment.id} comment={comment} stale={stale} onEdit={() => (setEditing(comment.id), setTarget(null))} onRemove={() => remove(sessionId, comment.id)} />
    );
  const under = (i: number) => [...comments.filter((c) => anchors.get(c.id)?.last === i).map((c) => card(c, false)), ...(target && targetAnchor?.last === i ? [editor(target)] : [])];
  const stale = comments.filter((c) => !anchors.get(c.id));
  return (
    <div ref={containerRef} id={id} className="@container/diff mx-1 mb-1 overflow-x-auto overscroll-x-contain rounded-md bg-bg font-mono text-ui select-text" data-file-diff data-diff-wrap={wrap}>
      <div className={wrap ? '' : 'w-max min-w-full'}>
        {/* Comments whose lines are gone show first, with the lines they quote. */}
        {stale.map((c) => card(c, true))}
        {target && !targetAnchor && editor(target)}
        {rows.map((row, i) => (
          <Fragment key={i}>
          {row.kind === 'hunk' ? (
            <div key={i} data-diff-row={i} className={`bg-border/30 px-3 text-faint ${wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre'}`}>
              @@ {row.text}
            </div>
          ) : row.kind === 'note' ? (
            <div key={i} data-diff-row={i} className="px-3 text-faint italic">
              {row.text}
            </div>
          ) : (
            <div
              key={i}
              data-diff-row={i}
              data-diff-picked={(picked && i >= picked.first && i <= picked.last) || undefined}
              className={`flex ${row.kind === 'add' ? 'bg-diff-added' : row.kind === 'del' ? 'bg-diff-removed text-text/80' : 'text-muted'}`}
              onMouseEnter={drag ? () => dragRef.current && dragTo({ ...dragRef.current, to: i }) : undefined}
            >
              {/* The gutter is opaque (it covers lines scrolling under it), so it repeats the row's tint. */}
              <span className={gutter}>
                <span className={`flex ${row.kind === 'add' ? 'bg-diff-added' : row.kind === 'del' ? 'bg-diff-removed' : ''} ${picked && i >= picked.first && i <= picked.last ? 'shadow-[inset_2px_0_0_var(--color-accent-ink)]' : ''}`}>
                  <span
                    className={`w-9 shrink-0 cursor-pointer pr-1.5 text-right select-none hover:text-accent-ink ${picked && i >= picked.first && i <= picked.last ? 'font-semibold text-accent-ink' : 'text-faint/70'}`}
                    onMouseDown={(e) => pickDown(e, i)}
                    data-tooltip={`Comment on this line (drag or Shift-click for more, or select lines and press ${formatKeys(keysFor('changes.comment'))})`}
                    data-diff-line
                  >
                    {row.newLine ?? row.oldLine}
                  </span>
                  <span className={`w-4 shrink-0 text-center select-none ${row.kind === 'add' ? 'text-ok' : row.kind === 'del' ? 'text-error' : 'text-faint'}`}>
                    {row.kind === 'add' ? '+' : row.kind === 'del' ? '−' : ' '}
                  </span>
                </span>
              </span>
              <span className={`pr-3 ${wrap ? 'min-w-0 break-all whitespace-pre-wrap' : 'whitespace-pre'}`}>{row.text || ' '}</span>
            </div>
          )}
          {under(i)}
          </Fragment>
        ))}
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
  sessionId,
  cwd,
  changes,
  base,
  onBase,
  onRefresh,
  onClose,
  tabs,
  shared,
  outside = [],
}: {
  sessionId: string;
  cwd: string;
  changes: GitChanges | null;
  base: ChangesBase;
  onBase(base: ChangesBase): void;
  onRefresh(): void;
  onClose(): void;
  /** Ask is open too: this row of tabs goes on top, with the close button on its right. */
  tabs?: (actions: ReactNode) => ReactNode;
  /** Ask is open too: the two share the right side's width. */
  shared?: { width: number; setWidth(width: number): void };
  /** Files the last turn changed outside the plan (its catch-up), relative to the checkout: tinted, with a notice. */
  outside?: readonly string[];
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const openIn = useOpenIn();
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [reverting, setReverting] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wrap = useOverlay((s) => s.diffWrap);
  const toggleWrap = useOverlay((s) => s.toggleDiffWrap);
  const ownWidth = useChangesLayout((s) => s.width);
  const setOwnWidth = useChangesLayout((s) => s.setWidth);
  const width = shared?.width ?? ownWidth;
  const setWidth = shared?.setWidth ?? setOwnWidth;
  const expanded = useChangesLayout((s) => s.expanded);
  const toggleExpanded = useChangesLayout((s) => s.toggleExpanded);
  const files = changes?.files ?? [];
  const outsideSet = useMemo(() => new Set(outside), [outside]);
  const added = files.reduce((n, f) => n + f.additions, 0);
  const removed = files.reduce((n, f) => n + f.deletions, 0);
  const editable = base === 'uncommitted';
  const allStaged = files.length > 0 && files.every((f) => f.staged);
  // Each check of git gives a new list: open diffs reload then, even when a file's +/− counts stay the same.
  const load = useMemo(() => ++changesLoads, [changes]);
  // File paths have spaces and slashes, which don't make good ids for aria-controls.
  const idBase = useId();
  // The header's and footer's hairlines show only while files scroll under them.
  const listRef = useRef<HTMLDivElement>(null);
  const listEdge = useScrollEdge(listRef);
  const comments = useSessionComments(sessionId);
  const commentsOn = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of comments) if (c.root === changes?.root) counts.set(c.path, (counts.get(c.path) ?? 0) + 1);
    return counts;
  }, [comments, changes?.root]);
  // Submit fills the message box, so it needs one (a session another tool runs may have none).
  const hasComposer = useComposerTargets((s) => sessionId in s.boxes);
  const [clearing, setClearing] = useState(false);

  /**
   * Paths being staged or unstaged right now. A second click (a double click on a box, Stage all twice) waits
   * for the first: two `git add` at once fight over git's index lock, and the second fails.
   */
  const stagingRef = useRef(new Set<string>());
  const [staging, setStaging] = useState<ReadonlySet<string>>(new Set());
  /** Stages or unstages, then refreshes; `what` finishes "Couldn't …" when it fails. */
  const stage = (paths: string[], staged: boolean, what: string) => {
    if (!client || !claim(stagingRef.current, paths)) return;
    setStaging(new Set(stagingRef.current));
    void client
      .call('git.stage', { cwd, paths, staged })
      .then(
        () => (setError(null), onRefresh()),
        (e: Error) => setError(`Couldn't ${what}: ${e.message}`),
      )
      .finally(() => {
        release(stagingRef.current, paths);
        setStaging(new Set(stagingRef.current));
      });
  };
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
    // Only the panel of the session it was asked for: another pane on the same checkout may have Changes open too.
    if (!changesFocus || changesFocus.sessionId !== sessionId || !files.some((f) => f.path === changesFocus.path)) return;
    const { path } = changesFocus;
    useMemoryView.setState({ changesFocus: null });
    setOpen((s) => new Set(s).add(path));
    requestAnimationFrame(() => document.querySelector(`[data-changed-file="${CSS.escape(path)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [changesFocus, files, sessionId]);

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
      // The sidebar's darker surface sets it apart from the conversation, without a line (it comes back in high contrast).
      className={`relative flex min-w-0 flex-col bg-sidebar forced-colors:border-l ${expanded ? 'flex-1' : 'max-w-[85%] shrink-0'}`}
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
      {tabs?.(<Button variant="quiet" size="sm" iconOnly icon={<X size={13} />} shortcut="changes.toggle" onClick={onClose} aria-label="Close changes" />)}
      <div className="edge-b flex h-10 shrink-0 items-center gap-2 px-3" data-scrolled={!listEdge.atTop || undefined} data-changes-header>
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
        {!tabs && <Button variant="quiet" size="sm" iconOnly icon={<X size={13} />} shortcut="changes.toggle" onClick={onClose} aria-label="Close changes" />}
      </div>

      {outside.length > 0 && (
        <Notice tone="caution" icon={<TriangleAlert size={13} aria-hidden />} className="m-2" data-changes-outside>
          {outside.length === 1 ? '1 file outside the plan' : `${outside.length} files outside the plan`}
        </Notice>
      )}
      {(error ?? changes?.error) && (
        <p role="alert" className="px-3 py-2 text-meta text-error">
          {error ?? changes?.error}
        </p>
      )}

      <div ref={listRef} className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto py-1">
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
              <div key={file.path} data-changed-file={file.path} data-outside-plan={outsideSet.has(file.path) || undefined}>
                {/* Rows like the sidebar's: a hover and an open background instead of a line between them; files outside the plan keep their caution tint. */}
                <div
                  className={`group mx-1 flex h-8 items-center gap-2 rounded-md pr-1 pl-0.5 text-ui ${
                    outsideSet.has(file.path) ? (isOpen ? 'bg-caution/20' : 'bg-caution/10 hover:bg-caution/15') : isOpen ? 'bg-selected' : 'hover:bg-border/45'
                  }`}
                  data-file-open={isOpen || undefined}
                >
                  {editable && (
                    <Checkbox
                      checked={file.staged}
                      label={file.staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
                      tooltip={file.staged ? 'Staged: click to unstage' : 'Stage'}
                      onChange={(staged) => stage([file.path], staged, `${staged ? 'stage' : 'unstage'} ${name}`)}
                      // Not disabled while git runs (a disabled box drops the keyboard's focus): `stage` ignores the click.
                      className="ml-0.5 shrink-0 p-0.5"
                      dataAttrs={{ 'data-stage-file': file.path, 'data-staging': staging.has(file.path) || undefined }}
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
                  {(commentsOn.get(file.path) ?? 0) > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5 text-meta text-accent-ink tabular-nums" data-file-comments={commentsOn.get(file.path)}>
                      <MessageSquareText size={11} aria-hidden />
                      <span aria-hidden>{commentsOn.get(file.path)}</span>
                      <span className="sr-only">{commentsOn.get(file.path) === 1 ? '1 comment' : `${commentsOn.get(file.path)} comments`}</span>
                    </span>
                  )}
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
                        onClick={() => void openIn(joinPath(changes.root, file.path)).catch((e: Error) => setError(`Couldn't open ${name}: ${e.message}`))}
                      />
                    )}
                    {editable && (
                      <Button variant="quiet" size="sm" iconOnly icon={<Undo2 size={12} />} data-tooltip="Revert this file…" aria-label={`Revert ${name}`} onClick={() => setReverting([file.path])} className="hover:text-error!" />
                    )}
                  </span>
                </div>
                {isOpen && <FileDiff id={diffId} sessionId={sessionId} root={changes.root} cwd={cwd} base={base} path={file.path} version={`${load}:${file.additions}:${file.deletions}:${file.staged}`} />}
              </div>
            );
          })
        )}
      </div>

      {comments.length > 0 && (
        <div className="edge-t flex h-10 shrink-0 items-center gap-2 px-3 text-ui" data-scrolled={!listEdge.atBottom || undefined} data-review-bar>
          <MessageSquareText size={13} className="shrink-0 text-accent-ink" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-meta text-muted" data-review-count={comments.length}>
            {reviewSummary(comments)}
          </span>
          <Button variant="quiet" size="sm" onClick={() => setClearing(true)} data-review-clear>
            Clear
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={!hasComposer}
            onClick={() => submitReview(sessionId, cwd)}
            data-tooltip={hasComposer ? 'Put the comments in the message box, to read and send' : 'This session has no message box'}
            data-review-submit
          >
            Submit
          </Button>
        </div>
      )}

      {editable && files.length > 0 && client && (
        // Under the review bar, that bar carries the line where files scroll under.
        <div className={`${comments.length > 0 ? '' : 'edge-t'} flex h-10 shrink-0 items-center gap-2 px-3 text-ui`} data-scrolled={!listEdge.atBottom || undefined} data-changes-footer>
          <Button variant="quiet" size="sm" onClick={() => stage(files.map((f) => f.path), !allStaged, allStaged ? 'unstage the files' : 'stage the files')} aria-busy={staging.size > 0 || undefined} data-stage-all>
            {allStaged ? 'Unstage all' : 'Stage all'}
          </Button>
          <span className="flex-1" />
          <Button variant="danger" size="sm" onClick={() => setReverting(files.map((f) => f.path))}>
            Revert all…
          </Button>
        </div>
      )}

      {clearing && (
        <ConfirmDialog
          title={comments.length === 1 ? 'Remove the comment?' : `Remove ${comments.length} comments?`}
          danger
          confirmLabel="Remove"
          body={<p>{comments.length === 1 ? 'It is' : 'They are'} not sent to Claude.</p>}
          onConfirm={async () => useDiffComments.getState().clear(sessionId)}
          onClose={() => setClearing(false)}
        />
      )}

      {reverting && client && (
        <ConfirmDialog
          title={reverting.length === 1 ? `Revert ${reverting[0]}?` : `Revert ${reverting.length} files?`}
          danger
          confirmLabel="Revert"
          body={
            <p>
              {reverting.length === 1 ? 'Its' : 'Their'} uncommitted changes are lost. New files go to the {trashName()}, so you can get them back from there.
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
