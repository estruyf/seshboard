import { nextRuns, runsBetween, runTitle, type LaterDraft, type Schedule, type ScheduleRunEvent } from '@switchboard/protocol';
import type { ScheduleStore } from './scheduleStore.ts';

/** Why a run goes to the queue instead of starting: a short reason for the row, and a line for the notification. */
export interface RunHold {
  reason: string;
  detail: string;
}

export interface SchedulerDeps {
  store: ScheduleStore;
  /** The schedule's folder is there (and is a folder). */
  folderExists(cwd: string): boolean;
  /** A session a run started, if it is still busy: working, or waiting for you. */
  sessionState(sessionId: string): 'working' | 'waiting' | null;
  /** The queued item a run became is still on the queue. */
  queued(itemId: string): boolean;
  /** Why a run can't start now (the focus limit, or its profile's usage limit), or null when it can. */
  hold(draft: LaterDraft): RunHold | null;
  /** Starts a new session from the draft, titled `title`, the way `later.start` does. */
  start(draft: LaterDraft, title: string, scheduleId: string): Promise<string>;
  /** Puts the draft on the queue, as an item that starts by itself when the slot frees or the limit resets. */
  queue(draft: LaterDraft): string;
  projectName(cwd: string): string;
  /** A schedule changed (a run, a pause): the windows should hear the list again. */
  changed(): void;
  /** Runs happened, in one batch (several missed runs give one notification). */
  ran(runs: ScheduleRunEvent[]): void;
  log(level: 'info' | 'warn', message: string): void;
  now?(): number;
  /** Lets the process see a time zone change (Node keeps the zone it started with until told). */
  refreshZone?(): void;
  /** The longest the timer sleeps, so a clock change is seen within it. A minute by default. */
  tickMs?: number;
  /** A run this late still counts as on time (a timer that fired late, a short sleep). Two minutes by default. */
  graceMs?: number;
}

/** A timer that fires this far from when it should have means the clock changed, or the computer slept. */
const JUMP_MS = 10_000;
/** The clock went back by more than this: the runs count from the new time. */
const BACK_MS = 60 * 60_000;

/**
 * Runs scheduled sessions (#173), in the engine, so they run with no window open. One timer for the next run that is
 * due, re-armed after every change, on wake and when the clock or the time zone changes. Each schedule keeps the
 * moment up to which its runs were dealt with (`checkedAt`): what is due between then and now runs (or is recorded as
 * missed), once, however many runs it was.
 *
 * A run starts a new session from the schedule's draft. It never asks, since nobody may be there: while the last run
 * is still busy it is skipped, at the focus limit or a usage limit it goes to the queue as an item that starts by
 * itself, and a schedule whose folder is gone pauses.
 */
export class Scheduler {
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** When the timer should fire, to tell a clock change from a normal tick. */
  private expected: number | null = null;
  private running: Promise<void> | null = null;
  private again = false;
  /** Schedules with a run on its way, so each starts once. */
  private readonly busy = new Set<string>();
  private closed = false;

  constructor(private readonly deps: SchedulerDeps) {}

  /** Starts the timer. Runs due while Switchboard was closed are dealt with at once (or after `delayMs`). */
  start(delayMs = 0): void {
    if (delayMs > 0) this.arm(delayMs);
    else void this.check();
  }

  /** Schedules changed: the next run may be sooner or later. */
  rearm(): void {
    if (!this.closed) void this.check();
  }

