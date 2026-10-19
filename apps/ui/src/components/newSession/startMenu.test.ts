import { describe, expect, it } from 'vitest';
import { focusStartBlock, startButtonState, submitKey, type StartButtonInput } from './startMenu.ts';

const ready: StartButtonInput = { blocked: null, sending: false, hasMessage: true, hasText: true, startBlocked: null, canWorktree: true, worktree: false, question: false };
const press = (key: string, mods: { meta?: boolean; shift?: boolean } = {}) => ({ key, metaKey: !!mods.meta, shiftKey: !!mods.shift, ctrlKey: false, altKey: false });

describe('the Start button', () => {
  it('starts from the main part, with the menu offering start, queue and a new worktree', () => {
    const state = startButtonState(ready);
    expect(state).toMatchObject({ label: 'Start', disabled: false, menuDisabled: false, reason: null });
    expect(state.items.map((i) => [i.action, i.label, i.shortcut ?? null, i.disabled])).toEqual([
      ['start', 'Start session', 'new-session.start', false],
      ['queue', 'Add to queue', 'new-session.queue', false],
      ['start-worktree', 'Start in a new worktree', null, false],
    ]);
  });

  it('leads with Add to queue when opened to follow a session, with starting in the menu', () => {
    const state = startButtonState({ ...ready, queueFirst: true });
    expect(state).toMatchObject({ main: 'queue', shortcut: 'new-session.queue', label: 'Add to queue', disabled: false, reason: null });
    expect(state.items.map((i) => i.action)).toEqual(['queue', 'start', 'start-worktree']);
    expect(startButtonState({ ...ready, queueFirst: true, hasText: false, hasMessage: false })).toMatchObject({ disabled: true, reason: 'Type a message first' });
    expect(startButtonState(ready)).toMatchObject({ main: 'start', shortcut: 'new-session.start' });
  });

  it('keeps a new worktree and the queue when the branch is checked out in another worktree', () => {
    const reason = 'feature is checked out in another worktree. Pick another branch, or start in a new worktree.';
    const state = startButtonState({ ...ready, branchBlocked: reason });
    expect(state).toMatchObject({ disabled: true, menuDisabled: false, reason });
    expect(state.items.map((i) => [i.action, i.disabled])).toEqual([
      ['start', true],
      ['queue', false],
      ['start-worktree', false],
    ]);
  });

  it('offers a new worktree only on the current checkout of a git repository', () => {
    expect(startButtonState({ ...ready, worktree: true }).items.map((i) => i.action)).toEqual(['start', 'queue']);
    expect(startButtonState({ ...ready, canWorktree: false }).items.map((i) => i.action)).toEqual(['start', 'queue']);
  });

  it('offers Schedule… after Add to queue in New session, and Save schedule while a schedule is open', () => {
    const state = startButtonState({ ...ready, canSchedule: true });
    expect(state.items.map((i) => [i.action, i.label])).toEqual([
      ['start', 'Start session'],
      ['queue', 'Add to queue'],
      ['schedule', 'Schedule…'],
      ['start-worktree', 'Start in a new worktree'],
    ]);
    expect(startButtonState({ ...ready, canSchedule: true, editingSchedule: true }).items[2]).toMatchObject({ action: 'schedule', label: 'Save schedule', disabled: false });
    expect(startButtonState({ ...ready, canSchedule: true, hasText: false, hasMessage: false }).items[2]!.disabled).toBe(true);
    expect(startButtonState({ ...ready, canSchedule: true, question: true, canWorktree: false }).items.map((i) => i.action)).toEqual(['start', 'queue']);
  });

  it('asks for a quick question', () => {
    const state = startButtonState({ ...ready, canWorktree: false, question: true });
    expect(state.label).toBe('Ask');
    expect(state.items[0]!.label).toBe('Ask');
  });

  it('disables the whole button with the reason when nothing can go anywhere', () => {
    for (const [input, reason] of [
      [{ ...ready, blocked: 'Choose a folder first' }, 'Choose a folder first'],
      [{ ...ready, blocked: 'Connecting to the engine…' }, 'Connecting to the engine…'],
      [{ ...ready, hasMessage: false, hasText: false }, 'Type a message first'],
    ] as const) {
      const state = startButtonState(input);
      expect(state).toMatchObject({ disabled: true, menuDisabled: true, reason });
      expect(state.items.every((i) => i.disabled)).toBe(true);
    }
  });

  it('keeps the menu for Add to queue when only starting is blocked', () => {
    const state = startButtonState({ ...ready, startBlocked: 'At your focus limit' });
    expect(state).toMatchObject({ disabled: true, menuDisabled: false, reason: 'At your focus limit' });
    expect(state.items.filter((i) => !i.disabled).map((i) => i.action)).toEqual(['queue']);
  });

  it('starts with only images, which the queue leaves behind', () => {
    const state = startButtonState({ ...ready, hasText: false });
    expect(state.disabled).toBe(false);
    expect(state.items.find((i) => i.action === 'queue')!.disabled).toBe(true);
  });

  it('waits while sending, without a reason', () => {
    const state = startButtonState({ ...ready, sending: true });
    expect(state).toMatchObject({ label: 'Starting…', disabled: true, menuDisabled: true, reason: null });
  });
});

