import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { LaterDraft, ScheduleRunEvent, ScheduleSave } from '@seshboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { removeDir } from '../util/removeDir.ts';
import { Scheduler, type RunHold } from './scheduler.ts';
import { ScheduleStore } from './scheduleStore.ts';

// Runs are in local time: the tests use a zone with DST, and put back what was there.
const savedTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = 'Europe/Brussels';
});
afterAll(() => {
  if (savedTz === undefined) delete process.env.TZ;
  else process.env.TZ = savedTz;
});

const WEB = resolve('/work/web');
const dirs: string[] = [];
const databases: { close(): void }[] = [];
// Databases close first: Windows can't delete a folder with an open file in it.
afterEach(async () => {
  vi.useRealTimers();
  databases.splice(0).forEach((db) => db.close());
  await Promise.all(dirs.splice(0).map((d) => removeDir(d)));
});
/** The cache database at `path`, closed after the test. */
const openDb = (path: string) => {
  const { db } = openCacheDatabase(path);
  databases.push(db);
  return db;
};
const cachePath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-schedules-'));
  dirs.push(dir);
  return join(dir, 'cache.sqlite');
};
const local = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).getTime();
const schedule = (over: Partial<ScheduleSave> = {}): ScheduleSave => ({
  name: 'Review open pull requests',
  draft: { cwd: WEB, prompt: 'Review the open pull requests from yesterday', model: 'opus', permissionMode: 'acceptEdits' },
  rule: { kind: 'daily', time: '08:00' },
  missed: 'run',
  paused: false,
  ...over,
});

describe('schedule store', () => {
  it('saves, lists, changes and keeps a schedule with its draft and images', () => {
    const path = cachePath();
    const store = new ScheduleStore(openDb(path));
    const image = { type: 'image' as const, mediaType: 'image/png' as const, data: 'aGVsbG8=', name: 'shot.png' };
    const saved = store.save(schedule({ draft: { cwd: WEB, prompt: 'Look at this', attachments: [image] } }));
    expect(saved).toMatchObject({ name: 'Review open pull requests', rule: { kind: 'daily', time: '08:00' }, missed: 'run', paused: false, pausedReason: null, lastRun: null });
    expect(saved.draft).toMatchObject({ cwd: WEB, prompt: 'Look at this', permissionMode: 'default', workspace: 'current' });
    expect(saved.draft.attachments).toEqual([image]);

    store.setLastRun(saved.id, { at: 1, result: 'started', sessionId: 's1', itemId: null, reason: null });
    const changed = store.save({ ...schedule({ name: 'Standup summary', rule: { kind: 'weekly', days: [1, 4], time: '09:30' } }), id: saved.id });
    expect(changed).toMatchObject({ id: saved.id, name: 'Standup summary', createdAt: saved.createdAt, lastRun: { result: 'started', sessionId: 's1' } });

    // A new store over the same file (a restart, or a cache rebuild that keeps user choices).
    const again = new ScheduleStore(openDb(path));
    expect(again.list().map((s) => s.name)).toEqual(['Standup summary']);
  });

  it('refuses a week without days', () => {
    const store = new ScheduleStore(openDb(cachePath()));
    expect(() => store.save(schedule({ rule: { kind: 'weekly', days: [], time: '08:00' } }))).toThrow(/at least one day/);
    expect(store.list()).toEqual([]);
  });

  it('deletes and restores a schedule as it was', () => {
    const store = new ScheduleStore(openDb(cachePath()));
    const saved = store.save(schedule());
    store.setLastRun(saved.id, { at: 5, result: 'skipped', sessionId: 's1', itemId: null, reason: 'the last run was still working' });
    const before = store.get(saved.id)!;
    store.remove(saved.id);
    expect(store.list()).toEqual([]);
    expect(store.restore(before)).toEqual(before);
  });

  it('pauses with a reason and resumes without it', () => {
    const store = new ScheduleStore(openDb(cachePath()));
    const saved = store.save(schedule());
    expect(store.setPaused(saved.id, true, 'Folder not found')).toMatchObject({ paused: true, pausedReason: 'Folder not found' });
    expect(store.setPaused(saved.id, false)).toMatchObject({ paused: false, pausedReason: null });
    expect(store.setPaused(saved.id, true)).toMatchObject({ paused: true, pausedReason: null });
    expect(store.setPaused('gone', true)).toBeNull();
  });

  it('remembers the sessions a schedule started', () => {
    const store = new ScheduleStore(openDb(cachePath()));
    const saved = store.save(schedule());
    store.addRun('s1', saved.id, 1);
    store.addRun('s1', saved.id, 2);
    expect(store.sessions()).toEqual([{ sessionId: 's1', scheduleId: saved.id }]);
  });
});

