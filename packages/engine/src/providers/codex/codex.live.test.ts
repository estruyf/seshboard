/**
 * Real `codex app-server`, the user's own `codex`, with `CODEX_HOME` set to a new empty folder: never the user's
 * `~/.codex`. No prompt, no tokens and no login: it only reads.
 * Opt-in: SESHBOARD_LIVE_CODEX=1 npx vitest run codex.live
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAppServer } from './appServer.ts';
import { findCodex } from './codexBinary.ts';

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
      rmSync(codexHome, { recursive: true, force: true });
    }
  }, 60_000);
});
