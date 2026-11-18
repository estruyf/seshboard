import { joinPath } from '@seshboard/protocol/client';
import { ChevronDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useFilesPanel, useSessionFiles, type FileSearchQuery } from '../../state/filesPanelStore.ts';
import { searchResultsItem } from '../composer/contextItems.ts';
import { Button } from '../ui/Button.tsx';
import type { ViewerMatch } from './FileViewer.tsx';

/** One match of `files.grep`. */
export interface GrepMatch {
  path: string;
  line: number;
  column: number;
  length: number;
  text: string;
  textStart: number;
}

type Results = { state: 'idle' } | { state: 'searching'; previous: GrepMatch[] } | { state: 'error'; message: string; field: boolean } | { state: 'done'; matches: GrepMatch[]; files: number; truncated: boolean };

/** How long typing pauses before the search runs. */
const DEBOUNCE_MS = 250;
/** One search id per window and session: a newer search there cancels the one before. */
const WINDOW_ID = Math.random().toString(36).slice(2);

interface FileSearchProps {
  sessionId: string;
  cwd: string;
  /** At Side: the list and the viewer take turns. */
  narrow: boolean;
  /** The viewer beside the list (or instead of it at Side) for a file, its matches and the one picked. */
  viewer(path: string, matches: readonly ViewerMatch[], current: number, onStep: (step: 1 | -1) => void, lead: ReactNode): ReactNode;
}

/**
 * Search in files (⌘⌥F): text or a regular expression, match case and whole word, and globs to include and leave out,
 * through `git grep` (it respects .gitignore). Results group by file; ↑ ↓ walk the matches and the viewer follows.
 */
