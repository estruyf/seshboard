import { describe, expect, it } from 'vitest';
import type { CatchUp } from '@seshboard/protocol/client';
import {
  actionLabel,
  catchUpKey,
  catchUpShow,
  chipsOf,
  escapeStep,
  advancePass,
  nextInPass,
  passPosition,
  primaryAction,
  replyPlaceholder,
  reviewLabel,
  secondaryActions,
  stateLabel,
  suggestedNote,
  type KeyLike,
  type ShowContext,
} from './catchUpModel.ts';

const card = (patch: Partial<CatchUp> = {}, signals: Partial<CatchUp['signals']> = {}): CatchUp => ({
  sessionId: 's1',
  turnId: 't1',
  generatedAt: 0,
  source: 'model',
  state: 'finished',
  ask: 'Add a Needs review sort',
  did: ['Added a sort'],
  skipped: [],
  need: { kind: 'commit', title: 'Commit the changes', text: 'Ready to commit.' },
  signals: { tests: { state: 'passed', passed: 14, failed: 0 }, diff: { files: 6, add: 120, del: 40 }, outOfScope: [], scope: null, plan: 'followed', ...signals },
  reviewMinutes: 2,
  ...patch,
});
const need = (kind: CatchUp['need']['kind']) => ({ kind, title: 'x', text: 'y' });
const ctx = (patch: Partial<ShowContext> = {}): ShowContext => ({ enabled: true, folded: false, unread: true, working: false, waiting: false, collapsed: null, ...patch });
const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('when the catch-up shows', () => {
  it('shows the banner for an unread finish and an error', () => {
    expect(catchUpShow(card(), ctx())).toBe('full');
    expect(catchUpShow(card({ state: 'error' }), ctx({ unread: false }))).toBe('full');
  });

  it('leaves a session that waits for you to the permission card', () => {
    expect(catchUpShow(card({ state: 'waiting', need: need('permission') }), ctx({ waiting: true }))).toBeNull();
    // A finished card from before the request doesn't show over it either.
    expect(catchUpShow(card(), ctx({ waiting: true }))).toBeNull();
  });

  it('folds into the strip once read, or when you collapsed this turn', () => {
    expect(catchUpShow(card(), ctx({ unread: false }))).toBe('strip');
    expect(catchUpShow(card(), ctx({ collapsed: true }))).toBe('strip');
  });

  it('starts folded with Show catch-ups folded on, unless the turn ended with an error', () => {
    expect(catchUpShow(card(), ctx({ folded: true }))).toBe('strip');
    expect(catchUpShow(card({ state: 'error' }), ctx({ folded: true }))).toBe('full');
    expect(catchUpShow(card(), ctx({ folded: true, collapsed: false }))).toBe('full');
  });

  it('shows in full when you open a read session’s strip', () => {
    expect(catchUpShow(card(), ctx({ unread: false, collapsed: false }))).toBe('full');
  });

  it('shows nothing without a card, while Claude works, or for a request that is gone', () => {
    expect(catchUpShow(null, ctx())).toBeNull();
    expect(catchUpShow(card(), ctx({ working: true }))).toBeNull();
    expect(catchUpShow(card({ state: 'waiting', need: need('question') }), ctx({ waiting: false }))).toBeNull();
  });

  it('with summaries off, shows only when you ask for it, and folding hides it', () => {
    expect(catchUpShow(card(), ctx({ enabled: false }))).toBeNull();
    expect(catchUpShow(card(), ctx({ enabled: false, collapsed: false }))).toBe('full');
    expect(catchUpShow(card(), ctx({ enabled: false, collapsed: true }))).toBeNull();
  });
});

describe('what the banner says', () => {
  it('names the state in its colour', () => {
    expect(stateLabel(card(), false)).toEqual({ label: 'Finished', tone: 'unread' });
    expect(stateLabel(card({ state: 'error' }), false)).toEqual({ label: 'Finished with errors', tone: 'error' });
    expect(stateLabel(card(), true)).toEqual({ label: 'Committed', tone: 'ok' });
  });

  it('gives a review time, or none when nothing is needed', () => {
    expect(reviewLabel(card())).toBe('~2 min to review');
    expect(reviewLabel(card({ need: need('none') }))).toBe('Nothing to review');
  });

  it('shows the signals as chips, leaving out those that don’t apply', () => {
    expect(chipsOf(card()).map((c) => [c.text, c.tone])).toEqual([
      ['14 tests passed', 'ok'],
      ['+120 −40 · 6 files', 'neutral'],
      ['Followed the plan', 'ok'],
    ]);
    const failing = card({}, { tests: { state: 'failed', passed: 7, failed: 2 }, outOfScope: ['packages/engine/a.ts', 'README.md'], scope: 'apps/ui', plan: 'deviated', diff: null });
    expect(chipsOf(failing).map((c) => [c.text, c.tone, c.tooltip])).toEqual([
      ['2 of 9 tests fail', 'error', undefined],
      ['2 files outside apps/ui', 'caution', 'packages/engine/a.ts\nREADME.md'],
      ['Deviated from the plan', 'caution', undefined],
    ]);
    expect(chipsOf(card({}, { tests: { state: 'notRun' }, plan: null })).map((c) => c.text)).toEqual(['No tests run', '+120 −40 · 6 files']);
  });
});

