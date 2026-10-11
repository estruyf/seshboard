import { localizeKeys } from '../lib/shortcuts.ts';
import { useEffect, useId, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../lib/contextMenu.ts';
import { Popover } from './ui/Popover.tsx';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  /** `data-*` attributes for the item's button (test hooks). */
  data?: Record<`data-${string}`, string | boolean>;
  onSelect(): void;
  /** The item's own context menu (right-click, Shift+F10): this menu closes and the caller opens that one at `at`. */
  contextMenu?(at: ContextMenuPoint): void;
}
/**
 * `heading`: a small label over a group of items. `title`: the menu's subject in bold, with a line
 * about it (a branch and where it stands). `note`: a sentence under the items, such as why some are unavailable.
 */
export type MenuEntry = MenuItem | 'separator' | { heading: string } | { title: string; detail?: string } | { note: string; tone?: 'warn' };

/** The enabled items of a menu, in order. */
function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')) : [];
}

/**
 * A small popup menu at a screen position (context menus and dropdowns). Closes on outside click or Esc. `above` puts its bottom edge at y.
 * The first item takes focus, ↑ ↓ Home End move between items, and closing hands focus back to the control that opened it.
 */
export function Menu({
  x,
  y,
  entries,
  onClose,
  width = 220,
  above = false,
  label,
  anchor,
}: {
  x: number;
  y: number;
  entries: MenuEntry[];
  onClose(): void;
  width?: number;
  above?: boolean;
  label?: string;
  /** The button that opens it: a click there toggles the menu rather than closing and reopening it. */
  anchor?: RefObject<HTMLElement | null>;
}) {
  const id = useId();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const menu = document.getElementById(id);
    (above ? menuItems(menu).at(-1) : menuItems(menu)[0])?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (opener?.isConnected && opener !== document.body && (!active || active === document.body)) opener.focus({ preventScroll: true });
    };
  }, [id, above]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(event.currentTarget);
    if (items.length === 0) return;
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') {
      event.preventDefault();
      onClose();
      return;
    }
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    items[next]!.focus();
  };

  /** Hands over to an item's own context menu, at the pointer or (from the keyboard, `pointer` null) at the item. */
  const openItemMenu = (item: MenuItem, el: HTMLElement, pointer: { x: number; y: number } | null) => {
    const at = contextMenuPoint(pointer, el.getBoundingClientRect(), window.innerHeight);
    onClose();
    item.contextMenu?.(at);
  };
  // A context menu opened from the keyboard reports no pointer position.
  const pointerOf = (event: MouseEvent) => (event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : null);

  return (
    <Popover id={id} x={x} y={y} width={width} above={above} onClose={onClose} anchor={anchor} role="menu" aria-label={label} onKeyDown={onKeyDown}>
      {entries.map((entry, i) =>
        entry === 'separator' ? (
          <div key={i} role="separator" className="my-1 border-t border-border" />
        ) : 'heading' in entry ? (
          <p key={i} role="presentation" className="px-3 pt-1.5 pb-0.5 text-meta tracking-wide text-muted uppercase">
            {entry.heading}
          </p>
        ) : 'title' in entry ? (
          <div key={i} role="presentation" className="px-3 pt-1.5 pb-1" data-menu-title>
            <p className="truncate text-[12.5px] font-semibold text-text">{entry.title}</p>
            {entry.detail && <p className="truncate text-[11.5px] text-muted tabular-nums">{entry.detail}</p>}
          </div>
        ) : 'note' in entry ? (
          <p
            key={i}
            role="presentation"
            className={`text-ui ${entry.tone === 'warn' ? 'mx-2 my-1 rounded-md bg-warn/10 px-2.5 py-1.5 text-warn' : 'px-3 pt-1 pb-1.5 text-muted'}`}
            data-menu-note
          >
            {entry.note}
          </p>
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            {...entry.data}
            onClick={() => {
              onClose();
              entry.onSelect();
            }}
            onContextMenu={
              entry.contextMenu &&
              ((event) => {
                event.preventDefault();
                openItemMenu(entry, event.currentTarget, pointerOf(event));
              })
            }
            onKeyDown={
              entry.contextMenu &&
              ((event) => {
                if (!isContextMenuKey(event)) return;
                event.preventDefault();
                event.stopPropagation();
                openItemMenu(entry, event.currentTarget, null);
              })
            }
            className={`flex w-full items-center gap-2 px-3 py-1 text-left text-ui hover:bg-accent/15 focus-visible:bg-accent/15 disabled:opacity-40 ${entry.danger ? 'text-error' : 'text-text'}`}
          >
            {entry.icon && (
              <span aria-hidden className="flex w-4 shrink-0 justify-center text-muted">
                {entry.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            {entry.hint && <span className="shrink-0 text-meta text-faint">{localizeKeys(entry.hint)}</span>}
          </button>
        ),
      )}
    </Popover>
  );
}

/** State helper: where a menu is open (or null). */
export function useMenu() {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  return {
    at,
    openAt: (x: number, y: number) => setAt({ x, y }),
    openBelow: (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      setAt({ x: rect.left, y: rect.bottom + 4 });
    },
    /** For `<Menu above>`: anchors the menu's bottom edge just above the element. */
    openAbove: (el: HTMLElement) => {
      const rect = el.getBoundingClientRect();
      setAt({ x: rect.left, y: rect.top - 4 });
    },
    close: () => setAt(null),
  };
}
