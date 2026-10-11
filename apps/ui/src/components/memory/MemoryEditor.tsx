import { FolderSearch, MoreHorizontal, Pencil, Share2, Trash2 } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { bodyTokens, memoryMeta, splitFrontmatter, type MemoryFile } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { contextMenuPoint, type ContextMenuPoint } from '../../lib/contextMenu.ts';
import { agoText } from '../../lib/format.ts';
import { matches } from '../../lib/shortcuts.ts';
import { useMemoryView } from '../../state/memoryStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';
import { Menu, type MenuEntry } from '../Menu.tsx';
import { Button } from '../ui/Button.tsx';
import { Kbd } from '../ui/Kbd.tsx';
import { Notice } from '../ui/Notice.tsx';
import { Pill } from '../ui/Pill.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { SegmentedControl } from '../ui/SegmentedControl.tsx';
import { completeLink, linkQuery, linkSuggestions } from './linkCompletion.ts';
import { TYPE_CHOICES, typeTone } from './memoryUi.ts';
import { useMemoryFile } from './useMemoryList.ts';

const field = 'h-7 w-full rounded-md border border-edge bg-bg px-2.5 text-ui text-text outline-none focus:border-accent-ink';

interface Draft {
  description: string;
  type: string;
  body: string;
}

/**
 * One memory, editable: its description and type as fields (the name changes through Rename…), the Markdown body
 * (read with `[[name]]` links you can follow, edited as plain text), when and where it was written, and ⌘S to save.
 * Other frontmatter fields are kept by the engine. A file that changed on disk since it was opened is not overwritten
 * without asking.
 */
