import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fakeAcpConnection } from '../acp/acpFakes.ts';
import { antigravityUsage } from '../../usage/providerUsage.ts';
import { agyCandidates } from './agyBinary.ts';
import { agyFiles, agyLogFile, agyPromptTimes, agyTrashPaths } from './agyFiles.ts';
import { agyModeId, agyThoughtLevel } from './agyModes.ts';
import { agySessionSource } from './agySource.ts';
import { AGY_DEMO_CONFIG } from './agyDemo.ts';

const A = '7a1c0e52-4b3d-4e8f-9a10-00000000000a';
const B = '7a1c0e52-4b3d-4e8f-9a10-00000000000b';

/** A profile folder with a conversation's log and history, as Antigravity CLI leaves them. */
function geminiDir() {
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-agy-'));
  const data = join(dir, 'antigravity-cli');
  mkdirSync(join(data, 'brain', A, '.system_generated', 'logs'), { recursive: true });
  mkdirSync(join(data, 'brain', B, 'scratch'), { recursive: true });
  mkdirSync(join(data, 'conversations'), { recursive: true });
  writeFileSync(join(data, 'conversations', `${A}.db`), 'x');
  writeFileSync(
    agyLogFile(dir, A),
    [
      JSON.stringify({ step_index: 0, type: 'USER_INPUT', created_at: '2026-11-19T16:26:23Z' }),
      JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', created_at: '2026-11-19T16:26:24Z', model: 'gemini-3.8-flash-medium', input_tokens: 9021, cache_read_tokens: 100, output_tokens: 358 }),
      JSON.stringify({ step_index: 2, type: 'USER_INPUT', created_at: '2026-11-19T16:30:00Z' }),
      '{"cut short',
    ].join('\n'),
  );
  return dir;
}

describe('Antigravity files', () => {
  it('finds each conversation by its step log, and what Delete moves to the Trash', () => {
    const dir = geminiDir();
    const files = agyFiles(dir);
    // A conversation left without a prompt has no log: Antigravity doesn't list it either.
    expect([...files.files().keys()]).toEqual([A]);
    expect(files.sessionOf(`${A}/.system_generated/logs/transcript.jsonl`)).toEqual({ sessionId: A, file: agyLogFile(dir, A) });
    expect(files.sessionOf(`${A}\\.system_generated\\logs\\transcript.jsonl`)?.sessionId).toBe(A);
    expect(files.sessionOf(`${A}/scratch/transcript.jsonl`)).toBeNull();
    expect(agyTrashPaths(dir, A)).toEqual([join(dir, 'antigravity-cli', 'conversations', `${A}.db`), join(dir, 'antigravity-cli', 'brain', A)]);
    expect(agyTrashPaths(dir, '../x')).toEqual([]);
    expect(agyPromptTimes(agyLogFile(dir, A))).toEqual([Date.parse('2026-11-19T16:26:23Z'), Date.parse('2026-11-19T16:30:00Z')]);
  });

  it("counts each model call's tokens from the step log, and nothing from another file", () => {
    const dir = geminiDir();
    const lines = [JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', created_at: '2026-11-19T16:26:24Z', model: 'gemini-3.8-flash-medium', input_tokens: 9021, cache_read_tokens: 100, output_tokens: 358 })];
    expect(antigravityUsage(lines, agyLogFile(dir, A))).toEqual([
      { key: `antigravity|${A}|1`, sessionId: A, at: Date.parse('2026-11-19T16:26:24Z'), model: 'gemini-3.8-flash-medium', cwd: null, input: 9021, output: 358, cacheRead: 100, cacheWrite: 0, cacheWrite1h: 0, fast: false },
    ]);
    expect(antigravityUsage(lines, join(dir, 'antigravity-cli', 'brain', A, 'scratch', 'transcript.jsonl'))).toEqual([]);
  });

  it('finds agy where its installer puts it, and maps modes and thinking levels', () => {
    expect(agyCandidates({ PATH: '/usr/bin' }, '/Users/me', 'darwin').slice(0, 2)).toEqual(['/usr/bin/agy', '/Users/me/.local/bin/agy']);
    expect(agyCandidates({ Path: 'C:\\bin', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }, 'C:\\Users\\me', 'win32').slice(0, 2)).toEqual(['C:\\bin\\agy.exe', 'C:\\Users\\me\\AppData\\Local\\agy\\bin\\agy.exe']);
    expect([agyModeId('acceptEdits'), agyModeId('auto', true), agyModeId('bypassPermissions')]).toEqual(['accept-edits', 'default', 'default']);
    expect([agyThoughtLevel('max', AGY_DEMO_CONFIG), agyThoughtLevel('low', AGY_DEMO_CONFIG)]).toEqual(['xhigh', 'low']);
  });
});

describe('agySessionSource', () => {
  it('lists through session/list, and reads a conversation from its replay, then lets go of it', async () => {
    const dir = geminiDir();
    const fake = fakeAcpConnection({
      'session/list': { sessions: [{ sessionId: A, cwd: '/w/shop', title: 'Fix The Cart', updatedAt: '2026-11-19T16:31:00Z' }, { sessionId: 'not-an-id' }] },
      'session/load': () => {
        fake.update(A, { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Fix the cart' } });
        fake.update(B, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'another session' } });
        fake.update(A, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Fixed.' } });
        return { sessionId: A, configOptions: AGY_DEMO_CONFIG };
      },
      'session/close': {},
    });
    const source = agySessionSource(fake.connection, { geminiDir: dir });
    expect(await source.list()).toEqual([{ sessionId: A, provider: 'antigravity', summary: 'Fix The Cart', customTitle: 'Fix The Cart', lastModified: Date.parse('2026-11-19T16:31:00Z'), cwd: '/w/shop', fileSize: 1, origin: 'cli' }]);
    const messages = await source.messages(A);
    expect(messages.map((m) => [m.uuid, m.timestamp])).toEqual([
      [`${A}~u1`, '2026-11-19T16:26:23.000Z'],
      [`${A}~u1~1`, '2026-11-19T16:26:23.000Z'],
    ]);
    expect(fake.requests.map((r) => r.method).filter((m) => m !== 'session/list')).toEqual(['session/load', 'session/close']);
    // Read again for nothing (its log is the same): from the last read.
    await source.messages(A);
    expect(fake.requests.filter((r) => r.method === 'session/load')).toHaveLength(1);
    // An id Antigravity doesn't list is never loaded: `session/load` would answer for it all the same.
    expect(await source.messages(B)).toEqual([]);
    expect(fake.requests.filter((r) => r.method === 'session/load')).toHaveLength(1);
    source.named(A, 'Free Shipping');
    expect((await source.info(A))?.summary).toBe('Free Shipping');
  });

  it('keeps the last list when agy fails, and logs it once', async () => {
    const dir = geminiDir();
    let fail = false;
    const logs: string[] = [];
    const fake = fakeAcpConnection({
      'session/list': () => {
        if (fail) throw new Error('gone');
        return { sessions: [{ sessionId: A, cwd: '/w', title: 'One', updatedAt: '2026-11-19T16:31:00Z' }] };
      },
    });
    let changes = 'a';
    const source = agySessionSource(fake.connection, { geminiDir: dir, log: (_l, m) => logs.push(m), changes: () => changes });
    expect(await source.list()).toHaveLength(1);
    // Nothing changed: answered without asking.
    await source.list();
    expect(fake.requests).toHaveLength(1);
    fail = true;
    changes = 'b';
    expect(await source.list()).toHaveLength(1);
    changes = 'c';
    await source.list();
    expect(logs).toEqual(['Antigravity: listing sessions failed: gone']);
  });
});
