import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionsChanged, TranscriptFileCheck, TranscriptMessage, TranscriptProfileCheck, TranscriptUpdate } from '@seshboard/protocol';
import { createProjectResolver } from '../claude/projectResolver.ts';
import type { RawSessionInfo, SessionSource } from '../claude/sessionSource.ts';
import type { RawSessionMessage } from '../claude/transcript.ts';
import { openCacheDatabase } from '../db/database.ts';
import { coalesce } from '../util/coalesce.ts';
import { removeDir } from '../util/removeDir.ts';
import { SessionIndex } from './sessionIndex.ts';
import { MultiProfileSource } from '../profiles/profileSources.ts';
import { diagnoseTranscript, transcriptFindings } from './transcriptDiagnosis.ts';
import { diffTranscript, TranscriptHub, withNotices } from './transcriptHub.ts';

// Last made, first undone: indexes and databases close before their folders go (Windows won't delete open files).
const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const tempDir = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-sessions-')));
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

function setup(infos: RawSessionInfo[], db = openCacheDatabase(join(tempDir(), 'cache.sqlite')), activityDelayMs?: number) {
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
    ...(activityDelayMs !== undefined ? { activityDelayMs } : {}),
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
    t.index.markUnviewed(ID_B);
    expect(t.index.get(ID_B)).toMatchObject({ unread: true });
    t.index.markViewed(ID_B);
    t.index.setFlags(ID_A, { pinned: true, archived: true });
    expect(t.changes.at(-1)!.upserted[0]).toMatchObject({ id: ID_A, pinned: true });
    expect(t.index.get(ID_A)!.archivedAt).toBeGreaterThan(0);
    t.index.setFlags(ID_A, { archived: false });
    expect(t.index.get(ID_A)).toMatchObject({ pinned: true, archivedAt: null });
    // Unarchived by hand: a quiet session stays in the main list until it has new activity.
    expect(t.index.get(ID_A)!.restoredAt).toBeGreaterThan(0);
    t.index.setFlags(ID_B, { archived: true });
    expect(t.index.get(ID_B)).toMatchObject({ restoredAt: null });
    expect(t.index.get(ID_B)!.archivedAt).toBeGreaterThan(0);
    t.index.stop();
    const again = setup([], db);
    expect(again.index.get(ID_A)).toMatchObject({ pinned: true });
    expect(again.index.get(ID_A)!.restoredAt).toBeGreaterThan(0);
    expect(again.index.get(ID_B)).toMatchObject({ unread: false });
    expect(again.index.get(ID_B)!.archivedAt).toBeGreaterThan(0);
  });

  it('keeps a note on a session, through Done and a restart, until you clear it', async () => {
    const db = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    const t = setup([info(ID_A)], db);
    await t.index.refresh();
    expect(t.index.get(ID_A)).toMatchObject({ note: null });
    t.index.setNote(ID_A, 'push after review');
    expect(t.changes.at(-1)!.upserted[0]).toMatchObject({ id: ID_A, note: 'push after review' });
    t.index.setFlags(ID_A, { archived: true });
    t.index.setArchivedMany([ID_A], false);
    expect(t.index.get(ID_A)).toMatchObject({ note: 'push after review' });
    t.index.stop();
    const again = setup([], db);
    expect(again.index.get(ID_A)).toMatchObject({ note: 'push after review' });
    again.index.setNote(ID_A, null);
    expect(again.index.get(ID_A)).toMatchObject({ note: null });
  });

  it('moves sessions to Done for a merged pull request in one change, and keeps the merge handled after Reopen', async () => {
    const db = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    const t = setup([info(ID_A), info(ID_B)], db);
    await t.index.refresh();
    const before = t.changes.length;
    t.index.markMerged([{ sessionId: ID_A, pr: 12 }, { sessionId: ID_B, pr: 13 }]);
    expect(t.changes).toHaveLength(before + 1);
    expect(t.index.get(ID_A)).toMatchObject({ donePr: 12, restoredAt: null });
    expect(t.index.get(ID_A)!.archivedAt).toBeGreaterThan(0);
    t.index.setFlags(ID_A, { archived: false });
    expect(t.index.get(ID_A)).toMatchObject({ donePr: 12, archivedAt: null });
    t.index.stop();
    expect(setup([], db).index.get(ID_B)).toMatchObject({ donePr: 13 });
  });

  it('snoozes sessions, brings them back when due, and takes the reminder away on Done', async () => {
    const db = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    const t = setup([info(ID_A), info(ID_B)], db);
    await t.index.refresh();
    t.index.setReminder([ID_A, ID_B], 5_000);
    expect(t.index.snoozed().sort()).toEqual([ID_A, ID_B].sort());
    expect(t.index.dueReminders(4_999)).toEqual([]);
    expect(t.index.dueReminders(5_000).map((d) => d.sessionId).sort()).toEqual([ID_A, ID_B].sort());
    t.index.markReminded([ID_A], 6_000);
    expect(t.index.get(ID_A)).toMatchObject({ remindAt: 5_000, remindedAt: 6_000 });
    expect(t.index.dueReminders(7_000).map((d) => d.sessionId)).toEqual([ID_B]);
    t.index.setFlags(ID_B, { archived: true });
    expect(t.index.get(ID_B)).toMatchObject({ remindAt: null, remindedAt: null });
    t.index.stop();
    expect(setup([], db).index.get(ID_A)).toMatchObject({ remindAt: 5_000, remindedAt: 6_000 });
  });

  it('archives a pipeline tree in one change, and hides sessions until they have new activity', async () => {
    const db = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    const t = setup([info(ID_A), info(ID_B)], db);
    await t.index.refresh();
    t.index.setFlags(ID_A, { pinned: true });
    const before = t.changes.length;
    t.index.setArchivedMany([ID_A, ID_B], true);
    expect(t.changes).toHaveLength(before + 1);
    expect(t.changes.at(-1)!.upserted.map((s) => s.id).sort()).toEqual([ID_A, ID_B].sort());
    expect(t.index.get(ID_A)).toMatchObject({ pinned: false });
    expect(t.index.get(ID_B)!.archivedAt).toBeGreaterThan(0);
    t.index.setArchivedMany([ID_A, ID_B], false);
    expect(t.index.get(ID_B)).toMatchObject({ archivedAt: null });

    t.index.hide([ID_B]);
    expect(t.changes.at(-1)).toMatchObject({ upserted: [], removed: [ID_B] });
    expect(t.index.snapshot().sessions.map((s) => s.id)).toEqual([ID_A]);
    expect(t.index.get(ID_B)).not.toHaveProperty('hiddenAt');
    t.index.stop();
    const again = setup([info(ID_A), info(ID_B, { lastModified: Date.now() + 60_000 })], db);
    expect(again.index.snapshot().sessions.map((s) => s.id)).toEqual([ID_A]);
    // Resumed in Claude Code: it comes back.
    await again.index.refresh();
    expect(again.index.snapshot().sessions.map((s) => s.id).sort()).toEqual([ID_A, ID_B].sort());
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

  it('BUDGET: a busy session\'s writes make no sessions.changed and no stored summary within the hold, and one change after it', async () => {
    // The hold is a timer: timers and the clock are the test's, file reads stay real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    try {
      const hold = 15_000;
      const t = setup([info(ID_A, { fileSize: 100 })], undefined, hold);
      const file = join(t.projectsDir, '-repo', `${ID_A}.jsonl`);
      const line = (at: number) => `${JSON.stringify({ type: 'assistant', entrypoint: 'cli', timestamp: new Date(at).toISOString() })}\n`;
      const start = Date.now() - 60_000;
      writeFileSync(file, line(start));
      await t.index.refresh();
      const stored = () => (t.db.db.prepare('SELECT summary_json FROM sessions WHERE id = ?').get(ID_A) as { summary_json: string }).summary_json;
      const sent = t.changes.length;
      const before = stored();
      // Forty writes, each with a later time and a bigger file: the numbers every write moves.
      for (let i = 1; i <= 40; i++) {
        appendFileSync(file, line(start + i * 500));
        t.infos.set(ID_A, info(ID_A, { fileSize: 100 + i * 100 }));
        await t.index.reread(ID_A);
      }
      // Nearly the whole hold later: still nothing sent, nothing stored.
      await vi.advanceTimersByTimeAsync(hold - 1_000);
      expect(t.changes.length).toBe(sent);
      expect(stored()).toBe(before);
      // Past it: one change, with the latest.
      await vi.advanceTimersByTimeAsync(2_000);
      expect(t.changes.length).toBe(sent + 1);
      expect(t.changes.at(-1)!.upserted[0]).toMatchObject({ updatedAt: start + 40 * 500, fileSize: 4_100 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a newer time and size a while later, but a session turning unread or renamed at once', async () => {
    const t = setup([info(ID_A, { fileSize: 100 })], undefined, 300);
    const file = join(t.projectsDir, '-repo', `${ID_A}.jsonl`);
    const line = (at: number) => `${JSON.stringify({ type: 'assistant', entrypoint: 'cli', timestamp: new Date(at).toISOString() })}\n`;
    const start = Date.now() - 60_000;
    writeFileSync(file, line(start));
    await t.index.refresh();
    expect(t.index.get(ID_A)).toMatchObject({ updatedAt: start, fileSize: 100, unread: true });
    // Only the time and size moved: held back, then sent once with the latest.
    const sent = t.changes.length;
    appendFileSync(file, line(start + 1_000));
    t.infos.set(ID_A, info(ID_A, { fileSize: 200 }));
    await t.index.reread(ID_A);
    appendFileSync(file, line(start + 2_000));
    t.infos.set(ID_A, info(ID_A, { fileSize: 300 }));
    await t.index.reread(ID_A);
    expect(t.changes.length).toBe(sent);
    expect(t.index.get(ID_A)).toMatchObject({ updatedAt: start, fileSize: 100 });
    await until(() => t.changes.length === sent + 1);
    expect(t.changes.at(-1)!.upserted[0]).toMatchObject({ updatedAt: start + 2_000, fileSize: 300 });
    // Read now, then new activity makes it unread: sent at once.
    t.index.markViewed(ID_A);
    const viewed = t.changes.length;
    appendFileSync(file, line(Date.now() + 10_000));
    await t.index.reread(ID_A);
    expect(t.changes.length).toBe(viewed + 1);
    expect(t.changes.at(-1)!.upserted[0]).toMatchObject({ unread: true });
    // Renamed: sent at once.
    t.infos.set(ID_A, info(ID_A, { fileSize: 300, customTitle: 'Renamed' }));
    await t.index.reread(ID_A);
    expect(t.changes.at(-1)!.upserted[0]).toMatchObject({ title: 'Renamed' });
  });

  it('sends new activity at once when it moves a session out of Done or past being restored', async () => {
    const t = setup([info(ID_A, { fileSize: 100 })], undefined, 60_000);
    const file = join(t.projectsDir, '-repo', `${ID_A}.jsonl`);
    const line = (at: number) => `${JSON.stringify({ type: 'assistant', entrypoint: 'cli', timestamp: new Date(at).toISOString() })}\n`;
    writeFileSync(file, line(Date.now() - 60_000));
    await t.index.refresh();
    t.index.setFlags(ID_A, { archived: true });
    const archived = t.changes.length;
    appendFileSync(file, line(Date.now() + 5_000));
    await t.index.reread(ID_A);
    expect(t.changes.length).toBe(archived + 1);
  });

  it('keeps a change that waits when a full scan that read the session before it ends', async () => {
    const t = setup([info(ID_A, { fileSize: 100 })], undefined, 300);
    const file = join(t.projectsDir, '-repo', `${ID_A}.jsonl`);
    const line = (at: number) => `${JSON.stringify({ type: 'assistant', entrypoint: 'cli', timestamp: new Date(at).toISOString() })}\n`;
    const start = Date.now() - 60_000;
    writeFileSync(file, line(start));
    await t.index.refresh();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const stale = await t.source.list();
    t.source.list = async () => (await gate, stale);
    const scan = t.index.refresh();
    appendFileSync(file, line(start + 1_000));
    t.infos.set(ID_A, info(ID_A, { fileSize: 200 }));
    await t.index.reread(ID_A);
    release();
    await scan;
    await until(() => t.index.get(ID_A)?.fileSize === 200);
    expect(t.index.get(ID_A)!.updatedAt).toBe(start + 1_000);
  });

  it('reads a session with files in two folders the SDK way, and keeps the first folder\u2019s file', async () => {
    const t = setup([info(ID_A), info(ID_B)]);
    mkdirSync(join(t.projectsDir, '-other'));
    writeFileSync(join(t.projectsDir, '-other', `${ID_A}.jsonl`), '{"type":"user"}\n');
    writeFileSync(join(t.projectsDir, '-repo', `${ID_A}.jsonl`), '{"type":"user"}\n');
    writeFileSync(join(t.projectsDir, '-repo', `${ID_B}.jsonl`), '{"type":"user"}\n');
    await t.index.refresh();
    expect(t.index.pathFor(ID_A)).toBe(join(t.projectsDir, '-other', `${ID_A}.jsonl`));
    expect(t.index.transcriptFile(ID_A)).toBeNull();
    expect(t.index.transcriptFile(ID_B)).toBe(join(t.projectsDir, '-repo', `${ID_B}.jsonl`));
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

  it("follows a provider's session file that moves (Codex compresses a rollout), with the latest profile", async () => {
    const dir = join(tempDir(), 'sessions');
    mkdirSync(dir);
    const fake = fakeSource([]);
    const cache = openCacheDatabase(join(tempDir(), 'cache.sqlite'));
    cleanups.push(() => cache.close());
    const plain = join(dir, `${ID_A}.jsonl`);
    const packed = `${plain}.zst`;
    // As Codex's files do: the session stands for whichever of its two files is there now.
    const provider = {
      sessionOf: (relative: string) => (relative.startsWith(ID_A) ? { sessionId: ID_A, file: existsSync(plain) ? plain : packed } : null),
      files: () => new Map([[ID_A, existsSync(plain) ? plain : packed]]),
    };
    const index = new SessionIndex({
      baseline: 1500,
      db: cache.db,
      source: fake.source,
      projectsDirs: () => [{ profileId: 'codex', dir, provider }],
      resolver: createProjectResolver('/nonexistent-home'),
      log: () => {},
      onChange: () => {},
      onTranscriptChanged: () => {},
    });
    cleanups.push(() => index.stop());
    index.start();
    await index.refresh();
    fake.infos.set(ID_A, info(ID_A, { provider: 'codex', summary: 'First' }));
    await writeUntilSeen(plain, () => index.get(ID_A) !== null);
    // Compressed: the `.zst` is written and the plain file goes. The session stays, and later changes still reach it.
    writeFileSync(packed, '{}\n');
    unlinkSync(plain);
    fake.infos.set(ID_A, info(ID_A, { provider: 'codex', summary: 'Second' }));
    await until(() => {
      if (index.get(ID_A)?.title === 'Second') return true;
      appendFileSync(packed, '{}\n');
      return false;
    });
    expect(index.get(ID_A)).toMatchObject({ title: 'Second', profileId: 'codex' });
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
  it('appends, ignores no-ops, splices after a common start and replaces when nothing is in common', () => {
    expect(diffTranscript(['a'], t('a', 'b'))).toEqual({ mode: 'append', messages: t('b') });
    expect(diffTranscript(['a', 'b'], t('a', 'b'))).toBeNull();
    expect(diffTranscript(['a', 'b'], t('a', 'c'))).toEqual({ mode: 'splice', at: 1, messages: t('c') });
    expect(diffTranscript(['a', 'b'], t('a'))).toEqual({ mode: 'splice', at: 1, messages: [] });
    expect(diffTranscript(['a', 'b'], t('x', 'b'))).toEqual({ mode: 'replace', messages: t('x', 'b') });
  });

  it('waits when the file is only behind messages that were streamed live, and keeps them in a splice', () => {
    expect(diffTranscript(['a', 'p', 'r'], t('a', 'p'), new Set(['p', 'r']))).toBeNull();
    expect(diffTranscript(['a', 'p'], t('a'), new Set(['x']))).toEqual({ mode: 'splice', at: 1, messages: [] });
    const live = new Map(t('r').map((m) => [m.uuid, m]));
    expect(diffTranscript(['a', 'p', 'r'], t('a', 's', 'p'), new Set(['p', 'r']), (uuid) => live.get(uuid))).toEqual({ mode: 'splice', at: 1, messages: t('s', 'p', 'r') });
  });
});

describe('TranscriptHub', () => {
  it('sends a full load, then appends, then splices after a rewind', async () => {
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
    expect(updates[2]).toMatchObject({ mode: 'splice', at: 1 });
    expect(uuids(updates[2]!.messages)).toEqual(['x']);
    stop();
    hub.stop();
  });

  it('keeps a queued message for a window that opens the session later', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('1')]);
    const hub = new TranscriptHub(source, () => {});
    const first: TranscriptUpdate[] = [];
    const stop = hub.watch(ID_A, (u) => first.push(u));
    await until(() => first.length === 1);

    hub.pushLive(ID_A, [msg('2')]);
    stop();

    // Back in the session: the file doesn't have the queued message yet, the window still shows it.
    const again: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => again.push(u));
    await until(() => again.length === 1);
    expect(uuids(again[0]!.messages)).toEqual(['1', '2']);

    // The file catches up: no duplicate, and nothing is kept once it has the message.
    messages.set(ID_A, [msg('1'), msg('2')]);
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 150));
    expect(again).toHaveLength(1);

    // Once the turn is over, a message the file never got isn't shown again.
    hub.pushLive(ID_A, [msg('3')]);
    hub.settled(ID_A);
    const last: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => last.push(u));
    await until(() => last.length === 1);
    expect(uuids(last[0]!.messages)).toEqual(['1', '2']);
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

  it('keeps a held message until the file has it, also for a window that starts watching later', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, []);
    const hub = new TranscriptHub(source, () => {});
    // Sent before any window watches, and held back from Claude Code (Auto choosing): not in the file.
    hub.pushLive(ID_A, [msg('1')], true);
    // A plain live message nobody watches is not kept.
    hub.pushLive(ID_B, [msg('x')]);
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);
    expect(uuids(updates[0]!.messages)).toEqual(['1']);

    // The file still doesn't have it: nothing changes. Then it does, with a reply: only the reply is new.
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 150));
    expect(updates).toHaveLength(1);
    messages.set(ID_A, [msg('1'), msg('2')]);
    hub.changed(ID_A);
    await until(() => updates.length === 2);
    expect(updates[1]).toMatchObject({ mode: 'append' });
    expect(uuids(updates[1]!.messages)).toEqual(['2']);

    // Stopped before it was sent: a later window doesn't show it.
    hub.pushLive(ID_B, [msg('y')], true);
    hub.dropHeld(ID_B);
    const later: TranscriptUpdate[] = [];
    hub.watch(ID_B, (u) => later.push(u));
    await until(() => later.length === 1);
    expect(later[0]!.messages).toEqual([]);
    hub.stop();
  });

  it('reads a held message with the file, as a phone asks for a page before it watches', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('0')]);
    const hub = new TranscriptHub(source, () => {});
    hub.pushLive(ID_A, [msg('1')], true);
    expect(uuids(await hub.readWithHeld(ID_A))).toEqual(['0', '1']);
    expect(uuids(await hub.read(ID_A))).toEqual(['0']);

    // Once the file has it, it is there once.
    messages.set(ID_A, [msg('0'), msg('1')]);
    expect(uuids(await hub.readWithHeld(ID_A))).toEqual(['0', '1']);
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

