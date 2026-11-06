import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AskText } from '../../host/sideQuestions.ts';
import { AppServerError } from './appServer.ts';
import { codexDriver } from './codexDriver.ts';
import { codexItemId, ID_JOIN } from './codexEvents.ts';
import { fakeAppServer, thread } from './codexFakes.ts';
import { codexForkTurn } from './codexFork.ts';
import { codexProvider } from './codexProvider.ts';
import { codexSessionSource } from './codexSource.ts';
import type { Turn } from './protocol.ts';

const T = '019a0000-0000-7000-8000-00000000000a';
const F = '019a0000-0000-7000-8000-0000000000f0';
const ASK = '019a0000-0000-7000-8000-0000000000a5';

const turn = (id: string, items: Turn['items'] = []): Turn => ({ id, items, itemsView: 'full', status: 'completed', error: null, startedAt: null, completedAt: null, durationMs: null });
const started = (id: string) => ({ thread: thread(id, { originator: 'seshboard', source: 'vscode' }), model: 'gpt-5.5', reasoningEffort: null, approvalPolicy: 'on-request', sandbox: {} });

describe('codexForkTurn', () => {
  const turns = [turn('t1'), turn('t:2'), turn('t3')];

  it("keeps the message's whole turn: Codex forks only where a turn ends", () => {
    expect(codexForkTurn(turns, codexItemId('t1', 'u1'))).toBe('t1');
    expect(codexForkTurn(turns, codexItemId('t3', 'msg_9'))).toBe('t3');
    // A tool's result, a stopped turn's end, an agent's report: the turn is the first part.
    expect(codexForkTurn(turns, `${codexItemId('t1', 'c1')}${ID_JOIN}result`)).toBe('t1');
    expect(codexForkTurn(turns, `t3${ID_JOIN}end`)).toBe('t3');
    // A `:` in Codex's id is written as `_` in Seshboard's.
    expect(codexForkTurn(turns, codexItemId('t:2', 'x'))).toBe('t:2');
  });

  it('finds no turn for a message that is none of the thread\'s', () => {
    expect(codexForkTurn(turns, 'note-123')).toBeNull();
    expect(codexForkTurn(turns, `t9${ID_JOIN}x`)).toBeNull();
    expect(codexForkTurn(turns, '')).toBeNull();
  });
});

describe('forking a Codex session', () => {
  it("forks through the message's turn on the source's model, lets go of the fork, and lists it before Codex does", async () => {
    let forked = false;
    const server = fakeAppServer({
      'thread/turns/list': () => ({ data: [turn('t1'), turn('t2')], nextCursor: null }),
      'thread/read': ({ threadId }) =>
        threadId === T ? { thread: thread(T, { model: 'gpt-5-mini', preview: 'Fix the parser', name: 'Parser' }) } : { thread: thread(F, { forkedFromId: T, preview: '', originator: 'seshboard', source: 'vscode' }) },
      'thread/fork': () => ((forked = true), started(F)),
      'thread/unsubscribe': () => ({}),
      // As codex-cli 0.167 does: a fork without a turn of its own isn't listed.
      'thread/list': () => ({ data: [thread(T, { preview: 'Fix the parser', name: 'Parser' })], nextCursor: null }),
    });
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-fork-')));
    const adapter = codexProvider({ profileId: 'codex-1', codexHome: home, userHome: home, binary: async () => ({ path: '/fake/codex', version: '0.167.0' }), createAppServer: () => server });
    expect(await adapter.source.fork!(T, codexItemId('t1', 'msg_1'))).toBe(F);
    expect(forked).toBe(true);
    expect(server.calls.find((c) => c.method === 'thread/fork')!.params).toEqual({ threadId: T, lastTurnId: 't1', excludeTurns: true, model: 'gpt-5-mini' });
    expect(server.calls.at(-1)).toEqual({ method: 'thread/unsubscribe', params: { threadId: F } });
    // Started here: origin app, named after its source.
    expect((await adapter.source.list()).find((s) => s.sessionId === F)).toMatchObject({ provider: 'codex', origin: 'app', summary: 'Parser', firstPrompt: 'Fix the parser' });
    await expect(adapter.source.fork!(T, 'note-1')).rejects.toThrow(/its own messages/);
  });

  it("names a fork without a preview after the thread it came from, and forgets one Codex lists or that's gone", async () => {
    let listsFork = false;
    let gone = false;
    const server = fakeAppServer({
      'thread/list': () => ({ data: [thread(T, { preview: 'Fix the parser' }), ...(listsFork ? [thread(F, { forkedFromId: T, preview: '' })] : [])], nextCursor: null }),
      'thread/read': ({ threadId }) => {
        if (gone) throw new AppServerError('thread not found', 'rpc', -32600);
        return { thread: threadId === T ? thread(T, { preview: 'Fix the parser' }) : thread(F, { forkedFromId: T, preview: '' }) };
      },
    });
    const source = codexSessionSource(server);
    expect(await source.info(F)).toMatchObject({ summary: 'Fix the parser', firstPrompt: 'Fix the parser' });
    source.remember(F);
    expect((await source.list()).map((s) => s.sessionId)).toEqual([T, F]);
    listsFork = true;
    expect((await source.list()).map((s) => s.sessionId)).toEqual([T, F]);
    listsFork = false;
    gone = true;
    expect((await source.list()).map((s) => s.sessionId)).toEqual([T]);
  });

  it("resumes a thread Codex is still letting go of (a fork just made), once it has", async () => {
    let closing = 2;
    const server = fakeAppServer({
      'thread/resume': ({ threadId }) => {
        if (closing-- > 0) throw new AppServerError(`thread ${threadId} is closing; retry thread/resume after the thread is closed`, 'rpc', -32600);
        return started(threadId);
      },
    });
    const driver = codexDriver({ server, status: async () => ({}) as never, live: () => ({ handle: () => {} }), closingRetryMs: 1 });
    const session = await driver.start({ cwd: '/work', model: null, permissionMode: 'default', resume: F }, { stream() {}, messages() {}, state() {}, permission() {}, permissionDone() {}, usage() {}, model() {} });
    expect(session.sessionId).toBe(F);
    expect(server.calls.filter((c) => c.method === 'thread/resume')).toHaveLength(3);
  });
});

