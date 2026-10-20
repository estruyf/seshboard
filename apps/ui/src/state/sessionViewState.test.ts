import { describe, expect, it } from 'vitest';
import { EMPTY_ASK } from './ask.ts';
import { applyView, collectView, parseView, sameView, type SessionViewState, type ViewSlices } from './sessionViewState.ts';

const none = (): ViewSlices => ({
  changes: new Set(),
  ask: new Map(),
  agents: new Map(),
  commands: new Map(),
  tabs: new Map(),
  tab: 'changes',
  terminalOpen: new Set(),
  terminalMaximized: new Set(),
  terminalTab: new Map(),
});

const closed: SessionViewState = {
  changes: false,
  ask: false,
  askThread: 'latest',
  agents: false,
  agent: null,
  commands: false,
  command: null,
  tab: 'changes',
  terminal: false,
  terminalMaximized: false,
  terminalTab: null,
};

const busy: SessionViewState = {
  changes: true,
  ask: true,
  askThread: { id: 't1' },
  agents: true,
  agent: 'toolu_1',
  commands: true,
  command: 'task_9',
  tab: 'agents',
  terminal: true,
  terminalMaximized: true,
  terminalTab: 'term-3',
};

describe('collecting a session view', () => {
  it('is all closed for a session that opened nothing', () => {
    expect(collectView('a', none())).toEqual(closed);
  });

  it('reads every panel of the session and none of another', () => {
    const slices: ViewSlices = {
      changes: new Set(['a', 'b']),
      ask: new Map([['a', { ...EMPTY_ASK, open: true, threadId: 't1' }]]),
      agents: new Map([['a', { open: true, picked: 'toolu_1' }]]),
      commands: new Map([['a', { open: true, picked: 'task_9' }]]),
      tabs: new Map([['a', 'agents' as const]]),
      tab: 'ask',
      terminalOpen: new Set(['a']),
      terminalMaximized: new Set(['a']),
      terminalTab: new Map([['a', 'term-3']]),
    };
    expect(collectView('a', slices)).toEqual(busy);
    expect(collectView('c', slices)).toEqual({ ...closed, tab: 'ask' });
  });

  it('tells a new Ask thread from the latest one', () => {
    const ask = (threadId: string | null | undefined) => collectView('a', { ...none(), ask: new Map([['a', { ...EMPTY_ASK, threadId }]]) }).askThread;
    expect(ask(undefined)).toBe('latest');
    expect(ask(null)).toBe('new');
    expect(ask('t2')).toEqual({ id: 't2' });
  });

  it('keeps a mod pane in front, and a closed terminal from being maximized', () => {
    const view = collectView('a', { ...none(), tabs: new Map([['a', 'mod:pane-1' as const]]), terminalMaximized: new Set(['a']) });
    expect(view.tab).toBe('mod:pane-1');
    expect(view.terminalMaximized).toBe(false);
  });

  it('leaves sizes out', () => {
    expect(Object.keys(collectView('a', none())).sort()).toEqual(Object.keys(closed).sort());
    expect(JSON.stringify(collectView('a', none()))).not.toMatch(/width|height|dock/i);
  });
});

