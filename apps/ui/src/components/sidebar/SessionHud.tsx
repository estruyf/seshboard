import { useEffect, useMemo, useState } from 'react';
import { basename } from '../../lib/format.ts';
import { useHosts } from '../../state/hostsStore.ts';
import { useProjects } from '../../state/projectsStore.ts';
import { useHud } from '../../state/sessionNav.ts';
import { toRows, useSessions } from '../../state/sessionsStore.ts';
import { statusLine } from '../../state/sidebarOrder.ts';
import { rowStatus } from '../../state/sidebarRows.ts';
import { ProjectIcon } from '../ProjectIcon.tsx';
import { useRemoteRows } from '../../state/useRemoteRows.ts';

/** How long the HUD stays after a jump. */
export const HUD_MS = 1_200;

const DOT: Record<string, string> = { warn: 'bg-warn', accent: 'bg-accent-ink', unread: 'bg-unread', ok: 'bg-ok', error: 'bg-error', faint: 'bg-faint' };

/**
 * Where ⌃⇥, ⌃⇧⇥ and ⌘⇧U landed while the sidebar is minimal or closed: "2 of 6", the status dot, the
 * project icon, the title and the project, floating at the top centre for 1.2s. A polite live region,
 * so VoiceOver says it too. It fades out (at once with reduced motion).
 */
export function SessionHud() {
  const message = useHud((s) => s.message);
  const nonce = useHud((s) => s.nonce);
  const [visible, setVisible] = useState(false);
  const sessions = useSessions((s) => s.sessions);
  const live = useSessions((s) => s.live);
  const hosts = useHosts((s) => s.hosts);
  const projects = useProjects((s) => s.projects);
  const remoteRows = useRemoteRows();

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), HUD_MS);
    return () => clearTimeout(timer);
  }, [message, nonce]);

  const session = useMemo(
    () => (message?.kind === 'session' ? ([...toRows(sessions, live, hosts), ...remoteRows].find((row) => row.id === message.id) ?? null) : null),
    [message, sessions, live, hosts, remoteRows],
  );
  const project = session ? projects.get(session.projectRoot) : undefined;
  const line = session ? statusLine(rowStatus(session)) : null;
  const text = message?.kind === 'note' ? message.text : session && message?.kind === 'session' ? `${message.position} of ${message.total}: ${session.title}` : '';

  return (
    <div className="pointer-events-none fixed inset-x-0 top-14 z-40 flex justify-center px-4">
      {/* The live region stays mounted so each new message is announced; only its look fades. */}
      <div role="status" aria-live="polite" className="sr-only" data-session-hud-text>
        {visible ? text : ''}
      </div>
      {message && (
        <div
          aria-hidden
          className={`flex max-w-full min-w-0 items-center gap-2.5 rounded-xl border overlay px-3.5 py-2 text-ui transition-opacity duration-300 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`}
          data-session-hud={visible ? (message.kind === 'session' ? message.id : 'note') : undefined}
        >
          {message.kind === 'note' ? (
            <span className="font-medium text-text">{message.text}</span>
          ) : session ? (
            <>
              <span className="shrink-0 text-meta text-muted tabular-nums">
                {message.position} of {message.total}
              </span>
              <span aria-hidden className={`size-2 shrink-0 rounded-full ${DOT[line?.tone ?? 'faint']}`} />
              <ProjectIcon project={project} root={session.projectRoot} size={18} name={session.remote?.projectName} remote={!!session.remote} />
              <span className="min-w-0 truncate text-body font-semibold text-text">{session.title || 'Untitled session'}</span>
              <span className="shrink-0 text-meta text-muted">{project?.name ?? basename(session.projectRoot)}</span>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}
