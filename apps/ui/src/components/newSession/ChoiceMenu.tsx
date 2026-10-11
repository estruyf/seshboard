import { localizeKeys } from '../../lib/shortcuts.ts';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
  /** Theme class for a status dot before the label (`bg-ok`). */
  dot?: string;
  /** A short muted note after the label (`current`, `↓3`). */
  note?: string;
  /** Shown but not choosable (its description says why). */
  disabled?: boolean;
}

/** A plain command under the choices, after a divider ("Save as project default"). */
export interface ChoiceAction {
  label: string;
  hint?: string;
  disabled?: boolean;
  /** `data-*` attributes for the item's button (test hooks). */
  data?: Record<`data-${string}`, string | boolean>;
  onSelect(): void;
}

/** The pill that opens a ChoiceMenu: a quiet 28px button. Exported so a hidden copy can measure a row of them (the message box's chips). */
export const CHOICE_PILL = 'flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 text-ui whitespace-nowrap text-muted hover:bg-border/50 hover:text-text disabled:opacity-50';

/** The items keyboard navigation moves between: the choices and the enabled actions. */
const ITEMS = '[role=menuitemradio]:not(:disabled),[role=menuitem]:not(:disabled)';

/**
 * A pill that opens a small menu of choices under (or above) it. The checked choice (or the search
 * field) gets focus on open, arrow keys move between choices, and Escape, Tab or a click outside closes it.
 */
