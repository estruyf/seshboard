import type { RowStatus } from '../../state/sidebarRows.ts';
import { minimalMark, STATUS_LABEL, statusLabel } from './rowLabel.ts';

export { STATUS_LABEL };

/**
 * One glance per session: a spinning ring while Claude (or another agent) works, a pulsing
 * pink dot when it waits for you, red when it failed, blue for unread (never yellow: that means working), a slow green
 * ring while a background task runs, green when open and idle. Nothing for archived, read sessions.
 * Each is a labelled image, so the state never rests on colour or motion alone.
 */
export function StatusIcon({
  status,
  agent,
  variant = 'standard',
}: {
  status: RowStatus;
  /** Who works in the session (`agentNameOf`). */
  agent?: string;
  /** `minimal`: Minimal mode's marks, by shape (`minimalMark`). */
  variant?: 'standard' | 'minimal';
}) {
  if (variant === 'minimal') return <MinimalStatusIcon status={status} />;
  if (!status) return <span className="size-3.5 shrink-0" aria-hidden />;
  const label = statusLabel(status, agent);
  switch (status) {
    case 'running':
      return (
        <span className="size-3.5 shrink-0 animate-spin rounded-full border-[1.5px] border-accent-ink/25 border-t-accent-ink" role="img" data-tooltip={label} aria-label={label} />
      );
    case 'needs-you':
      return (
        <span className="relative flex size-3.5 shrink-0 items-center justify-center" role="img" data-tooltip={label} aria-label={label}>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-warn opacity-60" />
          <span className="relative size-2 rounded-full bg-warn" />
        </span>
      );
    case 'error':
      return (
        <span className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-error text-[9px] font-bold text-white" role="img" data-tooltip={label} aria-label={label}>
          !
        </span>
      );
    case 'unread':
      return (
        <span className="flex size-3.5 shrink-0 items-center justify-center" role="img" data-tooltip={label} aria-label={label}>
          <span className="size-2 rounded-full bg-unread" />
        </span>
      );
    case 'background':
      return (
        <span className="size-3.5 shrink-0 animate-[spin_2.5s_linear_infinite] rounded-full border-[1.5px] border-ok/25 border-t-ok" role="img" data-tooltip={label} aria-label={label} />
      );
    case 'idle':
      return (
        <span className="flex size-3.5 shrink-0 items-center justify-center" role="img" data-tooltip={label} aria-label={label}>
          <span className="size-2 rounded-full border-[1.5px] border-ok" />
        </span>
      );
  }
}

/** The arc of Minimal mode's working mark: three quarters of a circle, open at the top right. */
const ARC = 'M21 12a9 9 0 1 1-6.2-8.56';

/**
 * Minimal mode's state mark, in a 12px slot so titles line up: a 7px dot in the text colour (needs you), an 11px arc
 * that turns (working; it stays still with reduced motion), a 7px ring (to review), the red badge (failed), nothing
 * (open). Each mark is a labelled image.
 */
function MinimalStatusIcon({ status }: { status: RowStatus }) {
  const { mark, label } = minimalMark(status);
  // 10px wide: the marks are 7 to 10px, and the title stays close to the row's edge.
  const slot = 'flex h-3 w-2.5 shrink-0 items-center justify-center';
  if (mark === 'none' || !label) return <span className={slot} aria-hidden data-minimal-mark="none" />;
  const own = { role: 'img', 'aria-label': label, 'data-tooltip': label, 'data-minimal-mark': mark } as const;
  switch (mark) {
    case 'dot':
      return (
        <span className={slot} {...own}>
          <span className="size-[7px] rounded-full bg-text" />
        </span>
      );
    case 'spinner':
      return (
        <span className={`${slot} text-muted`} {...own}>
          <svg width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" className="motion-safe:animate-spin" aria-hidden>
            <path d={ARC} />
          </svg>
        </span>
      );
    case 'ring':
      return (
        <span className={slot} {...own}>
          <span className="size-[7px] rounded-full border-[1.5px] border-muted" />
        </span>
      );
    case 'error':
      return (
        <span className={slot} {...own}>
          <span className="flex size-2.5 items-center justify-center rounded-full bg-error text-[8px] font-bold text-white">!</span>
        </span>
      );
  }
}
