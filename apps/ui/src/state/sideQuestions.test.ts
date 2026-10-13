import { describe, expect, it } from 'vitest';
import {
  browsable,
  chipLabel,
  closed,
  current,
  EMPTY_SIDE,
  moved,
  openedItem,
  openedLatest,
  position,
  withAsked,
  withEvent,
  withList,
  withoutItem,
  type SessionSide,
} from './sideQuestions.ts';

const stored = (n: number) => ({ id: `q${n}`, question: `Question ${n}?`, answer: `Answer ${n}`, at: n * 1000 });
const loaded = (count: number, unsupported = false): SessionSide => withList(EMPTY_SIDE, { items: Array.from({ length: count }, (_, i) => stored(i + 1)), unsupported });

describe('side question panel', () => {
  it('opens a bare /btw on the latest side question, and moves through them oldest first', () => {
    let state = openedLatest(loaded(3));
    expect(state.open).toBe(true);
    expect(current(state)?.id).toBe('q3');
    expect(position(state)).toEqual({ index: 2, count: 3 });
    state = moved(state, -1);
    expect(current(state)?.id).toBe('q2');
    state = moved(moved(state, -1), -1);
    // At the oldest, ‹ does nothing.
    expect(current(state)?.id).toBe('q1');
    state = moved(moved(state, 1), 1);
    expect(current(state)?.id).toBe('q3');
    expect(moved(state, 1)).toBe(state);
  });

  it('shows how to ask with a bare /btw before any was asked, and asks for a question on an older Claude Code', () => {
    expect(openedLatest(loaded(0)).view).toEqual({ kind: 'usage' });
    expect(current(openedLatest(loaded(0)))).toBeNull();
    // Even with side questions kept: this Claude Code can't show them.
    const old = withList(EMPTY_SIDE, { items: [], unsupported: true });
    expect(openedLatest(old).view).toEqual({ kind: 'needs-question' });
    expect(browsable(old)).toBe(0);
    expect(browsable(loaded(3))).toBe(3);
  });

  it('opens on a new side question, streams its answer in and keeps it last in the order', () => {
    let state = withAsked(loaded(2), { id: 'new', at: 9_000, question: 'Which flag?' });
    expect(state.open).toBe(true);
    expect(current(state)).toMatchObject({ id: 'new', status: 'answering', answer: '', mine: true });
    expect(position(state)).toEqual({ index: 2, count: 3 });
    state = withEvent(state, { sessionId: 's', id: 'new', delta: 'It was ' });
    state = withEvent(state, { sessionId: 's', id: 'new', delta: '`--cleanStart`.' });
    expect(current(state)).toMatchObject({ status: 'answering', answer: 'It was `--cleanStart`.' });
    state = withEvent(state, { sessionId: 's', id: 'new', done: true });
    expect(current(state)?.status).toBe('done');
    // Another window's answer isn't this window's to show.
    expect(withEvent(state, { sessionId: 's', id: 'other', delta: 'x' })).toBe(state);
  });

  it('keeps answering after Esc hides the panel, and the chip brings it back', () => {
    let state = withAsked(loaded(1), { id: 'new', at: 9_000, question: 'Which flag?' });
    state = closed(state);
    expect(state.open).toBe(false);
    expect(state.chip).toBe('new');
    const chipItem = state.items.find((i) => i.id === state.chip)!;
    expect(chipLabel(chipItem)).toBe('Answering');
    state = withEvent(withEvent(state, { sessionId: 's', id: 'new', delta: 'It was --cleanStart.' }), { sessionId: 's', id: 'new', done: true });
    expect(chipLabel(state.items.find((i) => i.id === state.chip)!)).toBe('Side answer ready');
    state = openedItem(state, state.chip!);
    expect(state.open).toBe(true);
    expect(state.chip).toBeNull();
    expect(current(state)).toMatchObject({ id: 'new', answer: 'It was --cleanStart.' });
  });

  it('leaves no chip after an answer was read, or after browsing earlier side questions', () => {
    expect(closed(openedLatest(loaded(2))).chip).toBeNull();
    const asked = withAsked(loaded(1), { id: 'new', at: 9_000, question: 'Which flag?' });
    expect(closed(withEvent(asked, { sessionId: 's', id: 'new', done: true })).chip).toBeNull();
  });

  it('keeps what this window asked when the list is read again, and swaps in what the engine kept', () => {
    let state = withAsked(loaded(1), { id: 'new', at: 9_000, question: 'Which flag?' });
    state = withList(state, { items: [stored(1)], unsupported: false });
    expect(state.items.map((i) => [i.id, i.status])).toEqual([
      ['q1', 'done'],
      ['new', 'answering'],
    ]);
    state = withEvent(withEvent(state, { sessionId: 's', id: 'new', delta: 'Yes' }), { sessionId: 's', id: 'new', done: true });
    state = withList(state, { items: [stored(1), { id: 'new', question: 'Which flag?', answer: 'Yes', at: 9_000 }], unsupported: false });
    expect(state.items.map((i) => i.id)).toEqual(['q1', 'new']);
    expect(state.items[1]).toMatchObject({ status: 'done', mine: true });
  });

  it('shows a failure in the panel until it is asked again', () => {
    let state = withAsked(loaded(1), { id: 'new', at: 9_000, question: 'Which flag?' });
    state = withEvent(state, { sessionId: 's', id: 'new', done: true, error: 'Claude Code is not signed in' });
    expect(current(state)).toMatchObject({ status: 'error', error: 'Claude Code is not signed in' });
    state = withoutItem(state, 'new');
    expect(state.items.map((i) => i.id)).toEqual(['q1']);
    expect(current(state)?.id).toBe('q1');
  });
});
