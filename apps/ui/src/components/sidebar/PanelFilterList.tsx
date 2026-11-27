import { Layers } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';

/** One project to filter by: its key (the folder, or a remote key), name, icon and what it holds. */
export interface PanelFilterRow {
  key: string;
  name: string;
  icon: ReactNode;
  /** A short count on the right ("2 · 1", "1h 20m"). */
  meta?: string;
  /** The same in words, for the tooltip and screen readers. */
  metaLabel?: string;
}

/**
 * A view's project filter in the panel beside the nav rail (Upcoming, Activity): All projects, then each project with what
 * it holds. A click picks one, a click on the picked one (or All projects) shows them all. ↑ ↓ move between the rows.
 */
export function PanelFilterList({ title, rows, selected, onPick, empty, note, hook }: { title: string; rows: readonly PanelFilterRow[]; selected: string | null; onPick(key: string | null): void; empty?: string; note?: string; hook: string }) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const all = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-panel-filter]')];
    const at = all.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
  };
  const row = (key: string | null, name: string, icon: ReactNode, meta?: string, metaLabel?: string) => {
    const current = selected === key;
    return (
      <button
        key={key ?? 'all'}
        type="button"
        onClick={() => onPick(current && key !== null ? null : key)}
        aria-current={current ? 'true' : undefined}
        aria-label={metaLabel ? `${name}, ${metaLabel}` : name}
        data-tooltip={metaLabel}
        data-panel-filter={key ?? 'all'}
        className={`flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-ui ${current ? 'bg-selected text-text' : 'text-muted hover:bg-border/45 hover:text-text'}`}
      >
        <span className="flex size-4 shrink-0 items-center justify-center">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {meta && <span className="shrink-0 text-meta text-faint tabular-nums">{meta}</span>}
      </button>
    );
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-panel-filters={hook}>
      <div className="flex h-10 shrink-0 items-center px-2">
        <h2 className="min-w-0 flex-1 truncate pl-1.5 text-ui font-semibold text-text">{title}</h2>
      </div>
      <div role="group" aria-label={`${title}: filter by project`} onKeyDown={onKeyDown} className="grid min-h-0 flex-1 content-start gap-0.5 overflow-y-auto px-2 pb-2">
        {row(null, 'All projects', <Layers size={14} aria-hidden />)}
        {rows.length === 0 ? <p className="px-2.5 py-1.5 text-ui text-muted">{empty ?? 'No projects here yet.'}</p> : rows.map((r) => row(r.key, r.name, r.icon, r.meta, r.metaLabel))}
        {note && rows.length > 0 && <p className="px-2.5 pt-1.5 text-meta text-faint">{note}</p>}
      </div>
    </div>
  );
}
