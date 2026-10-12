import { useEffect, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export interface PopoverProps extends Omit<HTMLAttributes<HTMLDivElement>, 'style'> {
  x: number;
  y: number;
  width?: number;
  /** Puts the popover's bottom edge at y instead of its top edge. */
  above?: boolean;
  onClose(): void;
  /** Close on Escape from anywhere (menus). A Select handles Escape itself so it never reaches other listeners. */
  closeOnEscape?: boolean;
  /** Clicks on this element don't count as outside clicks (the button that toggles the popover). */
  anchor?: RefObject<HTMLElement | null>;
  children: ReactNode;
}

/**
 * A floating panel at a screen position, kept on screen. Closes on an outside click, when the window
 * loses focus and (optionally) on Escape. The shared base for `Menu` and `Select`. Rendered in `body`, so a parent
 * that stacks its own layer (Settings, a dialog) can't keep it under the toasts.
 */
export function Popover({ x, y, width, above = false, onClose, closeOnEscape = true, anchor, className = '', children, ...rest }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the popover on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { innerWidth, innerHeight } = window;
    const top = above ? y - el.offsetHeight : y;
    setPosition({ left: Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)), top: Math.max(8, Math.min(top, innerHeight - el.offsetHeight - 8)) });
  }, [x, y, above]);

  // The listeners read the latest props through a ref so they're added once. If they were re-added
  // whenever `onClose` changed, a popover that closes on a click (the project filter) would re-render
  // a nested one (its project menu) mid-dispatch, and the browser would skip the nested one's
  // replaced listener, leaving it open.
  const latest = useRef({ onClose, closeOnEscape });
  useLayoutEffect(() => {
    latest.current = { onClose, closeOnEscape };
  });

  useEffect(() => {
    const close = () => latest.current.onClose();
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target) || anchor?.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => latest.current.closeOnEscape && event.key === 'Escape' && close();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      {...rest}
      style={{ left: position.left, top: position.top, width }}
      // Above the toasts (z-70), so a toast never covers an open menu, and under the tooltips (z-100).
      className={`no-drag fixed z-80 max-h-[70vh] overflow-y-auto rounded-lg border overlay py-1 ${className}`}
      // Lets a dialog see that a menu or dropdown is open, so Escape closes that first.
      data-popover
    >
      {children}
    </div>,
    document.body,
  );
}
