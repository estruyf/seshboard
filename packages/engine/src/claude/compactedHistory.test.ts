import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { IDLE_COMPACTION_MAX_GAP_MS, IDLE_COMPACTION_MIN_GAP_MS, isIdleCompaction, joinParts } from './compactedHistory.ts';
import { sdkSessionSource } from './sessionSource.ts';
import type { RawSessionMessage } from './transcript.ts';

const SESSION = '0b0e6f0a-5c1e-4c9a-9d3e-6b7a1f2c3d4e';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

/** A transcript in Claude Code's format: a conversation, compacted `compactions` times, a turn after each. */
function transcript(compactions: number, boundaryAt: { trigger?: string; quietMs?: number; version?: string; preTokens?: number } = {}): { lines: object[]; prompts: string[] } {
  const lines: object[] = [];
  const prompts: string[] = [];
  const base = { isSidechain: false, sessionId: SESSION, cwd: '/tmp/project', version: '2.1.287', userType: 'external' };
  let parent: string | null = null;
  let time = Date.parse('2026-10-11T10:00:00.000Z');
  const at = () => new Date((time += 1000)).toISOString();
  const turn = (text: string) => {
    const user = uuid();
    const answer = uuid();
    prompts.push(text);
    lines.push({ ...base, parentUuid: parent, type: 'user', uuid: user, timestamp: at(), message: { role: 'user', content: text } });
    lines.push({ ...base, parentUuid: user, type: 'assistant', uuid: answer, timestamp: at(), message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: `Done: ${text}` }] } });
    parent = answer;
  };
  turn('First task');
  turn('Second task');
  for (let i = 0; i < compactions; i++) {
    const boundary = uuid();
    const summary = uuid();
    lines.push({ type: 'last-prompt', sessionId: SESSION });
    time += boundaryAt.quietMs ?? 0;
    lines.push({ ...base, ...(boundaryAt.version ? { version: boundaryAt.version } : {}), parentUuid: null, logicalParentUuid: parent, type: 'system', subtype: 'compact_boundary', content: 'Conversation compacted', uuid: boundary, timestamp: at(), compactMetadata: { trigger: boundaryAt.trigger ?? 'manual', preTokens: boundaryAt.preTokens ?? 1000 } });
    lines.push({ ...base, parentUuid: boundary, type: 'user', uuid: summary, isCompactSummary: true, timestamp: at(), message: { role: 'user', content: 'This session is being continued from a previous conversation.' } });
    parent = summary;
    turn(`Task after compaction ${i + 1}`);
  }
  return { lines, prompts };
}

