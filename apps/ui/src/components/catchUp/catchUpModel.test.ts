import { describe, expect, it } from 'vitest';
import type { CatchUp } from '@switchboard/protocol/client';
import {
  actionLabel,
  catchUpKey,
  catchUpShow,
  chipsOf,
  escapeStep,
  nextAfterArchive,
  primaryActions,
  replyPlaceholder,
  reviewLabel,
  secondaryActions,
  stateLabel,
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
const ctx = (patch: Partial<ShowContext> = {}): ShowContext => ({ layout: 'card', unread: true, working: false, waiting: false, collapsed: null, ...patch });
const key = (k: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });

describe('when the catch-up shows', () => {
  it('shows in full for an unread finish, an error and a session that waits for you', () => {
    expect(catchUpShow(card(), ctx())).toBe('full');
    expect(catchUpShow(card({ state: 'error' }), ctx({ unread: false }))).toBe('full');
    expect(catchUpShow(card({ state: 'waiting', need: need('permission') }), ctx({ unread: false, waiting: true }))).toBe('full');
  });

  it('folds into the strip once read, or when you collapsed this turn', () => {
    expect(catchUpShow(card(), ctx({ unread: false }))).toBe('strip');
    expect(catchUpShow(card(), ctx({ collapsed: true }))).toBe('strip');
  });

  it('shows in full when you open a read session’s strip', () => {
    expect(catchUpShow(card(), ctx({ unread: false, collapsed: false }))).toBe('full');
  });

  it('shows nothing without a card, with the layout off, while Claude works, or for a request that is gone', () => {
    expect(catchUpShow(null, ctx())).toBeNull();
    expect(catchUpShow(card(), ctx({ layout: 'off' }))).toBeNull();
    expect(catchUpShow(card(), ctx({ working: true }))).toBeNull();
    expect(catchUpShow(card({ state: 'waiting', need: need('question') }), ctx({ waiting: false }))).toBeNull();
  });
});

describe('what the card says', () => {
  it('names the state in its colour', () => {
    expect(stateLabel(card(), false)).toEqual({ label: 'Finished', tone: 'unread' });
    expect(stateLabel(card({ state: 'error' }), false)).toEqual({ label: 'Finished with errors', tone: 'error' });
    expect(stateLabel(card({ state: 'waiting', need: need('question') }), false)).toEqual({ label: 'Needs you · question', tone: 'warn' });
    expect(stateLabel(card({ state: 'waiting', need: need('permission') }), false)).toEqual({ label: 'Needs you · permission', tone: 'warn' });
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
    expect(primaryActions('commit', false)).toEqual(['commit']);
    expect(primaryActions('reply', false)).toEqual(['reply']);
    expect(primaryActions('permission', false)).toEqual(['allow', 'deny']);
    expect(primaryActions('question', false)).toEqual(['answer']);
    expect(primaryActions('review', false)).toEqual(['review']);
    expect(primaryActions('none', false)).toEqual(['archive']);
    // After a commit there is only archiving left.
    expect(primaryActions('commit', true)).toEqual(['archive']);
  });

  it('lists the others in order, without the primary and what doesn’t apply', () => {
    expect(secondaryActions(card(), { unread: true, committed: false })).toEqual(['review', 'reply', 'read', 'archive', 'expand']);
    expect(secondaryActions(card({ need: need('review') }), { unread: false, committed: false })).toEqual(['commit', 'reply', 'archive', 'expand']);
    expect(secondaryActions(card({ need: need('none') }, { diff: { files: 0, add: 0, del: 0 } }), { unread: true, committed: false })).toEqual(['reply', 'read', 'expand']);
    expect(secondaryActions(card({ need: need('reply') }, { diff: null }), { unread: false, committed: false })).toEqual(['archive', 'expand']);
    expect(secondaryActions(card({ state: 'waiting', need: need('permission') }), { unread: true, committed: false })).toEqual(['review', 'expand']);
    expect(secondaryActions(card(), { unread: false, committed: true })).toEqual(['review', 'reply', 'expand']);
  });

  it('says Hide changes while the panel is open', () => {
    expect(actionLabel('review', { changesOpen: false, layout: 'card' })).toBe('Review changes');
    expect(actionLabel('review', { changesOpen: true, layout: 'card' })).toBe('Hide changes');
  });

  it('opens the next session after archiving, in the sidebar’s order', () => {
    expect(nextAfterArchive(['a', 'b', 'c'], 'b')).toBe('c');
    expect(nextAfterArchive(['a', 'b', 'c'], 'c')).toBe('b');
    expect(nextAfterArchive(['a'], 'a')).toBeNull();
    expect(nextAfterArchive(['a', 'b'], 'x')).toBe('a');
  });

  it('puts the session’s title in the reply placeholder', () => {
    expect(replyPlaceholder('Needs review sort')).toBe('Reply to Claude about Needs review sort…');
    expect(replyPlaceholder('x'.repeat(80)).length).toBeLessThan(90);
  });
});

