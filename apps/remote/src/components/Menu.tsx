import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
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
  const id = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  return (
    <div className="relative">
      <Button ref={button} variant="quiet" size="md" aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)} className="px-2!" data-remote-menu>
        <MoreHorizontal className="size-5" aria-hidden />
      </Button>
      {open && <MenuList id={id} label={label} items={items} owner={button} onClose={close} className={`absolute ${side === 'above' ? 'bottom-full mb-1' : 'top-full mt-1'} ${align === 'right' ? 'right-0' : 'left-0'}`} />}
    </div>
  );
}

/** Where a context menu opens: at the pointer, or under (or over) the row when it came from the keyboard. */
export interface MenuPoint {
  x: number;
  y: number;
  above: boolean;
}

/**
 * Where a right-click (or Shift+F10, or a long press where the browser turns it into one) opens a menu: at the
 * pointer, else at the element. In the lower half of the window it opens upwards, so it doesn't run off the bottom.
 */
export function menuPoint(event: { clientX: number; clientY: number }, element: Element): MenuPoint {
  const fromKeyboard = event.clientX === 0 && event.clientY === 0;
  if (!fromKeyboard) return { x: event.clientX, y: event.clientY, above: event.clientY > window.innerHeight / 2 };
  const rect = element.getBoundingClientRect();
  const above = rect.top > window.innerHeight / 2;
  return { x: rect.left + 12, y: above ? rect.top - 4 : rect.bottom + 4, above };
}

/** A menu at a point: a row's right-click menu. Closing it puts focus back on what it was opened from. */
export function ContextMenu({ label, items, point, owner, onClose }: { label: string; items: MenuItem[]; point: MenuPoint; owner: HTMLElement | null; onClose: () => void }) {
  const list = useRef<HTMLDivElement>(null);
  const opener = useRef(owner);
  opener.current = owner;
  const [left, setLeft] = useState(point.x);
  // Kept inside the window on the right, once its width is known.
  useLayoutEffect(() => {
    const width = list.current?.offsetWidth ?? 0;
    setLeft(Math.max(8, Math.min(point.x, window.innerWidth - width - 8)));
  }, [point.x]);
  useEffect(() => {
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);
  const style: CSSProperties = point.above ? { left, bottom: window.innerHeight - point.y } : { left, top: point.y };
  return (
    <MenuList
      ref={list}
      label={label}
      items={items}
      owner={opener}
      onClose={(refocus) => {
        onClose();
        if (refocus) owner?.focus();
      }}
      className="fixed"
      style={style}
    />
  );
}

/** The list both menus show. `owner` is what opened it: a tap on it isn't a tap outside. */
function MenuList({
  ref,
  id,
  label,
  items,
  owner,
  onClose,
  className,
  style,
}: {
  ref?: Ref<HTMLDivElement>;
  id?: string;
  label: string;
  items: MenuItem[];
  owner: { current: HTMLElement | null };
  onClose: (refocus: boolean) => void;
  className: string;
  style?: CSSProperties;
}) {
  const list = useRef<HTMLDivElement | null>(null);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;

  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[role=menuitem]:not([aria-disabled=true])')?.focus();
    const outside = (event: PointerEvent) => {
      if (!list.current?.contains(event.target as Node) && !owner.current?.contains(event.target as Node)) latestClose.current(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [owner]);

  return (
    <div
      ref={(el) => {
        list.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      id={id}
      role="menu"
      aria-label={label}
      onKeyDown={(event) => {
        const items = [...(list.current?.querySelectorAll<HTMLElement>('[role=menuitem]:not([aria-disabled=true])') ?? [])];
        const at = items.indexOf(document.activeElement as HTMLElement);
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        } else if (event.key === 'Tab') onClose(false);
      }}
      onContextMenu={(event) => event.preventDefault()}
      style={style}
      className={`overlay z-40 flex min-w-56 flex-col rounded-xl p-1 ${className}`}
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
              onClose(false);
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
  );
}