export function MemoryEditor({
  root,
  memory,
  names,
  menuEntries,
  onShare,
  onRename,
  onDelete,
  onReveal,
  onOpenLink,
  footerActions,
  autoFocus = false,
  linkInfo,
  labelOf,
  onOpenPath,
  highlight = [],
}: {
  /** The project, or null for the personal folder. */
  root: string | null;
  memory: MemoryFile;
  /** Memory names a `[[name]]` link can open (this folder, then the personal one). */
  names: ReadonlySet<string>;
  menuEntries: MenuEntry[];
  onShare?(): void;
  onRename(): void;
  onDelete(): void;
  onReveal(): void;
  onOpenLink(name: string): void;
  /** More quiet actions in the footer (Move to Personal). */
  footerActions?: ReactNode;
  /** Put the cursor in it once it is read (opened from search or a link). */
  autoFocus?: boolean;
  /** Its links (resolved or not) and what links to it, from `memory.links`. */
  linkInfo?: { links: Array<{ name: string; target: string | null }>; backlinks: string[] };
  /** A memory's name, by path (for Linked from). */
  labelOf?(path: string): string;
  /** Opens another memory (a backlink). */
  onOpenPath?(path: string): void;
  /** Words to mark in the text (a reference Health found stale). */
  highlight?: readonly string[];
}) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const id = useId();
  const [version, setVersion] = useState(0);
  const file = useMemoryFile(root, memory.path, `${memory.modified}:${version}`);
  const [saved, setSaved] = useState<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [modified, setModified] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [menu, setMenu] = useState<ContextMenuPoint | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLInputElement>(null);
  const loaded = draft !== null;
  useEffect(() => {
    if (autoFocus && loaded) descriptionRef.current?.focus();
  }, [autoFocus, loaded]);
  const sessionTitle = useSessions((s) => (memory.originSessionId ? (s.sessions.get(memory.originSessionId)?.title ?? null) : null));

  // A fresh read (another file, or saved here or by Claude) replaces the fields, unless you are in the middle of an edit.
  useEffect(() => {
    if (file.content === null) return;
    const { data, body } = splitFrontmatter(file.content);
    const meta = memoryMeta(data);
    const next = { description: meta.description ?? '', type: meta.type ?? 'project', body: body.trimEnd() };
    setSaved(next);
    setModified(file.modified);
    setDraft((current) => (current && saved && !sameDraft(current, saved) ? current : next));
    // `saved` is read, not followed: only a new read changes the fields.
  }, [file.content, file.modified]);

  const dirty = !!draft && !!saved && !sameDraft(draft, saved);
  useEffect(() => {
    useMemoryView.setState({ dirty });
  }, [dirty]);
  useEffect(() => () => useMemoryView.setState({ dirty: false }), []);

  const save = async (force = false) => {
    if (!client || !draft || !dirty) return;
    setError(null);
    try {
      const result = await client.call('memory.write', { root, path: memory.path, ...draft, expectedModified: modified, force });
      setSaved(draft);
      setModified(result.modified);
      setEditing(false);
      setVersion((v) => v + 1);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'CHANGED') setConflict(true);
      else setError(err.message);
    }
  };

  // ⌘S saves, wherever focus is in the window.
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!matches(event, 'memory.save')) return;
      event.preventDefault();
      void saveRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (editing) bodyRef.current?.focus();
  }, [editing]);

  const tokens = useMemo(() => bodyTokens(draft?.body ?? ''), [draft?.body]);
  /** Text with the highlighted words marked (`npm run x` is found by its script's name as written). */
  const marked = (text: string) => {
    const words = highlight.map((h) => h.replace(/^(npm run|make) /, '')).filter(Boolean);
    if (!words.length) return text;
    const pattern = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g');
    return text.split(pattern).map((part, i) =>
      words.includes(part) ? (
        <mark key={i} className="rounded-sm bg-accent/35 px-px text-text" data-memory-highlight>
          {part}
        </mark>
      ) : (
        part
      ),
    );
  };
  // Links as the engine resolved them (same folder, then personal); names when that isn't known yet.
  const resolved = (name: string) => {
    const link = linkInfo?.links.find((l) => l.name === name);
    return link ? link.target !== null : names.has(name);
  };
  const backlinks = linkInfo?.backlinks ?? [];
  const unwritten = useMemo(() => [...new Set(tokens.flatMap((t) => ('link' in t && !resolved(t.link) ? [t.link] : [])))], [tokens, linkInfo, names]);
  // `[[` while editing: the memory names that match what follows it.
  const [caret, setCaret] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState(0);
  const query = editing && caret !== null && draft ? linkQuery(draft.body, caret) : null;
  const suggestions = query === null ? [] : linkSuggestions(names, query);
  const complete = (name: string) => {
    if (!draft || caret === null) return;
    const next = completeLink(draft.body, caret, name);
    setDraft({ ...draft, body: next.text });
    setCaret(null);
    requestAnimationFrame(() => bodyRef.current?.setSelectionRange(next.caret, next.caret));
  };
  if (file.error) return <Notice tone="error" className="m-4">{`Couldn't read this memory: ${file.error}`}</Notice>;
  if (!draft) return <p className="p-4 text-ui text-muted">Reading…</p>;
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-memory-editor={memory.path}>
      <div className="flex min-w-0 items-start gap-3 border-b border-border px-4 py-3">
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h3 className="flex min-w-0 items-center gap-2 text-title font-semibold">
            <span className="truncate" data-memory-name>
              {memory.name}
            </span>
            <Pill tone={typeTone(draft.type)}>{draft.type}</Pill>
          </h3>
          <p className="flex min-w-0 items-center gap-1 text-meta text-muted">
            {sessionTitle && memory.originSessionId && (
              <>
                <span className="shrink-0">Written in</span>
                <button type="button" onClick={() => useSessions.getState().select(memory.originSessionId!)} className="min-w-0 truncate text-link hover:underline" data-memory-origin>
                  {sessionTitle}
                </button>
                <span className="shrink-0 text-faint">·</span>
              </>
            )}
            <span className="shrink-0">modified {agoText(modified ?? memory.modified)}</span>
          </p>
        </div>
        {onShare && (
          <Button icon={<Share2 size={13} aria-hidden />} onClick={onShare} data-memory-share>
            Share with the team…
          </Button>
        )}
        <Button
          variant="quiet"
          iconOnly
          icon={<MoreHorizontal size={14} aria-hidden />}
          aria-label="More"
          aria-haspopup="menu"
          onClick={(e) => setMenu(contextMenuPoint(null, e.currentTarget.getBoundingClientRect(), window.innerHeight))}
          data-memory-more
        />
      </div>

      <div className="grid min-h-0 flex-1 content-start gap-3 overflow-y-auto p-4">
        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
          <label htmlFor={`${id}-description`} className="text-ui text-muted">
            Description
          </label>
          <input ref={descriptionRef} id={`${id}-description`} value={draft.description} onChange={(e) => set({ description: e.target.value.replace(/[\r\n]+/g, ' ') })} className={field} data-memory-description />
          <span className="text-ui text-muted">Type</span>
          <SegmentedControl
            mode="radio"
            label="Type"
            value={draft.type}
            onChange={(type) => set({ type })}
            className="justify-self-start"
            segments={[...TYPE_CHOICES, ...(TYPE_CHOICES.includes(draft.type as (typeof TYPE_CHOICES)[number]) ? [] : [draft.type])].map((t) => ({ value: t, label: t, data: { 'data-memory-type': t } }))}
          />
        </div>
        {editing ? (
          <div className="grid gap-1">
            <textarea
              ref={bodyRef}
              aria-label="Memory text"
              value={draft.body}
              role="combobox"
              aria-expanded={suggestions.length > 0}
              aria-controls={`${id}-links`}
              aria-autocomplete="list"
              aria-activedescendant={suggestions.length ? `${id}-link-${suggestion}` : undefined}
              onChange={(e) => {
                set({ body: e.target.value });
                setCaret(e.target.selectionStart);
                setSuggestion(0);
              }}
              onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
              onKeyDown={(e) => {
                if (!suggestions.length) return;
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  setSuggestion((i) => (i + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
                } else if (e.key === 'Enter' || e.key === 'Tab') {
                  e.preventDefault();
                  complete(suggestions[suggestion]!);
                } else if (e.key === 'Escape') {
                  // Closes the list, not the editor or a dialog behind it.
                  e.preventDefault();
                  setCaret(null);
                }
              }}
              spellCheck={false}
              className="min-h-64 w-full resize-y rounded-lg border border-edge bg-code p-4 font-mono text-ui text-text outline-none focus:border-accent-ink"
              data-memory-body
            />
            {suggestions.length > 0 && (
              <div id={`${id}-links`} role="listbox" aria-label="Memories to link to" className="flex flex-wrap gap-1 rounded-lg border overlay p-1" data-memory-link-suggestions>
                {suggestions.map((name, i) => (
                  <button
                    key={name}
                    id={`${id}-link-${i}`}
                    type="button"
                    role="option"
                    aria-selected={i === suggestion}
                    onMouseDown={(e) => (e.preventDefault(), complete(name))}
                    className={`rounded-md px-2 py-0.5 font-mono text-ui ${i === suggestion ? 'bg-selected text-text' : 'text-muted hover:bg-border/45'}`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="group relative">
            <pre className="min-h-32 overflow-x-auto rounded-lg border border-border bg-code p-4 font-mono text-ui break-words whitespace-pre-wrap select-text" data-memory-content onDoubleClick={() => setEditing(true)}>
              {tokens.map((token, i) =>
                'link' in token ? (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onOpenLink(token.link)}
                    className={`underline decoration-dotted underline-offset-2 hover:decoration-solid ${resolved(token.link) ? 'text-link' : 'text-caution'}`}
                    data-tooltip={resolved(token.link) ? `Open ${token.link}` : `${token.link} isn't written yet: write it`}
                    data-memory-link={token.link}
                  >
                    {token.raw}
                  </button>
                ) : (
                  <span key={i}>{marked(token.text)}</span>
                ),
              )}
              {draft.body === '' && <span className="text-faint">No text yet.</span>}
            </pre>
            <Button size="sm" icon={<Pencil size={12} aria-hidden />} onClick={() => setEditing(true)} className="absolute top-2 right-2" data-memory-edit>
              Edit
            </Button>
          </div>
        )}
        {(backlinks.length > 0 || unwritten.length > 0) && (
          <div className="grid grid-cols-2 gap-4 @max-[640px]:grid-cols-1">
            {backlinks.length > 0 && (
              <section className="grid content-start gap-1" data-memory-backlinks>
                <SectionHeader>Linked from</SectionHeader>
                {backlinks.map((path) => (
                  <button key={path} type="button" onClick={() => onOpenPath?.(path)} className="justify-self-start text-ui text-link hover:underline" data-memory-backlink={path}>
                    {labelOf?.(path) ?? path.split('/').pop()!.replace(/\.md$/, '')}
                  </button>
                ))}
              </section>
            )}
            {unwritten.length > 0 && (
              <section className="grid content-start gap-1" data-memory-links>
                <SectionHeader>Not written yet</SectionHeader>
                {unwritten.map((name) => (
                  <span key={name} className="flex items-center gap-1.5 text-ui">
                    <span className="text-caution">{name}</span>
                    <span className="text-faint">·</span>
                    <Button size="sm" variant="quiet" onClick={() => onOpenLink(name)} data-memory-write-link={name}>
                      Write it…
                    </Button>
                  </span>
                ))}
              </section>
            )}
          </div>
        )}
        {error && (
          <Notice tone="error" onDismiss={() => setError(null)}>
            {`Couldn't save: ${error}`}
          </Notice>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-2 text-meta">
        <span className={dirty ? 'text-text' : 'text-muted'} role="status" data-memory-save-state={dirty ? 'unsaved' : 'saved'}>
          {dirty ? 'Unsaved changes' : 'Saved'}
        </span>
        <Kbd shortcut="memory.save" />
        {dirty && (
          <Button size="sm" variant="primary" onClick={() => void save()} data-memory-save>
            Save
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="quiet" icon={<FolderSearch size={12} aria-hidden />} onClick={onReveal}>
          Reveal in Finder
        </Button>
        {footerActions}
        <Button size="sm" variant="danger" icon={<Trash2 size={12} aria-hidden />} onClick={onDelete} data-memory-delete>
          Delete…
        </Button>
      </div>

      {menu && <Menu x={menu.x} y={menu.y} above={menu.above} entries={[{ label: 'Rename…', onSelect: onRename, data: { 'data-memory-rename': true } }, ...menuEntries]} label="Memory" onClose={() => setMenu(null)} />}
      {conflict && (
        <ConfirmDialog
          title={`${memory.name} changed on disk`}
          body="Claude (or another app) saved this memory after you opened it. Saving replaces that version with yours."
          confirmLabel="Save mine"
          danger
          onConfirm={() => save(true)}
          onClose={() => setConflict(false)}
        />
      )}
    </div>
  );
}

const sameDraft = (a: Draft, b: Draft) => a.description.trim() === b.description.trim() && a.type === b.type && a.body.trimEnd() === b.body.trimEnd();