/** A store on a real SQLite file, a fake clock and a scheduler whose sessions and limits the test drives. */
function world(options: { at: number }) {
  vi.useFakeTimers({ now: options.at });
  const store = new ScheduleStore(openDb(cachePath()));
  const started: { draft: LaterDraft; title: string; scheduleId: string; sessionId: string }[] = [];
  const queued: LaterDraft[] = [];
  const batches: ScheduleRunEvent[][] = [];
  const logs: string[] = [];
  const states = new Map<string, 'working' | 'waiting'>();
  const missing = new Set<string>();
  const queue = new Set<string>();
  let hold: RunHold | null = null;
  let next = 0;
  const scheduler = new Scheduler({
    store,
    folderExists: (cwd) => !missing.has(cwd),
    sessionState: (id) => states.get(id) ?? null,
    queued: (id) => queue.has(id),
    hold: () => hold,
    start: async (draft, title, scheduleId) => {
      const sessionId = `run-${++next}`;
      started.push({ draft, title, scheduleId, sessionId });
      return sessionId;
    },
    queue: (draft) => {
      queued.push(draft);
      const id = `item-${queued.length}`;
      queue.add(id);
      return id;
    },
    projectName: () => 'web',
    changed: () => {},
    ran: (runs) => batches.push(runs),
    log: (_level, message) => logs.push(message),
  });
  return {
    store,
    scheduler,
    started,
    queued,
    batches,
    logs,
    states,
    missing,
    queue,
    setHold: (value: RunHold | null) => void (hold = value),
    /** Time passes with the app running: timers fire. */
    advanceTo: (at: number) => vi.advanceTimersByTimeAsync(at - Date.now()),
    /** Time passes with the app closed or the computer asleep: no timer fires. */
    sleepUntil: (at: number) => vi.setSystemTime(at),
  };
}

