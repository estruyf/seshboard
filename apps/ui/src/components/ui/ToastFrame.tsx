import { X } from 'lucide-react';
import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Button } from './Button.tsx';

/**
 * Calls `done` after `ms` of being seen: the countdown pauses while the pointer is on the toast or the window is in
 * the background. Null never runs out. Spread the handlers on the toast.
 */
export function useToastCountdown(ms: number | null, done: () => void): Pick<HTMLAttributes<HTMLElement>, 'onMouseEnter' | 'onMouseLeave'> {
  const [hovered, setHovered] = useState(false);
  const [windowFocused, setWindowFocused] = useState(() => document.hasFocus());
  const left = useRef(ms ?? 0);
  const finish = useRef(done);
  finish.current = done;

  useEffect(() => {
    const on = () => setWindowFocused(true);
    const off = () => setWindowFocused(false);
    window.addEventListener('focus', on);
    window.addEventListener('blur', off);
    return () => {
      window.removeEventListener('focus', on);
      window.removeEventListener('blur', off);
    };
  }, []);

  const running = ms !== null && !hovered && windowFocused;
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const timer = setTimeout(() => finish.current(), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [running]);

  return { onMouseEnter: () => setHovered(true), onMouseLeave: () => setHovered(false) };
}

interface ToastFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** An icon or dot before the title. */
  lead?: ReactNode;
  title: ReactNode;
  /** The sentence under the title. */
  body?: ReactNode;
  /** Buttons in a row under the body. */
  actions?: ReactNode;
  onDismiss(): void;
  dismissLabel?: string;
  /** More under the actions (release notes). */
  children?: ReactNode;
}

/** The card form of a toast: a title with a close button, a sentence and its buttons. */
export function ToastFrame({ lead, title, body, actions, onDismiss, dismissLabel = 'Dismiss', children, className = '', ...rest }: ToastFrameProps) {
  return (
    <div
      role="status"
      // A focused toast takes Escape itself, so it never reaches the message box (which would stop Claude).
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
      className={`pointer-events-auto flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-1.5 rounded-xl border overlay py-2.5 pr-2 pl-3.5 text-ui text-text ${className}`}
      {...rest}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        {lead}
        <span className="min-w-0 flex-1 truncate font-semibold">{title}</span>
        <Button variant="quiet" size="sm" iconOnly icon={<X size={13} aria-hidden />} aria-label={dismissLabel} onClick={onDismiss} className="shrink-0" data-toast-close />
      </div>
      {/* Errors can carry a long URL or path with no spaces: let it wrap anywhere rather than run out of the card. */}
      {body && <div className="pr-2 text-ui text-muted [overflow-wrap:anywhere]">{body}</div>}
      {actions && <div className="mt-1 flex items-center gap-2">{actions}</div>}
      {children}
    </div>
  );
}