export function FileSearch({ sessionId, cwd, narrow, viewer }: FileSearchProps) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const files = useSessionFiles(sessionId);
  const search = files.search;
  const set = (change: Partial<FileSearchQuery>) => useFilesPanel.getState().setSearch(sessionId, change);
  const [results, setResults] = useState<Results>({ state: 'idle' });
  const [active, setActive] = useState(0);
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());
  const [showViewer, setShowViewer] = useState(false);
  const queryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // ⌘⌥F asks for the field.
  const command = files.command;
  const seen = useRef(command?.nonce ?? 0);
  useEffect(() => {
    if (command?.kind !== 'search' || command.nonce === seen.current) return;
    seen.current = command.nonce;
    setShowViewer(false);
    requestAnimationFrame(() => queryRef.current?.select());
  }, [command]);

  useEffect(() => {
    if (!client || !search.query) return setResults({ state: 'idle' });
    let cancelled = false;
    setResults((r) => ({ state: 'searching', previous: r.state === 'done' ? r.matches : r.state === 'searching' ? r.previous : [] }));
    const timer = setTimeout(() => {
      void client.call('files.grep', { cwd, ...search, limit: 2000, searchId: `${WINDOW_ID}:${sessionId}` }).then(
        (result) => {
          if (cancelled) return;
          setResults({ state: 'done', ...result });
          setActive(0);
        },
        (error: unknown) => {
          const code = (error as { code?: unknown })?.code;
          if (cancelled || code === 'CANCELLED') return;
          setResults({ state: 'error', message: error instanceof Error ? error.message : String(error), field: code === 'INVALID_QUERY' });
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, cwd, sessionId, search]);

  const matches = results.state === 'done' ? results.matches : results.state === 'searching' ? results.previous : [];
  const groups = useMemo(() => {
    const byFile = new Map<string, Array<{ match: GrepMatch; index: number }>>();
    matches.forEach((match, index) => {
      const list = byFile.get(match.path) ?? [];
      list.push({ match, index });
      byFile.set(match.path, list);
    });
    return [...byFile];
  }, [matches]);
  const current = matches[Math.min(active, matches.length - 1)];

  const step = (by: 1 | -1) => {
    if (!matches.length) return;
    const next = (active + by + matches.length) % matches.length;
    setActive(next);
    const path = matches[next]!.path;
    if (folded.has(path)) setFolded((f) => new Set([...f].filter((p) => p !== path)));
  };
  useEffect(() => {
    // Braces: scrollIntoView returns a promise in newer Chromium, which React would take for a cleanup.
    listRef.current?.querySelector('[data-files-result][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      step(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter' && current) {
      event.preventDefault();
      if (narrow) setShowViewer(true);
      else useFilesPanel.getState().openFile(sessionId, joinPath(cwd, current.path), { line: current.line });
    }
  };

  const askClaude = () => {
    if (!matches.length) return;
    useDrafts.getState().addContext(sessionId, [searchResultsItem(search.query, matches, matches.length)]);
    useDrafts.getState().requestFocus(sessionId);
  };

  const status =
    results.state === 'searching'
      ? 'Searching…'
      : results.state === 'done'
        ? results.matches.length === 0
          ? 'No matches. Check the include and exclude fields.'
          : `${results.matches.length.toLocaleString('en-US')} ${results.matches.length === 1 ? 'match' : 'matches'} in ${results.files} ${results.files === 1 ? 'file' : 'files'} · .gitignore respected`
        : '';

  const inFile = current ? groups.find(([path]) => path === current.path)?.[1] ?? [] : [];
  const viewerMatches = inFile.map(({ match }) => ({ line: match.line, column: match.column, length: match.length }));
  const viewerCurrent = inFile.findIndex(({ index }) => index === active);
  const stepInFile = (by: 1 | -1) => {
    if (!inFile.length) return;
    const at = (viewerCurrent + by + inFile.length) % inFile.length;
    setActive(inFile[at]!.index);
  };

  const list = (
    <section aria-label="Search in files" className={`flex min-h-0 flex-col gap-2 px-2.5 py-2.5 ${narrow ? 'flex-1' : 'w-[380px] shrink-0 max-w-[50%]'}`} data-files-search="">
      <label className={`flex h-8 shrink-0 items-center gap-1.5 rounded-md border bg-bg pr-1 pl-2 text-muted focus-within:border-focus-ring ${results.state === 'error' && results.field ? 'border-error' : 'border-edge'}`}>
        <Search size={13} aria-hidden className="shrink-0" />
        <input
          ref={queryRef}
          aria-label="Search"
          placeholder="Search"
          value={search.query}
          onChange={(e) => set({ query: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') onListKey(e as unknown as KeyboardEvent<HTMLDivElement>);
            else if (e.key === 'Enter') onListKey(e as unknown as KeyboardEvent<HTMLDivElement>);
          }}
          spellCheck={false}
          aria-invalid={results.state === 'error' && results.field}
          className="min-w-0 flex-1 bg-transparent font-mono text-ui text-text outline-none placeholder:font-sans placeholder:text-faint"
          data-files-search-input=""
        />
        <SearchToggle label="Match case" on={search.caseSensitive} onClick={() => set({ caseSensitive: !search.caseSensitive })} text="Aa" />
        <SearchToggle label="Whole word" on={search.wholeWord} onClick={() => set({ wholeWord: !search.wholeWord })} text="ab" />
        <SearchToggle label="Regular expression" on={search.regex} onClick={() => set({ regex: !search.regex })} text=".*" />
      </label>
      {results.state === 'error' && (
        <p role="alert" className="-mt-1 px-1 text-meta text-error" data-files-search-error="">
          {results.message}
        </p>
      )}
      <div className="flex shrink-0 gap-1.5">
        <input aria-label="Files to include" placeholder="Include: src/**, *.ts" value={search.include} onChange={(e) => set({ include: e.target.value })} spellCheck={false} className="h-7 min-w-0 flex-1 rounded-md border border-edge bg-bg px-2 font-mono text-meta text-text outline-none placeholder:font-sans placeholder:text-faint focus:border-focus-ring" data-files-search-include="" />
        <input aria-label="Files to leave out" placeholder="Leave out: *.snap" value={search.exclude} onChange={(e) => set({ exclude: e.target.value })} spellCheck={false} className="h-7 min-w-0 flex-1 rounded-md border border-edge bg-bg px-2 font-mono text-meta text-text outline-none placeholder:font-sans placeholder:text-faint focus:border-focus-ring" data-files-search-exclude="" />
      </div>
      <p role="status" aria-live="polite" className="px-1 text-meta text-muted" data-files-search-count="">
        {status}
        {results.state === 'done' && results.truncated && <span className="block">Showing the first 2,000 matches.</span>}
      </p>
      <div ref={listRef} role="listbox" aria-label="Results" tabIndex={0} onKeyDown={onListKey} aria-activedescendant={current ? `files-result-${active}` : undefined} className="min-h-0 flex-1 overflow-y-auto outline-none focus-visible:ring-1 focus-visible:ring-focus-ring" data-files-results="">
        {groups.map(([path, list]) => {
          const isFolded = folded.has(path);
          const slash = path.lastIndexOf('/');
          return (
            <div key={path} role="group" aria-label={path}>
              <button
                type="button"
                aria-expanded={!isFolded}
                onClick={() => setFolded((f) => (f.has(path) ? new Set([...f].filter((p) => p !== path)) : new Set(f).add(path)))}
                className="flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-ui text-text hover:bg-border/45"
                data-files-result-file={path}
              >
                {isFolded ? <ChevronRight size={12} aria-hidden className="shrink-0 text-faint" /> : <ChevronDown size={12} aria-hidden className="shrink-0 text-faint" />}
                <span className="shrink-0 truncate">{path.slice(slash + 1)}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-meta text-muted">{slash < 0 ? '' : path.slice(0, slash)}</span>
                <span className="shrink-0 rounded-full bg-text/6 px-1.5 text-meta text-muted tabular-nums">{list.length}</span>
              </button>
              {!isFolded &&
                list.map(({ match, index }) => {
                  const at = Math.max(0, match.column - 1 - match.textStart);
                  return (
                    <div
                      key={index}
                      id={`files-result-${index}`}
                      role="option"
                      aria-selected={index === active}
                      onClick={() => {
                        setActive(index);
                        if (narrow) setShowViewer(true);
                      }}
                      className={`flex cursor-default gap-2 rounded-md py-1 pr-2 pl-6 font-mono text-meta whitespace-pre ${index === active ? 'bg-selected text-text' : 'text-muted hover:bg-border/45'}`}
                      data-files-result={`${match.path}:${match.line}`}
                    >
                      <span className="w-8 shrink-0 text-right text-faint tabular-nums">{match.line}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {match.text.slice(0, at).trimStart()}
                        <mark className="rounded-sm bg-accent/35 text-text">{match.text.slice(at, at + match.length)}</mark>
                        {match.text.slice(at + match.length)}
                      </span>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
      {matches.length > 0 && (
        <Button size="sm" onClick={askClaude} className="shrink-0" data-files-search-ask="">
          Ask Claude about these results
        </Button>
      )}
    </section>
  );

  const back = (
    <Button variant="quiet" size="sm" icon={<ChevronLeft size={13} aria-hidden />} onClick={() => setShowViewer(false)} data-files-search-back="">
      Results
    </Button>
  );
  if (narrow) return showViewer && current ? <>{viewer(joinPath(cwd, current.path), viewerMatches, viewerCurrent, stepInFile, back)}</> : list;
  return (
    <div className="flex min-h-0 flex-1">
      {list}
      {current ? (
        viewer(joinPath(cwd, current.path), viewerMatches, viewerCurrent, stepInFile, null)
      ) : (
        <div className="flex flex-1 items-center justify-center bg-code text-ui text-muted">{search.query ? '' : 'Type to search in every file of the project.'}</div>
      )}
    </div>
  );
}

function SearchToggle({ label, on, onClick, text }: { label: string; on: boolean; onClick(): void; text: string }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on} data-tooltip={label} onClick={onClick} className={`flex h-6 w-7 shrink-0 items-center justify-center rounded font-mono text-meta ${on ? 'bg-accent/25 text-text' : 'text-muted hover:bg-border/50 hover:text-text'}`}>
      {text}
    </button>
  );
}
