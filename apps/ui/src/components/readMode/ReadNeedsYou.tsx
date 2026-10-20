import { useMemo } from 'react';
import { useHosts } from '../../state/hostsStore.ts';
import { useReadMode } from '../../state/readModeStore.ts';
import { useSessions } from '../../state/sessionsStore.ts';
import { openRow } from '../../state/useRemoteRows.ts';
import { permissionTitle } from '../session/PermissionCard.tsx';
import { Button } from '../ui/Button.tsx';
import { bannerRequest } from './needsYou.ts';

/**
 * A slim line under the top bar while any session waits for an answer: who and what, with Go. It is a polite live
 * region that never takes focus (an Enter meant for the page must not answer it), in the needs-you colour as a rail
 * and a dot rather than a filled box, and it goes when nothing waits.
 */
export function ReadNeedsYou({ sessionId }: { sessionId: string }) {
  const permissions = useHosts((s) => s.permissions);
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const close = useReadMode((s) => s.close);
  // The one that has waited longest.
  const request = useMemo(() => bannerRequest(permissions.values()), [permissions]);
  const id = request?.sessionId ?? null;
  const title = id ? (sessions.get(id)?.title ?? live.get(id)?.name ?? 'a session') : '';
  const cwd = id ? (sessions.get(id)?.cwd ?? live.get(id)?.cwd ?? null) : null;
  return (
    <div role="status" aria-live="polite" data-read-needs-you-region>
      {request && id && (
        <div className="read-banner-in flex h-9 items-center gap-2.5 border-b border-border border-l-[3px] border-l-warn bg-paper px-4 text-ui" data-read-needs-you data-session-id={id}>
          <span aria-hidden className="size-2 shrink-0 animate-pulse rounded-full bg-warn motion-reduce:animate-none" />
          <span className="min-w-0 flex-1 truncate text-paper-text">
            <span className="font-semibold">Claude needs you</span> in {title}
            <span className="text-muted"> · {permissionTitle(request, cwd)}</span>
          </span>
          <Button size="sm" className="no-drag" onClick={() => (id === sessionId ? close() : openRow(id))} data-read-needs-you-go>
            Go
          </Button>
        </div>
      )}
    </div>
  );
}
