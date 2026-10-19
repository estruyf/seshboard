import { matches } from './shortcuts.ts';

/** Where a context menu opens: `above` puts its bottom edge at `y` (see `Menu`). */
export interface ContextMenuPoint {
  x: number;
  y: number;
  above: boolean;
}

/** Shift+F10 or the context-menu key: opens an element's context menu from the keyboard, as a right-click does. */
export const isContextMenuKey = (event: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }) => event.key === 'ContextMenu' || matches(event, 'context-menu');

/** Room a menu needs below the pointer; with less it opens upwards instead. */
const ROOM_BELOW_POINTER = 260;

/**
 * Where to open a context menu: at the pointer for a right-click, at the element for the keyboard
 * (`pointer` null). A right-click opens below the pointer, as usual, and only goes upwards when there is
 * no room underneath for a menu; the keyboard case opens upwards in the lower half of the window.
 */
export function contextMenuPoint(pointer: { x: number; y: number } | null, rect: { left: number; top: number; bottom: number }, viewportHeight: number): ContextMenuPoint {
  if (pointer) return { x: pointer.x, y: pointer.y, above: viewportHeight - pointer.y < ROOM_BELOW_POINTER };
  const above = rect.top > viewportHeight / 2;
  return { x: rect.left, y: above ? rect.top - 4 : rect.bottom + 4, above };
}
