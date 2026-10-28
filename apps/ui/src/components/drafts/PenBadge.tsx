import { PencilLine } from 'lucide-react';
import type { HTMLAttributes } from 'react';

/**
 * The small pen in a circle on an icon or button that holds an unsent message: the + button (a New session prompt)
 * and session icons in the rail. On the popover surface, ringed in the sidebar's colour so it reads as cut out.
 * `className` places it (`absolute -top-1 -right-1`).
 */
export function PenBadge({ size = 16, className = '', ...rest }: { size?: number; className?: string } & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none flex items-center justify-center rounded-full bg-popover text-muted ring-2 ring-sidebar ${className}`}
      style={{ width: size, height: size }}
      {...rest}
    >
      <PencilLine size={Math.round(size * 0.6)} strokeWidth={2.2} />
    </span>
  );
}

/** The + button's tooltip while a New session prompt is unsent. */
export const newSessionDraftTooltip = (project: string | null) => (project ? `New session · unsent prompt in ${project}` : 'New session · unsent prompt');

/** The same, for a prompt typed for another computer. */
export const remoteNewSessionDraftTooltip = (computer: string) => `New session · unsent prompt on ${computer}`;
