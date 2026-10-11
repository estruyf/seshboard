import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionsChanged, TranscriptFileCheck, TranscriptMessage, TranscriptProfileCheck, TranscriptUpdate } from '@switchboard/protocol';
import { createProjectResolver } from '../claude/projectResolver.ts';
import type { RawSessionInfo, SessionSource } from '../claude/sessionSource.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { openCacheDatabase } from '../db/database.ts';
import { coalesce } from '../util/coalesce.ts';
import { removeDir } from '../util/removeDir.ts';
import { SessionIndex } from './sessionIndex.ts';
import { MultiProfileSource } from '../profiles/profileSources.ts';
import { diagnoseTranscript, transcriptFindings } from './transcriptDiagnosis.ts';
import { diffTranscript, TranscriptHub } from './transcriptHub.ts';

// Last made, first undone: indexes and databases close before their folders go (Windows won't delete open files).
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'switchboard-sessions-')));
  cleanups.push(() => removeDir(dir));
  return dir;
};
const until = async (check: () => boolean, timeoutMs = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
};

/**
 * Writes a new transcript and waits until the index has it. FSEvents starts reporting a moment after a watcher
 * is made, and a write before then is never seen: keep appending (as Claude Code does) until one is.
 */
const writeUntilSeen = (file: string, seen: () => boolean) => {
  writeFileSync(file, '{"entrypoint":"cli"}\n');
  return until(() => {
    if (seen()) return true;
    appendFileSync(file, '{}\n');
    return false;
  });
};

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

function fakeSource(initial: RawSessionInfo[]) {
  const infos = new Map(initial.map((i) => [i.sessionId, i]));
  const messages = new Map<string, RawSessionMessage[]>();
  const source: SessionSource = {
    list: async () => [...infos.values()],
    info: async (id) => infos.get(id),
    messages: async (id) => messages.get(id) ?? [],
  };
  return { source, infos, messages };
}

function setup(infos: RawSessionInfo[], db = openCacheDatabase(join(tempDir(), 'cache.sqlite'))) {
  const projectsDir = join(tempDir(), 'projects');
  mkdirSync(join(projectsDir, '-repo'), { recursive: true });
  const fake = fakeSource(infos);
  const changes: SessionsChanged[] = [];
  const transcriptChanges: string[] = [];
  const index = new SessionIndex({
    baseline: 1500,
    db: db.db,
    source: fake.source,
    projectsDirs: () => [{ profileId: 'default', dir: projectsDir }],
    resolver: createProjectResolver('/nonexistent-home'),
    log: () => {},
    onChange: (c) => changes.push(c),
    onTranscriptChanged: (id) => transcriptChanges.push(id),
  });
  cleanups.push(() => {
    if (db.db.isOpen) db.close();
  });
  cleanups.push(() => index.stop());
  return { index, changes, transcriptChanges, projectsDir, db, ...fake };
}

const info = (id: string, extra: Partial<RawSessionInfo> = {}): RawSessionInfo => ({
  sessionId: id,
  summary: `Session ${id.slice(0, 4)}`,
  lastModified: 1000,
  cwd: '/work/app',
  ...extra,
});