describe('focusStartBlock', () => {
  it('blocks starting only at the limit in Strict mode', () => {
    expect(focusStartBlock({ limit: 3, count: 3, mode: 'strict' })).toMatch(/focus limit/);
    expect(focusStartBlock({ limit: 3, count: 4, mode: 'strict' })).toMatch(/focus limit/);
    expect(focusStartBlock({ limit: 3, count: 2, mode: 'strict' })).toBeNull();
    expect(focusStartBlock({ limit: 3, count: 3, mode: 'nudge' })).toBeNull();
    expect(focusStartBlock({ limit: null, count: 9, mode: 'strict' })).toBeNull();
  });
});

describe('submitKey', () => {
  it('starts on ⌘↵ and ↵, queues on ⌘⇧↵', () => {
    expect(submitKey(press('Enter', { meta: true }), 'new-session.queue')).toBe('send');
    expect(submitKey(press('Enter'), 'new-session.queue')).toBe('send');
    expect(submitKey(press('Enter', { meta: true, shift: true }), 'new-session.queue')).toBe('secondary');
  });

  it('leaves ⇧↵ (a new line) and other keys alone', () => {
    expect(submitKey(press('Enter', { shift: true }), 'new-session.queue')).toBeNull();
    expect(submitKey(press('a', { meta: true }), 'new-session.queue')).toBeNull();
  });

  it('does nothing on ⌘⇧↵ without a second action', () => {
    expect(submitKey(press('Enter', { meta: true, shift: true }))).toBeNull();
  });
});

describe('Schedule a session', () => {
  it('puts Schedule… on the main part, without a key, and starting in the menu', () => {
    const state = startButtonState({ blocked: null, sending: false, hasMessage: true, hasText: true, startBlocked: null, canWorktree: false, worktree: false, question: false, canSchedule: true, scheduleFirst: true });
    expect(state).toMatchObject({ main: 'schedule', label: 'Schedule…', shortcut: null, disabled: false });
    expect(state.items.map((i) => i.action)).toEqual(['schedule', 'start', 'queue']);
    expect(startButtonState({ blocked: null, sending: false, hasMessage: false, hasText: false, startBlocked: null, canWorktree: false, worktree: false, question: false, canSchedule: true, scheduleFirst: true })).toMatchObject({ main: 'schedule', disabled: true, reason: 'Type a message first' });
    // A quick question can't be scheduled: Ask stays.
    expect(startButtonState({ blocked: null, sending: false, hasMessage: true, hasText: true, startBlocked: null, canWorktree: false, worktree: false, question: true, canSchedule: true, scheduleFirst: true }).main).toBe('start');
  });
});
