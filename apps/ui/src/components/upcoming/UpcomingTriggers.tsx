import { Pause, Play, Zap } from 'lucide-react';
import { useMemo } from 'react';
import type { Trigger, TriggerEvent } from '@switchboard/protocol/client';
import { checkedLine, eventDetail, eventTitle, pausedLine, speakEvent, triggerCounts } from '../../state/triggers.ts';
import { openTriggersTab, setTriggerPaused, startTriggerEvent } from '../../state/triggersStore.ts';
import { toast } from '../../state/toastStore.ts';
import { SourceIcon } from '../triggers/TriggerEditor.tsx';
import { useTriggerSessions } from '../triggers/useTriggerSessions.ts';
import { Button } from '../ui/Button.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';

const CARD = 'grid content-start gap-1 rounded-xl border border-border bg-card p-3';

/**
 * Upcoming's Triggers: every trigger across projects, with its last check, how many of its sessions are busy, what
 * waits and what was skipped, and how many events it has. A paused one says why, with Resume. Under them, the events
 * that wait for a slot, oldest first, with Start now.
 */
export function TriggersCard({ triggers, events, now, nameOf }: { triggers: Trigger[]; events: TriggerEvent[]; now: number; nameOf(root: string): string }) {
  const { busy } = useTriggerSessions();
  const byTrigger = useMemo(() => {
    const map = new Map<string, TriggerEvent[]>();
    for (const event of events) map.set(event.triggerId, [...(map.get(event.triggerId) ?? []), event]);
    return map;
  }, [events]);
  const shownIds = new Set(triggers.map((t) => t.id));
  const waiting = events.filter((e) => e.status === 'waiting' && shownIds.has(e.triggerId)).sort((a, b) => a.createdAt - b.createdAt);
  const names = new Map(triggers.map((t) => [t.id, t]));
  return (
    <section aria-labelledby="upcoming-triggers" className={CARD} data-upcoming-triggers>
      <div className="flex min-w-0 items-center gap-3 px-1 pb-1">
        <SectionHeader as="h2" headingId="upcoming-triggers" count={triggers.length} className="min-w-0 flex-1">
          <Zap size={13} className="shrink-0" aria-hidden />
          Triggers
        </SectionHeader>
      </div>
      {triggers.length === 0 ? (
        <p className="px-1 pb-1 text-ui text-muted">No triggers. Set them up on a project's Triggers tab.</p>
      ) : (
        <ul className="grid gap-0.5">
          {triggers.map((trigger) => {
            const own = byTrigger.get(trigger.id) ?? [];
            const counts = triggerCounts(trigger, own, busy);
            const paused = pausedLine(trigger);
            const line = [checkedLine(trigger.lastCheckedAt, now), `${counts.busy} of ${counts.max} busy`, `${counts.waiting} waiting`, counts.skipped ? `${counts.skipped} skipped` : null].filter(Boolean).join(' · ');
            return (
              <li key={trigger.id} className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-2 hover:bg-border/45" data-upcoming-trigger={trigger.id}>
                {trigger.paused ? <Pause size={14} className="w-5 shrink-0 text-caution" aria-hidden /> : <SourceIcon kind={trigger.source.kind} size={20} />}
                <button type="button" onClick={() => openTriggersTab(trigger.projectRoot)} className="grid min-w-0 flex-1 gap-px text-left" data-tooltip="Open the project's Triggers tab">
                  <span className="truncate text-body text-text">
                    {trigger.name} · {nameOf(trigger.projectRoot)}
                  </span>
                  <span className={`truncate text-meta ${paused ? 'text-caution' : 'text-faint'}`}>{paused ?? line}</span>
                </button>
                {trigger.paused ? (
                  <Button size="md" icon={<Play size={11} fill="currentColor" aria-hidden />} onClick={() => void setTriggerPaused(trigger, false).catch((e: Error) => toast(`Couldn't resume it: ${e.message}`))} data-upcoming-trigger-resume>
                    Resume
                  </Button>
                ) : (
                  <span className="shrink-0 text-meta text-muted">{own.length === 1 ? '1 event' : `${own.length} events`}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {waiting.length > 0 && (
        <>
          <h3 className="mt-2 px-1 text-meta font-semibold tracking-wide text-muted uppercase">Waiting for a slot</h3>
          <ul className="grid gap-0.5">
            {waiting.map((event, i) => (
              <li key={event.id} className="flex min-w-0 items-center gap-2.5 rounded-lg px-1 py-2" aria-label={speakEvent(event, null, { position: i + 1, of: waiting.length })} data-upcoming-trigger-event={event.id}>
                <span className="w-5 shrink-0 text-right text-meta text-faint tabular-nums" aria-hidden>
                  {i + 1}
                </span>
                <span className="grid min-w-0 flex-1 gap-px">
                  <span className="truncate text-body text-text">{eventTitle(event)}</span>
                  <span className="truncate text-meta text-faint">
                    {eventDetail(event, now)} · {names.get(event.triggerId)?.name ?? ''}
                  </span>
                </span>
                <Button size="md" icon={<Play size={11} fill="currentColor" aria-hidden />} onClick={() => void startTriggerEvent(event)} data-trigger-event-start>
                  Start now
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
