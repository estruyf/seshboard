import type { KeyboardEvent, ReactNode } from 'react';
import { CountBadge } from '../ui/Pill.tsx';
import type { RightTab } from './askWidth.ts';

const TABS: Array<{ id: RightTab; label: string }> = [
  { id: 'changes', label: 'Changes' },
  { id: 'ask', label: 'Ask' },
];

/**
 * The top of the right side while Changes and Ask are both open: a tab for each, with its count (changed files, the
 * questions in the thread on screen), and the front panel's buttons on the right. ← → move between the tabs.
 */
export function RightPanelTabs({ tab, onTab, counts, children }: { tab: RightTab; onTab(tab: RightTab): void; counts: Record<RightTab, number>; children?: ReactNode }) {
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next: RightTab = tab === 'changes' ? 'ask' : 'changes';
    onTab(next);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-right-tab="${next}"][aria-selected="true"]`)?.focus());
  };
  return (
    <div className="flex h-10 shrink-0 items-end gap-2 border-b border-border pr-3 pl-1.5" data-right-tabs>
      <div role="tablist" aria-label="Right panel" className="-mb-px flex min-w-0 gap-1" onKeyDown={onKey}>
        {TABS.map(({ id, label }) => {
          const active = id === tab;
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
            >
              {label}
              <CountBadge count={counts[id]} />
            </button>
          );
        })}
      </div>
      <div className="mb-1.5 ml-auto flex shrink-0 items-center">{children}</div>
    </div>
  );
}
