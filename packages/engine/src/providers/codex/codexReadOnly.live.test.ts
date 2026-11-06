/**
 * Real `codex app-server` in a new, empty `CODEX_HOME` (never the user's `~/.codex`), with an MCP server and a trusted
 * hook that each leave a marker file when they run: a read-only session and Ask about this session's fork start
 * neither, while a session that may write starts the server. No login, so no tokens: Ask's turn fails before a model
 * is asked. Opt-in: SESHBOARD_LIVE_CODEX=1 npx vitest run codexReadOnly.live
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DriverEvents } from '../provider.ts';
import { createAppServer } from './appServer.ts';
import { findCodex } from './codexBinary.ts';
import { codexDriver } from './codexDriver.ts';

const events: DriverEvents = { stream() {}, messages() {}, state() {}, permission() {}, permissionDone() {}, usage() {}, model() {} };
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe.skipIf(process.env.SESHBOARD_LIVE_CODEX !== '1')('live: what a read-only Codex thread starts', () => {
  it('starts no MCP server and runs no hook for a read-only session or an Ask, and does for one that may write', async () => {
    const found = await findCodex(process.env, homedir());
    expect(found).not.toBeNull();
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'seshboard-codex-ro-')));
    const home = join(root, 'home');
    const cwd = join(root, 'repo');
    const markers = join(root, 'markers');
    mkdirSync(home);
    mkdirSync(cwd);
    mkdirSync(markers);
    const mcpMarker = join(markers, 'mcp');
    const hookMarker = join(markers, 'hook');
    writeFileSync(
      join(home, 'config.toml'),
      `[mcp_servers.marker]\ncommand = "sh"\nargs = ["-c", "touch '${mcpMarker}'; cat"]\nstartup_timeout_sec = 3\n\n[[hooks.SessionStart]]\nhooks = [{ type = "command", command = "touch '${hookMarker}'" }]\n\n[[hooks.UserPromptSubmit]]\nhooks = [{ type = "command", command = "touch '${hookMarker}'" }]\n`,
    );
    const make = () => createAppServer({ binary: async () => found, env: async () => ({ ...process.env, CODEX_HOME: home }), experimentalApi: true });
    // Trusts the hooks as Codex records it, so they would run.
    const first = make();
    const listed = await first.request('hooks/list', { cwds: [cwd] });
    for (const hook of listed.data.flatMap((e) => e.hooks)) appendFileSync(join(home, 'config.toml'), `\n[hooks.state."${hook.key}"]\ntrusted_hash = "${(hook as unknown as { currentHash: string }).currentHash}"\n`);
    await first.dispose();
    const server = make();
    const driver = codexDriver({ server, status: async () => ({}) as never });
    try {
      // `config/read`, which names the servers, starts none of them.
      await server.request('config/read', { cwd });
      const states: string[] = [];
      const readOnly = await driver.start({ cwd, model: null, permissionMode: 'auto', readOnly: true }, { ...events, state: (state) => void states.push(state) });
      // A turn of its own, so the thread has a rollout to fork (signed out, it fails before any model is asked).
      await readOnly.send('Say hi.', []);
      for (let i = 0; i < 300 && !states.some((s) => s === 'idle' || s === 'error'); i++) await settle(100);
      const asked = await driver.ask!({ sessionId: readOnly.sessionId, cwd, model: null, prompt: 'Say hi.', onText: () => {}, onFork: () => {} });
      // Signed out in an empty home: the turn fails before any model is asked, after the prompt's hooks would have run.
      expect(asked.answer).toBeNull();
      await settle(4000);
      expect(existsSync(mcpMarker)).toBe(false);
      expect(existsSync(hookMarker)).toBe(false);
      await readOnly.close();
      // The control: a session that may write starts the configured server, and its turn runs the hooks.
      const writingStates: string[] = [];
      const writing = await driver.start({ cwd, model: null, permissionMode: 'default' }, { ...events, state: (state) => void writingStates.push(state) });
      await writing.send('Say hi.', []);
      for (let i = 0; i < 300 && !writingStates.some((s) => s === 'idle' || s === 'error'); i++) await settle(100);
      await settle(2000);
      expect(existsSync(mcpMarker)).toBe(true);
      expect(existsSync(hookMarker)).toBe(true);
      await writing.close();
    } finally {
      await driver.dispose();
      await server.dispose();
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
