import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserToolRequest } from '@seshboard/protocol';
import { BrowserBridge, type BrowserBridgeDeps } from './browserBridge.ts';

const BASE = { command: '/app/Seshboard', args: ['browser-mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((done) => done()));

function bridge(overrides: Partial<BrowserBridgeDeps> = {}) {
  const runs: BrowserToolRequest[] = [];
  const asked: string[] = [];
  const b = new BrowserBridge({
    run: async (request) => (runs.push(request), { text: `ran ${request.tool}` }),
    access: async (_sessionId, tool) => (tool === 'snapshot' ? { allow: true } : { allow: false, site: 'https://app.example.com' }),
    ask: async (_sessionId, site) => (asked.push(site), false),
    log: () => {},
    ...overrides,
  });
  cleanup.push(() => b.close());
  return { b, runs, asked };
}

const token = (server: { env: Record<string, string> }) => server.env.SESHBOARD_BROWSER_TOKEN!;

describe('BrowserBridge', () => {
  it('runs a call on an allowed site for the session its token belongs to', async () => {
    const { b, runs } = bridge();
    const server = await b.serverFor(BASE, () => 'session-1');
    expect(server.env).toMatchObject({ ELECTRON_RUN_AS_NODE: '1', SESHBOARD_BROWSER_SOCKET: expect.any(String), SESHBOARD_BROWSER_TOKEN: expect.any(String) });
    await expect(b.handle({ id: 1, token: token(server), tool: 'snapshot', args: {} })).resolves.toEqual({ text: 'ran snapshot' });
    expect(runs).toEqual([{ sessionId: 'session-1', tool: 'snapshot', args: {} }]);
  });

  it('asks before another site, and runs nothing when you decline', async () => {
    const { b, runs, asked } = bridge();
    const server = await b.serverFor(BASE, () => 'session-1');
    const declined = await b.handle({ id: 2, token: token(server), tool: 'click', args: { ref: 'e1' } });
    expect(asked).toEqual(['https://app.example.com']);
    expect(declined).toMatchObject({ error: true, text: expect.stringContaining('did not allow app.example.com') });
    expect(runs).toEqual([]);
    const allowing = bridge({ ask: async () => true });
    const other = await allowing.b.serverFor(BASE, () => 'session-2');
    await expect(allowing.b.handle({ id: 3, token: token(other), tool: 'click', args: { ref: 'e1' } })).resolves.toEqual({ text: 'ran click' });
  });

  it('refuses an unknown token or tool', async () => {
    const { b } = bridge();
    await expect(b.handle({ id: 4, token: 'nope', tool: 'snapshot', args: {} })).resolves.toMatchObject({ error: true });
    const server = await b.serverFor(BASE, () => 'session-1');
    await expect(b.handle({ id: 5, token: token(server), tool: 'evaluate', args: {} })).resolves.toMatchObject({ error: true });
  });

  it('answers each line on its socket', async () => {
    const { b } = bridge();
    const server = await b.serverFor(BASE, () => 'session-1');
    const socket = connect(server.env.SESHBOARD_BROWSER_SOCKET!);
    cleanup.push(() => socket.destroy());
    const reply = await new Promise<string>((resolve) => {
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => resolve(chunk));
      socket.write(`${JSON.stringify({ id: 7, token: token(server), tool: 'snapshot', args: {} })}\n`);
    });
    expect(JSON.parse(reply)).toEqual({ id: 7, result: { text: 'ran snapshot' } });
  });
});