describe('the actions', () => {
  it('has one primary action per kind of need', () => {
    expect(primaryAction('commit', false)).toBe('commit');
    expect(primaryAction('reply', false)).toBe('reply');
    expect(primaryAction('review', false)).toBe('review');
    expect(primaryAction('none', false)).toBe('archive');
    // After a commit there is only archiving left.
    expect(primaryAction('commit', true)).toBe('archive');
  });

  it('lists the others in order, without the primary and what doesn’t apply', () => {
    expect(secondaryActions(card(), { unread: true, committed: false })).toEqual(['review', 'reply', 'read', 'archive']);
    expect(secondaryActions(card({ need: need('review') }), { unread: false, committed: false })).toEqual(['commit', 'reply', 'archive']);
    expect(secondaryActions(card({ need: need('none') }, { diff: { files: 0, add: 0, del: 0 } }), { unread: true, committed: false })).toEqual(['reply', 'read']);
    expect(secondaryActions(card({ need: need('reply') }, { diff: null }), { unread: false, committed: false })).toEqual(['archive']);
    expect(secondaryActions(card(), { unread: false, committed: true })).toEqual(['review', 'reply']);
  });

  it('says Hide changes while the panel is open', () => {
    expect(actionLabel('review', { changesOpen: false })).toBe('Review changes');
    expect(actionLabel('review', { changesOpen: true })).toBe('Hide changes');
  });

  it('puts the session’s title in the reply placeholder', () => {
    expect(replyPlaceholder('Needs review sort')).toBe('Reply to Claude about Needs review sort…');
    expect(replyPlaceholder('x'.repeat(80)).length).toBeLessThan(90);
  });
});

describe('the keys', () => {
  const at = (target: 'view' | 'control' | 'elsewhere', extra: Partial<{ overlay: boolean; show: 'full' | 'strip' | null }> = {}) => ({ target, overlay: false, show: 'full' as const, ...extra });

  it('maps the banner’s keys', () => {
    expect(catchUpKey(key('Enter'), at('view'))).toEqual({ type: 'primary' });
    expect(catchUpKey(key('Escape'), at('view'))).toEqual({ type: 'escape' });
    expect(catchUpKey(key('d'), at('view'))).toEqual({ type: 'action', id: 'review' });
    expect(catchUpKey(key('c'), at('view'))).toEqual({ type: 'action', id: 'commit' });
    expect(catchUpKey(key('r'), at('view'))).toEqual({ type: 'action', id: 'reply' });
    expect(catchUpKey(key('u'), at('view'))).toEqual({ type: 'action', id: 'read' });
    expect(catchUpKey(key('e'), at('view'))).toEqual({ type: 'action', id: 'archive' });
    expect(catchUpKey(key(' '), at('view'))).toEqual({ type: 'space' });
    expect(catchUpKey(key('s'), at('view'))).toEqual({ type: 'skip' });
    expect(catchUpKey(key('n'), at('view'))).toEqual({ type: 'note' });
    expect(catchUpKey(key('x'), at('view'))).toBeNull();
  });

  it('never takes keys typed into the message box or another field, with a modifier, or under a dialog', () => {
    for (const k of ['Enter', 'Escape', 'c', ' ']) expect(catchUpKey(key(k), at('elsewhere'))).toBeNull();
    expect(catchUpKey(key('c', { metaKey: true }), at('view'))).toBeNull();
    expect(catchUpKey(key('Enter', { ctrlKey: true }), at('view'))).toBeNull();
    expect(catchUpKey(key('C', { shiftKey: true }), at('view'))).toBeNull();
    expect(catchUpKey(key('c'), at('view', { overlay: true }))).toBeNull();
    expect(catchUpKey(key('c', { isComposing: true }), at('view'))).toBeNull();
  });

  it('lets Enter and Space press a focused button', () => {
    expect(catchUpKey(key('Enter'), at('control'))).toBeNull();
    expect(catchUpKey(key(' '), at('control'))).toBeNull();
    expect(catchUpKey(key('c'), at('control'))).toEqual({ type: 'action', id: 'commit' });
  });

  it('in the strip, only shows the banner again, skips or runs its primary action', () => {
    expect(catchUpKey(key(' '), at('view', { show: 'strip' }))).toEqual({ type: 'space' });
    expect(catchUpKey(key('Enter'), at('view', { show: 'strip' }))).toEqual({ type: 'primary' });
    expect(catchUpKey(key('s'), at('view', { show: 'strip' }))).toEqual({ type: 'skip' });
    expect(catchUpKey(key('s'), at('elsewhere', { show: 'strip' }))).toBeNull();
    expect(catchUpKey(key('c'), at('view', { show: 'strip' }))).toBeNull();
    expect(catchUpKey(key('n'), at('view', { show: 'strip' }))).toBeNull();
    expect(catchUpKey(key('c'), at('view', { show: null }))).toBeNull();
  });

  it('closes things with Esc from the inside out: the reply, the Changes panel, Details, then the banner', () => {
    const all = { replying: true, changesOpen: true, detailsOpen: true, show: 'full' as const };
    expect(escapeStep(all)).toBe('leave-reply');
    expect(escapeStep({ ...all, replying: false })).toBe('close-changes');
    expect(escapeStep({ ...all, replying: false, changesOpen: false })).toBe('close-details');
    expect(escapeStep({ ...all, replying: false, changesOpen: false, detailsOpen: false })).toBe('collapse');
    // Folded, Esc is left to the rest of the view.
    expect(escapeStep({ replying: false, changesOpen: false, detailsOpen: false, show: 'strip' })).toBeNull();
  });
});

