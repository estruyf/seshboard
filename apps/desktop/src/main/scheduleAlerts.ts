import type { ScheduleRunEvent } from '@switchboard/protocol/client';
import type { AttentionEvent } from './attention.ts';

/**
 * What scheduled runs (#173) tell you, as notifications. One for each run that started, went to the queue, was skipped
 * or couldn't start; several runs that were missed while Switchboard was closed and started together give one ("3
 * scheduled sessions started"). A missed run that was skipped (Skip it) says nothing: its row shows it.
 */
export function scheduleAlerts(runs: readonly ScheduleRunEvent[]): AttentionEvent[] {
  const caughtUp = runs.filter((run) => run.missed && run.result === 'started');
  const together = caughtUp.length > 1;
  const events: AttentionEvent[] = [];
  if (together) {
    events.push({
      kind: 'schedule-started',
      // A click opens the first of them.
      sessionId: caughtUp[0]!.sessionId ?? '',
      title: `${caughtUp.length} scheduled sessions started`,
      body: 'They were missed while Switchboard was closed.',
    });
  }
  for (const run of runs) {
    switch (run.result) {
      case 'started':
        if (!together || !run.missed) events.push({ kind: 'schedule-started', sessionId: run.sessionId ?? '', title: `Scheduled: ${run.name} started`, body: run.projectName });
        break;
      case 'queued':
        events.push({ kind: 'schedule-queued', sessionId: '', title: `Scheduled: ${run.name} is in the queue`, body: run.reason ?? run.projectName });
        break;
      case 'skipped':
        events.push({ kind: 'schedule-skipped', sessionId: run.sessionId ?? '', title: `Scheduled: ${run.name} was skipped`, body: capitalize(run.reason ?? 'The last run was still working.') });
        break;
      case 'failed':
        events.push({ kind: 'schedule-skipped', sessionId: '', title: `Scheduled: ${run.name} didn't start`, body: capitalize(run.reason ?? run.projectName) });
        break;
      case 'missed':
        break;
    }
  }
  return events;
}

/** "the last run was still working" as a sentence. */
const capitalize = (text: string) => {
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
};
