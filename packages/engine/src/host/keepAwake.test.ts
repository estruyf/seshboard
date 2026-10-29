import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEEP_AWAKE_GRACE_MS, SessionsAwake, sessionDone, type AwakeState } from './keepAwake.ts';

const state = (patch: Partial<AwakeState> = {}): AwakeState => ({ state: 'idle', backgroundTasks: [], queue: [], queueHold: null, compacting: false, ...patch });
const task = { taskId: 't1', type: 'local_bash', description: 'npm test', startedAt: 1 };
const queued = { id: 'q1', text: 'next', attachments: [], createdAt: 1 };

describe('sessionDone', () => {
  it('is done when idle with nothing left, or when the process ended', () => {
    expect(sessionDone(state())).toBe(true);
    expect(sessionDone(state({ state: 'closed' }))).toBe(true);
    expect(sessionDone(state({ state: 'error', backgroundTasks: [task] }))).toBe(true);
  });

  it('is not done while Claude works, waits on you or starts', () => {
    expect(sessionDone(state({ state: 'running' }))).toBe(false);
    expect(sessionDone(state({ state: 'needs-you' }))).toBe(false);
    expect(sessionDone(state({ state: 'starting' }))).toBe(false);
  });

  it('is not done while a background task runs, a compact runs, or Up next sends by itself', () => {
    expect(sessionDone(state({ backgroundTasks: [task] }))).toBe(false);
    expect(sessionDone(state({ compacting: true }))).toBe(false);
    expect(sessionDone(state({ queue: [queued] }))).toBe(false);
    // A held queue doesn't send by itself.
    expect(sessionDone(state({ queue: [queued], queueHold: 'stopped' }))).toBe(true);
  });
});

describe('SessionsAwake', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const make = () => {
    const changes: boolean[] = [];
    const cleared: string[] = [];
    const awake = new SessionsAwake({ onChange: (on) => changes.push(on), onCleared: (id) => cleared.push(id) });
    return { awake, changes, cleared };
  };

  it('holds sleep off while the session works and lets go once it stays done', () => {
    const { awake, changes, cleared } = make();
    awake.set('s1', true, state({ state: 'running' }));
    expect(awake.active).toBe(true);
    awake.update('s1', state());
    vi.advanceTimersByTime(KEEP_AWAKE_GRACE_MS - 1);
    expect(awake.active).toBe(true);
    vi.advanceTimersByTime(1);
    expect(awake.active).toBe(false);
    expect(awake.has('s1')).toBe(false);
    expect(changes).toEqual([true, false]);
    expect(cleared).toEqual(['s1']);
  });

  it('keeps holding through background tasks after the turn ends', () => {
    const { awake } = make();
    awake.set('s1', true, state({ state: 'running' }));
    awake.update('s1', state({ backgroundTasks: [task] }));
    vi.advanceTimersByTime(KEEP_AWAKE_GRACE_MS * 4);
    expect(awake.active).toBe(true);
    awake.update('s1', state());
    vi.advanceTimersByTime(KEEP_AWAKE_GRACE_MS);
    expect(awake.active).toBe(false);
  });

  it('keeps the flag when the turn a finished task starts comes within the grace period', () => {
    const { awake, cleared } = make();
    awake.set('s1', true, state({ backgroundTasks: [task] }));
    awake.update('s1', state());
    vi.advanceTimersByTime(1_000);
    awake.update('s1', state({ state: 'running' }));
    vi.advanceTimersByTime(KEEP_AWAKE_GRACE_MS * 2);
    expect(awake.active).toBe(true);
    expect(cleared).toEqual([]);
  });

  it('waits for work on a session flagged while idle, without holding sleep off', () => {
    const { awake, changes } = make();
    awake.set('s1', true, state());
    expect(awake.has('s1')).toBe(true);
    expect(awake.active).toBe(false);
    vi.advanceTimersByTime(KEEP_AWAKE_GRACE_MS * 2);
    expect(awake.has('s1')).toBe(true);
    awake.update('s1', state({ state: 'running' }));
    expect(awake.active).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('clears the flag at once when the process ends', () => {
    const { awake, cleared } = make();
    awake.set('s1', true, state({ state: 'running', backgroundTasks: [task] }));
    awake.update('s1', state({ state: 'closed' }));
    expect(awake.active).toBe(false);
    expect(cleared).toEqual(['s1']);
  });

  it('turns off when asked, and refuses a session that is no longer running', () => {
    const { awake, cleared } = make();
    expect(awake.set('s1', true, state({ state: 'closed' }))).toBe(false);
    expect(awake.has('s1')).toBe(false);
    awake.set('s1', true, state({ state: 'running' }));
    awake.set('s1', false, state({ state: 'running' }));
    expect(awake.active).toBe(false);
    // Turned off by you: not reported as finished.
    expect(cleared).toEqual([]);
  });

  it('stays on while any flagged session works', () => {
    const { awake, changes } = make();
    awake.set('s1', true, state({ state: 'running' }));
    awake.set('s2', true, state({ state: 'needs-you' }));
    awake.update('s1', state({ state: 'closed' }));
    expect(awake.active).toBe(true);
    awake.update('s2', state({ state: 'error' }));
    expect(awake.active).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('ignores updates for sessions without the flag', () => {
    const { awake, changes } = make();
    awake.update('s1', state({ state: 'running' }));
    expect(awake.active).toBe(false);
    expect(changes).toEqual([]);
  });
});
