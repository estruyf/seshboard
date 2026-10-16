import { Puzzle } from 'lucide-react';
import type { KeyboardEvent, ReactNode } from 'react';
import { CountBadge } from '../ui/Pill.tsx';
import { paneOfTab, type PanelTab, type RightTab } from './askWidth.ts';

const LABELS: Record<PanelTab, string> = { changes: 'Changes', ask: 'Ask', agents: 'Agents', terminal: 'Terminal' };

/**
 * The top of the right side while two or more panels are open (Changes, Ask, Agents, a terminal docked right): a tab for
 * each, with its count (changed files, the questions in the thread on screen, agents or terminals running), and the
 * front panel's buttons on the right.
 * ← → move between the tabs.
 */
export function RightPanelTabs({
  tab,
  open,
  onTab,
  counts,
  titles = {},
  children,
}: {
  tab: RightTab;
  /** The open panels, in tab order. */
  open: readonly RightTab[];
  onTab(tab: RightTab): void;
  counts: Partial<Record<RightTab, number>>;
  /** A mod's pane's tab label (its title), by pane id. */
  titles?: Readonly<Record<string, string>>;
  children?: ReactNode;
}) {
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const at = open.indexOf(tab);
    const next = open[(at + (event.key === 'ArrowRight' ? 1 : open.length - 1)) % open.length]!;
    onTab(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-right-tab="${next}"][aria-selected="true"]`)?.focus());
  };
  return (
    <div className="flex h-10 shrink-0 items-end gap-2 border-b border-border pr-3 pl-1.5" data-right-tabs>
      <div role="tablist" aria-label="Right panel" className="-mb-px flex min-w-0 gap-1" onKeyDown={onKey}>
        {open.map((id) => {
          const active = id === tab;
          const pane = paneOfTab(id);
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onTab(id)}
              className={`flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-3 text-ui ${active ? 'border-accent-ink font-semibold text-text' : 'border-transparent text-muted hover:text-text'}`}
              data-right-tab={id}
              data-mod-pane-tab={pane ?? undefined}
            >
              {pane !== null && <Puzzle size={12} className="shrink-0" aria-hidden />}
              {pane !== null ? (titles[pane] ?? pane) : LABELS[id as PanelTab]}
              <CountBadge count={counts[id] ?? 0} />
            </button>
          );
        })}
      </div>
      <div className="mb-1.5 ml-auto flex shrink-0 items-center">{children}</div>
    </div>
  );
}
