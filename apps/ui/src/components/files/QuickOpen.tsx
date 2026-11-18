import { joinPath } from '@seshboard/protocol/client';
import { FileText } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { modKey } from '../../lib/shortcuts.ts';
import { useDrafts } from '../../state/draftsStore.ts';
import { useFilePreview } from '../../state/filePreviewStore.ts';
import { useFilesPanel, useTouched } from '../../state/filesPanelStore.ts';
import { useQuickOpen, type QuickOpenTarget } from '../../state/quickOpenStore.ts';
import { PaletteFooter } from '../palette/PaletteFooter.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { insideFolder } from './touchedFiles.ts';
import { matchedLetters, parseQuickOpen } from './quickOpen.ts';

/** A file Quick open lists: relative to the folder, with why it is there when nothing is typed. */
interface Row {
  path: string;
  group: 'match' | 'session' | 'recent';
  note?: string;
}

/** Quick open (⌘⌥P): a file of the session's folder, by part of its name, opened in Files. Mounted once per window. */
export function QuickOpenHost() {
  const target = useQuickOpen((s) => s.target);
  if (!target) return null;
  return <QuickOpen target={target} onClose={() => useQuickOpen.getState().close()} />;
}

function QuickOpen({ target, onClose }: { target: QuickOpenTarget; onClose(): void }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const { sessionId, cwd } = target;
  const touched = useTouched(sessionId);
  const files = useFilesPanel((s) => (sessionId ? s.sessions.get(sessionId) : undefined));
  const [text, setText] = useState('');
  const [found, setFound] = useState<{ query: string; files: string[] } | null>(null);
  const [active, setActive] = useState(0);
  const listId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const { query, line } = parseQuickOpen(text);

  useEffect(() => {
    if (!client || !cwd || !query) return;
    let cancelled = false;
    void client.call('files.search', { cwd, query, limit: 50 }).then(
      (result) => !cancelled && setFound({ query, files: result.files }),
      () => !cancelled && setFound({ query, files: [] }),
    );
    return () => {
      cancelled = true;
    };
  }, [client, cwd, query]);

  const rows = useMemo<Row[]>(() => {
    if (query) return found?.query === query ? found.files.map((path) => ({ path, group: 'match' })) : [];
    if (!cwd) return [];
    // Nothing typed: this session's files (changed first), then the files opened lately, newest first.
    const session: Row[] = [...[...touched.changed].sort().map((path): Row => ({ path, group: 'session', note: 'changed' })), ...[...touched.read].sort().map((path): Row => ({ path, group: 'session', note: 'read' }))];
    const seen = new Set(session.map((r) => r.path));
    const recent = [...(files?.tabs ?? [])]
      .sort((a, b) => b.seq - a.seq)
      .map((tab) => insideFolder(tab.path, cwd))
      .filter((path): path is string => path !== null && !seen.has(path))
      .map((path): Row => ({ path, group: 'recent' }));
    return [...session.slice(0, 12), ...recent.slice(0, 8)];
  }, [query, found, cwd, touched, files?.tabs]);

  useEffect(() => setActive(0), [rows]);
  useEffect(() => {
    // Braces: scrollIntoView returns a promise in newer Chromium, which React would take for a cleanup.
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (row: Row | undefined, how: 'open' | 'full' | 'mention') => {
    if (!cwd) return;
    // `:42` alone goes to a line of the file in front.
    const path = row ? joinPath(cwd, row.path) : null;
    if (!path) return;
    onClose();
    if (how === 'mention' && sessionId) return useDrafts.getState().addContext(sessionId, [{ kind: 'file', path, directory: false }]);
    if (!sessionId) return useFilePreview.getState().openDialog(path, { line });
    useFilesPanel.getState().openFile(sessionId, path, { line, ...(how === 'full' ? { full: true } : {}) });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rows.length) setActive((i) => (i + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(rows[active], event.altKey ? 'mention' : modKey(event) ? 'full' : 'open');
    }
  };

  const groups: Array<{ id: Row['group']; label: string | null }> = query
    ? [{ id: 'match', label: null }]
    : [
        { id: 'session', label: 'In this session' },
        { id: 'recent', label: 'Opened lately' },
      ];
  const optionId = (i: number) => `${listId}-${i}`;
  let index = -1;

  return (
    <Dialog bare flush placement="top" width="palette" title="Quick open" onClose={onClose} data-quick-open="">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-edge px-4">
        <FileText size={15} className="shrink-0 text-muted" aria-hidden />
        <input
          autoFocus
          role="combobox"
          aria-expanded={rows.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={rows[active] ? optionId(active) : undefined}
          aria-label="Go to file"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={cwd ? 'Go to file' : 'Open a session or pick a project first.'}
          disabled={!cwd}
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent text-body text-text outline-none placeholder:text-faint"
          data-quick-open-input=""
        />
        <Kbd shortcut="files.quick-open" />
      </div>
      {!cwd ? (
        <p className="px-4 py-6 text-center text-ui text-muted" data-quick-open-empty="">
          Open a session or pick a project first.
        </p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-ui text-muted" data-quick-open-empty="">
          {query ? (found?.query === query ? 'No files match.' : 'Looking…') : 'Type part of a file name.'}
        </p>
      ) : null}
      <div ref={listRef} id={listId} role="listbox" aria-label="Files" className={`min-h-0 flex-1 overflow-y-auto ${rows.length ? 'py-1.5' : ''}`}>
        {groups.map((group) => {
          const groupRows = rows.filter((r) => r.group === group.id);
          if (!groupRows.length) return null;
          return (
            <div key={group.id} role="group" aria-label={group.label ?? 'Matches'}>
              {group.label && (
                <SectionHeader aria-hidden className="px-4 pt-2 pb-1">
                  {group.label}
                </SectionHeader>
              )}
              {groupRows.map((row) => {
                index += 1;
                const i = index;
                const slash = row.path.lastIndexOf('/');
                const name = row.path.slice(slash + 1);
                const folder = slash < 0 ? '' : row.path.slice(0, slash);
                const marked = new Set(matchedLetters(name, query));
                const changed = touched.changed.has(row.path);
                return (
                  <div
                    key={row.path}
                    id={optionId(i)}
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={(e) => choose(row, e.altKey ? 'mention' : modKey(e) ? 'full' : 'open')}
                    className={`mx-1.5 flex h-8 cursor-default items-center gap-2.5 rounded-md px-2.5 text-ui ${i === active ? 'bg-selected text-text' : 'text-text'}`}
                    data-quick-open-row={row.path}
                  >
                    <span className="shrink-0 truncate">
                      {[...name].map((ch, k) => (marked.has(k) ? <span key={k} className="font-semibold text-accent-ink">{ch}</span> : ch))}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-meta text-muted">{folder}</span>
                    {row.note && <span className="shrink-0 text-meta text-muted">{row.note}</span>}
                    {changed && !row.note && <span aria-label="Changed in this session" className="size-1.5 shrink-0 rounded-full bg-accent-ink" />}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {query && found?.query === query ? (rows.length === 0 ? 'No files match' : `${rows.length} ${rows.length === 1 ? 'file' : 'files'}`) : ''}
      </p>
      <PaletteFooter
        keys={[
          { keys: '↩', label: 'open' },
          ...(sessionId
            ? [
                { keys: '⌘↩', label: 'open full size' },
                { keys: '⌥↩', label: 'add to message' },
              ]
            : []),
          { keys: ':42', label: 'go to line', prefix: true },
        ]}
      />
    </Dialog>
  );
}
