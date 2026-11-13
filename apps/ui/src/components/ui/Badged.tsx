import type { ReactNode } from 'react';

/**
 * An icon with its count on the corner, or a dot: the sidebar's nav tray and the session's rail of tools. The count is
 * hidden from screen readers; the control's label says it. `ring` is the surface the icon sits on, so the badge
 * stands clear of it.
 */
export function Badged({
  icon,
  count,
  dot,
  tone = 'default',
  ring = 'sidebar',
  data,
}: {
  icon: ReactNode;
  count?: number;
  /** A dot in place of a count: pink for what needs you (pulsing), blue for something ready to look at. */
  dot?: boolean | 'warn' | 'link';
  tone?: 'default' | 'ok';
  ring?: 'sidebar' | 'bg';
  data?: Record<`data-${string}`, boolean>;
}) {
  const ringClass = ring === 'bg' ? 'ring-bg' : 'ring-sidebar';
  const dotTone = dot === 'link' ? 'link' : dot ? 'warn' : null;
  return (
    <span className="relative flex">
      {icon}
      {count !== undefined && count > 0 && (
        <span
          aria-hidden
          className={`pointer-events-none absolute -top-2.5 -right-3.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full px-1.5 text-meta leading-none font-semibold tabular-nums ring-2 ${ringClass} ${tone === 'ok' ? 'bg-ok text-bg' : 'bg-border text-text'}`}
          {...data}
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
      {dotTone === 'warn' && <span aria-hidden className={`absolute -top-1 -right-1 size-2 animate-pulse rounded-full bg-warn ring-2 ${ringClass}`} data-nav-needs-you />}
      {dotTone === 'link' && <span aria-hidden className={`absolute -top-1 -right-1 size-2 rounded-full bg-link ring-2 ${ringClass}`} data-badge-dot />}
    </span>
  );
}
