import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { openCacheDatabase } from '../db/database.ts';
import { removeDir } from '../util/removeDir.ts';
import { writeStub } from '@seshboard/protocol';
import { MARK_END, MARK_START, SearchIndex, searchableText, toFtsQuery } from './searchIndex.ts';

const user = (uuid: string, text: string): RawSessionMessage => ({ type: 'user', uuid, message: { role: 'user', content: text }, parent_tool_use_id: null });
const claude = (uuid: string, text: string): RawSessionMessage => ({ type: 'assistant', uuid, message: { role: 'assistant', content: [{ type: 'text', text }] }, parent_tool_use_id: null });

const dirs: string[] = [];
const caches: Array<{ close(): void }> = [];
afterEach(async () => {
  // Closed first: Windows won't delete a folder with an open database in it.
  caches.splice(0).forEach((cache) => cache.close());
  await Promise.all(dirs.splice(0).map((d) => removeDir(d)));
});

function setup(transcripts: Record<string, RawSessionMessage[]>, versions: Record<string, string>, extra: { writtenAt?: Record<string, number>; now?: () => number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-search-'));
  dirs.push(dir);
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  caches.push(cache);
  let reads = 0;
  const source = {
    list: async () => [],
    info: async () => undefined,
    messages: async (id: string) => (reads++, transcripts[id] ?? []),
  };
  const index = new SearchIndex(
    cache.db,
    source,
    () => Object.entries(versions).map(([id, version]) => ({ id, version, writtenAt: extra.writtenAt?.[id] ?? null })),
    () => {},
    undefined,
    { quietMs: 30_000, maxWaitMs: 300_000, ...(extra.now ? { now: extra.now } : {}) },
  );
  caches.push({ close: () => index.stop() });
  const all = (id: string) => cache.db.prepare('SELECT rowid, uuid FROM transcript_fts WHERE session_id = ? ORDER BY rowid').all(id) as Array<{ rowid: number; uuid: string }>;
  const rows = (id: string) => all(id).map((r) => r.uuid);
  const rowOf = (id: string, uuid: string) => all(id).find((r) => r.uuid === uuid)?.rowid;
  return { index, reads: () => reads, rows, rowOf };
}

describe('searchableText and toFtsQuery', () => {
  it('keeps prose, drops reminders, interrupts and command output', () => {
    const msg = (role: 'user' | 'assistant', text: string) => ({ uuid: 'u', role, timestamp: null, parentToolUseId: null, model: null, blocks: [{ type: 'text' as const, text }] });
    expect(searchableText(msg('user', 'Fix login<system-reminder>secret</system-reminder>'))).toBe('Fix login');
    expect(searchableText(msg('user', '<command-name>/review</command-name><command-args>--fast</command-args>'))).toBe('/review --fast');
    expect(searchableText(msg('user', '<local-command-stdout>x</local-command-stdout>'))).toBeNull();
    expect(searchableText(msg('user', '[Request interrupted by user]'))).toBeNull();
    expect(searchableText(msg('user', 'Another Claude session sent a message:\n<cross-session-message from=\"uds:/tmp/s.sock\" from-name=\"dev-2f\">\nKeep off versions.ts.\n</cross-session-message>\n\nThis came from another Claude session.'))).toBe('Keep off versions.ts.');
    // A linked session's brief is that session's: only what you typed is searched here.
    expect(searchableText(msg('user', `stack on @Usage cost\n\n${writeStub('Usage cost', 'id-1').replace('session: id-1', 'session: id-1\nbranch: worktree-usage-cost')}`))).toBe('stack on @Usage cost');
  });

  it('makes every word required, the last one a prefix, and keeps FTS syntax out', () => {
    expect(toFtsQuery('deploy the app')).toBe('"deploy" "the" "app"*');
    expect(toFtsQuery('NOT "x" OR (y)')).toBe('"NOT" "x" "OR" "y"*');
    expect(toFtsQuery('  ?! ')).toBeNull();
  });
});

describe('SearchIndex', () => {
  it('finds prompts and replies, and only re-reads changed transcripts', async () => {
    const { index, reads } = setup(
      {
        a: [user('a1', 'How do I deploy the dashboard?'), claude('a2', 'Run the deployment script with care.')],
        b: [user('b1', 'Rename the login button')],
      },
      { a: '1', b: '1' },
    );
    await index.sync();
    expect(reads()).toBe(2);
    expect(index.progress).toEqual({ indexed: 2, total: 2 });

    const hits = index.search('deplo', 10);
    expect(hits.map((h) => [h.sessionId, h.messageUuid, h.role]).sort()).toEqual([
      ['a', 'a1', 'user'],
      ['a', 'a2', 'assistant'],
    ]);
    expect(hits.find((h) => h.messageUuid === 'a1')!.snippet).toContain(`${MARK_START}deploy${MARK_END}`);
    expect(index.search('login button', 10).map((h) => h.messageUuid)).toEqual(['b1']);
    expect(index.search('', 10)).toEqual([]);

    // Nothing changed: nothing is read again.
    await index.sync();
    expect(reads()).toBe(2);
  });

  it('keeps hits to the given sessions before the limit, so others cannot take every place', async () => {
    const { index } = setup(
      {
        // Another app's long session that mentions the word far more often.
        other: Array.from({ length: 10 }, (_, i) => user(`o${i}`, 'session session session notes')),
        mine: [user('m1', 'a session I started in Seshboard')],
      },
      { other: '1', mine: '1' },
    );
    await index.sync();
    expect(index.search('session', 3).every((h) => h.sessionId === 'other')).toBe(true);
    expect(index.search('session', 3, ['mine']).map((h) => h.messageUuid)).toEqual(['m1']);
    expect(index.search('session', 3, [])).toEqual([]);
  });

  it('drops sessions that are gone', async () => {
    const versions: Record<string, string> = { a: '1' };
    const { index } = setup({ a: [user('a1', 'unique words here')] }, versions);
    await index.sync();
    expect(index.search('unique', 5)).toHaveLength(1);
    delete versions.a;
    await index.sync();
    expect(index.search('unique', 5)).toHaveLength(0);
  });

  it('BUDGET: adds only the new messages of a transcript that grew, and indexes it whole again after a rewrite', async () => {
    const transcripts = { a: [user('a1', 'first prompt'), claude('a2', 'first answer')] };
    const versions = { a: '1' };
    const { index, rows, rowOf } = setup(transcripts, versions);
    await index.sync();
    expect(rows('a')).toEqual(['a1', 'a2']);
    const first = rowOf('a', 'a1');
    // Grew: the last message indexed is indexed again (it may have been written in parts), the rest are added.
    transcripts.a = [...transcripts.a, user('a3', 'second prompt'), claude('a4', 'second answer')];
    versions.a = '2';
    await index.sync();
    expect(rows('a')).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(rowOf('a', 'a1')).toBe(first);
    expect(index.search('second', 5).map((h) => h.messageUuid).sort()).toEqual(['a3', 'a4']);
    expect(index.search('first', 5).map((h) => h.messageUuid).sort()).toEqual(['a1', 'a2']);
    // Rewound: an earlier message is gone and another took its place. Nothing of the old branch stays findable.
    transcripts.a = [user('a1', 'first prompt'), claude('b2', 'another answer')];
    versions.a = '3';
    await index.sync();
    expect(rows('a')).toEqual(['a1', 'b2']);
    expect(index.search('second', 5)).toEqual([]);
    // Shrank to fewer messages than were indexed.
    transcripts.a = [user('a1', 'first prompt')];
    versions.a = '4';
    await index.sync();
    expect(rows('a')).toEqual(['a1']);
  });

  it('indexes the last message again with the next ones, in case it was still being written', async () => {
    const transcripts = { a: [user('a1', 'question'), claude('a2', 'partial')] };
    const versions = { a: '1' };
    const { index, rows } = setup(transcripts, versions);
    await index.sync();
    transcripts.a = [user('a1', 'question'), claude('a2', 'partial then complete'), user('a3', 'thanks')];
    versions.a = '2';
    await index.sync();
    expect(rows('a')).toEqual(['a1', 'a2', 'a3']);
    expect(index.search('complete', 5).map((h) => h.messageUuid)).toEqual(['a2']);
  });

  it('BUDGET: waits for a session being written to be quiet, unless its turn ended', async () => {
    let now = 100_000;
    const writtenAt: Record<string, number> = { busy: now - 1_000, quiet: now - 60_000 };
    const versions: Record<string, string> = { busy: '1', quiet: '1' };
    const { index, reads } = setup({ busy: [user('x1', 'busy words')], quiet: [user('q1', 'quiet words')] }, versions, { writtenAt, now: () => now });
    await index.sync();
    expect(reads()).toBe(1);
    expect(index.search('busy', 5)).toEqual([]);
    expect(index.search('quiet', 5)).toHaveLength(1);
    // Its turn ended: indexed now.
    index.settled('busy');
    await index.sync();
    expect(index.search('busy', 5)).toHaveLength(1);
    expect(reads()).toBe(2);
    // Written again: it waits until it has been quiet long enough.
    writtenAt.busy = now;
    versions.busy = '2';
    await index.sync();
    expect(reads()).toBe(2);
    now += 31_000;
    await index.sync();
    expect(reads()).toBe(3);
  });

  it('indexes a session that is never quiet at least every five minutes', async () => {
    let now = 1_000_000;
    const writtenAt: Record<string, number> = { busy: now };
    const versions: Record<string, string> = { busy: '1' };
    const { index, reads } = setup({ busy: [user('x1', 'always busy')] }, versions, { writtenAt, now: () => now });
    await index.sync();
    expect(reads()).toBe(0);
    // Written every few seconds for four minutes: still waiting.
    for (let i = 0; i < 4; i++) {
      now += 60_000;
      writtenAt.busy = now - 2_000;
      versions.busy = String(i + 2);
      await index.sync();
    }
    expect(reads()).toBe(0);
    now += 61_000;
    writtenAt.busy = now - 2_000;
    await index.sync();
    expect(reads()).toBe(1);
    expect(index.search('busy', 5)).toHaveLength(1);
  });
});
