import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AcpError, createAcpConnection, type AcpConnection } from './acpConnection.ts';

/**
 * A tiny ACP agent: answers `initialize` with what it was sent, `echo` with its params, `ask` by asking the client for a
 * permission and returning the answer, `notify` with a `session/update` first, and `crash` by exiting.
 */
const AGENT = `
const rl = require('node:readline').createInterface({ input: process.stdin });
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\\n');
const waiting = new Map();
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === undefined && waiting.has(m.id)) { const reply = waiting.get(m.id); waiting.delete(m.id); return send({ id: reply, result: m.result ?? m.error }); }
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: 1, agentInfo: { name: 'fake' }, sent: m.params } });
  if (m.method === 'echo') return send({ id: m.id, result: m.params });
  if (m.method === 'fail') return send({ id: m.id, error: { code: -32000, message: 'Authentication required.' } });
  if (m.method === 'notify') { send({ method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk' } } }); return send({ id: m.id, result: {} }); }
  if (m.method === 'ask') { waiting.set(1000 + m.id, m.id); return send({ id: 1000 + m.id, method: 'session/request_permission', params: { sessionId: 's' } }); }
  if (m.method === 'crash') { process.stderr.write('boom\\n'); process.exit(3); }
});
`;

const opened: AcpConnection[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((c) => c.dispose()));
});

function connect(command: { path: string; args: string[] } | null = null) {
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-acp-'));
  const script = join(dir, 'agent.cjs');
  writeFileSync(script, AGENT);
  const connection = createAcpConnection({ agentName: 'Fake CLI', command: async () => command ?? { path: process.execPath, args: [script] }, env: async () => process.env, clientVersion: '9.9.9', killGraceMs: 200 });
  opened.push(connection);
  return connection;
}

describe('createAcpConnection', () => {
  it('starts the agent with initialize, then sends requests and hears its notifications', async () => {
    const connection = connect();
    const heard: unknown[] = [];
    connection.onNotification((method, params) => heard.push({ method, params }));
    expect(await connection.request('echo', { a: 1 })).toEqual({ a: 1 });
    expect(connection.initialized()).toMatchObject({
      protocolVersion: 1,
      sent: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false }, clientInfo: { name: 'seshboard', title: 'Seshboard', version: '9.9.9' } },
    });
    await connection.request('notify', {});
    expect(heard).toEqual([{ method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk' } } }]);
    expect(connection.pid()).toEqual(expect.any(Number));
  });

  it("fails with the agent's error and its code", async () => {
    const connection = connect();
    await expect(connection.request('fail', {})).rejects.toMatchObject({ code: 'rpc', rpcCode: -32000, message: 'Authentication required.' });
  });

  it("answers the agent's own requests with the handler's result, and refuses them without one", async () => {
    const connection = connect();
    expect(await connection.request('ask', {})).toEqual({ code: -32601, message: 'Seshboard does not handle this request.' });
    connection.handleRequests(async (method) => ({ outcome: { outcome: 'selected', optionId: method } }));
    expect(await connection.request('ask', {})).toEqual({ outcome: { outcome: 'selected', optionId: 'session/request_permission' } });
  });

  it('fails what waits when the agent ends, says so to what held it, and starts again on the next request', async () => {
    const connection = connect();
    await connection.request('echo', {});
    let exited = 0;
    connection.onExit(() => exited++);
    const release = connection.hold();
    await expect(connection.request('crash', {}, { timeoutMs: null })).rejects.toMatchObject({ code: 'exited', message: expect.stringContaining('boom') });
    expect(exited).toBe(1);
    release();
    expect(await connection.request('echo', { again: true })).toEqual({ again: true });
  });

  it("says the agent isn't installed", async () => {
    const missing = createAcpConnection({ agentName: 'Fake CLI', command: async () => null, env: async () => ({}) });
    opened.push(missing);
    await expect(missing.request('echo', {})).rejects.toEqual(new AcpError("Fake CLI isn't installed.", 'notInstalled'));
    const gone = connect({ path: join(tmpdir(), 'no-such-agent-binary'), args: [] });
    await expect(gone.request('echo', {})).rejects.toMatchObject({ code: 'notInstalled' });
  });

  it('refuses requests once disposed', async () => {
    const connection = connect();
    await connection.request('echo', {});
    await connection.dispose();
    await expect(connection.request('echo', {})).rejects.toMatchObject({ code: 'disposed' });
  });
});