describe('TranscriptHub during a turn this app runs', () => {
  it('BUDGET: reads the file once the turn ends, not on every write, and once more for a window that opens during it', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('1')]);
    let reads = 0;
    const counted: SessionSource = { ...source, messages: async (id) => (reads++, source.messages(id)) };
    const hub = new TranscriptHub(counted, () => {});
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);
    hub.running(ID_A, true);
    hub.pushLive(ID_A, [msg('2', 'live')]);
    expect(uuids(updates[1]!.messages)).toEqual(['2']);
    // The file follows, with a line only it has: not read during the turn.
    messages.set(ID_A, [msg('1'), msg('2'), msg('s', 'system line')]);
    hub.changed(ID_A);
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 200));
    expect(reads).toBe(1);
    expect(updates).toHaveLength(2);
    // A second window opens during the turn: its first load, and the next change, are read.
    const second: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => second.push(u));
    await until(() => second.length === 1);
    messages.set(ID_A, [msg('1'), msg('2'), msg('s'), msg('3')]);
    hub.changed(ID_A);
    await until(() => updates.length === 3);
    expect(reads).toBe(3);
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 200));
    expect(reads).toBe(3);
    // The turn ends: what the file got meanwhile comes in one read.
    messages.set(ID_A, [msg('1'), msg('2'), msg('s'), msg('3'), msg('4')]);
    hub.changed(ID_A);
    hub.running(ID_A, false);
    await until(() => updates.length === 4);
    expect(uuids(updates.flatMap((u) => u.messages))).toEqual(['1', '2', 's', '3', '4']);
    expect(reads).toBe(4);
    hub.stop();
  });
});

