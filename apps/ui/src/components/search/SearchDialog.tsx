import { Brain, Search } from 'lucide-react';
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { MAX_SEARCH_QUERY_LENGTH, type MemoryHit, type SearchHit } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { basename, shortAge } from '../../lib/format.ts';
import { useOverlay } from '../../state/overlayStore.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { openMemoryFile } from '../../state/memoryStore.ts';
import { addedProjects } from '../../state/projectList.ts';
import { typeTone } from '../memory/memoryUi.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Dialog } from '../ui/Dialog.tsx';
import { Pill } from '../ui/Pill.tsx';
import { Select } from '../ui/Select.tsx';

/** The type chips: every type, or one. */
const MEMORY_TYPE_CHIPS = ['all', 'user', 'feedback', 'project', 'reference'] as const;
/** A row of the results: a memory or a message, in the order the arrow keys move through them. */
type Row = { kind: 'memory'; hit: MemoryHit } | { kind: 'message'; hit: SearchHit };

const MARK = /\u0002([\s\S]*?)\u0003/g;
const HITS_PER_SESSION = 4;

/** A snippet with the matched words highlighted. */
function Snippet({ text }: { text: string }) {
  const parts: Array<{ text: string; hit: boolean }> = [];
  let last = 0;
  for (const match of text.matchAll(MARK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), hit: false });
    parts.push({ text: match[1]!, hit: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hit: false });
  return (
    <span className="line-clamp-2 text-[12.5px] text-muted">
      {parts.map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-sm bg-accent/35 px-px text-text">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text.replace(/\s+/g, ' ')}</Fragment>
        ),
      )}
    </span>
  );
}

/**
 * ⌘⇧F: search memory and every conversation. Memories come first in their own group (type chips and a project narrow
 * them); Enter opens a memory in its editor, or the session at the matching message. Search memory… shows memory only.
 */
