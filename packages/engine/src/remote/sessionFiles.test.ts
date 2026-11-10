import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TranscriptMessage } from '@seshboard/protocol';
import { canSymlink } from '../util/canSymlink.ts';
import { inScratchpad, sessionFile, writtenPaths } from './sessionFiles.ts';

const SESSION = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

const cleanups: string[] = [];
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-session-files-')));
  cleanups.push(dir);
  return dir;
}

/** A Write call and its result, as one assistant and one user message. `result: null` is a call still waiting. */
function write(id: string, path: string, result: 'ok' | 'error' | null = 'ok'): TranscriptMessage[] {
  const call: TranscriptMessage = { uuid: `${id}-call`, role: 'assistant', timestamp: 1, parentToolUseId: null, model: null, blocks: [{ type: 'tool_use', id, name: 'Write', input: { file_path: path, content: 'x' }, truncated: false }] };
  if (!result) return [call];
  return [call, { uuid: `${id}-result`, role: 'user', timestamp: 2, parentToolUseId: null, model: null, blocks: [{ type: 'tool_result', toolUseId: id, isError: result === 'error', text: '', truncated: false, images: [] }] }];
}

const says = (text: string): TranscriptMessage => ({ uuid: 'said', role: 'assistant', timestamp: 3, parentToolUseId: null, model: null, blocks: [{ type: 'text', text }] });

describe('writtenPaths', () => {
  it('keeps the Write calls that finished without an error', () => {
    const messages = [...write('t1', '/a/done.md'), ...write('t2', '/a/failed.md', 'error'), ...write('t3', '/a/waiting.md', null), ...write('t4', 'relative.md')];
    expect([...writtenPaths(messages)]).toEqual([resolve('/a/done.md')]);
  });

  it('ignores other tools that name a path', () => {
    const read: TranscriptMessage = { uuid: 'r', role: 'assistant', timestamp: 1, parentToolUseId: null, model: null, blocks: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/etc/hosts.txt' }, truncated: false }] };
    const done: TranscriptMessage = { uuid: 'd', role: 'user', timestamp: 2, parentToolUseId: null, model: null, blocks: [{ type: 'tool_result', toolUseId: 'r1', isError: false, text: '', truncated: false, images: [] }] };
    expect(writtenPaths([read, done]).size).toBe(0);
  });
});

describe('inScratchpad', () => {
  const root = join(tmpdir(), 'root');
  const pad = (session: string, ...rest: string[]) => join(root, 'claude-501', '-Users-me-web', session, 'scratchpad', ...rest);

  it('takes a file in the session own scratchpad, at any depth', () => {
    expect(inScratchpad(pad(SESSION, 'review.md'), SESSION, [root])).toBe(true);
    expect(inScratchpad(pad(SESSION, 'shots', 'home.png'), SESSION, [root])).toBe(true);
  });

  it('refuses another session, the scratchpad folder itself, other folders and other roots', () => {
    expect(inScratchpad(pad(OTHER, 'review.md'), SESSION, [root])).toBe(false);
    expect(inScratchpad(pad(SESSION), SESSION, [root])).toBe(false);
    expect(inScratchpad(join(root, 'claude-501', '-Users-me-web', SESSION, 'notes', 'a.md'), SESSION, [root])).toBe(false);
    expect(inScratchpad(join(root, 'other', '-Users-me-web', SESSION, 'scratchpad', 'a.md'), SESSION, [root])).toBe(false);
    expect(inScratchpad(pad(SESSION, 'review.md'), SESSION, [join(tmpdir(), 'elsewhere')])).toBe(false);
    expect(inScratchpad(join(root, '..', 'x', 'claude-501', 'p', SESSION, 'scratchpad', 'a.md'), SESSION, [root])).toBe(false);
  });
});

describe('sessionFile', () => {
  it('gives a file Claude wrote, and the same NOT_FOUND for every other path', async () => {
    const dir = tempDir();
    const written = join(dir, 'report.md');
    const named = join(dir, 'named.md');
    writeFileSync(written, '# Report');
    writeFileSync(named, 'secret');
    const messages = [...write('t1', written), ...write('t2', join(dir, 'gone.md')), says(`See ${named}`)];
    expect(await sessionFile(written, SESSION, messages, [])).toBe(written);
    const refused = { code: 'NOT_FOUND', message: 'That file is not one this session made' };
    // Named in a reply only, written but gone, a folder, a relative path.
    await expect(sessionFile(named, SESSION, messages, [])).rejects.toMatchObject(refused);
    await expect(sessionFile(join(dir, 'gone.md'), SESSION, messages, [])).rejects.toMatchObject(refused);
    await expect(sessionFile(dir, SESSION, [...write('t3', dir)], [])).rejects.toMatchObject(refused);
    await expect(sessionFile('report.md', SESSION, messages, [])).rejects.toMatchObject(refused);
  });

  it('refuses a written path that became a link', async () => {
    if (!canSymlink()) return;
    const dir = tempDir();
    const secret = join(dir, 'secret.md');
    const written = join(dir, 'report.md');
    writeFileSync(secret, 'secret');
    symlinkSync(secret, written);
    await expect(sessionFile(written, SESSION, write('t1', written), [])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('gives a file in the session scratchpad without a Write, and not through a link out of it', async () => {
    const root = tempDir();
    const pad = join(root, 'claude-501', '-Users-me-web', SESSION, 'scratchpad');
    mkdirSync(pad, { recursive: true });
    writeFileSync(join(pad, 'review.md'), '# Review');
    expect(await sessionFile(join(pad, 'review.md'), SESSION, [], [root])).toBe(join(pad, 'review.md'));
    await expect(sessionFile(join(pad, 'review.md'), OTHER, [], [root])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A folder in the scratchpad that links elsewhere: the real path is outside it.
    if (!canSymlink()) return;
    const outside = tempDir();
    writeFileSync(join(outside, 'secret.md'), 'secret');
    symlinkSync(outside, join(pad, 'out'));
    await expect(sessionFile(join(pad, 'out', 'secret.md'), SESSION, [], [root])).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
