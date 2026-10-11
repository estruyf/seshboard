import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { openCacheDatabase } from '../db/database.ts';
import { removeDir } from '../util/removeDir.ts';
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

function setup(transcripts: Record<string, RawSessionMessage[]>, versions: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'switchboard-search-'));
  dirs.push(dir);
  const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
  caches.push(cache);
  let reads = 0;
  const source = {
    list: async () => [],
    info: async () => undefined,
    messages: async (id: string) => (reads++, transcripts[id] ?? []),
  };
  const index = new SearchIndex(cache.db, source, () => Object.entries(versions).map(([id, version]) => ({ id, version })), () => {});
  return { index, reads: () => reads };
}

describe('searchableText and toFtsQuery', () => {
  it('keeps prose, drops reminders, interrupts and command output', () => {
    const msg = (role: 'user' | 'assistant', text: string) => ({ uuid: 'u', role, timestamp: null, parentToolUseId: null, model: null, blocks: [{ type: 'text' as const, text }] });
    expect(searchableText(msg('user', 'Fix login<system-reminder>secret</system-reminder>'))).toBe('Fix login');
    expect(searchableText(msg('user', '<command-name>/review</command-name><command-args>--fast</command-args>'))).toBe('/review --fast');
    expect(searchableText(msg('user', '<local-command-stdout>x</local-command-stdout>'))).toBeNull();
    expect(searchableText(msg('user', '[Request interrupted by user]'))).toBeNull();
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
        mine: [user('m1', 'a session I started in Switchboard')],
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
});
