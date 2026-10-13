import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SIDE_QUESTIONS_KEPT, type SideQuestionEvent } from '@switchboard/protocol';
import { openCacheDatabase } from '../db/database.ts';
import { askSideQuestion, readAnswer, SideQuestions, SideQuestionStore, stubAnswer, type SideAnswer, type SideExchange } from './sideQuestions.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
const cachePath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-btw-'));
  dirs.push(dir);
  return join(dir, 'cache.sqlite');
};

const entry = (n: number) => ({ id: `q${n}`, question: `Question ${n}?`, answer: `Answer ${n}`, at: 1_000 + n });

const until = async (check: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

/** The runner with a real store and a scripted Claude Code. */
function setup(options: { version?: string | null; answer?: (question: string, history: SideExchange[]) => Promise<SideAnswer>; stub?: boolean } = {}) {
  const cache = openCacheDatabase(cachePath());
  const store = new SideQuestionStore(cache.db);
  const events: SideQuestionEvent[] = [];
  const asked: Array<{ sessionId: string; question: string; history: SideExchange[] }> = [];
  const runner = new SideQuestions({
    store,
    ask: (sessionId, question, history) => {
      asked.push({ sessionId, question, history });
      return options.answer ? options.answer(question, history) : Promise.resolve({ response: `About ${question}`, synthetic: false });
    },
    emit: (event) => events.push(event),
    claudeVersion: () => (options.version === undefined ? '2.1.296' : options.version),
    stub: options.stub,
    stubDelayMs: 1,
    log: () => {},
  });
  const done = (id: string) => events.find((e) => e.id === id && e.done);
  return { cache, store, events, asked, runner, done };
}

describe('Side question store', () => {
  it('keeps a session’s side questions, oldest first, across a reopen', () => {
    const path = cachePath();
    const first = openCacheDatabase(path);
    const store = new SideQuestionStore(first.db);
    store.add('s1', entry(2));
    store.add('s1', entry(1));
    store.add('s2', entry(3));
    first.close();

    const cache = openCacheDatabase(path);
    const reopened = new SideQuestionStore(cache.db);
    expect(reopened.list('s1')).toEqual([entry(1), entry(2)]);
    expect(reopened.list('s2')).toEqual([entry(3)]);
    reopened.forget('s1');
    expect(reopened.list('s1')).toEqual([]);
    expect(reopened.list('s2')).toHaveLength(1);
    cache.close();
  });

  it('keeps the last 50 per session, and sends the last 20 along', () => {
    const cache = openCacheDatabase(cachePath());
    const store = new SideQuestionStore(cache.db);
    for (let n = 1; n <= SIDE_QUESTIONS_KEPT + 5; n++) store.add('s1', entry(n));
    store.add('s2', entry(100));
    const kept = store.list('s1');
    expect(kept).toHaveLength(SIDE_QUESTIONS_KEPT);
    expect(kept[0]!.id).toBe('q6');
    expect(kept.at(-1)!.id).toBe(`q${SIDE_QUESTIONS_KEPT + 5}`);
    // Another session's are left alone.
    expect(store.list('s2')).toEqual([entry(100)]);
    const history = store.history('s1');
    expect(history).toHaveLength(20);
    expect(history.at(-1)).toEqual({ question: `Question ${SIDE_QUESTIONS_KEPT + 5}?`, response: `Answer ${SIDE_QUESTIONS_KEPT + 5}` });
    cache.close();
  });
});

describe('SideQuestions', () => {
  it('answers, keeps the answer and sends the earlier ones along', async () => {
    const t = setup();
    t.store.add('s1', entry(1));
    const { id, at } = t.runner.ask('s1', 'Which flag?');
    await until(() => !!t.done(id));
    expect(t.events.filter((e) => e.id === id)).toEqual([
      { sessionId: 's1', id, delta: 'About Which flag?' },
      { sessionId: 's1', id, done: true },
    ]);
    expect(t.asked).toEqual([{ sessionId: 's1', question: 'Which flag?', history: [{ question: 'Question 1?', response: 'Answer 1' }] }]);
    expect(t.runner.list('s1')).toEqual({ unsupported: false, items: [entry(1), { id, question: 'Which flag?', answer: 'About Which flag?', at }] });
    t.cache.close();
  });

  it('reports a failure with its reason and keeps nothing', async () => {
    const t = setup({ answer: () => Promise.reject(new Error('Claude Code is not signed in')) });
    const { id } = t.runner.ask('s1', 'Which flag?');
    await until(() => !!t.done(id));
    expect(t.done(id)).toEqual({ sessionId: 's1', id, done: true, error: 'Claude Code is not signed in' });
    expect(t.runner.list('s1').items).toEqual([]);
    t.cache.close();
  });

  it('shows Claude Code’s own messages as errors, not answers', async () => {
    const t = setup({ answer: async () => ({ response: '(API error: Overloaded)', synthetic: true }) });
    const { id } = t.runner.ask('s1', 'Which flag?');
    await until(() => !!t.done(id));
    expect(t.done(id)?.error).toBe('API error: Overloaded');
    expect(t.events.some((e) => e.id === id && e.delta)).toBe(false);
    expect(t.runner.list('s1').items).toEqual([]);
    t.cache.close();
  });

  it('can’t show earlier side questions on a Claude Code before 2.1.212, but still asks', async () => {
    const old = setup({ version: '2.1.211' });
    old.store.add('s1', entry(1));
    expect(old.runner.list('s1')).toEqual({ items: [], unsupported: true });
    const { id } = old.runner.ask('s1', 'Which flag?');
    await until(() => !!old.done(id));
    expect(old.done(id)?.error).toBeUndefined();
    old.cache.close();

    expect(setup({ version: '2.1.212' }).runner.list('s1').unsupported).toBe(false);
    // A version that isn't known yet isn't held against it.
    expect(setup({ version: null }).runner.list('s1').unsupported).toBe(false);
  });

  it('answers with the stub in pieces, without asking Claude Code', async () => {
    const t = setup({ stub: true, version: '1.0.0' });
    const { id } = t.runner.ask('s1', 'Which flag did we use?');
    await until(() => !!t.done(id));
    expect(t.asked).toEqual([]);
    const deltas = t.events.filter((e) => e.id === id && e.delta !== undefined);
    expect(deltas.length).toBeGreaterThan(5);
    expect(deltas.map((e) => e.delta).join('')).toBe(stubAnswer('Which flag did we use?'));
    expect(t.runner.list('s1').items.map((e) => e.answer)).toEqual([stubAnswer('Which flag did we use?')]);
    t.cache.close();
  });
});

describe('askSideQuestion', () => {
  it('uses the Query’s side question request, and says so when Claude Code has none', async () => {
    const calls: unknown[] = [];
    const query = { askSideQuestion: async (question: string, options: unknown) => (calls.push({ question, options }), { response: 'Yes', synthetic: false }) };
    await expect(askSideQuestion(query, 'Done?', [])).resolves.toEqual({ response: 'Yes', synthetic: false });
    expect(calls).toEqual([{ question: 'Done?', options: { history: [] } }]);
    await expect(askSideQuestion({}, 'Done?', [])).rejects.toThrow(/Update Claude Code/);
  });

  it('reads an empty answer as an error', () => {
    expect(readAnswer({ response: null, synthetic: false })).toEqual({ error: 'Claude had nothing to answer from yet.' });
    expect(readAnswer({ response: '  It was --cleanStart.  ', synthetic: false })).toEqual({ answer: 'It was --cleanStart.' });
  });
});
