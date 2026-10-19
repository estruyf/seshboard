import { describe, expect, it } from 'vitest';
import type { LaterItem, SessionOutcome } from './later.ts';
import { autoStartBlock, FOCUS_HELD_LABEL, queueRowLabel, queueStates, type QueueEntry, type QueueSession } from './queueStates.ts';

const NOW = Date.UTC(2026, 9, 19, 12);

const item = (id: string, overrides: Partial<LaterItem> = {}): LaterItem => ({
  id,
  cwd: '/work/switchboard',
  prompt: `Prompt ${id}`,
  model: null,
  effort: null,
  permissionMode: 'default',
  workspace: 'current',
  baseRef: 'fresh',
  branch: null,
  profileId: null,
  autoStart: false,
  attachments: [],
  typed: null,
  context: [],
  createdAt: NOW,
  position: 0,
  waitFor: { kind: 'project' },
  ...overrides,
});

const session = (id: string, busy: boolean, overrides: Partial<QueueSession> = {}): QueueSession => ({ id, title: id, projectRoot: '/work/switchboard', busy, ...overrides });

const states = (items: LaterItem[], sessions: QueueSession[], options: { outcomes?: Record<string, SessionOutcome>; focusHeld?: string[]; started?: Array<{ itemId: string; sessionId: string }> } = {}) =>
  queueStates({
    items,
    sessions,
    started: options.started ?? [],
    projectName: (root) => root.split('/').pop()!,
    outcomeOf: (id) => options.outcomes?.[id] ?? null,
    focusHeld: new Set(options.focusHeld ?? []),
    now: NOW,
  });
const brief = (entries: QueueEntry[]) => entries.map((e) => [e.item.id, e.state, e.label]);