function configWith(lines: object[]): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-compacted-')));
  dirs.push(dir);
  mkdirSync(join(dir, 'projects', '-tmp-project'), { recursive: true });
  writeFileSync(join(dir, 'projects', '-tmp-project', `${SESSION}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return dir;
}

/** The session source with CLAUDE_CONFIG_DIR pointing at `dir`, as ConfigDirLane does. */
function sourceFor(dir: string) {
  return sdkSessionSource(async (fn) => {
    const before = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = dir;
    try {
      return await fn();
    } finally {
      if (before === undefined) delete process.env.CLAUDE_CONFIG_DIR;
      else process.env.CLAUDE_CONFIG_DIR = before;
    }
  });
}

const text = (m: RawSessionMessage) => {
  const content = (m.message as { content?: unknown; subtype?: string }).content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return (content[0] as { text: string }).text;
  return `[${(m.message as { subtype?: string }).subtype}]`;
};

describe('compacted conversations', () => {
  it('reads the whole conversation, with a notice where each compaction was', async () => {
    const { lines } = transcript(2);
    const messages = await sourceFor(configWith(lines)).messages(SESSION);
    expect(messages.map(text)).toEqual([
      'First task',
      'Done: First task',
      'Second task',
      'Done: Second task',
      '[compact_boundary]',
      'This session is being continued from a previous conversation.',
      'Task after compaction 1',
      'Done: Task after compaction 1',
      '[compact_boundary]',
      'This session is being continued from a previous conversation.',
      'Task after compaction 2',
      'Done: Task after compaction 2',
    ]);
    expect(new Set(messages.map((m) => m.uuid)).size).toBe(messages.length);
  });

  it('leaves a conversation that was never compacted as the reader returns it', async () => {
    const { lines, prompts } = transcript(0);
    const messages = await sourceFor(configWith(lines)).messages(SESSION);
    expect(messages.filter((m) => m.type === 'user').map(text)).toEqual(prompts);
    expect(messages).toHaveLength(4);
  });

  it('shows what was kept through a compaction where it was first said', () => {
    const m = (id: string): RawSessionMessage => ({ type: 'user', uuid: id, message: {}, parent_tool_use_id: null });
    expect(joinParts([m('a'), m('b'), m('notice')], [m('summary'), m('b'), m('c')]).map((x) => x.uuid)).toEqual(['a', 'b', 'notice', 'summary', 'c']);
  });
});

describe('idle compaction', () => {
  const idleOf = async (lines: object[]) => (await sourceFor(configWith(lines)).messages(SESSION)).filter((m) => m.type === 'system').map((m) => (m.message as { idle?: boolean }).idle === true);

  /** An automatic compaction by Claude Code 2.1.311, 54 minutes after the last message, over 100K tokens: what idle compaction writes. */
  const idle = { trigger: 'auto', quietMs: 54 * 60_000, version: '2.1.311', preTokens: 150_000 };
  const t = (minutes: number) => new Date(Date.parse('2026-10-11T10:00:00.000Z') + minutes * 60_000).toISOString();

  it('marks an automatic compaction 54 minutes after the last message, of a big enough conversation', async () => {
    expect(await idleOf(transcript(1, idle).lines)).toEqual([true]);
  });

  it('leaves a compaction as it was when it does not look like the idle timer', async () => {
    // Inside a turn.
    expect(await idleOf(transcript(1, { ...idle, quietMs: 30_000 }).lines)).toEqual([false]);
    // Asked for.
    expect(await idleOf(transcript(1, { ...idle, trigger: 'manual' }).lines)).toEqual([false]);
    // Too long a pause: the timer is skipped when it is late.
    expect(await idleOf(transcript(1, { ...idle, quietMs: 3 * 60 * 60_000 }).lines)).toEqual([false]);
    // Too small a conversation.
    expect(await idleOf(transcript(1, { ...idle, preTokens: 50_000 }).lines)).toEqual([false]);
    // A Claude Code from before idle compaction.
    expect(await idleOf(transcript(1, { ...idle, version: '2.1.287' }).lines)).toEqual([false]);
  });

  it('keeps the window to 45 to 62 minutes', () => {
    const entries = (minutes: number) => [
      { type: 'user', uuid: 'u1', timestamp: t(0) },
      { type: 'assistant', uuid: 'a1', timestamp: t(1) },
      { type: 'system', uuid: 'b1', subtype: 'compact_boundary', timestamp: t(1 + minutes), compactMetadata: { trigger: 'auto' } },
    ];
    expect(IDLE_COMPACTION_MIN_GAP_MS).toBe(45 * 60_000);
    expect(IDLE_COMPACTION_MAX_GAP_MS).toBe(62 * 60_000);
    expect([44, 45, 54, 62, 63].map((m) => isIdleCompaction(entries(m), 2))).toEqual([false, true, true, true, false]);
  });

  it('judges from what the boundary says, and says no when it cannot tell', () => {
    const message = { type: 'assistant', uuid: 'a1', timestamp: t(0) };
    const boundary = (patch: object) => ({ type: 'system', uuid: 'b1', subtype: 'compact_boundary', timestamp: t(54), compactMetadata: { trigger: 'auto' }, ...patch });
    // Without a version or a token count there is nothing to rule it out.
    expect(isIdleCompaction([message, boundary({})], 1)).toBe(true);
    expect(isIdleCompaction([message, boundary({ version: '2.1.299', compactMetadata: { trigger: 'auto', preTokens: 100_000 } })], 1)).toBe(true);
    expect(isIdleCompaction([message, boundary({ version: '2.1.298' })], 1)).toBe(false);
    // No trigger, no earlier message to be quiet since, a time that isn't one, or no such entry.
    expect(isIdleCompaction([message, boundary({ compactMetadata: {} })], 1)).toBe(false);
    expect(isIdleCompaction([boundary({})], 0)).toBe(false);
    expect(isIdleCompaction([message, boundary({ timestamp: 'not a date' })], 1)).toBe(false);
    expect(isIdleCompaction([message], 5)).toBe(false);
  });
});
