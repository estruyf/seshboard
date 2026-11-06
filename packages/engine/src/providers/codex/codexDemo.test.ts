import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CODEX_DEMO_REFUSAL, CODEX_DEMO_THREADS, codexDemoRollout, demoCodex } from './codexDemo.ts';
import { codexProvider } from './codexProvider.ts';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A demo home's `.codex` with the rollout files the demo writes (`writeCodexDemo`). */
function codexHome(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'codex-demo-')));
  dirs.push(dir);
  const day = join(dir, 'sessions', '2026', '11', '06');
  mkdirSync(day, { recursive: true });
  for (const thread of CODEX_DEMO_THREADS) writeFileSync(join(day, `rollout-2026-11-06T10-00-00-${thread.id}.jsonl`), codexDemoRollout(thread, '/demo/acme-store', new Date()));
  return dir;
}

describe('the demo Codex', () => {
  it('lists the threads with a rollout file, signed in, and reads their conversations with tool calls', async () => {
    const dir = codexHome();
    const adapter = codexProvider({ profileId: 'codex', codexHome: dir, userHome: dir, shellEnv: async () => ({}), ...demoCodex() });
    const listed = await adapter.source.list();
    expect(listed.map((s) => s.sessionId).sort()).toEqual(CODEX_DEMO_THREADS.map((t) => t.id).sort());
    expect(listed.every((s) => s.provider === 'codex' && s.cwd === '/demo/acme-store' && s.origin === 'cli')).toBe(true);
    expect(await adapter.status!()).toMatchObject({ binary: '/demo/bin/codex', signedIn: true, problem: null });
    expect([...adapter.files.files().keys()].sort()).toEqual(CODEX_DEMO_THREADS.map((t) => t.id).sort());
    const messages = await adapter.source.messages(CODEX_DEMO_THREADS[0]!.id);
    const blocks = messages.flatMap((m) => {
      const content = (m.message as { content?: unknown } | undefined)?.content;
      return Array.isArray(content) ? (content as Array<{ type?: string; name?: string }>) : [];
    });
    const tools = blocks.filter((b) => b.type === 'tool_use').map((b) => b.name);
    expect(tools).toContain('Read');
    expect(tools).toContain('Edit');
  });

  it('leaves out a thread whose rollout file is gone (Delete moved it to the Trash)', async () => {
    const dir = codexHome();
    rmSync(join(dir, 'sessions', '2026', '11', '06', `rollout-2026-11-06T10-00-00-${CODEX_DEMO_THREADS[1]!.id}.jsonl`));
    const adapter = codexProvider({ profileId: 'codex', codexHome: dir, userHome: dir, shellEnv: async () => ({}), ...demoCodex() });
    expect((await adapter.source.list()).map((s) => s.sessionId)).toEqual([CODEX_DEMO_THREADS[0]!.id]);
  });

  it('lists its models with their efforts, and refuses to start or continue a session', async () => {
    const dir = codexHome();
    const { createAppServer, binary } = demoCodex();
    const server = createAppServer({ binary, env: async () => ({ CODEX_HOME: dir }) });
    const { data } = await server.request('model/list', {});
    expect(data.map((m) => [m.id, m.supportedReasoningEfforts.map((e) => e.reasoningEffort), m.isDefault])).toEqual([
      ['gpt-5.3-codex', ['low', 'medium', 'high', 'xhigh'], true],
      ['gpt-5.3-codex-mini', ['medium', 'high'], false],
      ['gpt-5.2', [], false],
    ]);
    await expect(server.request('thread/start', { cwd: '/demo/acme-store' } as never)).rejects.toThrow(CODEX_DEMO_REFUSAL);
    await expect(server.request('turn/start', { threadId: CODEX_DEMO_THREADS[0]!.id, input: [] } as never)).rejects.toThrow(CODEX_DEMO_REFUSAL);
    // The rest of the interface does nothing: nothing runs.
    expect(server.pid()).toBeNull();
    server.handleRequests(null);
    server.onNotification(() => {})();
    server.hold()();
    server.onExit(() => {})();
  });
});