describe('scheduler', () => {
  it('runs a schedule at its time as one new session, titled with its day', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule());
    w.scheduler.start();
    await w.advanceTo(local(10, 19, 7, 59));
    expect(w.started).toEqual([]);
    await w.advanceTo(local(10, 19, 8, 0, ) + 1);
    expect(w.started).toHaveLength(1);
    expect(w.started[0]).toMatchObject({ title: 'Review open pull requests · Mon 19 Oct', scheduleId: saved.id });
    expect(w.started[0]!.draft).toMatchObject({ cwd: WEB, prompt: 'Review the open pull requests from yesterday', model: 'opus', permissionMode: 'acceptEdits' });
    expect(w.store.get(saved.id)!.lastRun).toMatchObject({ at: local(10, 19, 8), result: 'started', sessionId: 'run-1' });
    expect(w.store.sessions()).toEqual([{ sessionId: 'run-1', scheduleId: saved.id }]);
    expect(w.batches).toEqual([[expect.objectContaining({ result: 'started', title: 'Review open pull requests · Mon 19 Oct', projectName: 'web', missed: false })]]);
    // The next day too, once.
    await w.advanceTo(local(10, 20, 9));
    expect(w.started.map((s) => s.title)).toEqual(['Review open pull requests · Mon 19 Oct', 'Review open pull requests · Tue 20 Oct']);
    w.scheduler.close();
  });

  it("doesn't run a time already past today when it is saved", async () => {
    const w = world({ at: local(10, 19, 9) });
    w.store.save(schedule());
    w.scheduler.start();
    await w.advanceTo(local(10, 19, 23));
    expect(w.started).toEqual([]);
    w.scheduler.close();
  });

  it('re-arms after an edit', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule({ rule: { kind: 'daily', time: '09:00' } }));
    w.scheduler.start();
    await w.advanceTo(local(10, 19, 7, 10));
    w.store.save({ ...schedule({ rule: { kind: 'daily', time: '07:30' } }), id: saved.id });
    w.scheduler.rearm();
    await w.advanceTo(local(10, 19, 7, 31));
    expect(w.started).toHaveLength(1);
    await w.advanceTo(local(10, 19, 9, 30));
    expect(w.started).toHaveLength(1);
    w.scheduler.close();
  });

  it('runs once on wake after missed runs, with Run when Seshboard starts', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule());
    w.scheduler.start();
    await w.advanceTo(local(10, 19, 7, 30));
    // Asleep for three mornings.
    w.sleepUntil(local(10, 22, 10));
    w.scheduler.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.started).toHaveLength(1);
    expect(w.started[0]!.title).toBe('Review open pull requests · Thu 22 Oct');
    expect(w.batches).toEqual([[expect.objectContaining({ result: 'started', missed: true })]]);
    expect(w.store.get(saved.id)!.lastRun).toMatchObject({ result: 'started', at: local(10, 22, 8) });
    w.scheduler.close();
  });

  it('records a missed run on wake, with Skip it', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule({ missed: 'skip' }));
    w.scheduler.start();
    w.sleepUntil(local(10, 19, 10));
    w.scheduler.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.started).toEqual([]);
    expect(w.store.get(saved.id)!.lastRun).toMatchObject({ result: 'missed', at: local(10, 19, 8) });
    expect(w.batches).toEqual([[expect.objectContaining({ result: 'missed', missed: true })]]);
    // It runs again at its next time.
    await w.advanceTo(local(10, 20, 8, 1));
    expect(w.started).toHaveLength(1);
    w.scheduler.close();
  });

  it('finds runs missed while Seshboard was closed when it starts', async () => {
    const w = world({ at: local(10, 16, 18) });
    w.store.save(schedule({ rule: { kind: 'weekdays', time: '08:45' } }));
    // Closed over the weekend, opened on Monday at 10:00.
    w.sleepUntil(local(10, 19, 10));
    w.scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.started.map((s) => s.title)).toEqual(['Review open pull requests · Mon 19 Oct']);
    w.scheduler.close();
  });

  it('sees a clock jump between ticks', async () => {
    const w = world({ at: local(10, 19, 7) });
    w.store.save(schedule());
    w.scheduler.start();
    await w.advanceTo(local(10, 19, 7, 0, ) + 1_000);
    // The clock is set forward by an hour and a half while the app runs: the timer only sees it at its next tick.
    w.sleepUntil(local(10, 19, 8, 30));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.logs.some((l) => l.includes('the clock moved'))).toBe(true);
    expect(w.started).toHaveLength(1);
    expect(w.batches[0]![0]).toMatchObject({ missed: true });
    w.scheduler.close();
  });

  it('runs several schedules due at once in one batch', async () => {
    const w = world({ at: local(10, 19, 7) });
    w.store.save(schedule({ name: 'One' }));
    w.store.save(schedule({ name: 'Two' }));
    w.store.save(schedule({ name: 'Three', rule: { kind: 'weekdays', time: '08:45' } }));
    w.scheduler.start();
    w.sleepUntil(local(10, 19, 9, 12));
    w.scheduler.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.batches).toHaveLength(1);
    expect(w.batches[0]!.map((r) => [r.name, r.result, r.missed])).toEqual([
      ['One', 'started', true],
      ['Two', 'started', true],
      ['Three', 'started', true],
    ]);
    w.scheduler.close();
  });

  it('skips a run while the last run is still working or waiting', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule());
    w.scheduler.start();
    await w.advanceTo(local(10, 19, 8, 1));
    w.states.set('run-1', 'working');
    await w.advanceTo(local(10, 20, 8, 1));
    expect(w.started).toHaveLength(1);
    expect(w.store.get(saved.id)!.lastRun).toMatchObject({ result: 'skipped', at: local(10, 20, 8), sessionId: 'run-1', reason: 'the last run was still working' });
    expect(w.batches[1]).toEqual([expect.objectContaining({ result: 'skipped', reason: 'the last run was still working' })]);
    // Still waiting for you the day after: skipped again, and it says so.
    w.states.set('run-1', 'waiting');
    await w.advanceTo(local(10, 21, 8, 1));
    expect(w.store.get(saved.id)!.lastRun).toMatchObject({ result: 'skipped', reason: 'the last run was waiting for you' });
    w.states.clear();
    await w.advanceTo(local(10, 22, 8, 1));
    expect(w.started).toHaveLength(2);
    w.scheduler.close();
  });

  it('goes to the queue at a limit, and skips while that item is still queued', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule());
    w.scheduler.start();
    w.setHold({ reason: 'at the focus limit', detail: '3 of 3 sessions are working. It starts when one finishes.' });
    await w.advanceTo(local(10, 19, 8, 1));
    expect(w.started).toEqual([]);
    expect(w.queued).toHaveLength(1);
    expect(w.queued[0]).toMatchObject({ cwd: WEB, prompt: 'Review the open pull requests from yesterday' });
    expect(w.store.get(saved.id)!.lastRun).toMatchObject({ result: 'queued', itemId: 'item-1', reason: 'at the focus limit' });
    expect(w.batches[0]).toEqual([expect.objectContaining({ result: 'queued', reason: '3 of 3 sessions are working. It starts when one finishes.' })]);

    w.setHold({ reason: 'at the usage limit until 15:16', detail: 'Usage limit until 15:16. It starts when it resets.' });
    await w.advanceTo(local(10, 20, 8, 1));
    expect(w.store.get(saved.id)!.lastRun).toMatchObject({ result: 'skipped', reason: 'the last run was still in the queue' });
    w.queue.clear();
    await w.advanceTo(local(10, 21, 8, 1));
    expect(w.queued).toHaveLength(2);
    expect(w.store.get(saved.id)!.lastRun).toMatchObject({ result: 'queued', reason: 'at the usage limit until 15:16' });
    w.scheduler.close();
  });

  it('never runs a paused schedule, and counts from the resume', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule());
    w.store.setPaused(saved.id, true);
    w.scheduler.start();
    await w.advanceTo(local(10, 21, 9));
    expect(w.started).toEqual([]);
    w.store.setPaused(saved.id, false);
    w.scheduler.rearm();
    await w.advanceTo(local(10, 21, 10));
    expect(w.started).toEqual([]);
    await w.advanceTo(local(10, 22, 8, 1));
    expect(w.started).toHaveLength(1);
    w.scheduler.close();
  });

  it('pauses a schedule whose folder is gone', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule());
    w.missing.add(WEB);
    w.scheduler.start();
    await w.advanceTo(local(10, 19, 8, 1));
    expect(w.started).toEqual([]);
    expect(w.store.get(saved.id)).toMatchObject({ paused: true, pausedReason: 'Folder not found', lastRun: { result: 'failed', reason: 'Folder not found' } });
    await w.advanceTo(local(10, 20, 8, 1));
    expect(w.batches).toHaveLength(1);
    w.scheduler.close();
  });

  it('runs now without moving the next run', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule());
    w.scheduler.start();
    await w.advanceTo(local(10, 19, 7, 15));
    const run = await w.scheduler.runNow(saved.id);
    expect(run).toMatchObject({ result: 'started', title: 'Review open pull requests · Mon 19 Oct', missed: false });
    expect(w.scheduler.nextDue()).toBe(local(10, 19, 8));
    await w.advanceTo(local(10, 19, 8, 1));
    expect(w.started).toHaveLength(2);
    w.scheduler.close();
  });
});

