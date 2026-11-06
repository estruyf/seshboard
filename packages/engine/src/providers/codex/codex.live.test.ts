/**
 * Real `codex app-server`, the user's own `codex`, with `CODEX_HOME` set to a new empty folder: never the user's
 * `~/.codex`. No prompt, no tokens and no login: it reads, and starts a thread without a turn.
 * Opt-in: SESHBOARD_LIVE_CODEX=1 npx vitest run codex.live
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServer } from './appServer.ts';
import { findCodex } from './codexBinary.ts';
import { lockFile, openThreads } from './codexInUse.ts';
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
        expect(await openThreads(codexHome, [thread.id], new Set([server.pid()!]))).toEqual(new Set());
        expect(await openThreads(codexHome, [thread.id], new Set())).toEqual(new Set([thread.id]));
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
});