describe('applying a session view', () => {
  it('opens every panel as it was, and reads back the same', () => {
    const slices = applyView('a', busy, none());
    expect(collectView('a', slices)).toEqual(busy);
  });

  it('closes what was open', () => {
    const open = applyView('a', busy, none());
    const slices = applyView('a', { ...closed, tab: 'agents' }, open);
    expect(collectView('a', slices)).toMatchObject({ changes: false, ask: false, agents: false, commands: false, terminal: false, terminalMaximized: false });
  });

  it('keeps the agent that was picked in a panel that is closed, as the panel does', () => {
    const slices = applyView('a', { ...closed, agent: 'toolu_1' }, none());
    expect(slices.agents.get('a')).toEqual({ open: false, picked: 'toolu_1' });
  });

  it('touches only the session it is for', () => {
    const before: ViewSlices = { ...none(), changes: new Set(['b']), agents: new Map([['b', { open: true, picked: null }]]), terminalOpen: new Set(['b']), tabs: new Map([['b', 'ask' as const]]) };
    const after = applyView('a', busy, before);
    expect(collectView('b', after)).toEqual(collectView('b', before));
    expect(after.changes.has('b')).toBe(true);
  });

  it("keeps the window's own tab: a view carries only its session's", () => {
    const after = applyView('a', busy, { ...none(), tab: 'ask' });
    expect(after.tab).toBe('ask');
  });

  it('returns the very same parts when nothing changes, so no store updates', () => {
    const slices = applyView('a', busy, none());
    const again = applyView('a', busy, slices);
    expect(again.changes).toBe(slices.changes);
    expect(again.ask).toBe(slices.ask);
    expect(again.agents).toBe(slices.agents);
    expect(again.commands).toBe(slices.commands);
    expect(again.tabs).toBe(slices.tabs);
    expect(again.terminalOpen).toBe(slices.terminalOpen);
    expect(again.terminalMaximized).toBe(slices.terminalMaximized);
    expect(again.terminalTab).toBe(slices.terminalTab);
  });

  it('adds nothing for a session with nothing open', () => {
    const slices = none();
    const after = applyView('a', closed, slices);
    expect(after.ask).toBe(slices.ask);
    expect(after.agents).toBe(slices.agents);
    expect(after.commands).toBe(slices.commands);
    expect(after.tabs).toBe(slices.tabs);
  });

  it('puts a terminal that opens last among the open ones, and leaves one that is open where it is', () => {
    const kept = applyView('a', { ...closed, terminal: true }, { ...none(), terminalOpen: new Set(['b', 'a', 'c']) });
    expect([...kept.terminalOpen]).toEqual(['b', 'a', 'c']);
    const opened = applyView('a', { ...closed, terminal: true }, { ...none(), terminalOpen: new Set(['b']) });
    expect([...opened.terminalOpen]).toEqual(['b', 'a']);
  });

  it('keeps the unread dot off an Ask panel that opens, and the threads it has loaded', () => {
    const loaded = { ...EMPTY_ASK, loaded: true, ready: true, threads: [{ id: 't1', title: 'Q', createdAt: 1, items: [] }] };
    const after = applyView('a', { ...closed, ask: true }, { ...none(), ask: new Map([['a', loaded]]) });
    expect(after.ask.get('a')).toMatchObject({ open: true, ready: false, loaded: true });
    expect(after.ask.get('a')?.threads).toHaveLength(1);
  });

  it('leaves the terminal tab alone when the view has none', () => {
    const before: ViewSlices = { ...none(), terminalTab: new Map([['a', 'term-1']]) };
    expect(applyView('a', closed, before).terminalTab).toBe(before.terminalTab);
  });
});

describe('comparing and checking a view', () => {
  it('compares by what they say', () => {
    expect(sameView(busy, { ...busy, askThread: { id: 't1' } })).toBe(true);
    expect(sameView(busy, { ...busy, askThread: 'new' })).toBe(false);
    expect(sameView(busy, closed)).toBe(false);
  });

  it('survives going through JSON, as it does through main', () => {
    expect(parseView(JSON.parse(JSON.stringify(busy)))).toEqual(busy);
    expect(parseView(JSON.parse(JSON.stringify(closed)))).toEqual(closed);
  });

  it('refuses what is not a view', () => {
    expect(parseView(null)).toBeNull();
    expect(parseView('open')).toBeNull();
    expect(parseView({})).toBeNull();
    expect(parseView({ ...busy, changes: 'yes' })).toBeNull();
    expect(parseView({ ...busy, askThread: { id: '' } })).toBeNull();
    expect(parseView({ ...busy, askThread: 'other' })).toBeNull();
    expect(parseView({ ...busy, agent: 4 })).toBeNull();
  });

  it('turns a tab it does not know into Changes', () => {
    expect(parseView({ ...busy, tab: 'bogus' })?.tab).toBe('changes');
    expect(parseView({ ...busy, tab: 'mod:abc' })?.tab).toBe('mod:abc');
  });
});