  /** The computer woke (`powerMonitor` `resume`): runs due while it slept are dealt with now. */
  wake(): void {
    if (this.closed) return;
    this.deps.log('info', 'Schedules: woke up; looking for runs that were due');
    this.deps.refreshZone?.();
    void this.check();
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.timer);
  }

  /** The next time any schedule runs, or null when none will. */
  nextDue(): number | null {
    let next: number | null = null;
    for (const { schedule, checkedAt } of this.deps.store.stored()) {
      if (schedule.paused) continue;
      const [at] = nextRuns(schedule.rule, Math.min(checkedAt, this.now()), 1);
      if (at && (next === null || at.getTime() < next)) next = at.getTime();
    }
    return next;
  }

  /** Runs a schedule now, with the same rules as at its time. It doesn't move the next run. */
  async runNow(id: string): Promise<ScheduleRunEvent | null> {
    const schedule = this.deps.store.get(id);
    if (!schedule) return null;
    const run = await this.run(schedule, this.now(), false);
    this.deps.changed();
    this.deps.ran([run]);
    return run;
  }

  /** Deals with every run that is due, then arms the timer for the next one. Calls made meanwhile fold into one more. */
  check(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.pass();
        } while (this.again && !this.closed);
      } finally {
        this.running = null;
        this.arm();
      }
    })();
    return this.running;
  }

  private async pass(): Promise<void> {
    const now = this.now();
    const grace = this.deps.graceMs ?? 120_000;
    const runs: ScheduleRunEvent[] = [];
    for (const { schedule, checkedAt } of this.deps.store.stored()) {
      if (schedule.paused) continue;
      // The clock went far back: count from the new time, rather than wait for the old one to come around again.
      if (checkedAt > now + BACK_MS) {
        this.deps.store.setChecked(schedule.id, now);
        continue;
      }
      const due = runsBetween(schedule.rule, checkedAt, now);
      const latest = due[due.length - 1];
      if (!latest) continue;
      // Dealt with before anything starts, so a second pass never runs it again.
      this.deps.store.setChecked(schedule.id, now);
      const at = latest.getTime();
      if (now - at <= grace) runs.push(await this.run(schedule, at, false));
      else if (schedule.missed === 'run') runs.push(await this.run(schedule, at, true));
      else {
        this.deps.store.setLastRun(schedule.id, { at, result: 'missed', sessionId: null, itemId: null, reason: null });
        this.deps.log('info', `Schedules: “${schedule.name}” missed its run at ${new Date(at).toISOString()} (Skip it)`);
        runs.push(this.event(schedule, 'missed', { missed: true }));
      }
    }
    if (runs.length === 0) return;
    this.deps.changed();
    this.deps.ran(runs);
  }

  /** One run: skipped, queued, failed or started, recorded as the schedule's last run. */
  private async run(schedule: Schedule, at: number, missed: boolean): Promise<ScheduleRunEvent> {
    const { store } = this.deps;
    /** Kept as the last run; the notification may say more than the row (`detail`). */
    const record = (result: ScheduleRunEvent['result'], extra: { sessionId?: string | null; itemId?: string | null; reason?: string | null; detail?: string; title?: string | null } = {}) => {
      store.setLastRun(schedule.id, { at, result, sessionId: extra.sessionId ?? null, itemId: extra.itemId ?? null, reason: extra.reason ?? null });
      return this.event(schedule, result, { missed, sessionId: extra.sessionId ?? null, reason: extra.detail ?? extra.reason ?? null, title: extra.title ?? null });
    };
    if (this.busy.has(schedule.id)) return this.event(schedule, 'skipped', { missed, reason: 'the last run was still starting' });
    this.busy.add(schedule.id);
    try {
      if (!this.deps.folderExists(schedule.draft.cwd)) {
        store.setPaused(schedule.id, true, 'Folder not found');
        this.deps.log('warn', `Schedules: paused “${schedule.name}”: its folder is gone`);
        return record('failed', { reason: 'Folder not found' });
      }
      const last = schedule.lastRun;
      const state = last?.sessionId && (last.result === 'started' || last.result === 'skipped') ? this.deps.sessionState(last.sessionId) : null;
      if (state && last?.sessionId) {
        const reason = state === 'waiting' ? 'the last run was waiting for you' : 'the last run was still working';
        this.deps.log('info', `Schedules: skipped “${schedule.name}”: ${reason}`);
        return record('skipped', { sessionId: last.sessionId, reason });
      }
      if (last?.result === 'queued' && last.itemId && this.deps.queued(last.itemId)) {
        return record('skipped', { itemId: last.itemId, reason: 'the last run was still in the queue' });
      }
      const draft = { ...schedule.draft, autoStart: false };
      const hold = this.deps.hold(draft);
      if (hold) {
        const itemId = this.deps.queue(draft);
        this.deps.log('info', `Schedules: queued “${schedule.name}”: ${hold.reason}`);
        return record('queued', { itemId, reason: hold.reason, detail: hold.detail });
      }
      const title = runTitle(schedule.name, at);
      try {
        const sessionId = await this.deps.start(draft, title, schedule.id);
        store.addRun(sessionId, schedule.id, this.now());
        this.deps.log('info', `Schedules: started “${schedule.name}” as ${sessionId}`);
        return record('started', { sessionId, title });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.deps.log('warn', `Schedules: could not start “${schedule.name}”: ${reason}`);
        return record('failed', { reason });
      }
    } finally {
      this.busy.delete(schedule.id);
    }
  }

  private event(schedule: Schedule, result: ScheduleRunEvent['result'], extra: { missed: boolean; sessionId?: string | null; reason?: string | null; title?: string | null }): ScheduleRunEvent {
    return {
      scheduleId: schedule.id,
      name: schedule.name,
      result,
      sessionId: extra.sessionId ?? null,
      title: extra.title ?? null,
      projectName: this.deps.projectName(schedule.draft.cwd),
      reason: extra.reason ?? null,
      missed: extra.missed,
    };
  }

  /**
   * One timer: for the next run, but never longer than a tick, so a clock or time zone change is seen within a minute.
   * A tick that fires far from when it should have means the clock changed (or the computer slept): look again.
   */
  private arm(delayMs?: number): void {
    clearTimeout(this.timer);
    if (this.closed) return;
    const tick = this.deps.tickMs ?? 60_000;
    const now = this.now();
    const next = delayMs === undefined ? this.nextDue() : null;
    const wait = delayMs ?? (next === null ? tick : Math.max(0, Math.min(tick, next - now)));
    this.expected = now + wait;
    this.timer = setTimeout(() => this.tick(), wait);
    this.timer.unref?.();
  }

  private tick(): void {
    const drift = this.expected === null ? 0 : this.now() - this.expected;
    if (Math.abs(drift) > JUMP_MS) this.deps.log('info', `Schedules: the clock moved by ${Math.round(drift / 1000)}s; looking again`);
    this.deps.refreshZone?.();
    void this.check();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
