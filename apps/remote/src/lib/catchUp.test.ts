import { describe, expect, it } from 'vitest';
import type { CatchUp } from '@switchboard/protocol/remote-client';
import { catchUpChips, commitTitle, reviewLabel, showsCatchUp, stateLabel } from './catchUp.ts';

const card = (change: Partial<CatchUp> = {}, signals: Partial<CatchUp['signals']> = {}): CatchUp => ({
  sessionId: 's',
  turnId: 't',
  generatedAt: 1,
  source: 'model',
  state: 'finished',
  ask: 'Add rate limits to the webhooks.',
  did: [],
  skipped: [],
  need: { kind: 'commit', title: 'Commit the changes', text: '' },
  signals: { tests: { state: 'passed', passed: 14 }, diff: { files: 6, add: 120, del: 40 }, outOfScope: [], scope: null, plan: null, ...signals },
  reviewMinutes: 2,
  ...change,
});

describe('catch-up wording', () => {
  it('says how the turn ended and how long it takes to review', () => {
    expect(stateLabel(card())).toEqual({ label: 'Finished', tone: 'unread' });
    expect(stateLabel(card({ state: 'error' }))).toEqual({ label: 'Finished with errors', tone: 'error' });
    expect(stateLabel(card(), true)).toEqual({ label: 'Committed', tone: 'ok' });
    expect(reviewLabel(card())).toBe('~2 min to review');
    expect(reviewLabel(card({ need: { kind: 'none', title: '', text: '' } }))).toBe('Nothing to review');
  });

  it('shows the tests and the diff as chips', () => {
    expect(catchUpChips(card())).toEqual([
      { id: 'tests', text: '14 tests passed', tone: 'ok' },
      { id: 'diff', text: '+120 −40 · 6 files', tone: 'neutral' },
    ]);
    expect(catchUpChips(card({}, { tests: { state: 'failed', passed: 3, failed: 1 }, diff: null }))).toEqual([{ id: 'tests', text: '1 of 4 tests fail', tone: 'error' }]);
    expect(catchUpChips(card({}, { tests: { state: 'notRun' } }))[0]).toEqual({ id: 'tests', text: 'No tests run', tone: 'neutral' });
  });

  it('shows only for a turn that ended, while nothing else goes on', () => {
    expect(showsCatchUp(card(), false, false)).toBe(true);
    expect(showsCatchUp(card(), true, false)).toBe(false);
    expect(showsCatchUp(card(), false, true)).toBe(false);
    expect(showsCatchUp(card({ state: 'waiting' }), false, false)).toBe(false);
    expect(showsCatchUp(null, false, false)).toBe(false);
  });

  it('starts a commit message from the ask', () => {
    expect(commitTitle(card())).toBe('Add rate limits to the webhooks');
    expect(commitTitle(card({ ask: `${'x'.repeat(80)}\nmore` })).length).toBe(72);
    expect(commitTitle(null)).toBe('');
  });
});
