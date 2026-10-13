import { Search, type LucideIcon } from 'lucide-react';
import type { KeyboardEvent, RefObject } from 'react';
import type { SettingsSection } from '../../state/sessionsStore.ts';
import { Kbd } from '../ui/Kbd.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import type { SettingEntry, SettingMatch, Span } from './searchSettings.ts';

export const resultId = (listId: string, index: number) => `${listId}-${index}`;

/** The query's words in a label or the line under it, drawn in the accent. */
function Marked({ text, spans }: { text: string; spans: Span[] }) {
  const parts: Array<string | { mark: string }> = [];
  let at = 0;
  for (const [start, end] of spans) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push({ mark: text.slice(start, end) });
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return (
    <>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          part
        ) : (
          <span key={i} className="font-medium text-accent-ink">
            {part.mark}
          </span>
        ),
      )}
    </>
  );
}

/** The search field at the top of Settings' list: a combobox, so ↑ ↓ move through the results while you type. */
export function SettingsSearchField({
  query,
  onQuery,
  onKeyDown,
  inputRef,
  listId,
  activeIndex,
  count,
}: {
  query: string;
  onQuery(query: string): void;
  onKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
  inputRef: RefObject<HTMLInputElement | null>;
  listId: string;
  activeIndex: number;
  count: number;
}) {
  const open = query.trim() !== '' && count > 0;
  return (
    <label className="mx-0.5 mb-2 flex h-7 shrink-0 items-center gap-2 rounded-md border border-edge bg-bg px-2.5 text-faint focus-within:border-accent-ink/60">
      <Search size={13} className="shrink-0" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        aria-label="Search settings"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open ? resultId(listId, activeIndex) : undefined}
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search settings"
        spellCheck={false}
        className="h-full min-w-0 flex-1 bg-transparent text-ui text-text outline-none placeholder:text-muted"
        data-settings-search
      />
      {!query && <Kbd shortcut="settings.search" tone="plain" aria-hidden />}
    </label>
  );
}

/** What the search found, grouped by page. Choosing one opens its page at the setting. */
export function SettingsSearchResults({
  query,
  groups,
  pages,
  listId,
  activeIndex,
  onHover,
  onChoose,
}: {
  query: string;
  groups: Array<{ page: SettingsSection; matches: SettingMatch[] }>;
  pages: ReadonlyArray<{ id: SettingsSection; label: string; icon: LucideIcon }>;
  listId: string;
  activeIndex: number;
  onHover(index: number): void;
  onChoose(entry: SettingEntry): void;
}) {
  const count = groups.reduce((sum, group) => sum + group.matches.length, 0);
  let index = -1;
  return (
    <div className="py-6" data-settings-results>
      <p className="sr-only" aria-live="polite">
        {count === 0 ? 'No settings found' : count === 1 ? '1 setting' : `${count} settings`}
      </p>
      {count === 0 ? (
        <p className="py-10 text-center text-ui text-muted" data-settings-search-empty>
          No settings match “{query.trim()}”.
        </p>
      ) : (
        <div id={listId} role="listbox" aria-label="Settings found" className="grid gap-4">
          {groups.map(({ page, matches }) => {
            const info = pages.find((p) => p.id === page);
            const Icon = info?.icon;
            return (
              <div key={page} role="group" aria-label={info?.label ?? page} className="grid gap-0.5" data-settings-results-page={page}>
                <SectionHeader aria-hidden count={matches.length} className="px-3 pb-1">
                  {Icon && <Icon size={12} aria-hidden />}
                  {info?.label ?? page}
                </SectionHeader>
                {matches.map((match) => {
                  index += 1;
                  const i = index;
                  const active = i === activeIndex;
                  return (
                    <div
                      key={match.entry.id}
                      id={resultId(listId, i)}
                      role="option"
                      aria-selected={active}
                      onMouseMove={() => onHover(i)}
                      onClick={() => onChoose(match.entry)}
                      className={`relative cursor-default rounded-md px-3 py-2 ${active ? 'bg-selected' : ''}`}
                      data-setting-result={match.entry.id}
                    >
                      {active && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent-ink" />}
                      <span className="block text-ui text-text">
                        <Marked text={match.entry.label} spans={match.label} />
                      </span>
                      {match.entry.detail && (
                        <span className="mt-0.5 line-clamp-2 block text-meta text-muted">
                          <Marked text={match.entry.detail} spans={match.detail} />
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Brings a setting into view on its page, once the page shows it: scrolls it to the middle, puts the keyboard
 * on it and flashes its row. Pages that load first (Memory, Profiles) get a moment; after that a setting that
 * isn't on screen (the Focus limit's options while it's off) goes to its `fallback`.
 */
export function jumpToSetting(entry: SettingEntry): void {
  const started = performance.now();
  const tick = () => {
    const page = document.querySelector<HTMLElement>(`[data-settings-page="${entry.page}"]`);
    const waited = performance.now() - started;
    const found = page?.querySelector<HTMLElement>(entry.target) ?? (waited > 500 && entry.fallback ? page?.querySelector<HTMLElement>(entry.fallback) : null);
    if (!found) {
      if (waited < 2_000) requestAnimationFrame(tick);
      return;
    }
    // The row: a labelled control with its text, a set of options, or the section it heads.
    const row = found.closest<HTMLElement>('[data-setting-row]') ?? found.closest<HTMLElement>('[role=radiogroup]') ?? found.closest<HTMLElement>('section') ?? found;
    row.scrollIntoView({ block: 'center' });
    // The chosen option of a set; otherwise the control itself, or the first one in the row.
    const focus = row.querySelector<HTMLElement>('[role=radio][aria-checked="true"]') ?? (found.matches(FOCUSABLE) ? found : (found.querySelector<HTMLElement>(FOCUSABLE) ?? row.querySelector<HTMLElement>(FOCUSABLE)));
    focus?.focus({ preventScroll: true });
    row.classList.remove('setting-flash');
    void row.offsetWidth; // restart the animation when the same row is chosen twice
    row.classList.add('setting-flash');
    row.dataset.settingFlash = entry.id;
    setTimeout(() => {
      row.classList.remove('setting-flash');
      if (row.dataset.settingFlash === entry.id) delete row.dataset.settingFlash;
    }, 2_600);
  };
  requestAnimationFrame(tick);
}
