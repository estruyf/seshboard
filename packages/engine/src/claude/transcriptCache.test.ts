import { appendFileSync, mkdirSync, statSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TranscriptUpdate } from '@seshboard/protocol';
import { TranscriptHub } from '../sessions/transcriptHub.ts';
import { sdkSessionSource } from './sessionSource.ts';
import { parseLines, TranscriptCache } from './transcriptCache.ts';

const SESSION = '0b0e6f0a-5c1e-4c9a-9d3e-6b7a1f2c3d4f';
const OTHER = '1b0e6f0a-5c1e-4c9a-9d3e-6b7a1f2c3d4f';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const base = { isSidechain: false, sessionId: SESSION, cwd: '/tmp/project', version: '2.1.287', userType: 'external' };
let time = Date.parse('2026-10-11T10:00:00.000Z');
const at = () => new Date((time += 1000)).toISOString();

/** Lines in Claude Code's format, chained from `parent`; returns them with the last uuid. */
function turn(parent: string | null, text: string): { lines: object[]; last: string } {
  const user = uuid();
  const answer = uuid();
  return {
    lines: [
      { ...base, parentUuid: parent, type: 'user', uuid: user, timestamp: at(), message: { role: 'user', content: text } },
      { type: 'last-prompt', sessionId: SESSION, lastPrompt: text },
      { ...base, parentUuid: user, type: 'assistant', uuid: answer, timestamp: at(), message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: `Done: ${text}` }] } },
    ],
    last: answer,
  };
}

