/**
 * The orchestrator end to end, against real agents (costs a few cents of Haiku, and one small Copilot request).
 * Opt-in, in a throwaway git repository only, after a build (`npm run build`), since the agents start the built
 * `orchestrator` MCP server:
 *
 *   SESHBOARD_LIVE_CWD=/path/to/throwaway/repo npx vitest run orchestrator.live
 *   SESHBOARD_LIVE_COPILOT_CWD=/path/to/throwaway/repo npx vitest run orchestrator.live
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';
import { createRpcClient, messagePortTransport, ORCHESTRATOR_PROMPT, type Contract, type DomLikePort, type OrchestratorInfo, type SessionHostInfo, type TranscriptMessage } from '@seshboard/protocol';
import { createEngine } from '../engine.ts';
import { copilotProvider } from '../providers/copilot/copilotProvider.ts';
import { copilotHome } from '../providers/copilot/copilotSource.ts';
import { ProviderHosts } from '../providers/providerHosts.ts';
import { OrchestratorBridge } from './orchestratorBridge.ts';

const cwd = process.env.SESHBOARD_LIVE_CWD;
const copilotCwd = process.env.SESHBOARD_LIVE_COPILOT_CWD;
/** The built server, run by this Node as Seshboard's binary runs it (`ELECTRON_RUN_AS_NODE`). */
const built = join(import.meta.dirname, '..', '..', '..', '..', 'apps', 'desktop', 'out', 'main', 'orchestrator-mcp.js');
const server = { command: process.execPath, args: [built], env: {} };
const asDomPort = (port: MessagePort) => port as unknown as DomLikePort;

const until = async (what: string, check: () => boolean, timeoutMs = 180_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

describe.skipIf(!cwd || !existsSync(built))('live orchestrator with Claude Code', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'seshboard-live-orchestrator-'));
  const engine = createEngine({ dataDir, onLog: (e) => e.level !== 'debug' && console.log(`[engine] ${e.level}: ${e.message}`) });
  engine.setOrchestratorServer(server);
  const { port1, port2 } = new MessageChannel();
  engine.attach(messagePortTransport(asDomPort(port1)));
  const client = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)), { timeoutMs: 120_000 });
  const hosts: SessionHostInfo[] = [];
  let orchestrators: OrchestratorInfo[] = [];
  let transcript: TranscriptMessage[] = [];
  client.on('session.host', (h) => hosts.push(h));
  client.on('orchestrator.changed', (c) => (orchestrators = c.orchestrators));
  client.on('transcript.updated', (u) => (transcript = u.mode === 'replace' ? u.messages : [...transcript, ...u.messages]));
  // Anything that asks is declined: the orchestrator's own tools never ask, and the session it starts only replies.
  client.on('session.permission', (p) => void client.call('session.respond', { requestId: p.requestId, decision: { behavior: 'deny', message: 'Not in this test.' } }).catch(() => {}));
  const state = (id: string) => hosts.filter((h) => h.sessionId === id).at(-1)?.state;

  afterAll(() => {
    client.dispose();
    engine.close();
    port1.close();
    port2.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('starts a session with its tool, lists it under itself, and hears when its turn ends', async () => {
    const { sessionId } = await client.call('session.create', {
      cwd: cwd!,
      model: 'haiku',
      permissionMode: 'default',
      orchestrator: true,
      prompt: 'Start exactly one session with the title "Say hi", the workspace "current" and the prompt "Reply with exactly the word hi and do nothing else." Then reply with exactly the word STARTED.',
    });
    await client.call('transcript.watch', { sessionId });
    // 1. Claude Code calls start_session through the MCP server, and the engine starts a real session under it.
    await until('a started session', () => orchestrators.some((o) => o.sessionId === sessionId && o.workers.some((w) => w.sessionId)));
    const worker = orchestrators.find((o) => o.sessionId === sessionId)!.workers[0]!;
    expect(worker).toMatchObject({ title: 'Say hi', itemId: null });
    // 2. The started session ends its turn, and Seshboard tells the orchestrator, which takes a turn of its own.
    await until('the session update in the orchestrator', () => transcript.some((m) => m.role === 'user' && m.blocks.some((b) => b.type === 'text' && b.text.startsWith('Session update (from Seshboard'))));
    await until('the orchestrator idle again', () => state(sessionId) === 'idle');
    const { sessions } = await client.call('sessions.list', {});
    expect(sessions.find((s) => s.id === worker.sessionId)?.parentId).toBe(sessionId);
  }, 400_000);
});

describe.skipIf(!copilotCwd || !existsSync(built))('live orchestrator with GitHub Copilot', () => {
  it('gets the orchestrator server and its role, and calls start_session through the bridge', async () => {
    const provider = copilotProvider({ profileId: 'live', copilotHome: copilotHome(process.env, homedir()), userHome: homedir() });
    const calls: Array<{ sessionId: string; tool: string; args: Record<string, unknown> }> = [];
    let orchestratorId = '';
    const bridge = new OrchestratorBridge({
      run: async (sessionId, tool, args) => (calls.push({ sessionId, tool, args }), { text: `Started "${String(args.title)}" as session test-1.` }),
      startChild: async () => ({ text: 'Not in this test.', error: true }),
      isOrchestrator: (id) => id === orchestratorId,
      log: () => {},
    });
    let ended: () => void = () => {};
    const done = new Promise<void>((resolve) => (ended = resolve));
    const hosts = new ProviderHosts({
      providers: () => [provider],
      profileOf: () => 'live',
      sessionCwd: () => copilotCwd!,
      orchestratorServer: (sessionId) => bridge.serverFor(server, sessionId),
      onInfo: () => {},
      onStream: () => {},
      onMessages: () => {},
      onPermission: (request) => hosts.respond(request.requestId, { behavior: 'deny', message: 'Not in this test.' }),
      onPermissionResolved: () => {},
      onTurnEnd: () => ended(),
      onCreated: (id) => (orchestratorId = id),
      log: () => {},
    });
    try {
      await hosts.create({
        profileId: 'live',
        cwd: copilotCwd!,
        prompt: 'Start exactly one session with the title "Say hi" and the prompt "Reply with exactly the word hi." Then reply with exactly the word STARTED.',
        attachments: [],
        model: null,
        orchestrator: true,
        appendSystem: ORCHESTRATOR_PROMPT,
      });
      await Promise.race([done, new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 150_000))]);
      expect(calls).toMatchObject([{ sessionId: orchestratorId, tool: 'start_session', args: { title: 'Say hi' } }]);
    } finally {
      await hosts.closeAll();
      await provider.driver!.dispose();
      bridge.close();
    }
  }, 200_000);
});
