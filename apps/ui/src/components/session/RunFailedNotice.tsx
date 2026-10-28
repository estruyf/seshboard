import { useState } from 'react';
import { CircleAlert, RefreshCw } from 'lucide-react';
import type { SessionHostInfo } from '@seshboard/protocol/client';
import { Button } from '../ui/Button.tsx';
import { Notice } from '../ui/Notice.tsx';

/** Longer than this, Claude Code's message shows its first lines until you open it. */
const LONG_ERROR = 160;

/**
 * Above the message box of a session whose Claude Code process failed (it would not start, or it crashed). Says why in
 * full, where the text can wrap, instead of in the row of chips. When Claude Code failed before it got your message,
 * Try again starts it again and sends that message; otherwise the next message you send starts it again.
 */
export function RunFailedNotice({ host, retrying, retryError, onRetry }: { host: SessionHostInfo; retrying: boolean; retryError: string | null; onRetry: (() => void) | null }) {
  const [open, setOpen] = useState(false);
  // Hidden until this process's error changes (Try again failing again shows the new one).
  const [dismissed, setDismissed] = useState<string | null>(null);
  const key = `${host.startedAt}:${host.error}`;
  if (host.state !== 'error' || dismissed === key) return null;

  const unsent = host.unsent ?? 0;
  const error = host.error?.trim() || 'Claude Code stopped without saying why.';
  const long = error.length > LONG_ERROR;
  return (
    <Notice
      tone="error"
      icon={<CircleAlert size={14} aria-hidden />}
      data-run-failed
      onDismiss={() => setDismissed(key)}
      actions={
        onRetry && (
          <Button
            variant="primary"
            size="sm"
            icon={<RefreshCw size={11} className={retrying ? 'animate-spin' : ''} aria-hidden />}
            disabled={retrying}
            aria-busy={retrying}
            onClick={onRetry}
            data-tooltip={unsent === 1 ? 'Start Claude Code again and send your message' : 'Start Claude Code again and send your messages'}
            data-run-failed-retry
          >
            {retrying ? 'Trying again…' : 'Try again'}
          </Button>
        )
      }
    >
      <span className="grid gap-0.5 text-text">
        <span className="font-medium">{unsent > 0 ? 'Claude Code could not start' : 'Claude Code stopped with an error'}</span>
        <span className="text-meta text-muted">
          {unsent > 0 ? (unsent === 1 ? 'Your message did not reach Claude.' : `Your ${unsent} messages did not reach Claude.`) : 'Send a message to start the session again.'}
        </span>
        <span className={`font-mono text-meta text-error ${long && !open ? 'line-clamp-2' : ''}`} data-run-failed-error>
          {error}
        </span>
        {long && (
          <Button variant="quiet" size="sm" className="-ml-1.5 justify-self-start" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? 'Show less' : 'Show all'}
          </Button>
        )}
        {retryError && <span className="text-meta text-error">{retryError}</span>}
      </span>
    </Notice>
  );
}
