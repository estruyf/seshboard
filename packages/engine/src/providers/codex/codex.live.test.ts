/**
 * Real `codex app-server`, the user's own `codex`, with `CODEX_HOME` set to a new empty folder: never the user's
 * `~/.codex`. No prompt, no tokens and no login: it reads, and starts a thread without a turn.
 * Opt-in: SESHBOARD_LIVE_CODEX=1 npx vitest run codex.live
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServer } from './appServer.ts';
import { findCodex } from './codexBinary.ts';
import { codexLocks, lockFile } from './codexInUse.ts';
import { codexCapabilities } from './codexTools.ts';
import type { ServerNotification } from './protocol.ts';

const until = async (condition: () => boolean, ms = 15_000) => {
  const end = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > end) throw new Error('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

/** Tries `rm` again for a moment: Codex may still be writing its housekeeping files as it ends. */
const remove = async (dir: string) => {
  for (let i = 0; i < 20; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
};

describe.skipIf(process.env.SESHBOARD_LIVE_CODEX !== '1')('live codex app-server', () => {
  it('starts in an empty CODEX_HOME, lists no threads and has no account', async () => {
    const binary = await findCodex(process.env, homedir());
    expect(binary).not.toBeNull();
    const codexHome = mkdtempSync(join(tmpdir(), 'seshboard-codex-live-'));
    const server = createAppServer({ binary: async () => binary, env: async () => ({ ...process.env, CODEX_HOME: codexHome }) });
    try {
      const list = await server.request('thread/list', {});
      expect(list).toMatchObject({ data: [], nextCursor: null });
      const account = await server.request('account/read', {});
      expect(account.account).toBeNull();
      expect(server.pid()).toEqual(expect.any(Number));
    } finally {
      await server.dispose();
      await remove(codexHome);
    }
  }, 60_000);

  it('starts a thread with the experimental API, holds its lock, and lets it go on unsubscribe', async () => {
    const found = await findCodex(process.env, homedir());
    expect(found).not.toBeNull();
    // Unloaded at once when nobody listens (60 s by default), so the lock goes within the test.
    const binary = { ...found!, args: [...(found!.args ?? []), '-c', 'thread_unload_delay_secs=0'] };
    const codexHome = mkdtempSync(join(tmpdir(), 'seshboard-codex-live-'));
    const cwd = mkdtempSync(join(tmpdir(), 'seshboard-codex-live-cwd-'));
    const server = createAppServer({ binary: async () => binary, env: async () => ({ ...process.env, CODEX_HOME: codexHome }), experimentalApi: true });
    const notifications: ServerNotification[] = [];
    server.onNotification((n) => notifications.push(n));
    try {
      const { thread } = await server.request('thread/start', { cwd });
      await until(() => notifications.some((n) => n.method === 'thread/started'));
      const lock = lockFile(codexHome, thread.id);
      expect(existsSync(lock)).toBe(true);
      // Held by Seshboard's own app-server: open elsewhere only for someone who doesn't count its pid as their own.
      if (process.platform === 'darwin') {
        expect(await codexLocks(codexHome).openThreads([thread.id], new Set([server.pid()!]))).toEqual(new Set());
        expect(await codexLocks(codexHome).openThreads([thread.id], new Set())).toEqual(new Set([thread.id]));
      }
      expect(await server.request('thread/unsubscribe', { threadId: thread.id })).toMatchObject({ status: 'unsubscribed' });
      await until(() => notifications.some((n) => n.method === 'thread/closed'));
      await until(() => !existsSync(lock));
    } finally {
      await server.dispose();
      await remove(codexHome);
      await remove(cwd);
    }
  }, 60_000);

  it("lists a thread's MCP servers, skills and hooks, names it, and starts its compaction (signed out: no tokens)", async () => {
    const found = await findCodex(process.env, homedir());
    expect(found).not.toBeNull();
    const binary = { ...found!, args: [...(found!.args ?? []), '-c', 'thread_unload_delay_secs=0'] };
    const codexHome = mkdtempSync(join(tmpdir(), 'seshboard-codex-live-'));
    const cwd = mkdtempSync(join(tmpdir(), 'seshboard-codex-live-cwd-'));
    // One MCP server that can't start, one turned off, and a skill of the folder's.
    writeFileSync(join(codexHome, 'config.toml'), '[mcp_servers.broken]\ncommand = "false"\n\n[mcp_servers.off]\ncommand = "false"\nenabled = false\n');
    mkdirSync(join(cwd, '.codex', 'skills', 'hello'), { recursive: true });
    writeFileSync(join(cwd, '.codex', 'skills', 'hello', 'SKILL.md'), '---\nname: hello\ndescription: Says hello\n---\nSay hello.\n');
    // No API key either: the compaction must fail at OpenAI's door, not spend anything.
    const { OPENAI_API_KEY: _key, CODEX_API_KEY: _codexKey, ...env } = process.env;
    const server = createAppServer({ binary: async () => binary, env: async () => ({ ...env, CODEX_HOME: codexHome }), experimentalApi: true });
    const notifications: ServerNotification[] = [];
    server.onNotification((n) => notifications.push(n));
    try {
      expect((await server.request('account/read', {})).account).toBeNull();
      const { thread } = await server.request('thread/start', { cwd });
      await until(() => notifications.some((n) => n.method === 'mcpServer/startupStatus/updated' && (n.params as { status?: string }).status === 'failed'));
      const [mcp, skills, hooks] = await Promise.all([
        server.request('mcpServerStatus/list', { threadId: thread.id, detail: 'toolsAndAuthOnly' }),
        server.request('skills/list', { cwds: [cwd] }),
        server.request('hooks/list', { threadId: thread.id }),
      ]);
      const caps = codexCapabilities({ live: true, mcp: mcp.data, skills: skills.data.flatMap((e) => e.skills), hooks: hooks.data.flatMap((e) => e.hooks) });
      expect(caps.mcp).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'broken', status: 'failed' }), expect.objectContaining({ name: 'off', status: 'disabled' })]));
      expect(caps.commands).toContainEqual({ name: 'hello', description: 'Says hello', argumentHint: '' });
      expect(caps.hooks).toEqual([]);
      await server.request('config/mcpServer/reload', {});

      await server.request('thread/name/set', { threadId: thread.id, name: 'Seshboard live name' });
      await until(() => notifications.some((n) => n.method === 'thread/name/updated'));
      expect((await server.request('thread/read', { threadId: thread.id })).thread.name).toBe('Seshboard live name');

      // A turn of its own, with a `contextCompaction` item, that fails signed out.
      await server.request('thread/compact/start', { threadId: thread.id });
      await until(() => notifications.some((n) => n.method === 'turn/completed'), 45_000);
      const methods = notifications.map((n) => n.method);
      expect(methods).toContain('turn/started');
      expect(notifications.some((n) => n.method === 'item/started' && (n.params as { item?: { type?: string } }).item?.type === 'contextCompaction')).toBe(true);
      expect(notifications.find((n) => n.method === 'turn/completed')?.params).toMatchObject({ turn: { status: 'failed' } });
    } finally {
      await server.dispose();
      await remove(codexHome);
      await remove(cwd);
    }
  }, 90_000);
});