describe('going through sessions', () => {
  // To review (r1, r2), then Open (o1, o2), in the sidebar's order.
  const order = ['r1', 'r2', 'o1', 'o2'];

  it('goes to the first session left, To review before Open, leaving out the current one and those skipped', () => {
    expect(nextInPass(order, 'r1', new Set())).toBe('r2');
    expect(nextInPass(order, 'r2', new Set(['r1']))).toBe('o1');
    // Read, r1 moved down to Open: the next is still the first one at the top.
    expect(nextInPass(['r2', 'o1', 'r1', 'o2'], 'r1', new Set())).toBe('r2');
    expect(nextInPass(order, 'o2', new Set(['r1', 'r2', 'o1']))).toBeNull();
    expect(nextInPass([], 'x', new Set())).toBeNull();
  });

  it('remembers skipped sessions for the pass, and counts what you skipped or archived', () => {
    const first = advancePass(null, 'r1', 'skip', order);
    expect(first).toEqual({ current: 'r2', skipped: new Set(['r1']), handled: 1 });
    // Done on r2: it leaves the list, nothing more is skipped.
    const second = advancePass(first, 'r2', 'done', order);
    expect(second).toEqual({ current: 'o1', skipped: new Set(['r1']), handled: 2 });
    expect(advancePass(second, 'o1', 'skip', ['r1', 'o1', 'o2'])).toMatchObject({ current: 'o2', handled: 3 });
    // Nothing left: the pass ends.
    expect(advancePass({ current: 'o2', skipped: new Set(['r1', 'r2', 'o1']), handled: 3 }, 'o2', 'skip', order)).toBeNull();
  });

  it('starts a new pass when you skip from a session the pass isn\'t on', () => {
    expect(advancePass({ current: 'o2', skipped: new Set(['r1']), handled: 3 }, 'r2', 'skip', order)).toEqual({ current: 'r1', skipped: new Set(['r2']), handled: 1 });
  });

  it('says where you are: those done, this one, and those still to come', () => {
    expect(passPosition({ current: 'r1', skipped: new Set(), handled: 0 }, 'r1', order)).toEqual({ position: 1, total: 4 });
    expect(passPosition({ current: 'o1', skipped: new Set(['r1']), handled: 2 }, 'o1', ['r1', 'o1', 'o2'])).toEqual({ position: 3, total: 4 });
    // Not on this session, or no pass: nothing to say.
    expect(passPosition({ current: 'o1', skipped: new Set(), handled: 0 }, 'r1', order)).toBeNull();
    expect(passPosition(null, 'r1', order)).toBeNull();
  });
});

describe('Use as note', () => {
  it('offers what the catch-up needs from you, never when it needs nothing or the note says it already', () => {
    expect(suggestedNote(card(), null)).toBe('Commit the changes');
    expect(suggestedNote(card({ need: { kind: 'reply', title: '  Answer\nthe question ', text: '' } }), 'old')).toBe('Answer the question');
    expect(suggestedNote(card({ need: need('none') }), null)).toBeNull();
    expect(suggestedNote(card(), 'Commit the changes')).toBeNull();
  });
});
