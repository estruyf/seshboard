import { ChevronDown, ChevronUp, Maximize2, Search, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { clearFindHighlights, rangesIn, setFindHighlights } from '../../lib/findHighlights.ts';
import { basename } from '../../lib/format.ts';
import { formatKeys, keysFor, matches } from '../../lib/shortcuts.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useFilePreview } from '../../state/filePreviewStore.ts';
import { useFilesPanel, type FileTab } from '../../state/filesPanelStore.ts';
import { toast } from '../../state/toastStore.ts';
import { fileLinesItem } from '../composer/contextItems.ts';
import { useFilePreviewContent } from '../filePreview/useFilePreviewContent.tsx';
import { Button } from '../ui/Button.tsx';
import { insideFolder } from './touchedFiles.ts';
import { fenceLanguage, lineSpan, markdownOutline } from './viewerModel.ts';

/** A match of Search in files to mark in the file: 1-based line and column. */
export interface ViewerMatch {
  line: number;
  column: number;
  length: number;
}

interface FileViewerProps {
  sessionId: string;
  cwd: string;
  tab: FileTab;
  tabs: readonly FileTab[];
  /** Files changed in the session, relative to `cwd`: their tabs get a dot. */
  changed: ReadonlySet<string>;
  /** Lines Claude changed in this file (from Changes), with what they were. */
  marks?: ReadonlyMap<number, string | null>;
  /** Show diff: Changes, at this file. Null when the file isn't in Changes. */
  onShowDiff: (() => void) | null;
  /** Read again when this changes (Claude wrote the file). */
  reloadKey: number;
  /** The outline of a Markdown file beside it (at Full, or at Half with room). */
  outline: boolean;
  /** A folder of the breadcrumb was clicked: show it in the tree. Relative to `cwd`. */
  onFolder(folder: string): void;
  /** Search in files' matches in this file, and the one picked; with them the viewer marks every match. */
  search?: { matches: readonly ViewerMatch[]; current: number; onStep(step: 1 | -1): void };
  /** Something before the breadcrumb (‹ Results at Side). */
  lead?: ReactNode;
}

const FIND_OWNER = (sessionId: string) => `files-find:${sessionId}`;
const SEARCH_OWNER = (sessionId: string) => `files-search:${sessionId}`;

/** The row of `node`'s line in the source, and its number; null outside a line. */
function lineOf(node: Node | null): number | null {
  const el = node instanceof Element ? node : node?.parentElement;
  const row = el?.closest('[data-line]');
  return row ? Number(row.getAttribute('data-line')) : null;
}

/** A range over `length` characters from `start` in the text of a line's code (its gutter left out). */
function rangeInLine(row: Element, start: number, length: number): Range | null {
  const code = row.lastElementChild;
  if (!code) return null;
  const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
  let offset = 0;
  const range = document.createRange();
  let started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.textContent?.length ?? 0;
    if (!started && start <= offset + len) {
      range.setStart(node, start - offset);
      started = true;
    }
    if (started && start + length <= offset + len) {
      range.setEnd(node, start + length - offset);
      return range;
    }
    offset += len;
  }
  return null;
}

/**
 * The Files panel's viewer: the file in front, read-only. A breadcrumb (its folders open in the tree), tabs for the
 * open files, Markdown rendered or as source with an outline, find in the file (⌘F), go to line (⌘⌥L), the lines
 * Claude changed marked in the gutter, and a selection of lines that goes into the message.
 */
