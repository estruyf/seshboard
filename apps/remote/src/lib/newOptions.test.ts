import { describe, expect, it } from 'vitest';
import { optionsSummary, startState, type SummaryInput } from './newOptions.ts';
import type { Choice } from './options.ts';

const defaults: Choice = { profileId: 'default', model: null, effort: null, permissionMode: 'auto', worktree: false };
const input = (change: Partial<SummaryInput> = {}, choice: Partial<Choice> = {}): SummaryInput => ({
  choice: { ...defaults, ...choice },
  defaults,
  baseProfile: 'default',
  profile: 'Personal',
  model: 'Default model',
  effort: null,
  mode: 'Auto',
  branch: 'dev',
  branchPicked: false,
  pipeline: null,
  ...change,
});
const texts = (parts: { text: string; changed: boolean }[]) => parts.map((p) => (p.changed ? `*${p.text}*` : p.text)).join(' · ');

describe('the Options summary', () => {
  it('sums up the defaults on two lines, nothing marked', () => {
    const summary = optionsSummary(input());
    expect(texts(summary.first)).toBe('Personal · Default model · Auto');
    expect(texts(summary.second)).toBe('This folder on dev · one session');
    expect(summary.label).toBe('Personal · Default model · Auto, This folder on dev · one session');
  });

  it('marks what differs from the defaults', () => {
    expect(texts(optionsSummary(input({ model: 'Opus' }, { model: 'opus' })).first)).toBe('Personal · *Opus* · Auto');
    expect(texts(optionsSummary(input({ profile: 'Work' }, { profileId: 'work' })).first)).toBe('*Work* · Default model · Auto');
    expect(texts(optionsSummary(input({ mode: 'Plan' }, { permissionMode: 'plan' })).first)).toBe('Personal · Default model · *Plan*');
    expect(texts(optionsSummary(input({ effort: 'High' }, { effort: 'high' })).first)).toBe('Personal · Default model · *High* · Auto');
    expect(texts(optionsSummary(input({}, { worktree: true })).second)).toBe('*New worktree* · one session');
    expect(texts(optionsSummary(input({ branch: 'main', branchPicked: true })).second)).toBe('*This folder on main* · one session');
  });

  it('leaves out the profile with only one, and the branch when it is not known', () => {
    const summary = optionsSummary(input({ profile: null, branch: null }));
    expect(texts(summary.first)).toBe('Default model · Auto');
    expect(texts(summary.second)).toBe('This folder · one session');
  });

  it('says the pipeline instead of where it works', () => {
    expect(texts(optionsSummary(input({ pipeline: 'Plan, execute, validate' })).second)).toBe('*Runs as Plan, execute, validate*');
  });
});

describe('Start', () => {
  const ready = { connected: true, project: true, text: 'Fix the test', busy: false, reading: false };

  it('is dim with an empty box, and says why', () => {
    expect(startState({ ...ready, text: '' })).toEqual({ ready: false, reason: 'Type a message first' });
    expect(startState({ ...ready, text: '   \n' })).toEqual({ ready: false, reason: 'Type a message first' });
  });

  it('is ready once there is text', () => {
    expect(startState(ready)).toEqual({ ready: true, reason: null });
  });

  it('waits for the connection, a project and the attachments', () => {
    expect(startState({ ...ready, connected: false }).reason).toBe('Waiting for the connection');
    expect(startState({ ...ready, project: false }).reason).toBe('Pick a project first');
    expect(startState({ ...ready, reading: true }).reason).toBe('Reading the attachments…');
    expect(startState({ ...ready, busy: true }).ready).toBe(false);
  });
});
