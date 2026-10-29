/**
 * End-to-end against the real Claude Code CLI (costs a few cents of Haiku).
 * Opt-in: SESHBOARD_LIVE_CWD=/path/to/throwaway/git/repo npx vitest run claude.live
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MessageChannel, type MessagePort } from 'node:worker_threads';
import { afterAll, describe, expect, it } from 'vitest';
import {
  createRpcClient,
  messagePortTransport,
  type Contract,
  type DomLikePort,
  type PermissionRequest,
  type SessionHostInfo,
  type StreamDelta,
  type TranscriptMessage,
} from '@seshboard/protocol';
import { createEngine } from '../engine.ts';

const cwd = process.env.SESHBOARD_LIVE_CWD;
const asDomPort = (port: MessagePort) => port as unknown as DomLikePort;

const until = async (what: string, check: () => boolean, timeoutMs = 90_000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

const texts = (messages: TranscriptMessage[]) =>
  messages.flatMap((m) => m.blocks.flatMap((b) => (b.type === 'text' ? [`${m.role}:${b.text.trim()}`] : [])));

describe.skipIf(!cwd)('live Claude Code session', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'seshboard-live-'));
  const engine = createEngine({ dataDir, onLog: (e) => e.level !== 'debug' && console.log(`[engine] ${e.level}: ${e.message}`) });
  const { port1, port2 } = new MessageChannel();
  engine.attach(messagePortTransport(asDomPort(port1)));
  const client = createRpcClient<Contract>(messagePortTransport(asDomPort(port2)), { timeoutMs: 120_000 });

  const hosts: SessionHostInfo[] = [];
  const streams: StreamDelta[] = [];
  const permissions: PermissionRequest[] = [];
  let transcript: TranscriptMessage[] = [];
  client.on('session.host', (h) => hosts.push(h));
  client.on('session.stream', (d) => streams.push(d));
  client.on('session.permission', (p) => permissions.push(p));
  client.on('transcript.updated', (u) => (transcript = u.mode === 'replace' ? u.messages : [...transcript, ...u.messages]));
  const state = (id: string) => hosts.filter((h) => h.sessionId === id).at(-1)?.state;

  afterAll(() => {
    client.dispose();
    engine.close();
    port1.close();
    port2.close();
    rmSync(dataDir, { recursive: true, force: true });
    if (cwd) rmSync(join(cwd, 'live-e2e.txt'), { force: true });
    if (cwd) rmSync(join(cwd, 'rewind-e2e.txt'), { force: true });
  });

  it('creates, asks permission, streams, continues, resumes and interrupts', async () => {
    const started = Date.now();
    const { sessionId } = await client.call('session.create', {
      cwd: cwd!,
      model: 'haiku',
      permissionMode: 'default',
      prompt: 'Run exactly this with the Bash tool: touch live-e2e.txt — then reply with exactly the word CREATED.',
    });
    await client.call('transcript.watch', { sessionId });

    // 1. A real permission prompt arrives and approving it lets the tool run.
    await until('permission prompt', () => permissions.some((p) => p.sessionId === sessionId));
    const request = permissions.find((p) => p.sessionId === sessionId)!;
    console.log(`permission prompt after ${Date.now() - started}ms:`, request.toolName, JSON.stringify(request.input), '| always:', request.alwaysLabel);
    expect(request.toolName).toBe('Bash');
    await client.call('session.respond', { requestId: request.requestId, decision: { behavior: 'allow' } });
    await until('first turn done', () => state(sessionId) === 'idle' && texts(transcript).some((t) => t.includes('CREATED')));
    expect(existsSync(join(cwd!, 'live-e2e.txt'))).toBe(true);
    expect(streams.some((s) => s.sessionId === sessionId && s.kind === 'text')).toBe(true);
    console.log(`first turn done after ${Date.now() - started}ms; ${streams.length} stream updates`);

    // 2. A follow-up on the same process.
    await client.call('session.send', { sessionId, text: 'Reply with exactly the word SECOND.' });
    await until('second reply', () => texts(transcript).some((t) => t.includes('SECOND') && t.startsWith('assistant')));
    await until('idle after second', () => state(sessionId) === 'idle');

    // 3. Stop the process, then resume by sending again.
    await client.call('session.close', { sessionId });
    expect(state(sessionId)).toBe('closed');
    await client.call('session.send', { sessionId, text: 'Reply with exactly the word RESUMED.' });
    await until('resumed reply', () => texts(transcript).some((t) => t.includes('RESUMED') && t.startsWith('assistant')));
    await until('idle after resume', () => state(sessionId) === 'idle');

    // 4. Interrupt a long answer; the session stays usable.
    const before = streams.length;
    await client.call('session.send', { sessionId, text: 'Write the numbers from 1 to 400, one per line, no other text.' });
    await until('streaming numbers', () => streams.length > before + 3);
    await client.call('session.interrupt', { sessionId });
    await until('idle after interrupt', () => state(sessionId) === 'idle', 30_000);
    await client.call('session.send', { sessionId, text: 'Reply with exactly the word AFTER.' });
    await until('reply after interrupt', () => texts(transcript).some((t) => t.includes('AFTER') && t.startsWith('assistant')));

    // 5. The transcript has no duplicates, even though messages arrived both live and from the file.
    const uuids = transcript.map((m) => m.uuid);
    expect(new Set(uuids).size).toBe(uuids.length);

    // 6. The index picks it up as a Seshboard session.
    const listed = async () => (await client.call('sessions.list', {})).sessions.find((s) => s.id === sessionId);
    const deadline = Date.now() + 15_000;
    let summary = await listed();
    while (!summary && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 300));
      summary = await listed();
    }
    expect(summary?.origin).toBe('app');
    console.log(`all steps done in ${Date.now() - started}ms; cost $${hosts.filter((h) => h.sessionId === sessionId).at(-1)?.costUsd}`);
  }, 300_000);

  it('runs worktree setup actions in the new worktree before Claude starts', async () => {
    const name = `live-setup-${Date.now() % 100_000}`;
    const worktree = join(cwd!, '.claude', 'worktrees', name);
    try {
      await client.call('actions.save', {
        projectRoot: cwd!,
        action: { id: 'live-setup', name: 'Live setup', command: 'touch setup-ran.txt', runOnWorktreeCreate: true },
      });
      const { sessionId } = await client.call('session.create', {
        cwd: cwd!,
        model: 'haiku',
        worktree: { name, baseRef: 'head' },
        prompt: 'Use the Bash tool to run `ls setup-ran.txt`, then reply with exactly FOUND if it exists, otherwise MISSING.',
      });
      await client.call('transcript.watch', { sessionId });
      await until('reply about the setup file', () => texts(transcript).some((t) => t.startsWith('assistant') && /FOUND|MISSING/.test(t)));
      const reply = texts(transcript).filter((t) => t.startsWith('assistant')).at(-1)!;
      const { terminals } = await client.call('terminal.list', {});
      const setup = terminals.find((t) => t.sessionId === sessionId && t.title === 'Setup: Live setup');
      console.log(`worktree reply: ${reply} | setup terminal exit ${setup?.exitCode} in ${setup?.cwd}`);
      expect(setup).toMatchObject({ kind: 'action', exitCode: 0, cwd: worktree });
      expect(reply).toContain('FOUND');
      expect(existsSync(join(worktree, 'setup-ran.txt'))).toBe(true);
      await client.call('session.close', { sessionId });
    } finally {
      await client.call('actions.delete', { projectRoot: cwd!, id: 'live-setup' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 1_500));
      try {
        execFileSync('git', ['worktree', 'remove', '--force', worktree], { cwd: cwd! });
        execFileSync('git', ['branch', '-D', `worktree-${name}`], { cwd: cwd! });
      } catch {
        // Already gone.
      }
    }
  }, 300_000);

  it.skipIf(!process.env.SESHBOARD_LIVE_SUBAGENT)('loads a real subagent transcript from its Task call', async () => {
    const [sessionId, toolUseId] = process.env.SESHBOARD_LIVE_SUBAGENT!.split(':');
    await until('index ready', () => true, 1);
    await new Promise((r) => setTimeout(r, 1_500));
    const result = await client.call('transcript.subagent', { sessionId: sessionId!, toolUseId: toolUseId! });
    console.log(`subagent ${result.agentId} (${result.agentType}): ${result.messages.length} messages`);
    expect(result.agentId).not.toBeNull();
    expect(result.messages.length).toBeGreaterThan(0);
  });

  it.skipIf(!process.env.SESHBOARD_LIVE_IMAGES)('serves images that Claude read, from a real transcript', async () => {
    const sessionId = process.env.SESHBOARD_LIVE_IMAGES!;
    const { messages } = await client.call('transcript.get', { sessionId });
    const refs = messages.flatMap((m) => m.blocks.flatMap((b) => (b.type === 'tool_result' ? b.images : b.type === 'image' && b.ref ? [b.ref] : [])));
    const payload = JSON.stringify(messages).length;
    expect(refs.length).toBeGreaterThan(0);
    const image = await client.call('transcript.image', { sessionId, imageId: refs.at(-1)!.imageId });
    console.log(`${refs.length} images referenced; transcript payload ${(payload / 1e6).toFixed(2)} MB without image data; last image ${image.mediaType}, ${(image.data.length / 1e3).toFixed(0)} KB base64`);
    expect(image.mediaType).toMatch(/^image\//);
    expect(image.data.length).toBeGreaterThan(1000);
  });

  it('rewinds the files Claude wrote, and forks from a message', async () => {
    transcript = [];
    const { sessionId } = await client.call('session.create', {
      cwd: cwd!,
      model: 'haiku',
      permissionMode: 'acceptEdits',
      prompt: 'Use the Write tool to create rewind-e2e.txt containing exactly: one — then reply with exactly the word WRITTEN.',
    });
    await client.call('transcript.watch', { sessionId });
    await until('file written', () => state(sessionId) === 'idle' && texts(transcript).some((t) => t.includes('WRITTEN')));
    expect(existsSync(join(cwd!, 'rewind-e2e.txt'))).toBe(true);

    const prompt = transcript.find((m) => m.role === 'user' && m.blocks.some((b) => b.type === 'text'))!;
    const preview = await client.call('session.rewind', { sessionId, messageUuid: prompt.uuid, dryRun: true });
    console.log('rewind preview:', JSON.stringify(preview));
    expect(preview.canRewind).toBe(true);
    expect(preview.files.some((f) => f.endsWith('rewind-e2e.txt'))).toBe(true);
    expect(existsSync(join(cwd!, 'rewind-e2e.txt'))).toBe(true);

    const done = await client.call('session.rewind', { sessionId, messageUuid: prompt.uuid, dryRun: false });
    expect(done.canRewind).toBe(true);
    expect(existsSync(join(cwd!, 'rewind-e2e.txt'))).toBe(false);

    // Fork from Claude's reply: the new session has the conversation up to there.
    await client.call('session.close', { sessionId });
    const reply = transcript.filter((m) => m.role === 'assistant').at(-1)!;
    const fork = await client.call('session.forkAt', { sessionId, messageUuid: reply.uuid });
    expect(fork.sessionId).not.toBe(sessionId);
    const forked = await client.call('transcript.get', { sessionId: fork.sessionId });
    console.log(`fork ${fork.sessionId}: ${forked.messages.length} messages`);
    expect(texts(forked.messages).some((t) => t.includes('WRITTEN'))).toBe(true);
   }, 180_000);
});
