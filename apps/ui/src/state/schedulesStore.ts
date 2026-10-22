import { useEffect } from 'react';
import { create } from 'zustand';
import { formatNext, nextRuns, type Schedule, type ScheduleRunEvent, type ScheduleSave, type ScheduleSession } from '@switchboard/protocol/client';
import { engineConnection } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useProjects } from './projectsStore.ts';
import { useSessions } from './sessionsStore.ts';
import { toast } from './toastStore.ts';
import { skippedToast } from './upcoming.ts';

// Scheduled sessions (#173). The engine keeps and runs them; every window shows the same list.

interface SchedulesState {
  schedules: Schedule[];
  /** The schedule each session came from, for the repeat icon on its row. */
  bySession: Map<string, string>;
  loaded: boolean;
  /** Edit…: New session fills itself in from this schedule's draft, and Start ▾ offers Save schedule. */
  request: { schedule: Schedule; seq: number } | null;
  /** Schedule a session (Upcoming): New session opens with Start ▾ on Schedule…; it takes this once. */
  scheduleFirst: boolean;
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
  scheduleFirst: false,
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

/** Opens New session (on a project, when given) with Start ▾ on Schedule…, to write the prompt a schedule runs. */
export function openToSchedule(root: string | null = null): void {
  if (root) useProjects.getState().startIn(root);
  useSchedules.setState({ scheduleFirst: true });
  useSessions.getState().openNewSession();
}

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

/** Takes back Skip this run: the run starts at its time again. */
export async function unskipRun(schedule: Pick<Schedule, 'id'>, at: number): Promise<void> {
  await clientNow().call('schedules.unskipRun', { id: schedule.id, at: new Date(at).toISOString() });
}

/** Skip this run: the run at `at` doesn't start; the toast says which, with Undo. */
export async function skipRun(schedule: Pick<Schedule, 'id' | 'name'>, at: number): Promise<void> {
  try {
    await clientNow().call('schedules.skipRun', { id: schedule.id, at: new Date(at).toISOString() });
    toast(skippedToast(at, schedule.name), { undo: () => void unskipRun(schedule, at).catch(() => {}), data: { 'data-run-skipped-toast': true } });
  } catch (error) {
    toast(`Couldn't skip it: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The next run that isn't skipped yet, or null (paused, or no run to come). */
export function nextRunToSkip(schedule: Schedule, now = Date.now()): number | null {
  if (schedule.paused) return null;
  const skipped = new Set(schedule.skippedRuns);
  return nextRuns(schedule.rule, now, 32).find((run) => !skipped.has(run.toISOString()))?.getTime() ?? null;
}
