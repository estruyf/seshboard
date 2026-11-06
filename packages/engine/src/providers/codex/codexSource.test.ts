import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Turn } from './protocol.ts';
import { fakeAppServer, thread } from './codexFakes.ts';
import { codexOrigin, codexSessionSource } from './codexSource.ts';

// The converter is its own module with its own tests: here it only has to show which turns it was given, in order.
vi.mock('./codexEvents.ts', () => ({
  codexMessages: (turns: Turn[]) => turns.map((t) => ({ type: 'user', uuid: t.id, parent_tool_use_id: null, message: { content: t.id } })),
}));

const A = '019a0000-0000-7000-8000-00000000000a';
const B = '019a0000-0000-7000-8000-00000000000b';
const C = '019a0000-0000-7000-8000-00000000000c';
const D = '019a0000-0000-7000-8000-00000000000d';
const E = '019a0000-0000-7000-8000-00000000000e';

const turn = (id: string): Turn => ({ id, items: [], itemsView: 'full', status: 'completed', error: null, startedAt: null, completedAt: null, durationMs: null });

describe('codexSessionSource', () => {
  it('lists every page, leaves out subagents, ephemeral threads and threads without a prompt, and never lists from the database alone', async () => {
    const pages: Record<string, { data: ReturnType<typeof thread>[]; nextCursor: string | null }> = {
      first: { data: [thread(A, { name: 'Parser fix', gitInfo: { sha: null, branch: 'fix/parser', originUrl: null } }), thread(B, { parentThreadId: A, source: { subAgent: { thread_spawn: {} } } })], nextCursor: 'c2' },
      c2: { data: [thread(C, { ephemeral: true }), thread(D, { preview: '  ' }), thread(E, { source: 'vscode', originator: 'codex_vscode', cwd: '' })], nextCursor: null },
    };
    const server = fakeAppServer({ 'thread/list': ({ cursor }) => pages[cursor ?? 'first']! });
    const source = codexSessionSource(server);
    const listed = await source.list();
    expect(listed.map((s) => s.sessionId)).toEqual([A, E]);
    expect(listed[0]).toEqual({
      sessionId: A,
      provider: 'codex',
      summary: 'Parser fix',
      customTitle: 'Parser fix',
      firstPrompt: `Prompt of ${A.slice(0, 4)}`,
      lastModified: 1_762_400_100_000,
      createdAt: 1_762_400_000_000,
      cwd: '/work/app',
      gitBranch: 'fix/parser',
      origin: 'cli',
    });
    // No name: the preview is the title, and an empty folder is no folder.
    expect(listed[1]).toMatchObject({ summary: `Prompt of ${E.slice(0, 4)}`, origin: 'ide' });
    expect(listed[1]).not.toHaveProperty('customTitle');
    expect(listed[1]).not.toHaveProperty('cwd');
    expect(server.calls).toHaveLength(2);
    for (const { params } of server.calls) {
      expect(params).toMatchObject({ archived: false, sourceKinds: ['cli', 'vscode', 'exec', 'appServer', 'unknown'] });
      expect(params).not.toHaveProperty('useStateDbOnly');
    }
    expect(server.calls.map((c) => (c.params as { cursor: string | null }).cursor)).toEqual([null, 'c2']);
  });

  it('stops at a cursor that repeats', async () => {
    const server = fakeAppServer({ 'thread/list': () => ({ data: [thread(A)], nextCursor: 'same' }) });
    expect((await codexSessionSource(server).list()).map((s) => s.sessionId)).toEqual([A]);
    expect(server.calls).toHaveLength(2);
  });

  it('reads the rollout file size when the thread names one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-source-'));
    try {
      const path = join(dir, `rollout-2026-11-06T10-00-00-${A}.jsonl`);
      writeFileSync(path, '12345');
      const server = fakeAppServer({ 'thread/read': () => ({ thread: thread(A, { path }) }) });
      expect(await codexSessionSource(server).info(A)).toMatchObject({ sessionId: A, fileSize: 5 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('maps where a thread was started', () => {
    expect(codexOrigin({ source: 'cli' })).toBe('cli');
    expect(codexOrigin({ source: 'vscode' })).toBe('ide');
    expect(codexOrigin({ source: 'exec' })).toBe('unknown');
    expect(codexOrigin({ source: 'appServer' })).toBe('unknown');
    expect(codexOrigin({ source: { custom: 'x' } })).toBe('unknown');
    // Started from Seshboard (its `clientInfo.name`), whatever the source.
    expect(codexOrigin({ source: 'appServer', originator: 'seshboard' })).toBe('app');
  });

  it('reads one thread without its turns, and none that is a subagent', async () => {
    const server = fakeAppServer({ 'thread/read': ({ threadId }) => ({ thread: thread(threadId, threadId === B ? { parentThreadId: A } : {}) }) });
    const source = codexSessionSource(server);
    expect(await source.info(A)).toMatchObject({ sessionId: A, provider: 'codex' });
    expect(await source.info(B)).toBeUndefined();
    expect(server.calls[0]).toEqual({ method: 'thread/read', params: { threadId: A, includeTurns: false } });
    // Not an id Codex could have: not asked.
    expect(await source.info('not-a-thread')).toBeUndefined();
    expect(server.calls).toHaveLength(2);
  });

  it('reads every page of turns, oldest first, with every item', async () => {
    const pages: Record<string, { data: Turn[]; nextCursor: string | null }> = {
      first: { data: [turn('t1'), turn('t2')], nextCursor: 'n' },
      n: { data: [turn('t3')], nextCursor: null },
    };
    const server = fakeAppServer({ 'thread/turns/list': ({ cursor }) => pages[cursor ?? 'first']! });
    const messages = await codexSessionSource(server).messages(A);
    expect(messages.map((m) => m.uuid)).toEqual(['t1', 't2', 't3']);
    expect(server.calls.map((c) => c.params)).toEqual([
      { threadId: A, cursor: null, sortDirection: 'asc', itemsView: 'full' },
      { threadId: A, cursor: 'n', sortDirection: 'asc', itemsView: 'full' },
    ]);
  });

  it('degrades quietly when Codex is missing or fails: empty, logged once until it works again; a conversation says it failed', async () => {
    const log = vi.fn();
    let fail = true;
    const server = fakeAppServer({
      'thread/list': () => {
        if (fail) throw new Error('codex is not installed');
        return { data: [thread(A)], nextCursor: null };
      },
      'thread/read': () => {
        throw new Error('timed out');
      },
      'thread/turns/list': () => {
        throw new Error('crashed');
      },
    });
    const source = codexSessionSource(server, { log });
    expect(await source.list()).toEqual([]);
    expect(await source.list()).toEqual([]);
    expect(await source.info(A)).toBeUndefined();
    // Not an empty transcript: the window says it couldn't read it (the transcript hub logs it).
    await expect(source.messages(A)).rejects.toThrow("Couldn't read this Codex session: crashed");
    await expect(source.turns(A)).rejects.toThrow('crashed');
    expect(log.mock.calls).toEqual([
      ['warn', 'Codex: listing sessions failed: codex is not installed'],
      ['warn', 'Codex: reading a thread failed: timed out'],
    ]);
    // Works again, then fails for a moment: the sidebar keeps what it listed last, and the new failure is logged.
    fail = false;
    expect((await source.list()).map((s) => s.sessionId)).toEqual([A]);
    fail = true;
    expect((await source.list()).map((s) => s.sessionId)).toEqual([A]);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('keeps the last whole list when a later page fails, and lists a thread whose file it can\'t stat', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-source-'));
    try {
      // A file where a folder should be: stat throws ENOTDIR, not "missing".
      writeFileSync(join(dir, 'file'), '');
      let second = (): { data: ReturnType<typeof thread>[]; nextCursor: string | null } => ({ data: [thread(B, { path: join(dir, 'file', 'rollout.jsonl') })], nextCursor: null });
      const server = fakeAppServer({ 'thread/list': ({ cursor }) => (cursor ? second() : { data: [thread(A)], nextCursor: 'next' }) });
      const source = codexSessionSource(server);
      const first = await source.list();
      expect(first.map((s) => s.sessionId)).toEqual([A, B]);
      expect(first[1]).not.toHaveProperty('fileSize');
      second = () => {
        throw new Error('timed out');
      };
      expect((await source.list()).map((s) => s.sessionId)).toEqual([A, B]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('answers from the last list while no rollout file changed, and asks again when one did or the list got old', async () => {
    let changes = 'one';
    let now = 0;
    const server = fakeAppServer({ 'thread/list': () => ({ data: [thread(A)], nextCursor: null }) });
    const source = codexSessionSource(server, { changes: () => changes, maxListAgeMs: 600_000, now: () => now });
    await source.list();
    now = 120_000;
    expect((await source.list()).map((s) => s.sessionId)).toEqual([A]);
    expect(server.calls).toHaveLength(1);
    changes = 'two';
    await source.list();
    expect(server.calls).toHaveLength(2);
    now = 800_000;
    await source.list();
    expect(server.calls).toHaveLength(3);
  });

  it('asks every time when it can\'t tell what changed', async () => {
    const server = fakeAppServer({ 'thread/list': () => ({ data: [thread(A)], nextCursor: null }) });
    const source = codexSessionSource(server, {
      changes: () => {
        throw new Error('EACCES');
      },
    });
    await source.list();
    await source.list();
    expect(server.calls).toHaveLength(2);
  });
});
