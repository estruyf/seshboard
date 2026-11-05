import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { openCacheDatabase } from '../db/database.ts';
import { mergeNotes, ProviderNotes } from './providerNotes.ts';

const at = (uuid: string, second: number, role: 'user' | 'assistant' = 'user'): RawSessionMessage => ({
  type: role,
  uuid,
  parent_tool_use_id: null,
  timestamp: new Date(Date.UTC(2026, 9, 30, 10, 0, second)).toISOString(),
  message: { role, content: [{ type: 'text', text: uuid }] },
});

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

describe('mergeNotes', () => {
  it('puts each note after the last message from before it, once', () => {
    const file = [at('u1', 1), at('a1', 2, 'assistant'), at('u2', 10)];
    const notes = [at('cmd', 5), at('answer', 5, 'assistant'), at('a1', 2, 'assistant')];
    expect(mergeNotes(file, notes).map((m) => m.uuid)).toEqual(['u1', 'a1', 'cmd', 'answer', 'u2']);
    expect(mergeNotes(file, [at('late', 20)]).map((m) => m.uuid).at(-1)).toBe('late');
    expect(mergeNotes(file, [])).toEqual(file);
  });
});

describe('ProviderNotes', () => {
  it('keeps a session\'s notes in a real database, in order, until the session is deleted', () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-notes-')));
    const cache = openCacheDatabase(join(dir, 'cache.sqlite'));
    cleanups.push(() => (cache.close(), rmSync(dir, { recursive: true, force: true })));
    const notes = new ProviderNotes(cache.db);
    notes.add('s1', [at('cmd', 5), at('answer', 5, 'assistant')]);
    // The same lines again (a reconnect) are kept once.
    notes.add('s1', [at('cmd', 5)]);
    notes.add('s2', [at('other', 1)]);
    expect(notes.list('s1').map((m) => m.uuid)).toEqual(['cmd', 'answer']);
    notes.forget('s1');
    expect(notes.list('s1')).toEqual([]);
    expect(notes.list('s2')).toHaveLength(1);
  });
});