export function ChoiceMenu<T extends string>({
  name,
  value,
  choices,
  onChange,
  title,
  label,
  disabled,
  width = 240,
  heading,
  placement = 'auto',
  align = 'left',
  chevron = false,
  search,
  mono = false,
  extra,
  actions,
  children,
}: {
  /** `data-menu` on the panel, and `data-<name>-select` on the pill, for the smoke test. */
  name: string;
  value: T;
  choices: Array<Choice<T>>;
  onChange(value: T): void;
  title?: string;
  /** The pill's accessible name, in place of "<heading>: <choice>" (a chip that shows only an icon or a short name). */
  label?: string;
  disabled?: boolean;
  width?: number;
  /** A small uppercase title over the choices; also names the menu, and the pill as "<heading>: <choice>". */
  heading?: string;
  /** `up` always opens above the pill; `auto` opens above only when there is no room below. */
  placement?: 'auto' | 'up';
  /** `right` lines the menu up with the pill's right edge (a pill at the end of a bar). */
  align?: 'left' | 'right';
  /** A small chevron after the pill's content, to read as a dropdown. */
  chevron?: boolean;
  /** Placeholder of a search field over the choices, which filters them by label. */
  search?: string;
  /** Choice labels in the monospace font (branch names). */
  mono?: boolean;
  /** Shown under the choices, such as a field that belongs to the checked one. */
  extra?: ReactNode;
  /** Commands after a divider at the end of the menu. */
  actions?: ChoiceAction[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  /** Where the panel sits: fixed to the window, from the pill's edges, so a dialog or scroll box around the pill can't clip it. */
  const [anchor, setAnchor] = useState<{ left: number; right: number; top: number; bottom: number; upward: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = choices.find((c) => c.value === value);
  // The pill shows an icon, a dot or a shortened label; its accessible name says what it sets and to what.
  const pillName = label ?? (heading ? `${heading}: ${current?.label ?? value}` : undefined);
  const needle = query.trim().toLowerCase();
  const listed = needle ? choices.filter((c) => c.label.toLowerCase().includes(needle)) : choices;

  useEffect(() => {
    if (!open) return;
    const filter = panel.current?.querySelector<HTMLInputElement>('[data-choice-search]');
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>('[role=menuitemradio]') ?? [])];
    (filter ?? items.find((b) => b.getAttribute('aria-checked') === 'true') ?? items[0])?.focus();
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onBlur = () => setOpen(false);
    // The panel is placed once, from the pill: when what's around it scrolls, the menu would be left behind.
    const onScroll = (e: Event) => !panel.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('blur', onBlur);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // Keys that confirm an IME composition (Enter picking a candidate) belong to the input method.
    if (e.nativeEvent.isComposing) return;
    const items = [...(panel.current?.querySelectorAll<HTMLButtonElement>(ITEMS) ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const inField = (e.target as HTMLElement).tagName === 'INPUT';
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (e.key === 'Escape') (e.preventDefault(), e.stopPropagation(), close(true));
    else if (e.key === 'Tab') close(false);
    else if (e.key === 'ArrowDown') (e.preventDefault(), focus(index + 1));
    else if (e.key === 'ArrowUp') (e.preventDefault(), focus(index < 0 ? items.length - 1 : index - 1));
    // In a text field, Home and End move the caret; Enter in the search field picks the first match.
    else if (e.key === 'Home' && !inField) (e.preventDefault(), focus(0));
    else if (e.key === 'End' && !inField) (e.preventDefault(), focus(items.length - 1));
    else if (e.key === 'Enter' && inField && (e.target as HTMLElement).hasAttribute('data-choice-search') && items[0]) (e.preventDefault(), items[0].click());
  };

  return (
    <div ref={ref} className="relative min-w-0" onKeyDown={open ? onKeyDown : undefined}>
      <button
        ref={trigger}
        type="button"
        data-tooltip={title}
        aria-label={pillName}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        data-value={value}
        {...{ [`data-${name}-select`]: '' }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          // Opens upward when the pill sits near the bottom of the window.
          setAnchor({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, upward: placement === 'up' || window.innerHeight - rect.bottom < 300 });
          setOpen((o) => !o);
        }}
        className={`${CHOICE_PILL} ${open ? 'bg-border/50 text-text' : ''}`}
      >
        {children}
        {chevron && <ChevronDown size={12} className="shrink-0 text-faint" aria-hidden />}
      </button>
      {open && anchor && (
        <div
          ref={panel}
          role="menu"
          aria-label={heading}
          data-menu={name}
          style={{
            width,
            left: Math.max(8, Math.min(align === 'right' ? anchor.right - width : anchor.left, window.innerWidth - width - 8)),
            ...(anchor.upward ? { bottom: window.innerHeight - anchor.top + 6 } : { top: anchor.bottom + 6 }),
          }}
          className="fixed z-40 max-h-80 overflow-y-auto rounded-lg border overlay py-1"
        >
          {heading && (
            <p role="presentation" className="px-3 pt-1.5 pb-1 text-meta tracking-wide text-faint uppercase">
              {heading}
            </p>
          )}
          {search && (
            <input
              data-choice-search
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={search}
              spellCheck={false}
              aria-label={search}
              className={`mx-2 mb-1 w-[calc(100%-1rem)] rounded-md border border-border bg-bg px-2 py-1 text-ui text-text outline-none placeholder:text-faint focus:border-accent-ink ${mono ? 'font-mono' : ''}`}
            />
          )}
          {listed.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="menuitemradio"
              aria-checked={choice.value === value}
              data-choice={choice.value}
              disabled={choice.disabled}
              onClick={() => {
                onChange(choice.value);
                close(true);
              }}
              className="flex w-full items-start gap-2 px-3 py-1.5 text-left outline-none hover:bg-accent/15 focus-visible:bg-accent/15 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {choice.dot && <span aria-hidden className={`mt-[5px] size-2 shrink-0 rounded-full ${choice.dot}`} />}
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className={`min-w-0 truncate text-text ${mono ? 'font-mono text-ui' : 'text-ui'}`}>{choice.label}</span>
                  {choice.note && <span className="shrink-0 text-meta text-faint tabular-nums">{choice.note}</span>}
                </span>
                {choice.description && <span className="block truncate text-meta text-muted">{choice.description}</span>}
              </span>
              <Check size={13} aria-hidden className={`mt-[3px] shrink-0 text-accent-ink ${choice.value === value ? '' : 'invisible'}`} />
            </button>
          ))}
          {search && listed.length === 0 && <p className="px-3 py-1.5 text-ui text-muted">No matches</p>}
          {extra}
          {actions && actions.length > 0 && (
            <>
              <div role="separator" className="my-1 border-t border-border" />
              {actions.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  role="menuitem"
                  disabled={action.disabled}
                  {...action.data}
                  onClick={() => {
                    close(true);
                    action.onSelect();
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ui text-text outline-none hover:bg-accent/15 focus-visible:bg-accent/15 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span className="min-w-0 flex-1 truncate">{action.label}</span>
                  {action.hint && <span className="shrink-0 text-meta text-faint">{localizeKeys(action.hint)}</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