export function SearchDialog() {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const close = useOverlay((s) => s.close);
  const sessions = useSessions((s) => s.sessions);
  const scope = usePreferences((s) => s.prefs.sessionScope);
  const projects = useProjects((s) => s.projects);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [memories, setMemories] = useState<MemoryHit[]>([]);
  const mode = useOverlay((s) => s.searchMode);
  const [memoryType, setMemoryType] = useState<(typeof MEMORY_TYPE_CHIPS)[number]>('all');
  const [memoryScope, setMemoryScope] = useState('all');
  const [indexing, setIndexing] = useState<{ indexed: number; total: number } | null>(null);
  const [active, setActive] = useState(0);
  /** The query the shown hits answer, so "no matches" waits for the engine instead of flashing while you type. */
  const [answered, setAnswered] = useState('');
  /** Why the last search failed; its results are cleared rather than left answering an older query. */
  const [failed, setFailed] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    if (!client) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // While the index is still being built (or hasn't started), ask again so results fill in.
    const ask = (first: boolean) => {
      client.call('search.query', { query, scope, only: mode === 'memory' ? 'memory' : 'all', memoryTypes: memoryType === 'all' ? [] : [memoryType], memoryScope }).then((result) => {
        if (cancelled) return;
        setHits(result.hits);
        setMemories(result.memories);
        setIndexing(result.indexing);
        setAnswered(query);
        setFailed(null);
        if (first) setActive(0);
        const building = result.indexing.total === 0 || result.indexing.indexed < result.indexing.total;
        if (building && query.trim()) timer = setTimeout(() => ask(false), 1_000);
      }, (error: unknown) => {
        if (cancelled) return;
        setHits([]);
        setMemories([]);
        setAnswered(query);
        setActive(0);
        setFailed(error instanceof Error ? error.message : String(error));
      });
    };
    timer = setTimeout(() => ask(true), 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, query, scope, mode, memoryType, memoryScope]);

  // Best match first, grouped by session in the order their best match appears.
  const groups = useMemo(() => {
    const bySession = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      // Same sessions as the sidebar: with "Seshboard sessions only", the engine searches only those.
      const list = bySession.get(hit.sessionId) ?? [];
      list.push(hit);
      bySession.set(hit.sessionId, list);
    }
    return [...bySession.entries()].map(([sessionId, list]) => ({ sessionId, hits: list.slice(0, HITS_PER_SESSION), more: Math.max(0, list.length - HITS_PER_SESSION) }));
  }, [hits]);
  const flat = useMemo<Row[]>(() => [...memories.map((hit) => ({ kind: 'memory' as const, hit })), ...groups.flatMap((g) => g.hits.map((hit) => ({ kind: 'message' as const, hit })))], [memories, groups]);
  const indexOf = (hit: MemoryHit | SearchHit) => flat.findIndex((row) => row.hit === hit);
  const projectOptions = useMemo(
    () => [{ value: 'all', label: 'All projects' }, { value: 'personal', label: 'Personal' }, ...addedProjects(projects).map((p) => ({ value: p.root, label: p.name }))],
    [projects],
  );

  const openRow = (row: Row) => {
    if (row.kind === 'message') return open(row.hit);
    close();
    openMemoryFile(row.hit.root, row.hit.path);
  };
  const open = (hit: SearchHit) => {
    useOverlay.getState().focus({ sessionId: hit.sessionId, messageUuid: hit.messageUuid });
    useSessions.getState().select(hit.sessionId);
    close();
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const typed = query.trim();
  const stillIndexing = indexing !== null && (indexing.total === 0 || indexing.indexed < indexing.total);
  const sessionCount = groups.length;
  const memoryOnly = mode === 'memory';
  const messageCount = flat.length - memories.length;
  // Read out once the results settle; empty while nothing is typed, so opening the dialog stays quiet.
  const pending = answered !== query;
  const announcement = !typed || pending
    ? ''
    : failed !== null
      ? "Couldn't search"
      : flat.length === 0
      ? stillIndexing
        ? 'No matches yet, still indexing'
        : 'No matches'
      : `${memories.length ? `${memories.length} ${memories.length === 1 ? 'memory' : 'memories'}, ` : ''}${messageCount} ${messageCount === 1 ? 'match' : 'matches'} in ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}`;

  return (
    <Dialog bare flush placement="top" title={memoryOnly ? 'Search memory' : 'Search memory and conversations'} onClose={close} data-search data-search-mode={mode}>
      <label className="flex h-12 shrink-0 items-center gap-2.5 border-b border-edge px-4">
        <Search size={16} className="shrink-0 text-faint" aria-hidden />
        {/* A combobox: focus stays in the field while ↑ ↓ move the highlighted match. */}
        <input
          autoFocus
          role="combobox"
          aria-expanded={flat.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={flat[active] ? optionId(active) : undefined}
          aria-label={memoryOnly ? 'Search memory' : 'Search memory and all conversations'}
          value={query}
          maxLength={MAX_SEARCH_QUERY_LENGTH}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.max(0, Math.min(flat.length - 1, i + 1))));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(0, i - 1)));
            // Handled here: the dialog closes before the window's key listeners run, and the catch-up banner behind would take this Enter.
            else if (e.key === 'Enter' && flat[active]) (e.preventDefault(), openRow(flat[active]!));
          }}
          placeholder={memoryOnly ? 'Search memory' : 'Search memory and conversations'}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-text outline-none placeholder:text-faint"
        />
        <Kbd keys="Esc" aria-hidden />
      </label>
      {/* Narrow the memories: by type, and to one project or the personal folder. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-edge px-4 py-1.5" data-search-memory-filters>
        {MEMORY_TYPE_CHIPS.map((type) => (
          <Pill key={type} onClick={() => setMemoryType(type)} selected={memoryType === type} aria-pressed={memoryType === type} data-search-memory-type={type}>
            {type}
          </Pill>
        ))}
        <span className="flex-1" />
        <Select
          label="Memory from"
          value={memoryScope}
          onChange={setMemoryScope}
          options={projectOptions}
          menuWidth={220}
          className="flex h-6 items-center gap-1 rounded-md border border-edge bg-bg px-2 text-meta text-text"
          dataAttrs={{ 'data-search-memory-scope': true }}
        />
      </div>

      {typed === '' ? (
        <p className="px-4 py-6 text-center text-ui text-muted">
          {memoryOnly ? 'Search what Claude Code remembers: names, descriptions and text.' : "Search memory, your prompts and Claude's replies in every session. Pick a match to open it."}
        </p>
      ) : failed !== null && !pending ? (
        <div className="grid gap-1 px-4 py-6 text-center text-ui" data-search-error>
          <p className="text-error">Couldn't search.</p>
          <p className="text-muted">{failed}</p>
        </div>
      ) : flat.length === 0 && !pending ? (
        <div className="grid gap-1 px-4 py-6 text-center text-ui">
          <p className="text-text">{stillIndexing && !memoryOnly ? `Nothing for “${typed}” yet.` : memoryOnly ? `No memory mentions “${typed}”.` : `Nothing mentions “${typed}”.`}</p>
          <p className="text-muted">{stillIndexing && !memoryOnly ? 'Still indexing; matches appear as sessions are read.' : 'Try another word, or fewer words.'}</p>
        </div>
      ) : null}
      <div ref={listRef} id={listId} role="listbox" aria-label="Matches" className={`min-h-0 flex-1 overflow-y-auto ${flat.length && typed ? 'py-1' : ''}`}>
        {typed !== '' && memories.length > 0 && (
          <div role="group" aria-labelledby={`${listId}-memory`} className="py-1" data-search-memory-group>
            <div id={`${listId}-memory`} className="flex items-center gap-2 px-4 pt-1.5 pb-1 text-meta font-semibold tracking-wider text-faint uppercase">
              <Brain size={13} aria-hidden />
              Memory
            </div>
            {memories.map((hit) => {
              const index = indexOf(hit);
              return (
                <div
                  key={hit.path}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === active}
                  data-active={index === active}
                  data-search-memory-hit={hit.path}
                  onMouseMove={() => setActive(index)}
                  onClick={() => openRow({ kind: 'memory', hit })}
                  className={`flex w-full min-w-0 cursor-default items-center gap-2.5 px-4 py-1.5 text-left ${index === active ? 'bg-accent/15' : ''}`}
                >
                  <span className="shrink-0 text-ui font-semibold">{hit.name}</span>
                  {hit.type && <Pill tone={typeTone(hit.type)}>{hit.type}</Pill>}
                  <span className="min-w-0 flex-1">
                    <Snippet text={hit.snippet || (hit.description ?? '')} />
                  </span>
                  <span className="shrink-0 text-meta text-muted">{hit.root ? (projects.get(hit.root)?.name ?? basename(hit.root)) : 'Personal'}</span>
                </div>
              );
            })}
          </div>
        )}
        {typed !== '' && !memoryOnly && groups.length > 0 && memories.length > 0 && (
          <div className="px-4 pt-2 pb-0.5 text-meta font-semibold tracking-wider text-faint uppercase">Conversations</div>
        )}
        {typed !== '' &&
          !memoryOnly &&
          groups.map((group) => {
            const summary = sessions.get(group.sessionId);
            const root = summary?.projectRoot ?? '';
            const project = projects.get(root);
            const headingId = `${listId}-${group.sessionId}`;
            return (
              <div key={group.sessionId} role="group" aria-labelledby={headingId} className="py-1" data-search-group>
                <div id={headingId} className="flex items-center gap-2 px-4 pt-1.5 pb-1 text-[11.5px] text-muted">
                  {root && <ProjectIcon project={project} root={root} size={14} />}
                  <span className="min-w-0 truncate font-medium text-text/85">{summary?.title ?? 'Session'}</span>
                  <span className="shrink-0">· {project?.name ?? basename(root)}</span>
                  {summary && <span className="shrink-0">· {shortAge(summary.updatedAt)}</span>}
                  {group.more > 0 && <span className="ml-auto shrink-0">+{group.more} more</span>}
                </div>
                {group.hits.map((hit) => {
                  const index = indexOf(hit);
                  return (
                    <div
                      key={hit.messageUuid}
                      id={optionId(index)}
                      role="option"
                      aria-selected={index === active}
                      data-active={index === active}
                      data-search-hit
                      onMouseMove={() => setActive(index)}
                      onClick={() => open(hit)}
                      className={`flex w-full cursor-default items-start gap-2.5 px-4 py-1.5 text-left ${index === active ? 'bg-accent/15' : ''}`}
                    >
                      <span className={`mt-px w-11 shrink-0 text-meta font-medium tracking-wide uppercase ${hit.role === 'user' ? 'text-accent-ink' : 'text-muted'}`}>
                        {hit.role === 'user' ? 'You' : 'Claude'}
                        <span className="sr-only">:</span>
                      </span>
                      <Snippet text={hit.snippet} />
                    </div>
                  );
                })}
              </div>
            );
          })}
      </div>

      {stillIndexing && typed !== '' && !memoryOnly && (
        <p className="shrink-0 border-t border-edge px-4 py-1.5 text-meta text-muted">
          {indexing.total === 0 ? 'Preparing the search index…' : `Indexing ${indexing.indexed} of ${indexing.total} sessions; results will fill in.`}
        </p>
      )}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </Dialog>
  );
}
