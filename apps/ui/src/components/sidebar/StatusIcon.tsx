import type { RowStatus } from '../../state/sidebarRows.ts';
import { STATUS_LABEL, statusLabel } from './rowLabel.ts';

export { STATUS_LABEL };

/**
 * One glance per session: a spinning ring while Claude (or another agent) works, a pulsing
 * pink dot when it waits for you, red when it failed, blue for unread (never yellow: that means working), a slow green
 * ring while a background task runs, green when open and idle. Nothing for archived, read sessions.
 * Each is a labelled image, so the state never rests on colour or motion alone.
 */
export function StatusIcon({ status, agent }: { status: RowStatus; /** Who works in the session (`agentNameOf`). */ agent?: string }) {
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
