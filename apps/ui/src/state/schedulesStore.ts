import { useEffect } from 'react';
import { create } from 'zustand';
import { formatNext, nextRuns, type Schedule, type ScheduleRunEvent, type ScheduleSave, type ScheduleSession } from '@switchboard/protocol/client';
import { engineConnection } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';

// Scheduled sessions (#173). The engine keeps and runs them; every window shows the same list.

interface SchedulesState {
  schedules: Schedule[];
  /** The schedule each session came from, for the repeat icon on its row. */
  bySession: Map<string, string>;
  loaded: boolean;
  /** Edit…: New session fills itself in from this schedule's draft, and Start ▾ offers Save schedule. */
  request: { schedule: Schedule; seq: number } | null;
  replace(schedules: Schedule[], sessions: ScheduleSession[]): void;
  /** Opens New session filled in from a schedule, to change its prompt and choices. */
  edit(schedule: Schedule): void;
  /** New session takes the request once. */
  take(): Schedule | null;
}

let seq = 0;

export const useSchedules = create<SchedulesState>()((set, get) => ({
  schedules: [],
  bySession: new Map(),
  loaded: false,
  request: null,
  replace: (schedules, sessions) => set({ schedules, bySession: new Map(sessions.map((s) => [s.sessionId, s.scheduleId])), loaded: true }),
  edit: (schedule) => {
    set({ request: { schedule, seq: ++seq } });
    useSessions.getState().openNewSession();
  },
  take: () => {
    const request = get().request;
    if (request) set({ request: null });
    return request?.schedule ?? null;
  },
}));

/** Loads the schedules once per connection and follows changes from every window and every run. */
export function useSchedulesSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('schedules.changed', ({ schedules, sessions }) => useSchedules.getState().replace(schedules, sessions));
    void client.call('schedules.list', {}).then(({ schedules, sessions }) => useSchedules.getState().replace(schedules, sessions), () => {});
    return off;
  }, [client]);
}

const clientNow = () => {
  const state = engineConnection.getSnapshot();
  if (state.status !== 'connected') throw new Error('Not connected to the engine');
  return state.client;
};

/** "Review open pull requests is scheduled. Next: Tomorrow 08:00" */
export function scheduledMessage(schedule: Schedule, now = Date.now()): string {
  const [next] = nextRuns(schedule.rule, now, 1);
  return `${schedule.name} is ${schedule.paused ? 'saved' : 'scheduled'}.${next && !schedule.paused ? ` Next: ${formatNext(next, now)}` : ''}`;
}

/** Creates or changes a schedule, and says so with its next run. */
export async function saveSchedule(schedule: ScheduleSave): Promise<Schedule> {
  const { schedule: saved } = await clientNow().call('schedules.save', { schedule });
  toast(scheduledMessage(saved), { data: { 'data-schedule-saved-toast': true } });
  return saved;
}

/** Deletes without asking; Undo puts it back as it was. */
export async function deleteSchedule(schedule: Schedule): Promise<void> {
  const client = clientNow();
  await client.call('schedules.delete', { id: schedule.id });
  toast(`Deleted ${schedule.name}`, { undo: () => void client.call('schedules.restore', { schedule }).catch(() => {}), data: { 'data-schedule-deleted-toast': true } });
}

export async function setSchedulePaused(schedule: Schedule, paused: boolean): Promise<void> {
  await clientNow().call('schedules.setPaused', { id: schedule.id, paused });
}

/** What Run now did, for a toast when it didn't open a session. */
const runLine = (run: ScheduleRunEvent) =>
  run.result === 'queued'
    ? `${run.name} is in the queue. ${run.reason ?? ''}`.trim()
    : run.result === 'skipped'
      ? `${run.name} was skipped: ${run.reason ?? 'the last run was still working'}.`
      : `${run.name} didn't start: ${run.reason ?? 'unknown reason'}.`;

/**
 * Runs a schedule now, with the same rules as at its time: it may be skipped or queued. A run that started opens its
 * session; anything else is said in a toast.
 */
export async function runScheduleNow(schedule: Schedule): Promise<void> {
  try {
    const { run } = await clientNow().call('schedules.runNow', { id: schedule.id });
    if (run.result === 'started' && run.sessionId) useSessions.getState().select(run.sessionId);
    else toast(runLine(run));
  } catch (error) {
    toast(`Couldn't run it: ${error instanceof Error ? error.message : String(error)}`);
  }
}