describe('run history and Skip this run', () => {
  it('keeps the last 20 runs, newest first, and keeps them on an edit', () => {
    const store = new ScheduleStore(openDb(cachePath()));
    const saved = store.save(schedule());
    for (let i = 1; i <= 22; i++) store.setLastRun(saved.id, { at: i, result: i % 2 ? 'started' : 'missed', sessionId: i % 2 ? `s${i}` : null, itemId: null, reason: null });
    const runs = store.get(saved.id)!.runs;
    expect(runs).toHaveLength(20);
    expect(runs[0]).toMatchObject({ at: 22, result: 'missed' });
    expect(runs[19]).toMatchObject({ at: 3, result: 'started', sessionId: 's3' });
    expect(store.save({ ...schedule({ name: 'Renamed' }), id: saved.id }).runs).toEqual(runs);
  });

  it('skips and unskips a run, and cleans up runs already dealt with', () => {
    vi.useFakeTimers({ now: local(10, 19, 7) });
    const store = new ScheduleStore(openDb(cachePath()));
    const saved = store.save(schedule());
    const tomorrow = local(10, 20, 8);
    expect(store.setSkipped(saved.id, tomorrow, true)!.skippedRuns).toEqual([new Date(tomorrow).toISOString()]);
    expect(store.setSkipped(saved.id, local(10, 21, 8), true)!.skippedRuns).toHaveLength(2);
    expect(store.setSkipped(saved.id, tomorrow, false)!.skippedRuns).toEqual([new Date(local(10, 21, 8)).toISOString()]);
    // A skipped time the timer has passed goes on the next change.
    store.setSkipped(saved.id, local(10, 19, 6), true);
    store.setChecked(saved.id, local(10, 19, 7));
    expect(store.setSkipped(saved.id, tomorrow, true)!.skippedRuns).toEqual([new Date(tomorrow).toISOString(), new Date(local(10, 21, 8)).toISOString()]);
    expect(store.setSkipped('gone', tomorrow, true)).toBeNull();
  });

  it("doesn't start a skipped run, records it as Skipped by you, and runs the next one", async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule());
    w.store.setSkipped(saved.id, local(10, 19, 8), true);
    w.scheduler.start();
    await w.advanceTo(local(10, 19, 9));
    expect(w.started).toEqual([]);
    expect(w.batches).toEqual([]);
    const after = w.store.get(saved.id)!;
    expect(after.lastRun).toMatchObject({ at: local(10, 19, 8), result: 'skipped', reason: 'Skipped by you' });
    expect(after.runs).toHaveLength(1);
    expect(after.skippedRuns).toEqual([]);
    await w.advanceTo(local(10, 20, 9));
    expect(w.started.map((s) => s.title)).toEqual(['Review open pull requests · Tue 20 Oct']);
    expect(w.store.get(saved.id)!.runs.map((r) => r.result)).toEqual(['started', 'skipped']);
    w.scheduler.close();
  });

  it('runs a run again once its skip is taken back', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule());
    w.store.setSkipped(saved.id, local(10, 19, 8), true);
    w.scheduler.start();
    w.store.setSkipped(saved.id, local(10, 19, 8), false);
    w.scheduler.rearm();
    await w.advanceTo(local(10, 19, 9));
    expect(w.started).toHaveLength(1);
    w.scheduler.close();
  });
});

