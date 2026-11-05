import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrations } from '../db/migrations.ts';
import { parseSkimAnswer, SkimHighlights, skimInput, stubSkim, type SkimRequest } from './skimHighlights.ts';

describe('parseSkimAnswer', () => {
  it('reads the numbers, in order and without repeats', () => {
    expect(parseSkimAnswer('{"keep":[4,1,4]}', 5)).toEqual([1, 4]);
    expect(parseSkimAnswer('Here you go:\n```json\n{"keep":[2]}\n```', 5)).toEqual([2]);
  });
  it('leaves out numbers that do not exist', () => {
    expect(parseSkimAnswer('{"keep":[0,2,9,1.5,"3"]}', 5)).toEqual([2]);
  });
  it.each(['', 'no json', '{"keep":[]}', '{"keep":[9]}', '{"keep":"1"}', '{broken}'])('gives nothing for %s', (text) => {
    expect(parseSkimAnswer(text, 5)).toBeNull();
  });
});

describe('skimInput', () => {
  it('cuts a long message, never the reply', () => {
    const outline = 'x'.repeat(5000);
    const input = JSON.parse(skimInput('m'.repeat(5000), outline)) as { message: string; reply: string };
    expect(input.message).toHaveLength(1500);
    expect(input.reply).toBe(outline);
  });
});

describe('stubSkim', () => {
  it('answers in the shape Haiku must', () => {
    const answer = stubSkim(skimInput('Add it', '[1] I went through it.\n- [2] Rows stay.'))!;
    expect(parseSkimAnswer(answer, 2)).toEqual([2]);
  });
});

describe('SkimHighlights', () => {
  let dir: string;
  let db: DatabaseSync;
  let calls: string[];
  let answer: string | null;
  let canAsk: boolean;
  let highlights: SkimHighlights;
  const request = (over: Partial<SkimRequest> = {}): SkimRequest => ({ sessionId: 's1', replyKey: 'r1', total: 3, ask: true, message: 'Why?', outline: '[1] A.\n[2] B.\n[3] C.', ...over });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skim-'));
    db = new DatabaseSync(join(dir, 'cache.db'));
    db.exec(migrations.at(-1)!);
    calls = [];
    answer = '{"keep":[2]}';
    canAsk = true;
    highlights = new SkimHighlights({
      db,
      canAsk: () => canAsk,
      ask: async (_sessionId, input) => {
        calls.push(input);
        return answer;
      },
    });
  });
  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('asks once per reply and keeps the answer', async () => {
    expect(await highlights.get(request())).toEqual({ state: 'ready', keep: [2] });
    expect(await highlights.get(request())).toEqual({ state: 'ready', keep: [2] });
    expect(calls).toHaveLength(1);
  });

  it('shares a call between two windows on one reply', async () => {
    const answers = await Promise.all([highlights.get(request()), highlights.get(request())]);
    expect(answers.map((a) => a.keep)).toEqual([[2], [2]]);
    expect(calls).toHaveLength(1);
  });

  it('never calls Haiku without ask, and still gives what is stored', async () => {
    expect(await highlights.get(request({ ask: false }))).toEqual({ state: 'none', keep: null });
    expect(calls).toHaveLength(0);
    await highlights.get(request());
    expect(await highlights.get(request({ ask: false }))).toEqual({ state: 'ready', keep: [2] });
  });

  it('never calls Haiku for a session without a Claude Code login', async () => {
    canAsk = false;
    expect(await highlights.get(request())).toEqual({ state: 'none', keep: null });
    expect(calls).toHaveLength(0);
  });

  it('does not keep a failed call, so the reply can be asked about again', async () => {
    answer = null;
    expect(await highlights.get(request())).toEqual({ state: 'failed', keep: null });
    answer = 'not json';
    expect(await highlights.get(request())).toEqual({ state: 'failed', keep: null });
    answer = '{"keep":[1]}';
    expect(await highlights.get(request())).toEqual({ state: 'ready', keep: [1] });
    expect(calls).toHaveLength(3);
  });

  it('asks again when the reply has another number of sentences', async () => {
    await highlights.get(request());
    answer = '{"keep":[4]}';
    expect(await highlights.get(request({ total: 4 }))).toEqual({ state: 'ready', keep: [4] });
  });

  it('forgets a deleted session', async () => {
    await highlights.get(request());
    highlights.forget('s1');
    expect(await highlights.get(request({ ask: false }))).toEqual({ state: 'none', keep: null });
  });
});
