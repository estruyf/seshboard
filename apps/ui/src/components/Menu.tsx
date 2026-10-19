import { Check, ChevronRight } from 'lucide-react';
import { localizeKeys } from '../lib/shortcuts.ts';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { contextMenuPoint, isContextMenuKey, type ContextMenuPoint } from '../lib/contextMenu.ts';
import { Popover } from './ui/Popover.tsx';

export interface MenuItem {
  label: string;
  /** A second, quieter line under the label (a profile's account and folder). */
  detail?: string;
  icon?: ReactNode;
  hint?: string;
  /** Marks the current choice with a check. */
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  /** `data-*` attributes for the item's button (test hooks). */
  data?: Record<`data-${string}`, string | boolean>;
  onSelect(): void;
  /** The item's own context menu (right-click, Shift+F10): this menu closes and the caller opens that one at `at`. */
  contextMenu?(at: ContextMenuPoint): void;
  /** A second, icon-only action at the end of the row (Fix with Claude on a failed check); ↑ ↓ reach it too. */
  action?: { label: string; icon: ReactNode; onSelect(): void; data?: Record<`data-${string}`, string | boolean> };
}
/** An item that opens a submenu beside it (hover, → or Enter); ← or Esc goes back. Picking one of its items closes every level. */
export interface SubmenuItem {
  label: string;
  icon?: ReactNode;
  hint?: string;
  disabled?: boolean;
  /** `data-*` attributes for the item's button (test hooks). */
  data?: Record<`data-${string}`, string | boolean>;
  submenu: MenuEntry[];
}
/**
 * `heading`: a small label over a group of items. `title`: the menu's subject in bold, with a line
 * about it (a branch and where it stands). `note`: a sentence under the items, such as why some are unavailable.
 */
export type MenuEntry = MenuItem | SubmenuItem | 'separator' | { heading: string } | { title: string; detail?: string } | { note: string; tone?: 'warn' };

/** How long the pointer rests on an item before its submenu opens (or the open one closes), so crossing a row on the way in doesn't swap it. */
const SUBMENU_DELAY = 150;

