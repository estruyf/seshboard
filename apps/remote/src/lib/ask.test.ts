import { describe, expect, it } from 'vitest';
import type { AskThread } from '@switchboard/protocol/remote-client';
import { answering, asQuote, closed, currentThread, EMPTY_ASK, lastQuestion, newThread, opened, pickedThread, threadRows, withAsked, withEvent, withoutItem, withQuote, withThreads, type SessionAsk } from './ask.ts';

const thread = (id: string, createdAt: number, questions: string[]): AskThread => ({
  id,
  title: questions[0] ?? '',
  createdAt,
  items: questions.map((question, i) => ({ id: `${id}-${i}`, question, answer: `About ${question}`, at: createdAt + i })),
});
const loaded = (...threads: AskThread[]): SessionAsk => withThreads(EMPTY_ASK, { threads });

describe('Ask panel state', () => {
  it('shows the latest thread until another is picked, and a new thread starts empty', () => {
    let state = loaded(thread('t2', 2_000, ['Why this approach?']), thread('t1', 1_000, ['What changed so far?', 'and the release script?']));
    expect(currentThread(state)?.id).toBe('t2');
    state = pickedThread(state, 't1');
    expect(currentThread(state)?.id).toBe('t1');
    expect(currentThread(state)?.items).toHaveLength(2);
    expect(lastQuestion(state)).toBe('and the release script?');
    state = newThread(state);
    expect(currentThread(state)).toBeNull();
    expect(lastQuestion(state)).toBeNull();
    // The other threads stay in Earlier threads.
    expect(threadRows(state).map((r) => [r.id, r.count, r.current])).toEqual([
      ['t2', 1, false],
      ['t1', 2, false],
    ]);
    expect(pickedThread(state, 'gone')).toBe(state);
  });

  it('opens on the intro before any question', () => {
    const state = opened(loaded());
    expect(state.open).toBe(true);
    expect(currentThread(state)).toBeNull();
    expect(threadRows(state)).toEqual([]);
  });

  it('streams an answer into its question, drops what came before a reset, and ends with the whole answer', () => {
    let state = withAsked(opened(loaded()), { threadId: 't1', id: 'q1', at: 5, question: 'Which files did it touch?' });
    expect(currentThread(state)).toMatchObject({ id: 't1', title: 'Which files did it touch?', items: [{ id: 'q1', status: 'answering', answer: '' }] });
    expect(answering(state)).toBe(true);
    state = withEvent(state, { sessionId: 's', threadId: 't1', id: 'q1', delta: 'Let me look.' });
    state = withEvent(state, { sessionId: 's', threadId: 't1', id: 'q1', reset: true });
    state = withEvent(state, { sessionId: 's', threadId: 't1', id: 'q1', delta: 'Two ' });
    state = withEvent(state, { sessionId: 's', threadId: 't1', id: 'q1', delta: 'files.' });
    expect(currentThread(state)!.items[0]!.answer).toBe('Two files.');
    state = withEvent(state, { sessionId: 's', threadId: 't1', id: 'q1', done: true, answer: 'Two files: a.ts and b.ts.' });
    expect(currentThread(state)!.items[0]).toMatchObject({ status: 'done', answer: 'Two files: a.ts and b.ts.' });
    expect(answering(state)).toBe(false);
    // Open the whole time: no dot.
    expect(state.ready).toBe(false);
    // Another window's question (or one this window doesn't know yet) leaves it as it is.
    expect(withEvent(state, { sessionId: 's', threadId: 't1', id: 'other', delta: 'x' })).toBe(state);
  });

  it('puts the dot on the Ask button when an answer ends while the panel is closed, and clears it on open', () => {
    let state = closed(withAsked(opened(loaded()), { threadId: 't1', id: 'q1', at: 5, question: 'What is left to do?' }));
    state = withEvent(state, { sessionId: 's', threadId: 't1', id: 'q1', delta: 'A test.' });
    expect(state.ready).toBe(false);
    state = withEvent(state, { sessionId: 's', threadId: 't1', id: 'q1', done: true, answer: 'A test.' });
    expect(state.ready).toBe(true);
    state = opened(state);
    expect(state.ready).toBe(false);
  });

  it('shows an error in its question, and a retry takes it out of the thread', () => {
    let state = withAsked(opened(loaded()), { threadId: 't1', id: 'q1', at: 5, question: 'Why?' });
    state = withEvent(state, { sessionId: 's', threadId: 't1', id: 'q1', delta: 'Partly' });
    state = withEvent(state, { sessionId: 's', threadId: 't1', id: 'q1', done: true, error: 'Claude took too long to answer.' });
    expect(currentThread(state)!.items[0]).toMatchObject({ status: 'error', answer: '', error: 'Claude took too long to answer.' });
    state = withoutItem(state, 't1', 'q1');
    expect(currentThread(state)!.items).toEqual([]);
  });

  it('asks a follow-up at the end of its thread, which comes on screen', () => {
    let state = pickedThread(loaded(thread('t2', 2_000, ['Newer?']), thread('t1', 1_000, ['What changed so far?'])), 't2');
    state = withAsked(state, { threadId: 't1', id: 'q9', at: 9_000, question: 'and the release script?' });
    expect(currentThread(state)!.items.map((i) => i.question)).toEqual(['What changed so far?', 'and the release script?']);
    expect(state.threads.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('keeps what is still answering when the engine’s list comes in, and loses a thread that is gone', () => {
    let state = withAsked(loaded(thread('t1', 1_000, ['First?'])), { threadId: 't1', id: 'q2', at: 1_500, question: 'Second?' });
    state = withAsked(state, { threadId: 'new', id: 'q3', at: 3_000, question: 'New one?' });
    // The engine keeps answered questions only: the two still answering stay.
    state = withThreads(state, { threads: [thread('t1', 1_000, ['First?'])] });
    expect(state.threads.map((t) => [t.id, t.items.map((i) => i.question)])).toEqual([
      ['new', ['New one?']],
      ['t1', ['First?', 'Second?']],
    ]);
    // Once answered, the list has them; a picked thread that was dropped leaves the latest on screen.
    state = pickedThread(state, 't1');
    state = withThreads({ ...state, threads: [] }, { threads: [thread('t3', 4_000, ['Other?'])] });
    expect(state.threadId).toBeUndefined();
    expect(currentThread(state)?.id).toBe('t3');
  });

  it('marks failed questions from the engine as errors', () => {
    const state = loaded({ id: 't1', title: 'Why?', createdAt: 1, items: [{ id: 'q1', question: 'Why?', answer: '', at: 1, error: 'Claude could not answer.' }] });
    expect(currentThread(state)!.items[0]).toMatchObject({ status: 'error', error: 'Claude could not answer.' });
  });

  it('quotes an answer at the end of the message box, with a line for your words', () => {
    expect(asQuote('Two files.\n\n\n\nBoth tests.  ')).toBe('> Two files.\n>\n> Both tests.');
    expect(withQuote('', 'Two files.')).toBe('> Two files.\n\n');
    expect(withQuote('Fix this:', 'Two files.')).toBe('Fix this:\n\n> Two files.\n\n');
    expect(withQuote('Fix this:\n', 'Two files.')).toBe('Fix this:\n\n> Two files.\n\n');
    expect(withQuote('Keep', '  \n ')).toBe('Keep');
  });
});