describe('SessionIndex', () => {
  it('reconciles with the source and emits one delta', async () => {
    const { index, changes, projectsDir } = setup([info(ID_A, { customTitle: '  Custom\n title ' }), info(ID_B, { lastModified: 2000 })]);
    writeFileSync(join(projectsDir, '-repo', `${ID_A}.jsonl`), '{"entrypoint":"cli"}\n');
    expect(index.snapshot()).toEqual({ sessions: [], complete: false });
    await index.refresh();
    expect(changes).toHaveLength(1);
    expect(changes[0]!.complete).toBe(true);
    const { sessions } = index.snapshot();
    expect(sessions.map((s) => s.id)).toEqual([ID_B, ID_A]);
    expect(sessions[1]).toMatchObject({ title: 'Custom title', origin: 'cli', projectRoot: '/work/app' });
    expect(sessions[0]!.origin).toBe('unknown');
  });

  it('reads the folder from the transcript when the SDK reports none', async () => {
    // A first prompt with a pasted image pushes `cwd` past the head the SDK reads.
    const { index, projectsDir } = setup([info(ID_A, { cwd: undefined })]);
    const user = { type: 'user', message: { content: 'x'.repeat(200_000) }, entrypoint: 'sdk-ts', cwd: '/work/app' };
    writeFileSync(join(projectsDir, '-repo', `${ID_A}.jsonl`), `${JSON.stringify(user)}\n`);
    await index.refresh();
    expect(index.get(ID_A)).toMatchObject({ cwd: '/work/app', projectRoot: '/work/app', origin: 'sdk' });
  });

  it('only emits what changed on later refreshes', async () => {
    const { index, changes, infos } = setup([info(ID_A), info(ID_B)]);
    await index.refresh();
    infos.set(ID_A, info(ID_A, { summary: 'Renamed', lastModified: 5000 }));
    infos.delete(ID_B);
    await index.refresh();
    expect(changes[1]).toMatchObject({ removed: [ID_B], upserted: [{ id: ID_A, title: 'Renamed' }] });
    await index.refresh();
    expect(changes).toHaveLength(2);
  });

  it('serves the cached list immediately on the next start', async () => {
    const db = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    const first = setup([info(ID_A)], db);
    await first.index.refresh();
    first.index.stop();
    const second = setup([], db);
    expect(second.index.snapshot()).toMatchObject({ complete: false, sessions: [{ id: ID_A }] });
  });

  it('tracks pins, archiving and unread state, and keeps them across restarts', async () => {
    const db = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    const t = setup([info(ID_A, { lastModified: 1000 }), info(ID_B, { lastModified: 9_000 })], db);
    await t.index.refresh();
    // Older than the baseline → read; newer → unread until viewed.
    expect(t.index.get(ID_A)).toMatchObject({ unread: false, pinned: false, archivedAt: null });
    expect(t.index.get(ID_B)!.unread).toBe(true);
    t.index.markViewed(ID_B);
    expect(t.index.get(ID_B)).toMatchObject({ unread: false });
    t.index.setFlags(ID_A, { pinned: true, archived: true });
    expect(t.changes.at(-1)!.upserted[0]).toMatchObject({ id: ID_A, pinned: true });
    expect(t.index.get(ID_A)!.archivedAt).toBeGreaterThan(0);
    t.index.setFlags(ID_A, { archived: false });
    expect(t.index.get(ID_A)).toMatchObject({ pinned: true, archivedAt: null });
    t.index.setFlags(ID_B, { archived: true });
    expect(t.index.get(ID_B)!.archivedAt).toBeGreaterThan(0);
    t.index.stop();
    const again = setup([], db);
    expect(again.index.get(ID_A)).toMatchObject({ pinned: true });
    expect(again.index.get(ID_B)).toMatchObject({ unread: false });
    expect(again.index.get(ID_B)!.archivedAt).toBeGreaterThan(0);
  });

  it('brings an archived session back when the user writes to it', async () => {
    const t = setup([info(ID_A), info(ID_B)]);
    await t.index.refresh();
    t.index.setFlags(ID_A, { pinned: true, archived: true });
    t.index.wake(ID_A);
    t.index.wake(ID_B);
    expect(t.index.get(ID_A)).toMatchObject({ pinned: true, archivedAt: null });
    expect(t.index.get(ID_B)).toMatchObject({ archivedAt: null });
  });

  it('dates a session by its last message, so Claude Code exiting does not make it unread', async () => {
    const { index, projectsDir } = setup([info(ID_A, { lastModified: 50_000 })]);
    const file = join(projectsDir, '-repo', `${ID_A}.jsonl`);
    writeFileSync(file, `${JSON.stringify({ type: 'user', entrypoint: 'cli', timestamp: new Date(1_000).toISOString() })}\n{"type":"last-prompt"}\n{"type":"cost-state"}\n`);
    await index.refresh();
    expect(index.get(ID_A)).toMatchObject({ updatedAt: 1_000, unread: false });
  });

  it('follows transcript writes and deletions through the file watcher', async () => {
    const { index, changes, transcriptChanges, projectsDir, infos } = setup([]);
    index.start();
    await until(() => changes.length === 1);
    infos.set(ID_A, info(ID_A, { summary: 'New one' }));
    const file = join(projectsDir, '-repo', `${ID_A}.jsonl`);
    await writeUntilSeen(file, () => index.snapshot().sessions.length === 1);
    expect(index.snapshot().sessions[0]).toMatchObject({ title: 'New one', origin: 'cli' });
    expect(transcriptChanges).toContain(ID_A);
    unlinkSync(file);
    await until(() => index.snapshot().sessions.length === 0);
    expect(changes.at(-1)?.removed).toEqual([ID_A]);
  });

  it('watches the projects folder of a new profile that has none yet', async () => {
    const configDir = join(tempDir(), 'profile');
    mkdirSync(configDir);
    const later = join(tempDir(), 'later');
    const fake = fakeSource([]);
    const cache = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    cleanups.push(() => cache.close());
    const index = new SessionIndex({
      baseline: 1500,
      db: cache.db,
      source: fake.source,
      projectsDirs: () => [
        { profileId: 'work', dir: join(configDir, 'projects') },
        // A config folder that doesn't exist yet: watched once a refresh finds it.
        { profileId: 'later', dir: join(later, 'projects') },
      ],
      resolver: createProjectResolver('/nonexistent-home'),
      log: () => {},
      onChange: () => {},
      onTranscriptChanged: () => {},
    });
    cleanups.push(() => index.stop());
    index.start();
    await index.refresh();
    fake.infos.set(ID_A, info(ID_A));
    mkdirSync(join(configDir, 'projects', '-repo'), { recursive: true });
    await writeUntilSeen(join(configDir, 'projects', '-repo', `${ID_A}.jsonl`), () => index.get(ID_A) !== null);

    mkdirSync(join(later, 'projects', '-repo'), { recursive: true });
    await index.refresh();
    fake.infos.set(ID_B, info(ID_B));
    await writeUntilSeen(join(later, 'projects', '-repo', `${ID_B}.jsonl`), () => index.get(ID_B) !== null);
  });

  it('does not let a slow full scan undo a delete or a write that happened meanwhile', async () => {
    const t = setup([info(ID_A)]);
    await t.index.refresh();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // The scan's list is read before the delete and before the new session.
    const stale = await t.source.list();
    t.source.list = async () => (await gate, stale);
    t.index.start();
    const scan = t.index.refresh();

    t.index.forget(ID_A);
    t.infos.set(ID_B, info(ID_B));
    await writeUntilSeen(join(t.projectsDir, '-repo', `${ID_B}.jsonl`), () => t.index.get(ID_B) !== null);
    release();
    await scan;
    expect(t.index.get(ID_A)).toBeNull();
    expect(t.index.get(ID_B)).not.toBeNull();
  });
});