describe('queue states, shared by the UI and the engine', () => {
  it('turns ready when what it waits for is done: the session, the item above and its session, the project', () => {
    const items = [
      item('a', { waitFor: { kind: 'session', sessionId: 'fix' } }),
      item('b', { waitFor: { kind: 'item', itemId: 'a' } }),
      item('c', { waitFor: { kind: 'project' } }),
      item('d', { waitFor: { kind: 'none' } }),
    ];
    const busy = states(items, [session('fix', true, { title: 'Fix login' })]);
    expect(brief(busy.entries)).toEqual([
      ['a', 'waiting', 'after “Fix login”'],
      ['b', 'waiting', 'after the item above'],
      ['c', 'waiting', 'switchboard has a session working'],
      ['d', 'queued', null],
    ]);
    const done = states(items, [session('fix', false, { title: 'Fix login' })]);
    expect(brief(done.entries).map(([id, state]) => [id, state])).toEqual([
      ['a', 'ready'],
      ['b', 'waiting'],
      ['c', 'ready'],
      ['d', 'queued'],
    ]);
    expect(done.readyCount).toBe(2);
  });

  it('says how the session it waited for ended, and keeps the usual words when that is clean or not known', () => {
    const items = [item('a', { waitFor: { kind: 'session', sessionId: 'fix' }, autoStart: true })];
    const done = [session('fix', false, { title: 'Fix login' })];
    expect(states(items, done, { outcomes: { fix: 'clean' } }).entries[0]).toMatchObject({ state: 'ready', label: '“Fix login” finished', finished: { sessionId: 'fix', outcome: 'clean' } });
    expect(states(items, done, { outcomes: { fix: 'error' } }).entries[0]).toMatchObject({ state: 'ready', label: '“Fix login” ended with an error, so it didn\'t start' });
    expect(states(items, done, { outcomes: { fix: 'stopped' } }).entries[0]).toMatchObject({ state: 'ready', label: '“Fix login” was stopped, so it didn\'t start' });
    expect(states(items, done, { outcomes: { fix: 'quit' } }).entries[0]).toMatchObject({ state: 'ready', label: '“Fix login” finished', finished: { outcome: 'quit' } });
    expect(states(items, done).entries[0]).toMatchObject({ label: '“Fix login” finished', finished: { outcome: null } });
    // One you start yourself never says it didn't start.
    expect(states([{ ...items[0]!, autoStart: false }], done, { outcomes: { fix: 'error' } }).entries[0]!.label).toBe('“Fix login” finished');
  });

  it('words an item that starts by itself as "starts after", for a session, the item above and a chain', () => {
    const items = [
      item('a', { waitFor: { kind: 'session', sessionId: 'fix' }, autoStart: true }),
      item('b', { waitFor: { kind: 'item', itemId: 'a' }, autoStart: true }),
      item('c', { waitFor: { kind: 'project' }, autoStart: true }),
    ];
    const { entries } = states(items, [session('fix', true, { title: 'Fix login' })]);
    expect(entries.map((e) => [e.label, e.detail, e.autoStart])).toEqual([
      ['starts after “Fix login”', 'Starts after “Fix login”', true],
      ['starts after the item above', 'Starts after the item above', true],
      ['starts after “Fix login”', 'Starts after “Fix login”', true],
    ]);
    // Started: the next one follows its session.
    const chained = states(items.slice(1), [session('fix', false), session('a-run', true, { title: 'Prompt a' })], { started: [{ itemId: 'a', sessionId: 'a-run' }] });
    expect(chained.entries[0]).toMatchObject({ state: 'waiting', label: 'starts after “Prompt a”', blockers: ['a-run'] });
  });

  it('shows an item held at the focus limit as waiting for a free slot, and one at a usage limit as waiting for the reset', () => {
    const items = [item('a', { waitFor: { kind: 'session', sessionId: 'fix' }, autoStart: true })];
    const done = [session('fix', false)];
    expect(states(items, done, { outcomes: { fix: 'clean' }, focusHeld: ['a'] }).entries[0]).toMatchObject({ state: 'waiting', label: FOCUS_HELD_LABEL, hold: 'focus', baseState: 'ready' });
    const limited = queueStates({
      items,
      sessions: done,
      started: [],
      projectName: () => 'switchboard',
      limitOf: () => ({ profileId: 'default', kind: 'five_hour', resetsAt: NOW + 3_600_000, since: NOW, message: null, sessionIds: [] }),
      now: NOW,
    });
    expect(limited.entries[0]).toMatchObject({ state: 'waiting', hold: 'limit', baseState: 'ready' });
    expect(limited.entries[0]!.label).toMatch(/^usage limit until /);
  });

  it("can't start by itself while it waits for nothing, or for a session Switchboard doesn't run", () => {
    const sessions = [session('deploy', true, { title: 'Deploy check', elsewhere: 'terminal' }), session('ide', true, { title: 'Refactor', elsewhere: 'app', projectRoot: '/work/other' })];
    const started = [{ itemId: 'x', sessionId: 'deploy' }];
    expect(autoStartBlock({ kind: 'none' }, { cwd: '/work/switchboard', sessions, started })).toBe('Choose what it waits for first.');
    expect(autoStartBlock({ kind: 'session', sessionId: 'deploy' }, { cwd: '/work/switchboard', sessions, started })).toBe(
      '“Deploy check” runs in the terminal, so Switchboard can\'t tell when it finishes. Start this one yourself.',
    );
    expect(autoStartBlock({ kind: 'session', sessionId: 'ide' }, { cwd: '/work/switchboard', sessions, started })).toMatch(/runs in another app/);
    expect(autoStartBlock({ kind: 'item', itemId: 'x' }, { cwd: '/work/switchboard', sessions, started })).toMatch(/^“Deploy check”/);
    expect(autoStartBlock({ kind: 'project' }, { cwd: '/work/switchboard', sessions, started })).toMatch(/^“Deploy check”/);
    expect(autoStartBlock({ kind: 'project' }, { cwd: '/work/web', sessions, started })).toBeNull();
    // Blocked, the item reads as one you start yourself.
    const entry = states([item('a', { waitFor: { kind: 'session', sessionId: 'deploy' }, autoStart: true })], sessions).entries[0]!;
    expect(entry).toMatchObject({ autoStart: false, label: 'after “Deploy check”' });
    expect(entry.autoBlocked).toMatch(/runs in the terminal/);
  });

  it('gives each row a label for screen readers', () => {
    const items = [item('a', { prompt: 'Run the tests', waitFor: { kind: 'session', sessionId: 'fix' }, autoStart: true }), item('b', { prompt: 'Write the changelog', waitFor: { kind: 'none' } })];
    const { entries } = states(items, [session('fix', true, { title: 'Fix login' })]);
    expect(queueRowLabel(entries[0]!)).toBe('Run the tests. Starts by itself after Fix login');
    expect(queueRowLabel(entries[1]!)).toBe('Write the changelog');
    const held = states(items.slice(0, 1), [session('fix', false)], { focusHeld: ['a'], outcomes: { fix: 'clean' } }).entries[0]!;
    expect(queueRowLabel(held)).toBe('Run the tests. Starts by itself, waits for a free slot (focus limit)');
  });
});