/** The enabled items of a menu, in order. */
function menuItems(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)')) : [];
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
  parent,
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
  /** Set on a submenu: the menu it opened from. `focus`: opened from the keys, so its first item takes focus. */
  parent?: { id: string; focus: boolean; back(focusItem: boolean): void; onPointerEnter(): void };
}) {
  const id = useId();
  // The open submenu, by its item's label, and the item it opened from.
  const [sub, setSub] = useState<{ label: string; x: number; y: number; focus: boolean } | null>(null);
  const subItem = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const menu = document.getElementById(id);
    // A submenu opened by the pointer leaves focus where it is.
    if (!parent || parent.focus) (above ? menuItems(menu).at(-1) : menuItems(menu)[0])?.focus({ preventScroll: true });
    return () => {
      const active = document.activeElement;
      if (opener?.isConnected && opener !== document.body && (!active || active === document.body)) opener.focus({ preventScroll: true });
    };
  }, [id, above]);

  /** Opens an item's submenu beside this menu, on the left when there is no room on the right. */
  const openSub = (label: string, el: HTMLElement, focus: boolean) => {
    window.clearTimeout(timer.current);
    const item = el.getBoundingClientRect();
    const menu = (document.getElementById(id) ?? el).getBoundingClientRect();
    const x = menu.right - 4 + width > window.innerWidth - 8 ? menu.left - width + 4 : menu.right - 4;
    subItem.current = el;
    // Its first item level with the one it opened from (the popover's border and padding above it).
    setSub({ label, x, y: item.top - 5, focus });
  };
  const later = (fn: () => void) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(fn, SUBMENU_DELAY);
  };
  // The pointer on another item: the open submenu closes after a moment, and one about to open doesn't.
  const leaveSub = () => (sub ? later(() => setSub(null)) : window.clearTimeout(timer.current));
  const open = sub ? entries.find((entry): entry is SubmenuItem => typeof entry === 'object' && 'submenu' in entry && entry.label === sub.label) : undefined;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems(event.currentTarget);
    if (parent && (event.key === 'ArrowLeft' || event.key === 'Escape')) {
      event.preventDefault();
      event.stopPropagation();
      parent.back(true);
      return;
    }
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
    <>
      <Popover
        id={id}
        x={x}
        y={y}
        width={width}
        above={above}
        // A submenu closes on its own (an outside click); Esc in a menu with a submenu open is the submenu's.
        onClose={parent ? () => parent.back(false) : onClose}
        closeOnEscape={!sub}
        anchor={anchor}
        owner={parent?.id}
        role="menu"
        aria-label={label}
        onKeyDown={onKeyDown}
        onMouseEnter={parent?.onPointerEnter}
      >
        {entries.map((entry, i) =>
          entry === 'separator' ? (
            <div key={i} role="separator" className="mx-2 my-1 border-t border-edge" />
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
          ) : 'submenu' in entry ? (
            <button
              key={i}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub?.label === entry.label}
              disabled={entry.disabled}
              {...entry.data}
              // From the keys (Enter, Space) a click has no detail: the submenu's first item takes focus.
              onClick={(event) => openSub(entry.label, event.currentTarget, event.detail === 0)}
              onKeyDown={(event) => {
                if (event.key !== 'ArrowRight') return;
                event.preventDefault();
                event.stopPropagation();
                openSub(entry.label, event.currentTarget, true);
              }}
              onMouseEnter={(event) => {
                const el = event.currentTarget;
                if (sub?.label === entry.label) window.clearTimeout(timer.current);
                else later(() => openSub(entry.label, el, false));
              }}
              className={`flex w-full items-center gap-2 px-3 py-1 text-left text-ui text-text hover:bg-accent/15 focus-visible:bg-accent/15 disabled:opacity-40 ${sub?.label === entry.label ? 'bg-accent/15' : ''}`}
            >
              {entry.icon && (
                <span aria-hidden className="flex w-4 shrink-0 justify-center text-muted">
                  {entry.icon}
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
              {entry.hint && <span className="max-w-[45%] shrink-0 truncate text-meta text-faint">{entry.hint}</span>}
              <ChevronRight size={13} className="-mr-1 shrink-0 text-faint" aria-hidden />
            </button>
          ) : (
            <MenuRow key={i} entry={entry} onClose={onClose}>
              <button
                type="button"
                role={entry.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={entry.checked}
                disabled={entry.disabled}
                {...entry.data}
                onMouseEnter={leaveSub}
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
                {entry.detail ? (
                  <span className="grid min-w-0 flex-1">
                    <span className="truncate">{entry.label}</span>
                    <span className="truncate text-meta text-muted">{entry.detail}</span>
                  </span>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                )}
                {entry.hint && <span className="shrink-0 text-meta text-faint">{localizeKeys(entry.hint)}</span>}
                {entry.checked && <Check size={13} className="shrink-0 text-accent-ink" aria-hidden />}
              </button>
            </MenuRow>
          ),
        )}
      </Popover>
      {sub && open && (
        <Menu
          x={sub.x}
          y={sub.y}
          width={width}
          entries={open.submenu}
          label={open.label}
          anchor={subItem}
          onClose={onClose}
          parent={{
            id,
            focus: sub.focus,
            back: (focusItem) => {
              setSub(null);
              if (focusItem) subItem.current?.focus({ preventScroll: true });
            },
            onPointerEnter: () => window.clearTimeout(timer.current),
          }}
        />
      )}
    </>
  );
}

/** An item, with its `action` beside it when it has one (two buttons side by side: a button can't hold another). */
function MenuRow({ entry, onClose, children }: { entry: MenuItem; onClose(): void; children: ReactNode }) {
  const action = entry.action;
  if (!action) return children;
  return (
    <div role="none" className="flex items-center pr-1.5">
      <div role="none" className="min-w-0 flex-1">
        {children}
      </div>
      <button
        type="button"
        role="menuitem"
        aria-label={action.label}
        data-tooltip={action.label}
        {...action.data}
        onClick={() => {
          onClose();
          action.onSelect();
        }}
        className="flex size-6 shrink-0 items-center justify-center rounded text-muted hover:bg-accent/15 hover:text-text focus-visible:bg-accent/15 focus-visible:text-text"
      >
        {action.icon}
      </button>
    </div>
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