const jsonl = (lines: object[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

function setup(maxBytes?: number, skipBytes?: number) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-cache-')));
  dirs.push(dir);
  mkdirSync(join(dir, 'projects', '-tmp-project'), { recursive: true });
  const file = join(dir, 'projects', '-tmp-project', `${SESSION}.jsonl`);
  const cache = new TranscriptCache({ ...(maxBytes !== undefined ? { maxBytes } : {}), ...(skipBytes !== undefined ? { skipBytes } : {}) });
  const scope = async <T>(fn: () => Promise<T>) => {
    const before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = dir;
    try {
      return await fn();
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    }
  };
  const paths = new Map([[SESSION, file]]);
  const cached = sdkSessionSource(scope, { cache, pathOf: (id) => paths.get(id) ?? null });
  // The SDK reading the file itself: what every read through the cache must match.
  const plain = sdkSessionSource(scope);
  const same = async (id = SESSION) => {
    const [a, b] = await Promise.all([cached.messages(id), plain.messages(id)]);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
    return a;
  };
  return { dir, file, cache, cached, plain, same, paths };
}

const uuids = (messages: readonly { uuid: string }[]) => messages.map((m) => m.uuid);

describe('TranscriptCache', () => {
  it('parses only what was appended, and builds the same conversation as the SDK reading the file', async () => {
    const { file, cache, same } = setup();
    const first = turn(null, 'First task');
    writeFileSync(file, jsonl(first.lines));
    expect(uuids(await same())).toHaveLength(2);
    const second = turn(first.last, 'Second task');
    appendFileSync(file, jsonl(second.lines));
    expect(uuids(await same())).toHaveLength(4);
    expect(cache.stats).toMatchObject({ full: 1, appended: 1 });
  });

  it('BUDGET: a big transcript is read in full once, however many writes follow', async () => {
    const { file, cache, cached } = setup();
    let parent: string | null = null;
    let lines: object[] = [];
    for (let i = 0; i < 300; i++) {
      const next = turn(parent, `Task ${i}`);
      lines = lines.concat(next.lines);
      parent = next.last;
    }
    writeFileSync(file, jsonl(lines));
    await cached.messages(SESSION);
    expect(cache.stats.full).toBe(1);
    // Fifty more turns, one read after each, as the window does while a session writes.
    for (let i = 0; i < 50; i++) {
      const next = turn(parent, `More ${i}`);
      parent = next.last;
      appendFileSync(file, jsonl(next.lines));
      await cached.messages(SESSION);
    }
    expect(cache.stats).toMatchObject({ full: 1, appended: 50 });
  });

  it('serves an unchanged file from memory, one read for reads that come together', async () => {
    const { file, cache, cached } = setup();
    writeFileSync(file, jsonl(turn(null, 'Only task').lines));
    const [a, b, c] = await Promise.all([cached.messages(SESSION), cached.messages(SESSION), cached.messages(SESSION)]);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(cache.stats).toEqual({ full: 1, appended: 0, unchanged: 2 });
  });

  it('waits for a line that is still being written', async () => {
    const { file, same } = setup();
    const first = turn(null, 'First task');
    writeFileSync(file, jsonl(first.lines));
    await same();
    const line = JSON.stringify(turn(first.last, 'Half written').lines[0]);
    appendFileSync(file, line.slice(0, 40));
    expect(await same()).toHaveLength(2);
    appendFileSync(file, `${line.slice(40)}\n`);
    expect(await same()).toHaveLength(3);
  });

  it('uses a last line that has no newline yet when it is complete, as the SDK does', async () => {
    const { file, same } = setup();
    const first = turn(null, 'First task');
    writeFileSync(file, jsonl(first.lines));
    await same();
    const next = turn(first.last, 'No newline yet');
    appendFileSync(file, jsonl(next.lines).trimEnd());
    expect(await same()).toHaveLength(4);
    // The newline and the next turn: the line is read again with them, once.
    appendFileSync(file, `\n${jsonl(turn(next.last, 'Then more').lines)}`);
    expect(await same()).toHaveLength(6);
  });

  it('keeps a big compacted transcript from its last compaction on, and builds what the SDK reads from it', async () => {
    const { file, cache, same } = setup();
    // About 3.6 MB of turns: under the size where the SDK's reader starts at the last compaction.
    const pad = 'x'.repeat(12_000);
    const lines: object[] = [];
    let parent: string | null = null;
    for (let i = 0; i < 100; i++) {
      const t = turn(parent, `Task ${i} ${pad}`);
      lines.push(...t.lines, { type: 'attribution-snapshot', sessionId: SESSION, n: i });
      parent = t.last;
    }
    writeFileSync(file, jsonl(lines));
    await same();
    expect(cache.entries(SESSION, file)).not.toBeNull();
    // A compaction, and the file grows past 5 MB: kept from the compaction on.
    const boundary = uuid();
    const summary = uuid();
    const after = turn(summary, 'After the compaction');
    const compaction = [
      { ...base, parentUuid: null, logicalParentUuid: parent, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', uuid: boundary, timestamp: at(), compactMetadata: { trigger: 'auto', preTokens: 150_000 } },
      { ...base, parentUuid: boundary, type: 'user', uuid: summary, isCompactSummary: true, timestamp: at(), message: { role: 'user', content: 'This session is being continued from a previous conversation.' } },
      ...after.lines,
      { type: 'attribution-snapshot', sessionId: SESSION, n: 'after' },
    ];
    const filler: object[] = [];
    let last = after.last;
    for (let i = 0; i < 60; i++) {
      const t = turn(last, `More ${i} ${pad}`);
      filler.push(...t.lines);
      last = t.last;
    }
    appendFileSync(file, jsonl([...compaction, ...filler]));
    expect(statSync(file).size).toBeGreaterThan(5 * 1024 * 1024);
    const whole = await same();
    expect(whole.some((m) => m.isCompactSummary)).toBe(true);
    expect(cache.entries(SESSION, file)).toBeNull();
    // A compaction that kept the last turn: the SDK's reader does not start from it, nor does the cache.
    const kept = turn(last, 'Kept through the compaction');
    const boundary2 = uuid();
    const summary2 = uuid();
    appendFileSync(
      file,
      jsonl([
        ...kept.lines,
        { ...base, parentUuid: null, logicalParentUuid: kept.last, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', uuid: boundary2, timestamp: at(), compactMetadata: { trigger: 'auto', preTokens: 150_000, preservedMessages: { uuids: [(kept.lines[0] as { uuid: string }).uuid, kept.last], anchorUuid: summary2 } } },
        { ...base, parentUuid: boundary2, type: 'user', uuid: summary2, isCompactSummary: true, timestamp: at(), message: { role: 'user', content: 'Continued, with the last turn kept.' } },
        ...turn(summary2, 'After the second compaction').lines,
      ]),
    );
    await same();
    // A plain compaction again: kept from there on.
    const boundary3 = uuid();
    const summary3 = uuid();
    appendFileSync(
      file,
      jsonl([
        { ...base, parentUuid: null, logicalParentUuid: kept.last, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', uuid: boundary3, timestamp: at(), compactMetadata: { trigger: 'manual', preTokens: 150_000 } },
        { ...base, parentUuid: boundary3, type: 'user', uuid: summary3, isCompactSummary: true, timestamp: at(), message: { role: 'user', content: 'Continued once more.' } },
        ...turn(summary3, 'After the third compaction').lines,
      ]),
    );
    await same();
    expect(cache.stats).toMatchObject({ full: 2, appended: 2 });
  });

  it('reads the whole file again when it shrank, was rewritten or replaced', async () => {
    const { file, cache, same } = setup();
    const first = turn(null, 'First task');
    const second = turn(first.last, 'Second task');
    writeFileSync(file, jsonl([...first.lines, ...second.lines]));
    await same();
    // Shrank.
    truncateSync(file, Buffer.byteLength(jsonl(first.lines)));
    expect(await same()).toHaveLength(2);
    // Rewritten in place, longer than before: the bytes before the old end changed.
    const other = turn(null, 'Another start');
    writeFileSync(file, jsonl([...other.lines, ...turn(other.last, 'And more').lines]));
    expect((await same()).map((m) => (m.message as { content: unknown }).content)).toContain('Another start');
    // Replaced by another file (a new inode).
    writeFileSync(`${file}.new`, jsonl(turn(null, 'Replaced').lines));
    renameSync(`${file}.new`, file);
    expect((await same()).map((m) => (m.message as { content: unknown }).content)).toContain('Replaced');
    expect(cache.stats.full).toBe(4);
    expect(cache.stats.appended).toBe(0);
  });

  it('follows a rewind and a compaction appended to the file, with the earlier parts', async () => {
    const { file, cache, same } = setup();
    const first = turn(null, 'First task');
    const second = turn(first.last, 'Second task');
    writeFileSync(file, jsonl([...first.lines, ...second.lines]));
    await same();
    // A rewind: a new branch from the first answer.
    const branch = turn(first.last, 'Instead, this');
    appendFileSync(file, jsonl(branch.lines));
    expect((await same()).map((m) => (m.message as { content: unknown }).content)).not.toContain('Second task');
    // A compaction, then a turn after it.
    const boundary = uuid();
    const summary = uuid();
    appendFileSync(
      file,
      jsonl([
        { ...base, parentUuid: null, logicalParentUuid: branch.last, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', uuid: boundary, timestamp: at(), compactMetadata: { trigger: 'manual', preTokens: 1000 } },
        { ...base, parentUuid: boundary, type: 'user', uuid: summary, isCompactSummary: true, timestamp: at(), message: { role: 'user', content: 'This session is being continued from a previous conversation.' } },
        ...turn(summary, 'After compaction').lines,
      ]),
    );
    const all = await same();
    expect(all.some((m) => m.isCompactSummary)).toBe(true);
    expect(all.map((m) => (m.message as { content: unknown }).content)).toContain('Instead, this');
    expect(cache.stats.appended).toBe(2);
  });

  it('keeps the least recently read sessions within its budget', async () => {
    // Room for one of these transcripts, not two.
    const { dir, file, cache, cached, paths } = setup(1000);
    writeFileSync(file, jsonl(turn(null, 'First task').lines));
    const otherFile = join(dir, 'projects', '-tmp-project', `${OTHER}.jsonl`);
    writeFileSync(otherFile, jsonl(turn(null, 'Other task').lines.map((l) => ({ ...l, sessionId: OTHER }))));
    expect(statSync(file).size).toBeLessThan(1000);
    expect(statSync(file).size + statSync(otherFile).size).toBeGreaterThan(1000);
    paths.set(OTHER, otherFile);
    await cached.messages(SESSION);
    await cached.messages(OTHER);
    expect(cache.entries(SESSION, file)).toBeNull();
    expect(cache.entries(OTHER, otherFile)).not.toBeNull();
  });

  it('falls back to the SDK when the file it was given is gone, and reads files of another folder the SDK way', async () => {
    const { file, cache, cached, plain, paths } = setup();
    writeFileSync(file, jsonl(turn(null, 'First task').lines));
    paths.set(SESSION, join(file, '..', 'missing.jsonl'));
    expect(await cached.messages(SESSION)).toEqual(await plain.messages(SESSION));
    paths.set(SESSION, join(tmpdir(), 'elsewhere', `${SESSION}.jsonl`));
    expect(await cached.messages(SESSION)).toEqual(await plain.messages(SESSION));
    expect(cache.stats).toEqual({ full: 0, appended: 0, unchanged: 0 });
  });

  it('skips lines that are not JSON, as the SDK does', () => {
    expect(parseLines('{"type":"user","uuid":"a"}\nnot json\n\n{"no":"type"}\n{"type":"x"}\n').map((e) => e.type)).toEqual(['user', 'x']);
  });
});

describe('TranscriptHub over the cache', () => {
  it('shows what the file has after appends, a switch away and back, and a rewrite', async () => {
    const { file, cached, plain } = setup();
    const first = turn(null, 'First task');
    writeFileSync(file, jsonl(first.lines));
    const hub = new TranscriptHub(cached, () => {});
    const shown: string[] = [];
    const apply = (u: TranscriptUpdate) => {
      if (u.mode === 'replace') shown.length = 0;
      shown.push(...uuids(u.messages));
    };
    const fromFile = async () => uuids(await plain.messages(SESSION));
    const until = async (check: () => boolean | Promise<boolean>) => {
      const start = Date.now();
      while (!(await check())) {
        if (Date.now() - start > 3000) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 20));
      }
    };
    let stop = hub.watch(SESSION, apply);
    await until(async () => shown.join() === (await fromFile()).join());
    const second = turn(first.last, 'Second task');
    appendFileSync(file, jsonl(second.lines));
    hub.changed(SESSION);
    await until(async () => shown.length === 4 && shown.join() === (await fromFile()).join());
    // Away and back, with a turn written meanwhile.
    stop();
    appendFileSync(file, jsonl(turn(second.last, 'Third task').lines));
    const updates: TranscriptUpdate[] = [];
    stop = hub.watch(SESSION, (u) => (updates.push(u), apply(u)));
    await until(() => updates.length === 1);
    expect(shown).toEqual(await fromFile());
    // Rewritten: the window gets the new list whole.
    writeFileSync(file, jsonl(turn(null, 'Started over').lines));
    hub.changed(SESSION);
    await until(async () => shown.join() === (await fromFile()).join());
    expect(updates.at(-1)!.mode).toBe('replace');
    stop();
    hub.stop();
    expect(readFileSync(file, 'utf8')).toContain('Started over');
  });
});