describe('TranscriptHub with lines only the file has', () => {
  it('sends a line the file has among live messages as a splice, keeping what came before and what is still live', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('1'), msg('2')]);
    const hub = new TranscriptHub(source, () => {});
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);
    hub.pushLive(ID_A, [msg('3'), msg('4')]);
    // The file has a line that never came live before 3, and not 4 yet.
    messages.set(ID_A, [msg('1'), msg('2'), msg('s', 'system line'), msg('3')]);
    hub.changed(ID_A);
    await until(() => updates.length === 3);
    expect(updates[2]).toMatchObject({ mode: 'splice', at: 2 });
    expect(uuids(updates[2]!.messages)).toEqual(['s', '3', '4']);
    // The file catches up with 4: nothing to send.
    messages.set(ID_A, [msg('1'), msg('2'), msg('s'), msg('3'), msg('4')]);
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 200));
    expect(updates).toHaveLength(3);
    // A rewind to the very start is still a replace.
    messages.set(ID_A, [msg('x')]);
    hub.changed(ID_A);
    await until(() => updates.length === 4);
    expect(updates[3]!.mode).toBe('replace');
    hub.stop();
  });

  it('shows what came live while a window\u2019s first load was read, after it', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [msg('1')]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow: SessionSource = { ...source, messages: async (id) => (await gate, source.messages(id)) };
    const hub = new TranscriptHub(slow, () => {});
    hub.running(ID_A, true);
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    hub.pushLive(ID_A, [{ ...msg('2', 'live'), type: 'assistant' }]);
    release();
    await until(() => updates.length === 2);
    expect(updates[0]).toMatchObject({ mode: 'replace' });
    expect(uuids(updates[0]!.messages)).toEqual(['1']);
    expect(updates[1]).toMatchObject({ mode: 'append' });
    expect(uuids(updates[1]!.messages)).toEqual(['2']);
    hub.stop();
  });
});