describe('Ask about this session', () => {
  function setup(turnStart: () => unknown = () => ({ turn: turn('ask-turn') })) {
    const server = fakeAppServer({
      'mcpServerStatus/list': () => ({ data: [{ name: 'github', pluginId: null }], nextCursor: null }),
      'thread/fork': () => started(ASK),
      'turn/start': () => turnStart() as never,
      'turn/interrupt': () => ({}),
      'thread/unsubscribe': () => ({}),
    });
    const driver = codexDriver({ server, status: async () => ({}) as never, live: () => ({ handle: () => {} }) });
    return { server, driver };
  }

  it('answers from a read-only, ephemeral fork without MCP servers, streams the answer, and lets it go', async () => {
    const { server, driver } = setup();
    const texts: AskText[] = [];
    const forks: string[] = [];
    const asking = driver.ask!({ sessionId: T, cwd: '/work', model: 'gpt-5-mini', prompt: 'Why?', onText: (t) => void texts.push(t), onFork: (id) => void forks.push(id) });
    await vi.waitFor(() => expect(server.calls.some((c) => c.method === 'turn/start')).toBe(true), { interval: 2 });
    // Registered before it runs, so the sidebar never shows it.
    expect(forks).toEqual([ASK]);
    expect(server.holds).toBe(1);
    expect(server.calls.find((c) => c.method === 'thread/fork')!.params).toEqual({ threadId: T, ephemeral: true, excludeTurns: true, cwd: '/work', approvalPolicy: 'never', sandbox: 'read-only', model: 'gpt-5-mini', config: { features: { apps: false }, mcp_servers: { github: { enabled: false } } } });
    expect(server.calls.find((c) => c.method === 'turn/start')!.params).toMatchObject({ threadId: ASK, input: [{ type: 'text', text: 'Why?' }], approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly' } });
    // Codex's commentary, then its answer: the text starts over with the second reply.
    server.notify('item/started', { threadId: ASK, turnId: 'ask-turn', item: { type: 'agentMessage', id: 'm1', text: '' } });
    server.notify('item/agentMessage/delta', { threadId: ASK, turnId: 'ask-turn', itemId: 'm1', delta: 'Looking…' });
    server.notify('item/completed', { threadId: ASK, turnId: 'ask-turn', item: { type: 'agentMessage', id: 'm1', text: 'Looking…' } });
    server.notify('item/started', { threadId: ASK, turnId: 'ask-turn', item: { type: 'agentMessage', id: 'm2', text: '' } });
    server.notify('item/agentMessage/delta', { threadId: ASK, turnId: 'ask-turn', itemId: 'm2', delta: 'Because ' });
    server.notify('item/agentMessage/delta', { threadId: ASK, turnId: 'ask-turn', itemId: 'm2', delta: 'it was.' });
    server.notify('item/completed', { threadId: ASK, turnId: 'ask-turn', item: { type: 'agentMessage', id: 'm2', text: 'Because it was.' } });
    // Another thread's reply is none of its business.
    server.notify('item/agentMessage/delta', { threadId: T, delta: 'not this' });
    // Anything it asks is declined: it can only read.
    await expect(server.ask('item/commandExecution/requestApproval', { threadId: ASK, turnId: 'ask-turn', itemId: 'c' })).rejects.toThrow(/can only read/);
    server.notify('turn/completed', { threadId: ASK, turn: turn('ask-turn') });
    expect(await asking).toEqual({ answer: 'Because it was.', spent: 0 });
    expect(texts).toEqual([{ delta: 'Looking…' }, { reset: true }, { delta: 'Because ' }, { delta: 'it was.' }]);
    expect(server.calls.at(-1)).toEqual({ method: 'thread/unsubscribe', params: { threadId: ASK } });
    expect(server.holds).toBe(0);
    expect(server.handling()).toBe(false);
  });

  it("says what went wrong: a failed turn, a turn that wouldn't start", async () => {
    const failing = setup();
    const asking = failing.driver.ask!({ sessionId: T, cwd: '/work', model: null, prompt: 'Why?', onText: () => {}, onFork: () => {} });
    await vi.waitFor(() => expect(failing.server.calls.some((c) => c.method === 'turn/start')).toBe(true), { interval: 2 });
    failing.server.notify('turn/completed', { threadId: ASK, turn: { ...turn('ask-turn'), status: 'failed', error: { message: 'Usage limit reached' } } });
    expect(await asking).toEqual({ answer: null, error: 'Usage limit reached', spent: 0 });

    const refused = setup(() => {
      throw new AppServerError('Not signed in', 'rpc', -32600);
    });
    expect(await refused.driver.ask!({ sessionId: T, cwd: '/work', model: null, prompt: 'Why?', onText: () => {}, onFork: () => {} })).toEqual({ answer: null, error: 'Not signed in', spent: 0 });
    expect(refused.server.calls.at(-1)!.method).toBe('thread/unsubscribe');
    expect(refused.server.holds).toBe(0);
  });
});
