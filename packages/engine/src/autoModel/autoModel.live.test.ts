/**
 * Auto model against the real Claude Code CLI (a few cents: Haiku routing calls, short Haiku and Sonnet turns, and
 * one short Fable reply). Opt-in: SESHBOARD_LIVE_CWD=/path/to/throwaway/git/repo npx vitest run autoModel.live
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';
import { AUTO_EFFORTS, DEFAULT_AUTO_MODEL, createRpcClient, tierOf, messagePortTransport, type AutoModelPrefs, type Contract, type DomLikePort, type SessionHostInfo, type TranscriptMessage } from '@seshboard/protocol';
import { createEngine } from '../engine.ts';
import type { SdkRuntime } from '../host/hostManager.ts';
import { ModelRouter } from './router.ts';

const cwd = process.env.SESHBOARD_LIVE_CWD;
const asDomPort = (port: MessagePort) => port as unknown as DomLikePort;
const ALL: AutoModelPrefs = { ...DEFAULT_AUTO_MODEL, allowed: ['haiku', 'sonnet', 'opus', 'fable'] };

const until = async (what: string, check: () => boolean, timeoutMs = 120_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

describe.skipIf(!cwd)('live Auto model', () => {
  it('Haiku picks a model and an effort by the rules', async () => {
    const claudePath = execFileSync('which', ['claude'], { encoding: 'utf8' }).trim();
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'));
    const router = new ModelRouter({
      sdk: () => import('@anthropic-ai/claude-agent-sdk') as unknown as Promise<SdkRuntime>,
      env: async () => env,
      claudePath: async () => claudePath,
      ephemeral: { add: () => {}, delete: () => {} },
      prefs: () => ALL,
      record: () => {},
      log: (level, message) => console.log(`[router] ${level}: ${message}`),
      // A cold start of Claude Code plus Haiku's answer; the app gives it 3 seconds once started.
      answerMs: 15_000,
    });
    const cases: Array<{ prompt: string; images?: number; want: string[] }> = [
      { prompt: 'What does `git rebase --onto` do?', want: ['haiku'] },
      { prompt: 'Rename the `total` variable to `subtotal` in src/cart.ts and its test.', want: ['sonnet'] },
      { prompt: 'The checkout page looks broken in this screenshot. Find out why and fix it.', images: 1, want: ['opus', 'fable'] },
      { prompt: 'Migrate the whole codebase from Express to Fastify: every service, route, middleware and test, and keep everything working.', want: ['fable'] },
    ];
    const seen: string[] = [];
    for (const c of cases) {
      const route = await router.route({ profileId: 'default', prompt: c.prompt, imageCount: c.images ?? 0 });
      seen.push(`${c.prompt.slice(0, 40)}… → ${route.ok ? `${route.model}/${route.effort} (${route.reason})` : `failed: ${route.reason}`}`);
      expect(route.ok, seen.at(-1)).toBe(true);
      if (!route.ok) continue;
      expect(AUTO_EFFORTS).toContain(route.effort);
      expect(c.want, seen.at(-1)).toContain(route.model);
    }
    console.log(seen.join('\n'));
    expect(seen).toHaveLength(cases.length);
  }, 180_000);

  describe('a session on Auto', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'seshboard-live-auto-'));
    const engine = createEngine({ dataDir, onLog: (e) => e.level !== 'debug' && console.log(`[engine] ${e.level}: ${e.message}`) });
    engine.setAutoModel(ALL);
    const { port1, port2 } = new MessageChannel();
    engine.attach(messagePortTransport(asDomPort(port1)));
    const client = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)), { timeoutMs: 120_000 });
    const hosts: SessionHostInfo[] = [];
    let transcript: TranscriptMessage[] = [];
    client.on('session.host', (h) => hosts.push(h));
    client.on('transcript.updated', (u) => (transcript = u.mode === 'replace' ? u.messages : [...transcript, ...u.messages]));
    const last = (id: string) => hosts.filter((h) => h.sessionId === id).at(-1);
    const replied = (word: string) => transcript.some((m) => m.role === 'assistant' && m.blocks.some((b) => b.type === 'text' && b.text.includes(word)));

    afterAll(() => {
      client.dispose();
      engine.close();
      port1.close();
      port2.close();
      rmSync(dataDir, { recursive: true, force: true });
    });

    it('starts on the model and effort Auto picked, compacts, then moves up to Fable', async () => {
      const { sessionId } = await client.call('session.create', { cwd: cwd!, model: 'auto', permissionMode: 'default', prompt: 'What does `git status` do? Answer in one sentence and use no tools. End with the word FIRST.' });
      await client.call('transcript.watch', { sessionId });
      await until('Auto picked and the first turn finished', () => !!last(sessionId)?.autoPick && last(sessionId)?.state === 'idle' && replied('FIRST'));
      const picked = last(sessionId)!;
      console.log(`Auto picked ${picked.autoPick?.model} at ${picked.autoPick?.effort} effort: ${picked.autoPick?.reason}`);
      expect(picked.autoPick?.model).toBeTruthy();
      expect(AUTO_EFFORTS).toContain(picked.autoPick?.effort);
      // The session runs on what Auto picked (Claude Code reports the full id), effort included, and keeps it for a resume.
      expect(tierOf(picked.model)).toBe(picked.autoPick!.model);
      expect(picked.effort).toBe(picked.autoPick!.effort);
      expect(await client.call('session.savedSettings', { sessionId })).toMatchObject({ model: picked.autoPick!.model, effort: picked.autoPick!.effort });

      // What "Compact, then use" waits for: /compact makes the session busy, then idle again.
      const from = hosts.length;
      await client.call('session.send', { sessionId, text: '/compact' });
      await until('compact finished', () => {
        const states = hosts.slice(from).filter((h) => h.sessionId === sessionId).map((h) => h.state);
        return states.some((s) => s === 'running' || s === 'starting') && states.at(-1) === 'idle';
      });
      console.log(`states while compacting: ${hosts.slice(from).filter((h) => h.sessionId === sessionId).map((h) => h.state).join(' → ')}`);

      // The step up: Fable at medium effort, from the next message. The transcript says which model answered.
      await client.call('session.setModel', { sessionId, model: 'fable' });
      await client.call('session.setEffort', { sessionId, effort: 'medium' });
      expect(last(sessionId)).toMatchObject({ effort: 'medium', autoPick: { left: true } });
      expect(tierOf(last(sessionId)!.model)).toBe('fable');
      await client.call('session.send', { sessionId, text: 'Reply with exactly the word FABLE and nothing else.' });
      await until('Fable replied', () => replied('FABLE') && last(sessionId)?.state === 'idle');
      const answer = transcript.filter((m) => m.role === 'assistant' && m.blocks.some((b) => b.type === 'text' && b.text.includes('FABLE'))).at(-1)!;
      console.log(`the last reply came from ${answer.model}; cost $${last(sessionId)?.costUsd}`);
      expect(answer.model).toMatch(/fable/);
      await client.call('session.close', { sessionId });
    }, 400_000);
  });
});