describe('one-time schedules', () => {
  it('runs once, and is removed a week after its run, keeping the repeat icon of its session', async () => {
    // November, so no clock change falls in the eight days.
    const w = world({ at: local(11, 2, 7) });
    const saved = w.store.save(schedule({ rule: { kind: 'once', date: '2026-11-02', time: '08:00' } }));
    w.scheduler.start();
    await w.advanceTo(local(11, 3, 9));
    expect(w.started.map((s) => s.title)).toEqual(['Review open pull requests · Mon 2 Nov']);
    // Eight days after its run (08:00): still there just before, gone just after.
    await w.advanceTo(local(11, 10, 7, 55));
    expect(w.store.get(saved.id)).not.toBeNull();
    await w.advanceTo(local(11, 10, 8, 5));
    expect(w.store.get(saved.id)).toBeNull();
    expect(w.store.sessions()).toEqual([{ sessionId: 'run-1', scheduleId: saved.id }]);
    expect(w.started).toHaveLength(1);
    w.scheduler.close();
  });

  it('keeps one whose run was due while Seshboard was closed until that run is dealt with', async () => {
    const w = world({ at: local(10, 19, 7) });
    const saved = w.store.save(schedule({ rule: { kind: 'once', date: '2026-10-19', time: '08:00' } }));
    // Closed for ten days: the run is caught up at the start, not removed unseen.
    w.sleepUntil(local(10, 29, 9));
    w.scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(w.started).toHaveLength(1);
    expect(w.store.get(saved.id)).not.toBeNull();
    w.scheduler.close();
  });
});
