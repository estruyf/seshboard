import { joinPath, type GitChanges } from '@seshboard/protocol/client';
import { ChevronLeft, PanelLeft, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { formatKeys, keysFor } from '../../lib/shortcuts.ts';
import { parseUnifiedDiff } from '../../lib/unifiedDiff.ts';
import { openChanges } from '../../state/changesPanelStore.ts';
import { useFilesPanel, useSessionFiles, useTouched, frontTabOf, TREE_MAX_WIDTH, TREE_MIN_WIDTH, type FileTab } from '../../state/filesPanelStore.ts';
import { useMemoryView } from '../../state/memoryStore.ts';
import { ASK_MAX_SHARE, ASK_MIN_WIDTH, askWidthForKey } from '../ask/askWidth.ts';
import { Button } from '../ui/Button.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { useWidth } from '../ui/useWidth.ts';
import { BackToConversation, PanelSize } from '../webPreview/BrowserPane.tsx';
import { parentFolders } from './fileTree.ts';
import { FileSearch } from './FileSearch.tsx';
import { FileTree } from './FileTree.tsx';
import { FileViewer, type ViewerMatch } from './FileViewer.tsx';
import { insideFolder } from './touchedFiles.ts';
import { changedLines } from './viewerModel.ts';

/** Under this width the tree and the viewer (or Search's list and the viewer) take turns. */
const NARROW_PX = 560;
/** From this width the outline of a Markdown file sits beside it at Half. */
const OUTLINE_PX = 760;

interface FilesPanelProps {
  sessionId: string;
  cwd: string;
  width: number;
  onWidth(width: number): void;
  /** The session's Changes (git), for the lines Claude changed and Show diff. */
  changes: GitChanges | null;
  changesBase: 'uncommitted' | 'branch';
  /** Goes up when Claude writes a file: open files are read again. */
  writes: ReadonlyMap<string, number>;
}

/** The project's files, cached per folder for this window so switching sessions or panels shows them at once. */
const listCache = new Map<string, { files: string[]; truncated: boolean }>();

/**
 * Files on the session's rail: the project's tree and a viewer for any text file, or Search in files. Read-only on
 * purpose: Open in editor is one click away for anything else. Side, Half or Full like the browser.
 */
export function FilesPanel({ sessionId, cwd, width, onWidth, changes, changesBase, writes }: FilesPanelProps) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const state = useSessionFiles(sessionId);
  const touched = useTouched(sessionId);
  const treeWidth = useFilesPanel((s) => s.treeWidth);
  const treeHidden = useFilesPanel((s) => s.treeHidden);
  const panel = useFilesPanel.getState();
  const asideRef = useRef<HTMLElement>(null);
  const measured = useWidth(asideRef) ?? width;
  const full = state.full;
  const narrow = !full && measured < NARROW_PX;
  const front = frontTabOf(state);

  // The tree's files: read when the panel opens, again when Claude adds or changes files, and when the window comes back.
  const [list, setList] = useState<{ files: string[]; truncated: boolean } | null>(listCache.get(cwd) ?? null);
  const [listError, setListError] = useState<string | null>(null);
  const touchedCount = touched.changed.size;
  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    const load = () =>
      void client.call('files.list', { cwd }).then(
        (result) => {
          if (cancelled) return;
          listCache.set(cwd, result);
          setList(result);
          setListError(null);
        },
        (error: unknown) => !cancelled && setListError(error instanceof Error ? error.message : String(error)),
      );
    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, [client, cwd, touchedCount]);

  // At Side, the tree and the viewer take turns: the viewer while a file is open, the tree from its ‹ Files.
  const [narrowTree, setNarrowTree] = useState(front === null);
  useEffect(() => setNarrowTree(front === null), [front?.path, front?.seq, front]);

  const [reveal, setReveal] = useState<{ path: string; nonce: number } | null>(null);
  const showFolder = (folder: string) => {
    useFilesPanel.getState().setFolders(sessionId, new Set([...state.folders, ...parentFolders(`${folder}/x`)]));
    if (treeHidden) useFilesPanel.getState().setTreeHidden(false);
    setNarrowTree(true);
    setReveal((r) => ({ path: folder, nonce: (r?.nonce ?? 0) + 1 }));
  };

  // The lines Claude changed in a file, from its diff in Changes (against the base Changes shows).
  const changedFile = (path: string) => {
    if (!changes) return null;
    const rel = insideFolder(path, changes.root);
    return rel !== null && changes.files.some((f) => f.path === rel && f.status !== 'deleted') ? rel : null;
  };
  const viewerPath = state.mode === 'files' ? (front?.path ?? null) : null;
  const [marks, setMarks] = useState<{ path: string; lines: Map<number, string | null> } | null>(null);
  const diffPath = viewerPath ? changedFile(viewerPath) : null;
  const diffKey = `${diffPath}:${changes?.files.find((f) => f.path === diffPath)?.additions ?? 0}:${changesBase}`;
  useEffect(() => {
    if (!client || !diffPath || !changes || !viewerPath) return setMarks(null);
    let cancelled = false;
    void client.call('git.diff', { cwd: changes.root, base: changesBase, path: diffPath }).then(
      ({ diff }) => !cancelled && setMarks({ path: viewerPath, lines: changedLines(parseUnifiedDiff(diff)) }),
      () => !cancelled && setMarks(null),
    );
    return () => {
      cancelled = true;
    };
    // `diffKey` holds what decides the diff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, diffKey, viewerPath]);
  const showDiff = (path: string) => {
    const rel = changedFile(path);
    if (!rel) return null;
    return () => {
      openChanges(sessionId);
      useMemoryView.setState({ changesFocus: { sessionId, path: rel, nonce: Date.now() } });
    };
  };

  const close = () => useFilesPanel.getState().setOpen(sessionId, false);
  const setFull = (on: boolean) => useFilesPanel.getState().setFull(sessionId, on);
  const onKey = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role=menu], [role=dialog], [role=alertdialog]')) return;
    event.preventDefault();
    if (full) setFull(false);
    else close();
  };

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = Math.min(width, event.currentTarget.parentElement?.getBoundingClientRect().width ?? width);
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => onWidth(startWidth + (startX - e.clientX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  const resizeByKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = askWidthForKey(event.key, width, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    onWidth(next);
  };
  const startTreeResize = (event: PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    const move = (e: globalThis.PointerEvent) => useFilesPanel.getState().setTreeWidth(treeWidth + (e.clientX - startX));
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };

  const viewerFor = (tab: FileTab, extra: { search?: { matches: readonly ViewerMatch[]; current: number; onStep(step: 1 | -1): void }; lead?: ReactNode; tabs?: readonly FileTab[] } = {}) => (
    <FileViewer
      key={tab.path}
      sessionId={sessionId}
      cwd={cwd}
      tab={tab}
      tabs={extra.tabs ?? [tab]}
      changed={touched.changed}
      marks={marks?.path === tab.path ? marks.lines : undefined}
      onShowDiff={showDiff(tab.path)}
      reloadKey={writes.get(tab.path) ?? 0}
      outline={full || measured > OUTLINE_PX}
      onFolder={showFolder}
      search={extra.search}
      lead={extra.lead}
    />
  );

  // Search's viewer follows the match picked: a tab of its own, at the match's line.
  const searchSeq = useRef(0);
  const searchTab = useMemo(() => new Map<string, FileTab>(), []);
  const searchViewer = (path: string, matches: readonly ViewerMatch[], current: number, onStep: (step: 1 | -1) => void, lead: ReactNode) => {
    const line = matches[current]?.line;
    const key = `${path}:${line}`;
    let tab = searchTab.get(key);
    if (!tab) {
      tab = { path, ...(line ? { line } : {}), seq: ++searchSeq.current };
      searchTab.clear();
      searchTab.set(key, tab);
    }
    return viewerFor(tab, { search: { matches, current, onStep }, lead });
  };

  const tree = (
    <FileTree
      files={list?.files ?? null}
      truncated={list?.truncated ?? false}
      error={listError}
      open={state.folders}
      filter={state.filter}
      onFilter={(filter) => panel.setFilter(sessionId, filter)}
      onToggle={(path, open) => {
        const next = new Set(state.folders);
        if (open) next.add(path);
        else next.delete(path);
        useFilesPanel.getState().setFolders(sessionId, next);
      }}
      onOpen={(path) => useFilesPanel.getState().openFile(sessionId, joinPath(cwd, path))}
      selected={front ? insideFolder(front.path, cwd) : null}
      touched={touched}
      reveal={reveal}
    />
  );

  const emptyViewer = (
    <div className="flex min-w-0 flex-1 items-center justify-center bg-code px-6 text-center text-ui text-muted" data-files-viewer-empty="">
      Pick a file in the tree, or press {formatKeys(keysFor('files.quick-open'))} to open one by name.
    </div>
  );

  let content: ReactNode;
  if (state.mode === 'search') content = <FileSearch sessionId={sessionId} cwd={cwd} narrow={narrow} viewer={searchViewer} />;
  else if (narrow)
    content =
      narrowTree || !front ? (
        <div className="flex min-h-0 flex-1 flex-col">{tree}</div>
      ) : (
        viewerFor(front, {
          tabs: state.tabs,
          lead: (
            <Button variant="quiet" size="sm" icon={<ChevronLeft size={13} aria-hidden />} onClick={() => setNarrowTree(true)} data-files-show-tree="">
              Files
            </Button>
          ),
        })
      );
  else
    content = (
      <div className="flex min-h-0 flex-1">
        {!(full && treeHidden) && (
          <nav aria-label="Project files" className="relative flex min-h-0 shrink-0 flex-col" style={{ width: treeWidth }}>
            {tree}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="File tree width"
              aria-valuenow={treeWidth}
              aria-valuemin={TREE_MIN_WIDTH}
              aria-valuemax={TREE_MAX_WIDTH}
              tabIndex={0}
              onPointerDown={startTreeResize}
              onKeyDown={(e) => {
                const by = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0;
                if (!by) return;
                e.preventDefault();
                useFilesPanel.getState().setTreeWidth(treeWidth + by);
              }}
              className="absolute inset-y-0 -right-0.5 z-10 w-1 cursor-col-resize hover:bg-accent-ink/40 focus-visible:bg-accent-ink/40"
              data-tooltip="Drag (or use ← →) to resize"
            />
          </nav>
        )}
        {front ? viewerFor(front, { tabs: state.tabs }) : emptyViewer}
      </div>
    );

  return (
    <aside
      ref={asideRef}
      aria-label="Files"
      tabIndex={-1}
      onKeyDown={onKey}
      className={full ? 'relative flex min-w-0 flex-1 flex-col bg-sidebar outline-none' : 'relative flex max-w-[min(85%,calc(100%-27.5rem))] min-w-0 shrink-0 flex-col bg-sidebar outline-none forced-colors:border-l'}
      style={full ? undefined : { width }}
      data-files-panel=""
      data-files-mode={state.mode}
      data-files-full={full || undefined}
    >
      {!full && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Files panel width"
          aria-valuenow={width}
          aria-valuemin={ASK_MIN_WIDTH}
          aria-valuemax={Math.round(window.innerWidth * ASK_MAX_SHARE)}
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={resizeByKey}
          className="absolute inset-y-0 -left-0.5 z-20 w-1 cursor-col-resize hover:bg-accent-ink/40 focus-visible:bg-accent-ink/40"
          data-tooltip="Drag (or use ← →) to resize"
        />
      )}
      <header className="@container/toolbar flex h-11 shrink-0 items-center gap-1.5 px-2.5" data-files-header="">
        {full && <BackToConversation onClick={() => setFull(false)} />}
        {full && state.mode === 'files' && (
          <Button
            variant="quiet"
            size="sm"
            iconOnly
            icon={<PanelLeft size={14} aria-hidden />}
            aria-label={treeHidden ? 'Show the file tree' : 'Hide the file tree'}
            aria-pressed={!treeHidden}
            selected={!treeHidden}
            onClick={() => useFilesPanel.getState().setTreeHidden(!treeHidden)}
            data-files-tree-toggle=""
          />
        )}
        <SegmentedControl
          mode="radio"
          size="sm"
          label="Files or search"
          value={state.mode}
          onChange={(mode) => useFilesPanel.getState().setMode(sessionId, mode)}
          segments={[
            { value: 'files', label: 'Files', data: { 'data-files-mode-files': true } },
            { value: 'search', label: 'Search', kbd: keysFor('files.search'), data: { 'data-files-mode-search': true } },
          ]}
        />
        <span className="flex-1" />
        <PanelSize full={full} onChange={setFull} />
        <Button variant="quiet" size="sm" iconOnly icon={<X size={14} aria-hidden />} aria-label="Close Files" shortcut="files.toggle" onClick={close} data-files-close="" />
      </header>
      {content}
    </aside>
  );
}
