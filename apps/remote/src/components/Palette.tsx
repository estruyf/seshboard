import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { CornerDownLeft, Plus, Search, Zap } from 'lucide-react';
import type { RemoteProject } from '@seshboard/protocol/remote-client';
import { listKey, type ListedSession } from '../lib/everywhere.ts';
import { nextIndex } from '../lib/keys.ts';
import { paletteGroups, type PaletteItem } from '../lib/palette.ts';
import type { Client } from './Connected.tsx';
import { ComputerTag, Kbd, STATUS_LABEL, StatusDot } from './ui.tsx';

export interface PaletteAction {
  id: string;
  title: string;
}

/** A project of one of the computers: `id` is its key in the palette, `projectId` its own. */
export type ListedProject = RemoteProject & { computer: string; projectId: string };

/** The palette's items, from every computer. */
export type PaletteChoice = PaletteItem<ListedSession, ListedProject>;

/** A computer the palette lists projects of: its name for the tag, and its connection. */
export interface PaletteComputer {
  id: string;
  name: string;
  client: Client;
}

/**
 * The ⌘K palette of the wide layout: a field and what matches it, in three groups. Sessions (↩ opens one), Start
 * ("New session in <project>") and Actions. ↑ and ↓ move, ↩ runs, Esc closes, and the focus goes back where it was.
 * The field is a combobox over a listbox, so a screen reader says the option you're on. Sessions and projects come
 * from every connected computer, each saying which with more than one (`labels`).
 */
export function Palette({ computers, labels = false, sessions, actions, onChoose, onClose }: { computers: readonly PaletteComputer[]; labels?: boolean; sessions: readonly ListedSession[]; actions: readonly PaletteAction[]; onChoose: (item: PaletteChoice) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<ListedProject[]>([]);
  const [active, setActive] = useState(0);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    field.current?.focus();
    return () => {
      // Back where you were, unless what you chose put the focus somewhere new (a session's message box).
      if (!document.activeElement || document.activeElement === document.body) before?.focus({ preventScroll: true });
    };
  }, []);

  // Read once, when the palette opens: each computer's projects, in the computers' order.
  useEffect(() => {
    let live = true;
    void Promise.all(
      computers.map(({ id: computer, client }) =>
        client
          ? client.call('projects.list', {}).then(
              ({ projects }) => projects.map((project): ListedProject => ({ ...project, id: listKey(computer, project.id), computer, projectId: project.id })),
              () => [],
            )
          : Promise.resolve([]),
      ),
    ).then((lists) => live && setProjects(lists.flat()));
    return () => {
      live = false;
    };
  }, []);
  const nameOf = (computer: string) => (labels ? computers.find((c) => c.id === computer)?.name || 'Your computer' : undefined);

  const groups = useMemo(() => paletteGroups({ sessions, projects, actions, query }), [sessions, projects, actions, query]);
  const items = groups.flatMap((g) => g.items);
  const current = items[Math.min(active, items.length - 1)];
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (current) list.current?.querySelector(`[data-palette-item="${CSS.escape(current.id)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const optionId = (item: PaletteChoice) => `${id}-${item.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]" data-remote-palette>
      <div aria-hidden className="scrim-in absolute inset-0 bg-black/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Search sessions and actions" className="toast-in overlay relative flex max-h-[70vh] w-[580px] max-w-full flex-col overflow-hidden rounded-2xl">
        <div className="flex items-center gap-2.5 border-b border-border px-4">
          <Search className="size-4 shrink-0 text-faint" aria-hidden />
          <input
            ref={field}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((at) => nextIndex(Math.min(at, items.length - 1), items.length, event.key === 'ArrowDown' ? 1 : -1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (current) onChoose(current);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                onClose();
              } else if (event.key === 'Tab') event.preventDefault();
            }}
            role="combobox"
            aria-expanded="true"
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={current ? optionId(current) : undefined}
            aria-label="Search sessions and actions"
            placeholder="Search sessions, projects and actions"
            spellCheck={false}
            className="min-h-12 min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-faint"
            data-remote-palette-field
          />
          <Kbd shortcut="escape" tone="cap" />
        </div>
        <div ref={list} id={`${id}-list`} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {items.length === 0 && <p className="px-3 py-6 text-center text-ui text-muted">Nothing matches.</p>}
          {groups.map((group) => (
            <div key={group.label} role="group" aria-labelledby={`${id}-${group.label}`}>
              <div id={`${id}-${group.label}`} role="presentation" className="px-2.5 pt-2 pb-1 text-meta font-semibold tracking-wide text-faint uppercase">
                {group.label}
              </div>
              {group.items.map((item) => {
                const isActive = item === current;
                return (
                  <div
                    key={item.id}
                    id={optionId(item)}
                    role="option"
                    aria-selected={isActive}
                    onPointerMove={() => !isActive && setActive(items.indexOf(item))}
                    onClick={() => onChoose(item)}
                    className={`flex min-h-9 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1 ${isActive ? 'bg-selected' : ''}`}
                    data-palette-item={item.id}
                  >
                    <Row item={item} computer={item.kind === 'session' ? nameOf(item.session.computer) : item.kind === 'start' ? nameOf(item.project.computer) : undefined} />
                    {isActive && <CornerDownLeft className="size-3.5 shrink-0 text-faint" aria-hidden />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-meta text-faint" aria-hidden>
          <span className="flex items-center gap-1">
            <Kbd shortcut="up" tone="cap" />
            <Kbd shortcut="down" tone="cap" /> move
          </span>
          <span className="flex items-center gap-1">
            <Kbd shortcut="enter" tone="cap" /> open
          </span>
          <span className="flex items-center gap-1">
            <Kbd shortcut="escape" tone="cap" /> close
          </span>
        </div>
      </div>
    </div>
  );
}

function Row({ item, computer }: { item: PaletteChoice; computer: string | undefined }) {
  if (item.kind === 'session') {
    const s = item.session;
    return (
      <>
        <StatusDot status={s.status} />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-body ${s.unread || s.status === 'needs-you' ? 'font-semibold' : ''}`}>{s.title}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-meta text-muted">
            {computer && <ComputerTag name={computer} />}
            <span className="truncate">
              {s.projectName}
              {s.branch ? ` · ${s.branch}` : ''}
            </span>
          </span>
        </span>
        <span className={`shrink-0 text-meta ${s.status === 'needs-you' ? 'text-warn' : s.status === 'working' ? 'text-accent-ink' : 'text-faint'}`}>{STATUS_LABEL[s.status]}</span>
      </>
    );
  }
  if (item.kind === 'start')
    return (
      <>
        <Plus className="size-4 shrink-0 text-faint" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-body">
          New session in <span className="font-semibold">{item.project.name}</span>
        </span>
        {computer && <ComputerTag name={computer} />}
      </>
    );
  return (
    <>
      <Zap className="size-4 shrink-0 text-faint" aria-hidden />
      <span className={`min-w-0 flex-1 truncate text-body ${item.id === 'action:forget' ? 'text-error' : ''}`}>{item.title}</span>
    </>
  );
}