describe('withNotices', () => {
  const at = (uuid: string, time: number) => ({ uuid, timestamp: time }) as TranscriptMessage;
  it('puts a notice before the first message written after it, or at the end', () => {
    const notice = at('n', 15);
    expect(uuids(withNotices([at('a', 10), at('b', 20)], [notice]))).toEqual(['a', 'n', 'b']);
    expect(uuids(withNotices([at('a', 10), at('b', 12)], [notice]))).toEqual(['a', 'b', 'n']);
    expect(uuids(withNotices([], [notice]))).toEqual(['n']);
  });
  it('shows a notice once, and leaves out retracted messages', () => {
    expect(uuids(withNotices([at('a', 10), at('n', 15)], [at('n', 15)]))).toEqual(['a', 'n']);
    expect(uuids(withNotices([at('a', 10), at('r', 11), at('b', 20)], [], new Set(['r'])))).toEqual(['a', 'b']);
  });
});

describe('TranscriptHub notices and retractions', () => {
  const at = (uuid: string, time: number): RawSessionMessage => ({ type: 'assistant', uuid, parent_tool_use_id: null, timestamp: new Date(time).toISOString(), message: { content: uuid } });
  const notice = (time: number): RawSessionMessage => ({ type: 'system', uuid: 'refusal', parent_tool_use_id: null, timestamp: new Date(time).toISOString(), message: { content: 'Claude switched this session to Sonnet after a refusal' } });

  it('keeps a notice in place across file reloads, a reopened session and a plain read', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [at('1', 1000), at('2', 2000)]);
    const hub = new TranscriptHub(source, () => {});
    const updates: TranscriptUpdate[] = [];
    const stop = hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);

    hub.notice(ID_A, notice(2500));
    expect(uuids(updates[1]!.messages)).toEqual(['refusal']);

    // The file moves on with the reply that followed it: the notice stays between the two, with no flicker (an append).
    hub.pushLive(ID_A, [at('3', 3000)]);
    messages.set(ID_A, [at('1', 1000), at('2', 2000), at('3', 3000)]);
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 150));
    expect(updates.filter((u) => u.mode === 'replace')).toHaveLength(1);

    // A plain read (a phone's transcript.get) has it where it happened.
    expect(uuids(await hub.read(ID_A))).toEqual(['1', '2', 'refusal', '3']);
    expect(uuids(await hub.readWithHeld(ID_A))).toEqual(['1', '2', 'refusal', '3']);

    // A window that opens the session later, with nobody watching meanwhile.
    stop();
    const again: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => again.push(u));
    await until(() => again.length === 1);
    expect(uuids(again[0]!.messages)).toEqual(['1', '2', 'refusal', '3']);
    hub.stop();
  });

  it('does not bring back a live message older than the file\u2019s last one when it rebuilds', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [at('1', 1000), at('2', 2000)]);
    const hub = new TranscriptHub(source, () => {});
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);

    // `old` is live and the file never writes it under that uuid; the file has moved on past it.
    hub.pushLive(ID_A, [at('old', 1500), at('refused', 2100), at('fresh', 3500)]);
    messages.set(ID_A, [at('1', 1000), at('2', 2000), at('3', 3000)]);
    hub.retract(ID_A, ['refused']);
    await until(() => updates.some((u) => u.mode === 'replace' && updates.indexOf(u) > 0));
    // What the file has, then only what is newer than it.
    expect(uuids(updates.at(-1)!.messages)).toEqual(['1', '2', '3', 'fresh']);
    hub.stop();
  });

  it('forgets live messages when the turn settles, so a later rebuild does not bring them back', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [at('1', 1000)]);
    const hub = new TranscriptHub(source, () => {});
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);
    hub.pushLive(ID_A, [at('gone', 2000), at('refused', 2100)]);
    hub.settled(ID_A);
    hub.retract(ID_A, ['refused']);
    await until(() => updates.length === 3);
    expect(uuids(updates[2]!.messages)).toEqual(['1']);
    hub.stop();
  });

  it('sends the rebuilds of one refusal as one update, built from the last read', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [at('1', 1000)]);
    const hub = new TranscriptHub(source, () => {});
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);
    hub.pushLive(ID_A, [at('r1', 2000), at('r2', 2100), at('r3', 2200)]);
    hub.retract(ID_A, ['r1']);
    hub.retract(ID_A, ['r2']);
    messages.set(ID_A, [at('1', 1000), at('2', 3000)]);
    hub.retract(ID_A, ['r3']);
    await until(() => updates.length === 3);
    await new Promise((r) => setTimeout(r, 300));
    // One rebuild for the three retractions, with what the file had when it ran.
    expect(updates).toHaveLength(3);
    expect(updates[2]!.mode).toBe('replace');
    expect(uuids(updates[2]!.messages)).toEqual(['1', '2']);
    hub.stop();
  });

  it('keeps a notice nobody was watching for', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [at('1', 1000)]);
    const hub = new TranscriptHub(source, () => {});
    hub.notice(ID_A, notice(1500));
    expect(uuids(await hub.read(ID_A))).toEqual(['1', 'refusal']);
    hub.stop();
  });

  it('drops retracted messages from the windows and from every later read', async () => {
    const { source, messages } = fakeSource([]);
    messages.set(ID_A, [at('1', 1000)]);
    const hub = new TranscriptHub(source, () => {});
    const updates: TranscriptUpdate[] = [];
    hub.watch(ID_A, (u) => updates.push(u));
    await until(() => updates.length === 1);

    // The refused partial and an earlier live message are shown; the file has neither yet.
    hub.pushLive(ID_A, [at('2', 2000), at('refused', 2100)]);
    expect(updates).toHaveLength(2);
    hub.retract(ID_A, ['refused']);
    await until(() => updates.length === 3);
    expect(updates[2]!.mode).toBe('replace');
    expect(uuids(updates[2]!.messages)).toEqual(['1', '2']);

    // The file has the refused message after all: it stays out.
    messages.set(ID_A, [at('1', 1000), at('2', 2000), at('refused', 2100)]);
    hub.changed(ID_A);
    await new Promise((r) => setTimeout(r, 150));
    expect(updates).toHaveLength(3);
    expect(uuids(await hub.read(ID_A))).toEqual(['1', '2']);
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
