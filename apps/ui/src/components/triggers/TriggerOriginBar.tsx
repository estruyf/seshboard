import { Zap } from 'lucide-react';
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
  const name = live?.name ?? link.triggerName ?? 'a trigger';
  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-1.5 border-b border-border px-6 py-1 text-meta text-muted" data-trigger-origin={link.triggerId}>
      <Zap size={12} className="shrink-0 text-trigger" aria-hidden />
      <span>
        Started by <span className="font-semibold text-text">{name}</span>
      </span>
      <span aria-hidden>·</span>
      <a href={link.url} target="_blank" rel="noreferrer" className="text-link hover:underline" data-trigger-origin-link>
        {link.ref}
      </a>
      <span aria-hidden>·</span>
      <span>{clock(link.at, Date.now())}</span>
      {event?.reassignedTo && (
        <span className="basis-full" data-trigger-reassigned>
          {link.ref} is now assigned to <span className="font-semibold text-text">@{event.reassignedTo}</span>. {event.runId ? 'This run goes on.' : 'This session goes on.'}
        </span>
      )}
    </div>
  );
}