const msg = (uuid: string, text = uuid): RawSessionMessage => ({ type: 'user', uuid, parent_tool_use_id: null, message: { content: text } });
const uuids = (messages: TranscriptMessage[]) => messages.map((m) => m.uuid);

describe('diffTranscript', () => {
  const t = (...ids: string[]) => ids.map((uuid) => ({ uuid }) as TranscriptMessage);
  it('appends, ignores no-ops and replaces when history changed', () => {
    expect(diffTranscript(['a'], t('a', 'b'))).toEqual({ mode: 'append', messages: t('b') });
    expect(diffTranscript(['a', 'b'], t('a', 'b'))).toBeNull();
    expect(diffTranscript(['a', 'b'], t('a', 'c'))).toEqual({ mode: 'replace', messages: t('a', 'c') });
    expect(diffTranscript(['a', 'b'], t('a'))).toEqual({ mode: 'replace', messages: t('a') });
  });

  it('waits when the file is only behind messages that were streamed live', () => {
    expect(diffTranscript(['a', 'p', 'r'], t('a', 'p'), new Set(['p', 'r']))).toBeNull();
    expect(diffTranscript(['a', 'p'], t('a'), new Set(['x']))).toEqual({ mode: 'replace', messages: t('a') });
  });
});

describe('TranscriptHub', () => {
  it('sends a full load, then appends, then replaces after a rewind', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('1'), msg('2')]);
    const hub = new TranscriptHub(source, () => {});
    const updates: TranscriptUpdate[] = [];
    const stop = hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);
    expect(updates[0]).toMatchObject({ mode: 'replace' });
    expect(uuids(updates[0]!.messages)).toEqual(['1', '2']);

    messages.set(ID_A, [msg('1'), msg('2'), msg('3')]);
    hub.changed(ID_A);
    await until(() => updates.length === 2);
    expect(updates[1]!.mode).toBe('append');
    expect(uuids(updates[1]!.messages)).toEqual(['3']);

    messages.set(ID_A, [msg('1'), msg('x')]);
    hub.changed(ID_A);
    await until(() => updates.length === 3);
    expect(updates[2]!.mode).toBe('replace');
    stop();
    hub.stop();
  });

  it('shows live messages at once and lets the file confirm them without duplicates', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('1')]);
    const hub = new TranscriptHub(source, () => {});
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);

    hub.pushLive(ID_A, [msg('2'), msg('3')]);
    expect(updates[1]).toMatchObject({ mode: 'append' });
    expect(uuids(updates[1]!.messages)).toEqual(['2', '3']);

    // The file catches up in two steps; neither produces an update.
    messages.set(ID_A, [msg('1'), msg('2')]);
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 150));
    messages.set(ID_A, [msg('1'), msg('2'), msg('3')]);
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 150));
    expect(updates).toHaveLength(2);

    // New file content after that is appended as usual.
    messages.set(ID_A, [msg('1'), msg('2'), msg('3'), msg('4')]);
    hub.changed(ID_A);
    await until(() => updates.length === 3);
    expect(uuids(updates[2]!.messages)).toEqual(['4']);
    hub.stop();
  });

  it('never sends duplicates when a change lands during the initial load', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('1')]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: SessionSource = { ...source, messages: async (id) => (await gate, source.messages(id)) };
    const hub = new TranscriptHub(slow, () => {});
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    messages.set(ID_A, [msg('1'), msg('2')]);
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 150));
    release();
    await until(() => updates.length >= 1);
    await new Promise((r) => setTimeout(r, 250));
    const delivered = updates.reduce<string[]>((acc, u) => (u.mode === 'replace' ? uuids(u.messages) : [...acc, ...uuids(u.messages)]), []);
    expect(delivered).toEqual(['1', '2']);
    hub.stop();
  });

  it('says when the first read fails, then delivers the transcript once it can be read', async () => {
    const { source, messages } = fakeSource([]);
    let broken = true;
    const flaky: SessionSource = { ...source, messages: async (id) => (broken ? Promise.reject(new Error('bad transcript')) : source.messages(id)) };
    const hub = new TranscriptHub(flaky, () => {});
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);
    expect(updates[0]).toMatchObject({ mode: 'replace', messages: [], error: 'bad transcript' });

    broken = false;
    messages.set(ID_A, [msg('1')]);
    hub.changed(ID_A);
    await until(() => updates.length === 2);
    expect(updates[1]!.error).toBeUndefined();
    expect(uuids(updates[1]!.messages)).toEqual(['1']);
    hub.stop();
  });
});

