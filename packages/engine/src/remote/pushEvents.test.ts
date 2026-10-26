import { describe, expect, it } from 'vitest';
import type { CatchUp } from '@seshboard/protocol';
import { finishedLine, needsYouLine, promptAnswers, pushTargets, TurnEnds } from './pushEvents.ts';

const card = (signals: Partial<CatchUp['signals']> = {}, change: Partial<CatchUp> = {}): CatchUp => ({
  sessionId: 's',
  turnId: 't',
  generatedAt: 1,
  source: 'model',
  state: 'finished',
  ask: '',
  did: [],
  skipped: [],
  need: { kind: 'commit', title: '', text: '' },
  signals: { tests: { state: 'passed', passed: 14 }, diff: null, outOfScope: [], scope: null, plan: null, ...signals },
  reviewMinutes: 2,
  ...change,
});

describe('push wording', () => {
  it('says what a prompt asks', () => {
    expect(needsYouLine({ toolName: 'Bash', input: { command: 'npm publish --tag beta\nsecond line' } })).toBe('Allow Bash: npm publish --tag beta');
    expect(needsYouLine({ toolName: 'Edit', input: { file_path: 'src/a.ts' } })).toBe('Allow Edit: src/a.ts');
    expect(needsYouLine({ toolName: 'mcp__x__y', input: {} })).toBe('Allow mcp__x__y?');
    expect(needsYouLine({ toolName: 'AskUserQuestion', input: { questions: [{ question: 'Which cache?' }] } })).toBe('Question: Which cache?');
    expect(needsYouLine({ toolName: 'ExitPlanMode', input: { plan: '...' } })).toBe('Claude has a plan. Ready to start?');
    expect(needsYouLine({ toolName: 'Bash', input: { command: 'x'.repeat(300) } }).length).toBe(120);
  });

  it('lets a tool prompt be answered from the notification, but not a question or a plan', () => {
    expect(promptAnswers({ requestId: 'r1', toolName: 'Bash' })).toEqual({ requestId: 'r1', answers: true });
    expect(promptAnswers({ requestId: 'r2', toolName: 'AskUserQuestion' })).toEqual({ requestId: 'r2', answers: false });
    expect(promptAnswers({ requestId: 'r3', toolName: 'ExitPlanMode' })).toEqual({ requestId: 'r3', answers: false });
  });

  it('sums up a finished turn from its catch-up', () => {
    expect(finishedLine(card())).toBe('14 tests passed · ~2 min to review');
    expect(finishedLine(card({ tests: { state: 'failed', failed: 2, passed: 3 } }))).toBe('2 tests fail · ~2 min to review');
    expect(finishedLine(card({ tests: { state: 'notRun' } }, { need: { kind: 'none', title: '', text: '' } }))).toBe('Nothing to review');
    expect(finishedLine(card({}, { state: 'error' }))).toBe('Finished with errors · 14 tests passed · ~2 min to review');
    expect(finishedLine(null)).toBe('Claude finished a turn.');
  });
});

describe('TurnEnds', () => {
  it('sees a turn end when a working or waiting session goes idle', () => {
    const ends = new TurnEnds();
    expect(ends.ended('a', 'starting')).toBe(false);
    expect(ends.ended('a', 'running')).toBe(false);
    expect(ends.ended('a', 'idle')).toBe(true);
    expect(ends.ended('a', 'idle')).toBe(false);
    expect(ends.ended('a', 'needs-you')).toBe(false);
    expect(ends.ended('a', 'idle')).toBe(true);
    expect(ends.ended('b', 'idle')).toBe(false);
  });
});

describe('pushTargets', () => {
  const subs = [
    { deviceId: 'phone', needsYou: true, finished: false },
    { deviceId: 'tablet', needsYou: true, finished: true },
    { deviceId: 'revoked', needsYou: true, finished: true },
  ];
  const known = new Set(['phone', 'tablet']);

  it('sends each kind to the devices that turned it on, and that still exist', () => {
    expect(pushTargets(subs, 'needs-you', new Set(), known).map((s) => s.deviceId)).toEqual(['phone', 'tablet']);
    expect(pushTargets(subs, 'finished', new Set(), known).map((s) => s.deviceId)).toEqual(['tablet']);
  });

  it('skips a device that has the app on screen', () => {
    expect(pushTargets(subs, 'needs-you', new Set(['phone']), known).map((s) => s.deviceId)).toEqual(['tablet']);
  });
});
