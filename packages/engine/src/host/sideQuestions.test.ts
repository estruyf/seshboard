import { mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ASK_THREADS_KEPT, threadTitle, type AskEvent } from '@seshboard/protocol';
import { openCacheDatabase, type CacheDatabase } from '../db/database.ts';
import { migrations } from '../db/migrations.ts';
import { breakdown } from '../usage/usageQuery.ts';
import { Asker, askPrompt, AskStore, isReadOnlyTool, readUsage, stubAnswer, sumByModel, type AskResult, type AskText } from './sideQuestions.ts';

const dirs: string[] = [];
const caches: CacheDatabase[] = [];
afterEach(() => {
  // Closed first: Windows won't delete a folder with an open database in it.
  caches.splice(0).forEach((c) => c.close());
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const cachePath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-ask-'));
  dirs.push(dir);
  return join(dir, 'cache.sqlite');
};
const openCache = (path: string) => {
  const cache = openCacheDatabase(path);
  caches.push(cache);
  return cache;
};

const until = async (check: () => boolean, timeoutMs = 2000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const tokens = { input: 3, output: 40, cacheRead: 9_000, cacheWrite: 120 };

/** The asker with a real store and a scripted Claude Code. */
function setup(options: { answer?: (prompt: string, onText: (text: AskText) => void) => Promise<AskResult>; stub?: boolean; path?: string } = {}) {
  const cache = openCache(options.path ?? cachePath());
  const store = new AskStore(cache.db);
  const events: AskEvent[] = [];
  const prompts: Array<{ sessionId: string; prompt: string }> = [];
  const recorded: Array<{ sessionId: string; id: string }> = [];
  const asker = new Asker({
    store,
    ask: (sessionId, prompt, onText) => {
      prompts.push({ sessionId, prompt });
      if (options.answer) return options.answer(prompt, onText);
      const question = prompt.split('\n').at(-1)!;
      onText({ delta: `About ${question}` });
      return Promise.resolve({ answer: `About ${question}`, usage: [{ model: 'claude-opus-5-5', tokens }] });
    },
    emit: (event) => events.push(event),
    recordUsage: (sessionId, id, usage) => {
      recorded.push({ sessionId, id });
      store.recordUsage('scope', sessionId, id, 5_000_000, usage);
    },
    stub: options.stub,
    stubDelayMs: 1,
    log: () => {},
  });
  const done = (id: string) => events.find((e) => e.id === id && e.done);
  return { cache, store, events, prompts, recorded, asker, done };
}

describe('Asker', () => {
  it('starts a thread, streams the answer and keeps it', async () => {
    const t = setup();
    const { threadId, id } = t.asker.ask('s1', 'What changed so far?');
    await until(() => !!t.done(id));
    expect(t.events).toEqual([
      { sessionId: 's1', threadId, id, delta: 'About What changed so far?' },
      { sessionId: 's1', threadId, id, done: true, answer: 'About What changed so far?' },
    ]);
    expect(t.asker.list('s1').threads).toMatchObject([{ id: threadId, title: 'What changed so far?', items: [{ id, question: 'What changed so far?', answer: 'About What changed so far?' }] }]);
    expect(t.asker.list('s2').threads).toEqual([]);
  });

  it('sends the earlier questions and answers of the same thread with a follow-up, and not those of another thread', async () => {
    const t = setup();
    const first = t.asker.ask('s1', 'Which files did it touch?');
    await until(() => !!t.done(first.id));
    const other = t.asker.ask('s1', 'Why this approach?');
    await until(() => !!t.done(other.id));
    expect(other.threadId).not.toBe(first.threadId);
    const follow = t.asker.ask('s1', 'and the release script?', first.threadId);
    await until(() => !!t.done(follow.id));
    expect(follow.threadId).toBe(first.threadId);
    expect(t.prompts[2]!.prompt).toContain('Question: Which files did it touch?\nAnswer: About Which files did it touch?');
    expect(t.prompts[2]!.prompt).not.toContain('Why this approach?');
    expect(t.prompts[2]!.prompt.endsWith('\n\nand the release script?')).toBe(true);
    // The first question of a thread goes alone.
    expect(t.prompts[0]!.prompt).not.toContain('Earlier questions');
    const thread = t.asker.list('s1').threads.find((th) => th.id === first.threadId)!;
    expect(thread.items.map((i) => i.question)).toEqual(['Which files did it touch?', 'and the release script?']);
  });

  it('starts a new thread when the one asked in is gone or belongs to another session', async () => {
    const t = setup();
    const a = t.asker.ask('s1', 'One?');
    await until(() => !!t.done(a.id));
    expect(t.asker.ask('s1', 'Two?', 'gone').threadId).not.toBe('gone');
    expect(t.asker.ask('s2', 'Three?', a.threadId).threadId).not.toBe(a.threadId);
  });

  it('keeps a failed question with its error, leaves it out of follow-ups, and replaces it when asked again', async () => {
    let fail = true;
    const t = setup({
      answer: async (prompt) => (fail ? { answer: null, error: 'Claude took too long to answer.', usage: [] } : { answer: `Fine: ${prompt.split('\n').at(-1)}`, usage: [] }),
    });
    const failed = t.asker.ask('s1', 'Why?');
    await until(() => !!t.done(failed.id));
    expect(t.done(failed.id)).toEqual({ sessionId: 's1', threadId: failed.threadId, id: failed.id, done: true, error: 'Claude took too long to answer.' });
    expect(t.asker.list('s1').threads[0]!.items).toEqual([{ id: failed.id, question: 'Why?', answer: '', at: expect.any(Number), error: 'Claude took too long to answer.' }]);

    fail = false;
    const again = t.asker.ask('s1', 'Why?', failed.threadId, failed.id);
    await until(() => !!t.done(again.id));
    expect(t.prompts[1]!.prompt).not.toContain('Earlier questions');
    expect(t.asker.list('s1').threads[0]!.items).toMatchObject([{ id: again.id, answer: 'Fine: Why?' }]);
  });

  it('turns a thrown error and an empty answer into an error', async () => {
    const thrown = setup({ answer: () => Promise.reject(new Error('Unknown session, or its folder is not recorded')) });
    const a = thrown.asker.ask('s1', 'Hm?');
    await until(() => !!thrown.done(a.id));
    expect(thrown.done(a.id)?.error).toBe('Unknown session, or its folder is not recorded');
    const empty = setup({ answer: async () => ({ answer: '   ', usage: [] }) });
    const b = empty.asker.ask('s1', 'Hm?');
    await until(() => !!empty.done(b.id));
    expect(empty.done(b.id)?.error).toBe('Claude had nothing to answer.');
  });

  it('records the tokens an answer used, for Usage, also when it failed', async () => {
    const t = setup({ answer: async () => ({ answer: null, error: 'Claude needed more steps', usage: [{ model: 'claude-opus-5-5', tokens }] }) });
    const a = t.asker.ask('s1', 'Everything?');
    await until(() => !!t.done(a.id));
    expect(t.recorded).toEqual([{ sessionId: 's1', id: a.id }]);
  });

  it('answers with the stub in pieces without asking Claude Code', async () => {
    const t = setup({ stub: true });
    const { id } = t.asker.ask('s1', 'Which flag did I add?');
    await until(() => !!t.done(id));
    expect(t.prompts).toEqual([]);
    const deltas = t.events.filter((e) => e.delta).map((e) => e.delta);
    expect(deltas.length).toBeGreaterThan(3);
    expect(deltas.join('')).toBe(stubAnswer('Which flag did I add?'));
    expect(t.done(id)?.answer).toBe(stubAnswer('Which flag did I add?'));
  });
});

describe('AskStore', () => {
  it('keeps a session’s threads, newest first, across a restart', async () => {
    const path = cachePath();
    const first = setup({ path });
    const a = first.asker.ask('s1', 'First?');
    await until(() => !!first.done(a.id));
    await new Promise((r) => setTimeout(r, 2));
    const b = first.asker.ask('s1', 'Second?');
    await until(() => !!first.done(b.id));
    first.cache.close();
    caches.splice(caches.indexOf(first.cache), 1);

    const cache = openCache(path);
    const threads = new AskStore(cache.db).threads('s1');
    expect(threads.map((th) => th.title)).toEqual(['Second?', 'First?']);
    expect(threads[1]!.items).toMatchObject([{ question: 'First?', answer: 'About First?' }]);
  });

  it(`keeps only the last ${ASK_THREADS_KEPT} threads of a session, with their questions`, () => {
    const cache = openCache(cachePath());
    const store = new AskStore(cache.db);
    for (let n = 0; n < ASK_THREADS_KEPT + 3; n++) {
      store.addThread('s1', { id: `t${n}`, title: `T${n}`, createdAt: 1_000 + n });
      store.addItem('s1', `t${n}`, { id: `q${n}`, question: `Q${n}`, answer: 'A', at: 1_000 + n });
    }
    store.addThread('s2', { id: 'other', title: 'Other', createdAt: 1 });
    const threads = store.threads('s1');
    expect(threads).toHaveLength(ASK_THREADS_KEPT);
    expect(threads[0]!.id).toBe(`t${ASK_THREADS_KEPT + 2}`);
    expect(threads.at(-1)!.id).toBe('t3');
    expect(cache.db.prepare("SELECT COUNT(*) AS n FROM side_questions WHERE session_id = 's1'").get()).toEqual({ n: ASK_THREADS_KEPT });
    expect(store.threads('s2')).toHaveLength(1);
    store.forget('s1');
    expect(store.threads('s1')).toEqual([]);
  });

  it('turns the side questions kept before threads into one thread per session', () => {
    const path = cachePath();
    const old = new DatabaseSync(path);
    old.exec(migrations.slice(0, 23).join('\n'));
    old.exec('PRAGMA user_version = 23');
    const insert = old.prepare('INSERT INTO side_questions (id, session_id, question, answer, at) VALUES (?, ?, ?, ?, ?)');
    insert.run('q2', 's1', 'And then?', 'Then this.', 2_000);
    insert.run('q1', 's1', `Which flag did I add in the first turn of this long session, and why did ${'it '.repeat(30)}matter?`, 'It was --cleanStart.', 1_000);
    insert.run('q3', 's2', 'Other?', 'Yes.', 3_000);
    old.close();

    const cache = openCache(path);
    const store = new AskStore(cache.db);
    const [thread] = store.threads('s1');
    expect(thread).toMatchObject({ id: 'btw-s1', createdAt: 1_000, items: [{ id: 'q1' }, { id: 'q2', answer: 'Then this.' }] });
    expect(thread!.title.length).toBe(80);
    expect(thread!.title.endsWith('…')).toBe(true);
    expect(store.history('btw-s1').map((e) => e.question)).toEqual([expect.stringMatching(/^Which flag/), 'And then?']);
    expect(store.threads('s2')).toMatchObject([{ id: 'btw-s2', title: 'Other?' }]);
  });

  it('shows the tokens as their own Side questions row in Usage, counting questions', async () => {
    const t = setup();
    const a = t.asker.ask('s1', 'One?');
    const b = t.asker.ask('s1', 'Two?');
    await until(() => !!t.done(a.id) && !!t.done(b.id));
    const lookup = { session: () => null, projectOf: () => '', projectName: () => '' };
    const result = breakdown(t.cache.db, { scope: 'scope', period: 'day', from: 0, to: 10_000_000, bucket: 'hour', groupBy: 'session', model: null, timeZone: 'UTC' }, lookup);
    expect(result.rows).toMatchObject([{ key: 'side-questions', label: 'Side questions', sideQuestions: { asked: 2 }, tokens: { input: 6, output: 80, cacheRead: 18_000, cacheWrite: 240 } }]);
    expect(result.totals.tokens.output).toBe(80);
  });
});

describe('read-only tools', () => {
  it('lets reading and git status, diff, log and show through, and nothing else', () => {
    for (const name of ['Read', 'Grep', 'Glob']) expect(isReadOnlyTool(name, {})).toBe(true);
    for (const command of [
      'git status',
      'git diff',
      'git diff --stat HEAD~3',
      'git log --oneline -20',
      'git show HEAD:src/a.ts',
      'git --no-pager log -p -- src',
      'git log --format="%h %s" --grep=\'fix it\'',
      'git diff --output-indicator-new=+ HEAD',
      'git diff -- *.ts',
    ]) {
      expect(isReadOnlyTool('Bash', { command })).toBe(true);
    }
    for (const name of ['Write', 'Edit', 'NotebookEdit', 'Task', 'Agent', 'WebFetch', 'mcp__github__create_issue', 'TodoWrite']) expect(isReadOnlyTool(name, {})).toBe(false);
    for (const command of [
      'git commit -am x',
      'git checkout .',
      'git push',
      'git status; rm -rf /',
      'git diff && touch x',
      'git log | sh',
      'git diff > out.txt',
      'git log $(rm x)',
      'git show `id`',
      'git diff --output=x.patch',
      'git diff --output x.patch',
      // The shell takes the quotes off, or makes the option from a brace or a file name.
      'git log -1 "--output=/tmp/x"',
      "git log -1 '--output'=/tmp/x",
      'git log -1 --out"put=/tmp/x"',
      'git log -1 {--output=/tmp/x,-1}',
      'git log -1 --out*',
      'git log "-1',
      'git -c core.pager=sh log',
      'rm -rf node_modules',
      'git status\nrm x',
    ]) {
      expect(isReadOnlyTool('Bash', { command }), command).toBe(false);
    }
    expect(isReadOnlyTool('Bash', {})).toBe(false);
  });
});

describe('helpers', () => {
  it('frames the question as one on the side, with the thread before it', () => {
    const prompt = askPrompt('and the release script?', [{ question: 'Which files?', answer: 'Two.' }]);
    expect(prompt).toMatch(/^<side-question>\n/);
    expect(prompt).toContain('Do not change anything');
    expect(prompt).toContain('still running, not interrupted');
    expect(prompt).toContain('Question: Which files?\nAnswer: Two.');
    expect(prompt.endsWith('</side-question>\n\nand the release script?')).toBe(true);
  });

  it('titles a thread with its first question on one line, shortened', () => {
    expect(threadTitle('  What   changed\nso far? ')).toBe('What changed so far?');
    const long = threadTitle('x'.repeat(200));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
  });

  it('reads a response’s tokens once per message id and adds them up per model', () => {
    expect(readUsage({ id: 'm1', model: 'opus', usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } })).toEqual({ key: 'm1', model: 'opus', tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 } });
    expect(readUsage({ id: 'm1', model: '<synthetic>', usage: { input_tokens: 1 } })).toBeNull();
    expect(readUsage({ model: 'opus', usage: {} })).toBeNull();
    const one = { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 };
    expect(sumByModel([{ model: 'a', tokens: one }, { model: 'a', tokens: one }, { model: 'b', tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }])).toEqual([{ model: 'a', tokens: { input: 2, output: 2, cacheRead: 2, cacheWrite: 2 } }]);
  });
});
