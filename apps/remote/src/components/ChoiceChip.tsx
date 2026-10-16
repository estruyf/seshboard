import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useWide } from '../lib/media.ts';
import { Sheet } from './Sheet.tsx';

export interface ChoiceOption<T> {
  value: T;
  label: string;
  description?: string | undefined;
  dot?: string | undefined;
  /** In front of the label instead of a dot (Auto's wand). */
  icon?: ReactNode;
  /** A line under it: Auto stands apart from the models. */
  separatorAfter?: boolean;
}

/**
 * A quiet chip that shows a value (the model, an effort with its gauge) and opens a small list to pick another: the list is a
 * listbox, arrow keys move, Enter picks, Escape and a tap outside close it. The mouse moves the same highlight as the
 * arrow keys (focus), so there is one row lit at a time; the chosen one has a check. On a phone the list is a bottom
 * sheet instead, with rows big enough to tap, because a chip near the right edge has no room for a list beside it.
 */
export function ChoiceChip<T>({
  label,
  face,
  selected,
  options,
  onPick,
  icon,
  disabled,
  placement = 'below',
  hook,
  spoken,
}: {
  /** The full meaning, for screen readers and the list ("Effort"). */
  label: string;
  /** What the chip shows: only the value ("Medium"); `label` says what it is. */
  face: ReactNode;
  selected: T;
  options: ChoiceOption<T>[];
  onPick: (value: T) => void;
  icon?: ReactNode;
  disabled?: boolean;
  placement?: 'below' | 'above';
  hook?: string;
  /** What a screen reader hears for the chip, when the face says more than the chosen option ("Model: Auto picked Sonnet"). */
  spoken?: string;
}) {
  const [open, setOpen] = useState(false);
  /** The list opens to the left of the chip when it would run off the right edge. */
  const [alignEnd, setAlignEnd] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();
  const wide = useWide();

  useLayoutEffect(() => {
    if (!open || !wide || !button.current || !list.current) return;
    const chip = button.current.getBoundingClientRect();
    setAlignEnd(chip.left + list.current.offsetWidth > document.documentElement.clientWidth - 8);
  }, [open, wide]);

  useEffect(() => {
    if (!open || !wide) return;
    (list.current?.querySelector<HTMLElement>('[aria-selected=true]') ?? list.current?.querySelector<HTMLElement>('[role=option]'))?.focus();
    const outside = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, wide]);

  const pick = (option: ChoiceOption<T>) => {
    setOpen(false);
    button.current?.focus();
    onPick(option.value);
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-label={spoken ?? `${label}: ${options.find((o) => o.value === selected)?.label ?? ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
        className="flex min-h-9 items-center gap-1.5 rounded-full border border-edge px-2.5 text-ui text-text hover:bg-border/45 disabled:opacity-50 pointer-fine:min-h-7"
        data-remote-choice={hook}
      >
        {icon}
        {face}
        <ChevronDown className="size-3.5 text-faint" aria-hidden />
      </button>
      {open && !wide && (
        <Sheet title={label} onClose={() => setOpen(false)} hook={hook ? `choice-${hook}` : 'choice'}>
          <ul role="listbox" aria-label={label} className="-mx-1 flex flex-col pb-1">
            {options.map((option, index) => {
              const isSelected = option.value === selected;
              return [
                <li key={index} role="option" aria-selected={isSelected} onClick={() => pick(option)} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-lg px-3 py-2.5 active:bg-selected">
                  {option.icon ?? (option.dot && <span aria-hidden className={`mt-2 size-2 shrink-0 rounded-full ${option.dot}`} />)}
                  <span className="min-w-0 flex-1">
                    <span className={`block text-body ${isSelected ? 'font-medium' : ''}`}>{option.label}</span>
                    {option.description && <span className="block text-ui text-muted">{option.description}</span>}
                  </span>
                  <Check aria-hidden className={`mt-1 size-4 shrink-0 text-accent-ink ${isSelected ? '' : 'invisible'}`} />
                </li>,
                option.separatorAfter && <li key={`${index}-line`} role="presentation" aria-hidden className="mx-3 my-1 shrink-0 border-t border-border" />,
              ];
            })}
          </ul>
        </Sheet>
      )}
      {open && wide && (
        <ul
          ref={list}
          id={id}
          role="listbox"
          aria-label={label}
          onKeyDown={(event) => {
            const items = [...(list.current?.querySelectorAll<HTMLElement>('[role=option]') ?? [])];
            const at = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setOpen(false);
              button.current?.focus();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            } else if (event.key === 'Tab') setOpen(false);
          }}
          className={`overlay absolute z-40 flex max-h-72 w-64 max-w-[calc(100vw-1rem)] ${alignEnd ? 'right-0' : 'left-0'} flex-col overflow-y-auto rounded-xl p-1 ${placement === 'below' ? 'top-full mt-1' : 'bottom-full mb-1'}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === selected;
            return [
              <li
                key={index}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                onClick={() => pick(option)}
                onPointerMove={(event) => event.pointerType === 'mouse' && event.currentTarget !== document.activeElement && event.currentTarget.focus({ preventScroll: true })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    pick(option);
                  }
                }}
                className="flex min-h-11 shrink-0 cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 outline-none pointer-fine:min-h-8 pointer-fine:py-1.5 focus:bg-accent/15"
              >
                {option.icon ?? (option.dot && <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${option.dot}`} />)}
                <span className="min-w-0 flex-1">
                  <span className="block text-ui">{option.label}</span>
                  {option.description && <span className="block text-meta text-muted">{option.description}</span>}
                </span>
                <Check aria-hidden className={`mt-0.5 size-3.5 shrink-0 text-accent-ink ${isSelected ? '' : 'invisible'}`} />
              </li>,
              option.separatorAfter && <li key={`${index}-line`} role="presentation" aria-hidden className="mx-2 my-1 shrink-0 border-t border-border" />,
            ];
          })}
        </ul>
      )}
    </div>
  );
}
