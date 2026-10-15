import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface ChoiceOption<T> {
  value: T;
  label: string;
  description?: string | undefined;
  dot?: string | undefined;
}

/**
 * A quiet chip that shows a value (the model, "Effort: Medium") and opens a small list to pick another: the list is a
 * listbox, arrow keys move, Enter picks, Escape and a tap outside close it.
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
}: {
  /** The full meaning, for screen readers and the list ("Effort"). */
  label: string;
  /** What the chip shows ("Effort: Medium"). */
  face: ReactNode;
  selected: T;
  options: ChoiceOption<T>[];
  onPick: (value: T) => void;
  icon?: ReactNode;
  disabled?: boolean;
  placement?: 'below' | 'above';
  hook?: string;
}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    (list.current?.querySelector<HTMLElement>('[aria-selected=true]') ?? list.current?.querySelector<HTMLElement>('[role=option]'))?.focus();
    const outside = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

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
        aria-label={`${label}: ${options.find((o) => o.value === selected)?.label ?? ''}`}
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
      {open && (
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
          className={`overlay absolute left-0 z-40 flex max-h-72 w-64 flex-col overflow-y-auto rounded-xl p-1 ${placement === 'below' ? 'top-full mt-1' : 'bottom-full mb-1'}`}
        >
          {options.map((option, index) => {
            const isSelected = option.value === selected;
            return (
              <li
                key={index}
                role="option"
                tabIndex={-1}
                aria-selected={isSelected}
                onClick={() => pick(option)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    pick(option);
                  }
                }}
                className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 outline-none pointer-fine:min-h-8 pointer-fine:py-1.5 focus-visible:bg-border/50 hover:bg-border/45 ${isSelected ? 'bg-selected' : ''}`}
              >
                {option.dot && <span aria-hidden className={`mt-1.5 size-2 shrink-0 rounded-full ${option.dot}`} />}
                <span className="min-w-0 flex-1">
                  <span className="block text-ui">{option.label}</span>
                  {option.description && <span className="block text-meta text-muted">{option.description}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