export function FileViewer({ sessionId, cwd, tab, tabs, changed, marks, onShowDiff, reloadKey, outline, onFolder, search, lead }: FileViewerProps) {
  const target = useMemo(() => ({ path: tab.path, sessionId, seq: tab.seq, ...(tab.line ? { line: tab.line } : {}), ...(tab.endLine ? { endLine: tab.endLine } : {}) }), [tab, sessionId]);
  const { name, kind, switcher, tools, body, text, showsSource } = useFilePreviewContent(target, { marks, reloadKey, renderedLabel: 'Rendered' });
  const relative = insideFolder(tab.path, cwd);
  // A file outside the project (a link to one) shows its name only: its folders aren't in the tree.
  const crumbs = relative === null ? [basename(tab.path)] : relative.split('/').filter(Boolean);
  const bodyRef = useRef<HTMLDivElement>(null);
  const command = useFilesPanel((s) => s.sessions.get(sessionId)?.command ?? null);

  // --- Find in the file (⌘F) -------------------------------------------------------------------------------------
  const [find, setFind] = useState<{ query: string; current: number } | null>(null);
  const [count, setCount] = useState(0);
  const findRef = useRef<HTMLInputElement>(null);
  const openFind = useCallback(() => {
    const selected = window.getSelection()?.toString() ?? '';
    setFind((f) => ({ query: selected && !selected.includes('\n') ? selected : (f?.query ?? ''), current: 0 }));
    requestAnimationFrame(() => findRef.current?.select());
  }, []);
  const closeFind = () => {
    setFind(null);
    clearFindHighlights(FIND_OWNER(sessionId));
    bodyRef.current?.querySelector<HTMLElement>('[data-file-preview-source], [data-file-preview-markdown]')?.focus();
  };

  // --- Go to line (⌘⌥L) ------------------------------------------------------------------------------------------
  const [goto, setGoto] = useState<string | null>(null);
  const gotoLine = (value: string) => {
    const line = Number(value.replace(/^:/, ''));
    setGoto(null);
    if (Number.isInteger(line) && line > 0) useFilesPanel.getState().openFile(sessionId, tab.path, { line });
  };

  // The panel's shortcuts ask through the store: ⌘F with focus in the viewer, ⌘⌥L from anywhere in the session.
  const seenCommand = useRef(command?.nonce ?? 0);
  useEffect(() => {
    if (!command || command.nonce === seenCommand.current) return;
    seenCommand.current = command.nonce;
    if (command.kind === 'find') openFind();
    else if (command.kind === 'goto') setGoto('');
  }, [command, openFind]);

  // Matches are drawn with the CSS highlight registry, so React's DOM stays as it is. The source colours itself
  // once the browser is idle, which replaces its text: the ranges are found again when the DOM changes.
  const [domVersion, setDomVersion] = useState(0);
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setDomVersion((v) => v + 1));
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const owner = FIND_OWNER(sessionId);
    const root = bodyRef.current?.querySelector('[data-file-preview-source], [data-file-preview-markdown]');
    if (!find || !find.query || !root) {
      clearFindHighlights(owner);
      setCount(0);
      return;
    }
    const ranges = rangesIn(root, find.query.toLowerCase());
    const current = ranges.length ? ranges[((find.current % ranges.length) + ranges.length) % ranges.length]! : null;
    setFindHighlights(owner, ranges, current);
    setCount(ranges.length);
  }, [find, domVersion, sessionId]);
  // The match picked comes into view when you step to it, not when the DOM redraws.
  useEffect(() => {
    if (!find?.query) return;
    const root = bodyRef.current?.querySelector('[data-file-preview-source], [data-file-preview-markdown]');
    const ranges = root ? rangesIn(root, find.query.toLowerCase()) : [];
    if (!ranges.length) return;
    ranges[((find.current % ranges.length) + ranges.length) % ranges.length]!.startContainer.parentElement?.scrollIntoView({ block: 'center' });
  }, [find]);
  useEffect(() => () => clearFindHighlights(FIND_OWNER(sessionId)), [sessionId]);

  // Search in files: every match in this file, the one picked stronger and in view.
  useLayoutEffect(() => {
    const owner = SEARCH_OWNER(sessionId);
    const root = bodyRef.current?.querySelector('[data-file-preview-source]');
    if (!search || !root) return clearFindHighlights(owner);
    const ranges: Range[] = [];
    let current: Range | null = null;
    search.matches.forEach((m, i) => {
      const row = root.querySelector(`[data-line="${m.line}"]`);
      const range = row ? rangeInLine(row, m.column - 1, m.length) : null;
      if (!range) return;
      ranges.push(range);
      if (i === search.current) current = range;
    });
    setFindHighlights(owner, ranges, current);
  }, [search, domVersion, sessionId]);
  useEffect(() => () => clearFindHighlights(SEARCH_OWNER(sessionId)), [sessionId]);

  // --- Lines to Claude ---------------------------------------------------------------------------------------------
  const [selection, setSelection] = useState<{ start: number; end: number; x: number; y: number } | null>(null);
  const readSelection = () => {
    const root = bodyRef.current;
    const picked = window.getSelection();
    if (!root || !showsSource || !picked || picked.isCollapsed || !root.contains(picked.anchorNode)) return setSelection(null);
    const a = lineOf(picked.anchorNode);
    const b = lineOf(picked.focusNode);
    if (a === null || b === null) return setSelection(null);
    const rect = picked.getRangeAt(0).getBoundingClientRect();
    const box = root.getBoundingClientRect();
    // Above the selection, or under it when there is no room above (the first lines of the file).
    const above = rect.top - box.top - 40;
    setSelection({ start: Math.min(a, b), end: Math.max(a, b), x: Math.max(8, Math.min(rect.left - box.left, box.width - 340)), y: above >= 4 ? above : rect.bottom - box.top + 6 });
  };
  const linesItem = () => {
    if (!selection || text === null) return null;
    const lines = text.split(/\r?\n/).slice(selection.start - 1, selection.end).join('\n');
    return fileLinesItem(tab.path, { start: selection.start, end: selection.end }, lines, fenceLanguage(tab.path));
  };
  const addLines = (focus: boolean) => {
    const item = linesItem();
    if (!item) return;
    useDrafts.getState().addContext(sessionId, [item]);
    if (focus) useDrafts.getState().requestFocus(sessionId);
    else toast(`Added ${item.label} to the message`);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };
  const copyLines = () => {
    const item = linesItem();
    if (!item) return;
    void navigator.clipboard.writeText(item.text).then(() => toast('Lines copied'), () => toast("Couldn't copy the lines"));
  };
  // A new file, or the rendered page, has no selection of lines.
  useEffect(() => setSelection(null), [tab.path, showsSource]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (matches(event, 'files.find')) {
      event.preventDefault();
      openFind();
    } else if (matches(event, 'files.add-lines') && selection) {
      event.preventDefault();
      addLines(false);
    }
  };

  // --- Outline ---------------------------------------------------------------------------------------------------
  const headings = useMemo(() => (outline && kind === 'markdown' && !showsSource && text ? markdownOutline(text) : []), [outline, kind, showsSource, text]);
  const jumpTo = (index: number) => {
    const heading = bodyRef.current?.querySelectorAll('[data-file-preview-markdown] :is(h1, h2, h3, h4, h5, h6)')[index];
    heading?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const relativeOf = (path: string) => insideFolder(path, cwd);
  const changedHere = relative !== null && changed.has(relative);

  return (
    <section
      aria-label={name}
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={onKeyDown}
      onMouseUp={readSelection}
      onKeyUp={(e) => e.shiftKey && readSelection()}
      data-files-viewer={tab.path}
    >
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Open files" className="flex shrink-0 gap-0.5 overflow-x-auto px-2 pt-1.5">
          {tabs.map((t) => {
            const isFront = t.path === tab.path;
            const rel = relativeOf(t.path);
            return (
              <div
                key={t.path}
                role="tab"
                aria-selected={isFront}
                tabIndex={isFront ? 0 : -1}
                onClick={() => useFilesPanel.getState().setFront(sessionId, t.path)}
                onAuxClick={(e: MouseEvent) => e.button === 1 && useFilesPanel.getState().closeTab(sessionId, t.path)}
                onKeyDown={(e) => {
                  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
                  const at = tabs.findIndex((x) => x.path === t.path);
                  const next = tabs[(at + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]!;
                  useFilesPanel.getState().setFront(sessionId, next.path);
                }}
                className={`group flex h-7 max-w-48 shrink-0 cursor-default items-center gap-1.5 rounded-t-md pr-1 pl-2.5 text-ui ${isFront ? 'bg-code text-text' : 'text-muted hover:bg-border/45 hover:text-text'}`}
                data-tooltip={rel ?? t.path}
                data-files-tab={t.path}
              >
                <span className="truncate">{basename(t.path)}</span>
                {rel !== null && changed.has(rel) && <span aria-label="Changed in this session" className="size-1.5 shrink-0 rounded-full bg-accent-ink" />}
                <button
                  type="button"
                  aria-label={`Close ${basename(t.path)}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    useFilesPanel.getState().closeTab(sessionId, t.path);
                  }}
                  className="flex size-5 items-center justify-center rounded text-faint opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 hover:bg-border/50 hover:text-text focus-visible:opacity-100"
                >
                  <X size={12} aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <div className="flex h-9 shrink-0 items-center gap-1 px-2" data-files-viewer-bar="">
        {lead}
        <nav aria-label="Path" className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden px-1 text-ui text-muted">
          {crumbs.map((part, i) => {
            const last = i === crumbs.length - 1;
            if (last)
              return (
                <span key={i} className="truncate font-semibold text-text" aria-current="page">
                  {part}
                </span>
              );
            const folder = crumbs.slice(0, i + 1).join('/');
            return (
              <span key={i} className="flex min-w-0 shrink items-center gap-1">
                {relative !== null ? (
                  <button type="button" onClick={() => onFolder(folder)} className="truncate rounded px-0.5 hover:bg-border/50 hover:text-text" data-files-crumb={folder}>
                    {part}
                  </button>
                ) : (
                  <span className="truncate">{part}</span>
                )}
                <span aria-hidden>›</span>
              </span>
            );
          })}
        </nav>
        {changedHere && marks && marks.size > 0 && (
          <span className="shrink-0 rounded-full bg-accent/15 px-2 py-0.5 text-meta text-text" data-files-changed-lines={marks.size}>
            changed by Claude · {marks.size} {marks.size === 1 ? 'line' : 'lines'}
          </span>
        )}
        {onShowDiff && (
          <Button variant="quiet" size="sm" onClick={onShowDiff} data-files-show-diff="">
            Show diff
          </Button>
        )}
        {search && search.matches.length > 0 && (
          <span className="flex shrink-0 items-center gap-0.5 text-meta text-muted" data-files-search-position="">
            Match {search.current + 1} of {search.matches.length}
            <Button variant="quiet" size="sm" iconOnly icon={<ChevronUp size={13} aria-hidden />} aria-label="Previous match" onClick={() => search.onStep(-1)} />
            <Button variant="quiet" size="sm" iconOnly icon={<ChevronDown size={13} aria-hidden />} aria-label="Next match" onClick={() => search.onStep(1)} />
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1 px-2 pb-1" data-file-preview-toolbar="">
        {switcher}
        <div className="ml-auto flex items-center">
          <Button variant="quiet" size="sm" iconOnly icon={<Search size={14} aria-hidden />} aria-label="Find in file" shortcut="files.find" onClick={openFind} data-files-find-open="" />
          <Button variant="quiet" size="sm" onClick={() => setGoto('')} data-tooltip={`Go to line (${formatKeys(keysFor('files.go-to-line'))})`} data-files-goto-open="">
            Go to line
          </Button>
          {tools}
          <Button variant="quiet" size="sm" iconOnly icon={<Maximize2 size={13} aria-hidden />} aria-label="Open in a dialog" data-file-preview-detach="" onClick={() => useFilePreview.getState().detach(sessionId)} />
        </div>
      </div>
      <div ref={bodyRef} className="relative flex min-h-0 flex-1" data-files-viewer-body="">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">{body}</div>
        {headings.length > 1 && (
          <nav aria-label="Outline" className="w-52 shrink-0 overflow-y-auto bg-code px-2 py-3" data-files-outline="">
            <p className="px-2 pb-1.5 text-meta font-semibold tracking-wide text-muted uppercase">Outline</p>
            {headings.map((h) => (
              <button
                key={h.index}
                type="button"
                onClick={() => jumpTo(h.index)}
                className="block w-full truncate rounded-md py-1 pr-2 text-left text-ui text-muted hover:bg-border/45 hover:text-text"
                style={{ paddingLeft: `${0.5 + (h.level - 1) * 0.75}rem` }}
              >
                {h.text}
              </button>
            ))}
          </nav>
        )}
        {(find || goto !== null) && (
          <div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-lg px-2 py-1 overlay" data-files-find="">
            {goto !== null ? (
              <input
                autoFocus
                aria-label="Go to line"
                placeholder="Line number"
                inputMode="numeric"
                value={goto}
                onChange={(e) => setGoto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.preventDefault(), gotoLine(goto));
                  else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), setGoto(null));
                }}
                onBlur={() => setGoto(null)}
                className="h-6 w-32 bg-transparent font-mono text-ui text-text outline-none placeholder:text-faint"
                data-files-goto=""
              />
            ) : (
              <>
                <input
                  ref={findRef}
                  autoFocus
                  aria-label="Find in file"
                  placeholder="Find in file"
                  value={find!.query}
                  onChange={(e) => setFind({ query: e.target.value, current: 0 })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.preventDefault(), setFind((f) => f && { ...f, current: f.current + (e.shiftKey ? -1 : 1) }));
                    else if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), closeFind());
                  }}
                  className="h-6 w-40 bg-transparent font-mono text-ui text-text outline-none placeholder:text-faint"
                  data-files-find-input=""
                />
                <span role="status" aria-live="polite" className="min-w-14 text-right text-meta text-muted tabular-nums" data-files-find-count="">
                  {find!.query ? (count ? `${(((find!.current % count) + count) % count) + 1} of ${count}` : 'No matches') : ''}
                </span>
                <Button variant="quiet" size="sm" iconOnly icon={<ChevronUp size={13} aria-hidden />} aria-label="Previous match" shortcut="find.previous" onClick={() => setFind((f) => f && { ...f, current: f.current - 1 })} />
                <Button variant="quiet" size="sm" iconOnly icon={<ChevronDown size={13} aria-hidden />} aria-label="Next match" shortcut="find.next" onClick={() => setFind((f) => f && { ...f, current: f.current + 1 })} />
                <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label="Close find" kbd="Esc" onClick={closeFind} />
              </>
            )}
          </div>
        )}
        {selection && (
          <div role="toolbar" aria-label={`Selected ${lineSpan(selection.start, selection.end)}`} className="absolute z-10 flex items-center gap-0.5 rounded-lg p-1 overlay" style={{ left: selection.x, top: selection.y }} data-files-selection-bar="">
            <Button variant="quiet" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => addLines(true)} data-files-ask-lines="">
              Ask about {lineSpan(selection.start, selection.end)}
            </Button>
            <Button variant="quiet" size="sm" shortcut="files.add-lines" onMouseDown={(e) => e.preventDefault()} onClick={() => addLines(false)} data-files-add-lines="">
              Add to message
            </Button>
            <Button variant="quiet" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={copyLines}>
              Copy
            </Button>
          </div>
        )}
      </div>
      {kind === 'code' && showsSource && marks && marks.size > 0 && (
        <p className="flex shrink-0 items-center gap-1.5 px-3 py-1 text-meta text-muted">
          <span aria-hidden className="h-3 w-[3px] bg-accent-ink" />A line Claude changed in this session. Hover it for the old text.
        </p>
      )}
    </section>
  );
}