describe('MultiProfileSource', () => {
  const failing: SessionSource = { list: async () => [], info: async () => undefined, messages: async () => Promise.reject(new Error('unreadable')) };

  it('passes a read error on when no profile has the messages', async () => {
    const empty = fakeSource([]).source;
    const multi = new MultiProfileSource(() => [
      { profileId: 'a', source: failing },
      { profileId: 'b', source: empty },
    ]);
    await expect(multi.messages(ID_A)).rejects.toThrow('unreadable');
  });

  it('uses the profile that has the messages, even when another fails', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('1')]);
    const multi = new MultiProfileSource(() => [
      { profileId: 'a', source: failing },
      { profileId: 'b', source },
    ]);
    expect((await multi.messages(ID_A)).length).toBe(1);
    expect(multi.ownerOf(ID_A)).toBe('b');
  });
});

describe('diagnoseTranscript', () => {
  const line = (entry: object) => `${JSON.stringify(entry)}\n`;

  it('counts what is in each transcript file and reports the reader', async () => {
    const configDir = tempDir();
    mkdirSync(join(configDir, 'projects', '-repo'), { recursive: true });
    const path = join(configDir, 'projects', '-repo', `${ID_A}.jsonl`);
    writeFileSync(
      path,
      line({ type: 'user', uuid: 'u1' }) + line({ type: 'assistant', uuid: 'a1' }) + line({ type: 'system', subtype: 'compact_boundary', uuid: 'b1' }) + 'not json\n' + line({ type: 'user', uuid: 'u2' }) + '{"type":"assist',
    );
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('u2')]);
    const result = await diagnoseTranscript(ID_A, path, [{ profileId: 'default', configDir, source }]);
    expect(result.profiles[0]).toMatchObject({ read: 1, error: null });
    expect(result.profiles[0]!.files).toEqual([expect.objectContaining({ path, lines: 6, badLines: 2, messages: 3, compactions: 1, complete: false })]);
    expect(result.findings.map((f) => f.tone)).toEqual(['warn', 'info', 'info']);
    expect(result.findings[2]!.text).toContain('compacted once');
  });

  it('finds the same session in two project folders and a reader that throws', async () => {
    const configDir = tempDir();
    for (const dir of ['-repo', '-repo-worktree']) {
      mkdirSync(join(configDir, 'projects', dir), { recursive: true });
      writeFileSync(join(configDir, 'projects', dir, `${ID_A}.jsonl`), line({ type: 'user', uuid: 'u1' }));
    }
    const throwing: SessionSource = { list: async () => [], info: async () => undefined, messages: async () => Promise.reject(new Error('boom')) };
    const result = await diagnoseTranscript(ID_A, null, [{ profileId: 'default', configDir, source: throwing }]);
    expect(result.profiles[0]!.files).toHaveLength(2);
    expect(result.profiles[0]).toMatchObject({ read: null, error: 'boom' });
    expect(result.profiles[0]!.stack).toContain('boom');
    expect(result.findings.map((f) => f.tone)).toEqual(['error', 'warn']);
  });
});

