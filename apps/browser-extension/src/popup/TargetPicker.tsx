import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { filterTargets, targetSummary, type TargetOption } from '../lib/payload.ts';

/**
 * Where to send: a button with the choice, which opens a search field over the list of sessions and projects. Type to
 * filter, ↑ and ↓ to move, ↩ to pick, Esc to close without changing it.
 */
export function TargetPicker({ options, value, onChange }: { options: readonly TargetOption[]; value: string | null; onChange(value: string): void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  const chosen = options.find((o) => o.value === value) ?? null;
  const shown = useMemo(() => filterTargets(options, query), [options, query]);

  // Opening starts on the current choice; typing starts on the first match.
  useEffect(() => {
    if (!open) return;
    setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
    search.current?.focus();
    // Only when it opens: the list changes as you type.
  }, [open]);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    if (open) list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const close = () => {
    setOpen(false);
    setQuery('');
    button.current?.focus();
  };
  const pick = (option: TargetOption | undefined) => {
    if (!option) return;
    onChange(option.value);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') setActive((i) => Math.min(shown.length - 1, i + 1));
    else if (event.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1));
    else if (event.key === 'Enter') pick(shown[active]);
    else if (event.key === 'Escape') close();
    else return;
    // Esc would close the whole popup.
    event.preventDefault();
    event.stopPropagation();
  };

  if (!open) {
    return (
      <button
        ref={button}
        type="button"
        className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 text-left hover:border-faint disabled:opacity-50"
        disabled={options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={false}
        onClick={() => setOpen(true)}
        data-target-picker
      >
        <span className="min-w-0 flex-1 truncate">{chosen ? targetSummary(chosen) : options.length === 0 ? 'Loading…' : 'Pick where to send'}</span>
        {chosen?.tag && <Tag text={chosen.tag} />}
        <span aria-hidden className="text-muted">
          ▾
        </span>
      </button>
    );
  }

  const groups = (['sessions', 'new'] as const).map((group) => ({ group, items: shown.filter((o) => o.group === group) })).filter((g) => g.items.length > 0);

  return (
    <div className="grid gap-1 rounded-md border border-border bg-card p-1" onKeyDown={onKeyDown} data-target-picker-open>
      <input
        ref={search}
        type="search"
        className="h-7 w-full rounded border border-border bg-bg px-2 text-ui text-text placeholder:text-faint focus:outline-none focus-visible:border-accent-ink"
        placeholder="Search sessions and projects"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={shown[active] ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        data-target-search
      />
      <ul ref={list} id={listId} role="listbox" aria-label="Where to send" className="max-h-60 overflow-y-auto">
        {shown.length === 0 && <li className="px-2 py-3 text-center text-muted">Nothing matches.</li>}
        {groups.map(({ group, items }) => (
          <li key={group} role="presentation">
            <div className="px-2 pt-2 pb-1 text-meta text-faint">{group === 'sessions' ? 'Sessions' : 'New session'}</div>
            <ul role="presentation">
              {items.map((option) => {
                const index = shown.indexOf(option);
                const selected = option.value === value;
                return (
                  <li
                    key={option.value}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={selected}
                    data-index={index}
                    data-target-option={option.value}
                    className={`flex cursor-default items-center gap-2 rounded px-2 py-1.5 ${index === active ? 'bg-text/10' : ''}`}
                    onMouseMove={() => setActive(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pick(option)}
                  >
                    <span className="grid min-w-0 flex-1">
                      <span className="truncate">{option.label}</span>
                      {option.detail && <span className="truncate text-meta text-muted">{option.detail}</span>}
                    </span>
                    {option.tag && <Tag text={option.tag} />}
                    <span aria-hidden className={`w-3 shrink-0 text-accent-ink ${selected ? '' : 'invisible'}`}>
                      ✓
                    </span>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tag({ text }: { text: string }) {
  const tone = text === 'Needs you' ? 'text-warn' : 'text-accent-ink';
  return <span className={`shrink-0 rounded-full bg-text/8 px-1.5 text-meta ${tone}`}>{text}</span>;
}