describe('the keys', () => {
  const at = (target: 'view' | 'control' | 'elsewhere', extra: Partial<{ overlay: boolean; show: 'full' | 'strip' | null; question: boolean; options: number }> = {}) => ({
    target,
    overlay: false,
    show: 'full' as const,
    question: false,
    options: 0,
    ...extra,
  });

  it('maps the card’s keys', () => {
    expect(catchUpKey(key('Enter'), at('view'))).toEqual({ type: 'primary' });
    expect(catchUpKey(key('Escape'), at('view'))).toEqual({ type: 'escape' });
    expect(catchUpKey(key('d'), at('view'))).toEqual({ type: 'action', id: 'review' });
    expect(catchUpKey(key('c'), at('view'))).toEqual({ type: 'action', id: 'commit' });
    expect(catchUpKey(key('r'), at('view'))).toEqual({ type: 'action', id: 'reply' });
    expect(catchUpKey(key('u'), at('view'))).toEqual({ type: 'action', id: 'read' });
    expect(catchUpKey(key('e'), at('view'))).toEqual({ type: 'action', id: 'archive' });
    expect(catchUpKey(key(' '), at('view'))).toEqual({ type: 'action', id: 'expand' });
    expect(catchUpKey(key('x'), at('view'))).toBeNull();
  });

  it('never takes keys typed into the message box or another field, with a modifier, or under a dialog', () => {
    for (const k of ['Enter', 'Escape', 'c', ' ', 'ArrowDown', '1']) expect(catchUpKey(key(k), at('elsewhere', { question: true, options: 3 }))).toBeNull();
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

  it('moves between and picks a question’s options', () => {
    expect(catchUpKey(key('ArrowDown'), at('view', { question: true, options: 3 }))).toEqual({ type: 'option', step: 1 });
    expect(catchUpKey(key('ArrowUp'), at('view', { question: true, options: 3 }))).toEqual({ type: 'option', step: -1 });
    expect(catchUpKey(key('2'), at('view', { question: true, options: 3 }))).toEqual({ type: 'pick', index: 1 });
    expect(catchUpKey(key('4'), at('view', { question: true, options: 3 }))).toBeNull();
    expect(catchUpKey(key('ArrowDown'), at('view'))).toBeNull();
  });

  it('in the strip, only shows the card again or runs its primary action', () => {
    expect(catchUpKey(key(' '), at('view', { show: 'strip' }))).toEqual({ type: 'action', id: 'expand' });
    expect(catchUpKey(key('Enter'), at('view', { show: 'strip' }))).toEqual({ type: 'primary' });
    expect(catchUpKey(key('c'), at('view', { show: 'strip' }))).toBeNull();
    expect(catchUpKey(key('c'), at('view', { show: null }))).toBeNull();
  });

  it('closes things with Esc from the inside out: the reply, the Changes panel, Details, then the card', () => {
    const all = { replying: true, changesOpen: true, detailsOpen: true, show: 'full' as const };
    expect(escapeStep(all)).toBe('leave-reply');
    expect(escapeStep({ ...all, replying: false })).toBe('close-changes');
    expect(escapeStep({ ...all, replying: false, changesOpen: false })).toBe('close-details');
    expect(escapeStep({ ...all, replying: false, changesOpen: false, detailsOpen: false })).toBe('collapse');
    // Folded, Esc is left to the rest of the view.
    expect(escapeStep({ replying: false, changesOpen: false, detailsOpen: false, show: 'strip' })).toBeNull();
  });
});
