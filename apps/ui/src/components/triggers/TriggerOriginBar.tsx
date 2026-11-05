import type { ReactNode } from 'react';
import { Zap } from 'lucide-react';
import type { RemoteTriggerOrigin } from '@seshboard/protocol/client';
import { useTriggers } from '../../state/triggersStore.ts';
import { clock } from '../../state/triggers.ts';

/**
 * Under the header of a session (or a pipeline's run row, by the run's id) a trigger started: "Started by CI fails on main · CI #4512 · 14:02", with a link to
 * the run or the issue. When the issue was assigned to someone else while the session works, it says who has it now;
 * the session goes on.
 */
export function TriggerOriginBar({ sessionId }: { sessionId: string | null }) {
  const link = useTriggers((s) => (sessionId ? (s.bySession.get(sessionId) ?? null) : null));
  const event = useTriggers((s) => (link ? (s.events.find((e) => e.id === link.eventId && (e.sessionId === sessionId || e.runId === sessionId)) ?? null) : null));
  const live = useTriggers((s) => (link ? s.triggers.find((t) => t.id === link.triggerId) : undefined));
  if (!link) return null;
  return (
    <TriggerOriginLine triggerId={link.triggerId} name={live?.name ?? link.triggerName ?? 'a trigger'} refText={link.ref} url={link.url} at={link.at}>
      {event?.reassignedTo && (
        <span className="basis-full" data-trigger-reassigned>
          {link.ref} is now assigned to <span className="font-semibold text-text">@{event.reassignedTo}</span>. {event.runId ? 'This run goes on.' : 'This session goes on.'}
        </span>
      )}
    </TriggerOriginLine>
  );
}

/**
 * The same line for a session or a run on another computer, from what that computer sent (`RemoteTriggerOrigin`): the
 * trigger is that computer's, so it has no reassigned note.
 */
export function RemoteTriggerOriginBar({ origin }: { origin: RemoteTriggerOrigin | null }) {
  if (!origin) return null;
  return <TriggerOriginLine triggerId="remote" name={origin.name} refText={origin.ref} url={origin.url} at={origin.at} />;
}

function TriggerOriginLine({ triggerId, name, refText, url, at, children }: { triggerId: string; name: string; refText: string; url: string; at: number; children?: ReactNode }) {
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-1.5 border-b border-border px-6 py-1 text-meta text-muted" data-trigger-origin={triggerId}>
      <Zap size={12} className="shrink-0 text-trigger" aria-hidden />
      <span>
        Started by <span className="font-semibold text-text">{name}</span>
      </span>
      <span aria-hidden>·</span>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-link hover:underline" data-trigger-origin-link>
          {refText}
        </a>
      ) : (
        <span>{refText}</span>
      )}
      <span aria-hidden>·</span>
      <span>{clock(at, Date.now())}</span>
      {children}
    </div>
  );
}
