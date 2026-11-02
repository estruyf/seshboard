import type { LiveSession } from '@seshboard/protocol/client';

const label: Record<LiveSession['status'], string> = {
  running: 'Working',
  'needs-you': 'Waiting for you',
  idle: 'Open, idle',
};

const backgroundCount = (live: LiveSession) => (live.status === 'idle' ? (live.background?.length ?? 0) : 0);

/**
 * Live state of a session: pulsing while working, amber when it needs you, green when open and
 * idle, and slowly pulsing green when idle while background tasks still run.
 */
export function StatusDot({ live, agent, className = '' }: { live: LiveSession | null; /** Who works in the session, for "… is working". */ agent?: string; className?: string }) {
  if (!live) return <span className={`inline-block size-2 shrink-0 ${className}`} aria-hidden />;
  const background = backgroundCount(live);
  const tone =
    live.status === 'running' ? 'bg-accent-ink animate-pulse' : live.status === 'needs-you' ? 'bg-warn' : background ? 'bg-ok animate-[pulse_2.5s_ease-in-out_infinite]' : 'bg-ok';
  const tasks = background ? `\n${live.background!.join('\n')}` : '';
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${tone} ${className}`}
      data-tooltip={`${liveLabel(live, agent)} (${live.rawStatus})${tasks}`}
      // Without a role, a span's aria-label isn't read out.
      role="img"
      aria-label={liveLabel(live, agent)}
      data-background-tasks={background || undefined}
    />
  );
}

/** The session's state in words. `agent` names who works in it ("GitHub Copilot is working"); Claude by default. */
export function liveLabel(live: LiveSession, agent = 'Claude'): string {
  const background = backgroundCount(live);
  if (!background) return live.status === 'running' ? `${agent} is working` : label[live.status];
  return `Open, ${background === 1 ? '1 background task' : `${background} background tasks`} running`;
}