describe('transcriptFindings', () => {
  const file = (extra: Partial<TranscriptFileCheck> = {}): TranscriptFileCheck => ({ path: '/p/a.jsonl', size: 10, modifiedAt: 0, lines: 1, badLines: 0, messages: 4, compactions: 0, complete: true, ...extra });
  const profile = (extra: Partial<TranscriptProfileCheck> = {}): TranscriptProfileCheck => ({ profileId: 'default', configDir: '/c', files: [file()], read: 4, readMs: 1, error: null, stack: null, ...extra });

  it('is fine when the reader returns the messages', () => {
    expect(transcriptFindings([profile()], '/p/a.jsonl')).toEqual([{ tone: 'ok', text: 'The transcript reads fine: 4 messages.' }]);
  });

  it('flags a file with messages the reader returned none of', () => {
    expect(transcriptFindings([profile({ read: 0 })], null)[0]).toMatchObject({ tone: 'error', text: expect.stringContaining('returned none') });
  });

  it('flags a missing file and a stale index entry', () => {
    expect(transcriptFindings([profile({ files: [], read: 0 })], null)[0]!.text).toContain('no transcript file');
    expect(transcriptFindings([profile()], '/old/a.jsonl')[0]).toMatchObject({ tone: 'warn', text: expect.stringContaining('/old/a.jsonl') });
  });
});

describe('coalesce', () => {
  it('runs at most once per interval and once more after a busy run', async () => {
    vi.useFakeTimers();
    let runs = 0;
    const c = coalesce(() => {
      runs++;
    }, 100);
    c.trigger();
    c.trigger();
    c.trigger();
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(1);
    c.trigger();
    await vi.advanceTimersByTimeAsync(100);
    expect(runs).toBe(2);
    c.stop();
    vi.useRealTimers();
  });
});
