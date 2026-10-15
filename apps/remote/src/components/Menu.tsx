import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Button } from './ui.tsx';

export type MenuItem =
  | { kind?: 'item'; label: string; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string | undefined }
  | { kind: 'note'; label: ReactNode }
  | { kind: 'separator' };

/**
 * The `⋯` menu (AGENTS.md, Buttons: what people use less often): a quiet icon button and a small list under it. Arrow
 * keys move, and so does the mouse (one row lit at a time); Escape and a tap outside close it, focus goes back to the
 * button.
 */
export function MenuButton({ label = 'More', items, align = 'right', side = 'below' }: { label?: string; items: MenuItem[]; align?: 'left' | 'right'; side?: 'above' | 'below' }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    list.current?.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')?.focus();
    const outside = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  return (
    <div className="relative">
      <Button ref={button} variant="quiet" size="md" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} className="px-2!" data-remote-menu>
        <MoreHorizontal className="size-5" aria-hidden />
      </Button>
      {open && (
        <div
          ref={list}
          id={id}
          role="menu"
          aria-label={label}
          onKeyDown={(event) => {
            const items = [...(list.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])];
            const at = items.indexOf(document.activeElement as HTMLElement);
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              close();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
            } else if (event.key === 'Tab') setOpen(false);
          }}
          className={`overlay absolute z-40 flex min-w-56 flex-col rounded-xl p-1 ${side === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'} ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {items.map((item, index) =>
            item.kind === 'separator' ? (
              <div key={index} role="separator" className="my-1 h-px bg-border" />
            ) : item.kind === 'note' ? (
              <div key={index} className="px-3 py-1.5 text-meta text-faint">
                {item.label}
              </div>
            ) : (
              <button
                key={index}
                type="button"
                role="menuitem"
                aria-disabled={item.disabled || undefined}
                onClick={() => {
                  if (item.disabled) return;
                  setOpen(false);
                  item.onSelect();
                }}
                onPointerMove={(event) => event.pointerType === 'mouse' && !item.disabled && event.currentTarget !== document.activeElement && event.currentTarget.focus({ preventScroll: true })}
                className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-left text-ui outline-none pointer-fine:min-h-8 focus:bg-accent/15 aria-disabled:opacity-50 ${item.danger ? 'text-error' : 'text-text'}`}
              >
                <span className="flex-1">{item.label}</span>
                {item.hint && <span className="text-meta text-faint">{item.hint}</span>}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
