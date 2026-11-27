import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import type { BrowserAnswer, BrowserAsk, BrowserToolRequest } from '@seshboard/protocol';
import { BrowserBridge, type BrowserBridgeDeps } from './browserBridge.ts';

const BASE = { command: '/app/Seshboard', args: ['browser-mcp.js'], env: { ELECTRON_RUN_AS_NODE: '1' } };
const cleanup: Array<() => void> = [];
afterEach(() => cleanup.splice(0).forEach((done) => done()));

function bridge(overrides: Partial<BrowserBridgeDeps> = {}) {
  const runs: BrowserToolRequest[] = [];
  const asked: BrowserAsk[] = [];
  const kept: Array<{ kind: string; site: string }> = [];
  const b = new BrowserBridge({
    run: async (request) => (runs.push(request), { text: `ran ${request.tool}` }),
    // snapshot works on a local page; every other tool on app.example.com.
    where: async (_sessionId, tool, args) => ({ url: tool === 'open' ? String(args.url) : tool === 'snapshot' ? 'http://localhost:3000/' : 'https://app.example.com/page', profile: null }),
    sites: () => ({ sites: [], scriptSites: [], project: true }),
    scripts: () => true,
    ask: async (_sessionId, ask) => (asked.push(ask), 'deny'),
    keep: (_sessionId, kind, site) => kept.push({ kind, site }),
    log: () => {},
    ...overrides,
  });
  cleanup.push(() => b.close());
  return { b, runs, asked, kept };
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
    expect(asked).toEqual([{ kind: 'site', site: 'https://app.example.com', tool: 'click', input: { ref: 'e1' }, profile: null, project: true }]);
    expect(declined).toMatchObject({ error: true, text: expect.stringContaining('did not allow app.example.com') });
    expect(runs).toEqual([]);
    const allowing = bridge({ ask: async () => 'once' });
    const other = await allowing.b.serverFor(BASE, () => 'session-2');
    await expect(allowing.b.handle({ id: 3, token: token(other), tool: 'click', args: { ref: 'e1' } })).resolves.toEqual({ text: 'ran click' });
  });

  it('names the element a call acts on when it asks', async () => {
    const { b, asked } = bridge({ where: async () => ({ url: 'https://github.com/x', profile: null, target: 'New issue' }) });
    const server = await b.serverFor(BASE, () => 'session-1');
    await b.handle({ id: 6, token: token(server), tool: 'click', args: { ref: 'e105' } });
    expect(asked[0]).toMatchObject({ tool: 'click', input: { ref: 'e105' }, target: 'New issue' });
  });

  it('refuses an unknown token or tool', async () => {
    const { b } = bridge();
    await expect(b.handle({ id: 4, token: 'nope', tool: 'snapshot', args: {} })).resolves.toMatchObject({ error: true });
    const server = await b.serverFor(BASE, () => 'session-1');
    await expect(b.handle({ id: 5, token: token(server), tool: 'eval', args: {} })).resolves.toMatchObject({ error: true });
  });

  it("opens in the browser profile the agent names, refuses one it can't use, and names it when asking", async () => {
    const profile: BrowserBridgeDeps['profile'] = (_sessionId, name) => (!name ? { id: null, name: null } : name.toLowerCase() === 'admin' ? { id: 'p-admin', name: 'Admin' } : { error: 'No browser profile called “x”.' });
    const asked: Array<string | null> = [];
    const { b, runs } = bridge({ profile, where: async (_s, _tool, args) => ({ url: String(args.url), profile: (args.profileName as string | null) ?? null }), ask: async (_s, ask) => (asked.push(ask.profile), 'once') });
    const server = await b.serverFor(BASE, () => 'session-1');
    // The agent can't pick a profile by id: the bridge drops what it sends and finds the name itself.
    await b.handle({ id: 8, token: token(server), tool: 'open', args: { url: 'http://localhost:3000/', profile: 'admin', profileId: 'forged' } });
    expect(runs.at(-1)!.args).toEqual({ url: 'http://localhost:3000/', profile: 'admin', profileId: 'p-admin', profileName: 'Admin' });
    await b.handle({ id: 9, token: token(server), tool: 'open', args: { url: 'http://localhost:3000/' } });
    expect(runs.at(-1)!.args).toMatchObject({ profileId: null, profileName: null });
    await expect(b.handle({ id: 10, token: token(server), tool: 'open', args: { url: 'http://localhost:3000/', profile: 'x' } })).resolves.toMatchObject({ error: true, text: expect.stringContaining('No browser profile') });
    expect(runs).toHaveLength(2);
    await b.handle({ id: 11, token: token(server), tool: 'open', args: { url: 'https://app.example.com/', profile: 'Admin' } });
    expect(asked).toEqual(['Admin']);
  });

  it('remembers Allow for this session per session and per kind, and keeps Always allow in the project', async () => {
    const answers: BrowserAnswer[] = ['session', 'always'];
    const { b, runs, asked, kept } = bridge({ ask: async (_s, ask) => (asked.push(ask), answers.shift() ?? 'deny') });
    const one = await b.serverFor(BASE, () => 'session-1');
    const two = await b.serverFor(BASE, () => 'session-2');
    await b.handle({ id: 20, token: token(one), tool: 'click', args: { ref: 'e1' } });
    // The same site again in this session: no second card.
    await b.handle({ id: 21, token: token(one), tool: 'type', args: { ref: 'e2', text: 'x' } });
    expect(asked).toHaveLength(1);
    expect(runs.map((r) => r.tool)).toEqual(['click', 'type']);
    // Another session asks for itself, and Always allow goes to the project.
    await b.handle({ id: 22, token: token(two), tool: 'click', args: { ref: 'e1' } });
    expect(asked).toHaveLength(2);
    expect(kept).toEqual([{ kind: 'site', site: 'https://app.example.com' }]);
    // Using the site doesn't allow scripts on it: evaluate asks on its own card.
    await b.handle({ id: 23, token: token(one), tool: 'evaluate', args: { script: '1' } });
    expect(asked.at(-1)).toMatchObject({ kind: 'scripts', site: 'https://app.example.com', tool: 'evaluate' });
    expect(runs.map((r) => r.tool)).toEqual(['click', 'type', 'click']);
  });

  it('refuses evaluate and network while scripts are off, and runs them on this computer at once', async () => {
    const local = bridge({ scripts: () => false, where: async () => ({ url: 'http://localhost:3000/', profile: null }) });
    const server = await local.b.serverFor(BASE, () => 'session-1');
    await expect(local.b.handle({ id: 30, token: token(server), tool: 'evaluate', args: { script: '1' } })).resolves.toMatchObject({ error: true, text: expect.stringContaining('Allow scripts in pages') });
    await expect(local.b.handle({ id: 31, token: token(server), tool: 'read', args: {} })).resolves.toEqual({ text: 'ran read' });
    const on = bridge({ where: async () => ({ url: 'http://localhost:3000/', profile: null }) });
    const other = await on.b.serverFor(BASE, () => 'session-1');
    await expect(on.b.handle({ id: 32, token: token(other), tool: 'network', args: {} })).resolves.toEqual({ text: 'ran network' });
    expect(on.asked).toEqual([]);
  });

  it('counts Always allow for this session outside an added project, and runs scripts on a project’s script site', async () => {
    const cards: BrowserAsk[] = [];
    const outside = bridge({ sites: () => ({ sites: [], scriptSites: [], project: false }), ask: async (_s, ask) => (cards.push(ask), 'always') });
    const server = await outside.b.serverFor(BASE, () => 'session-1');
    await outside.b.handle({ id: 40, token: token(server), tool: 'evaluate', args: { script: '1' } });
    expect(cards).toMatchObject([{ kind: 'scripts', project: false }]);
    expect(outside.kept).toEqual([]);
    await outside.b.handle({ id: 41, token: token(server), tool: 'evaluate', args: { script: '2' } });
    expect(cards).toHaveLength(1);
    expect(outside.runs).toHaveLength(2);
    const project = bridge({ sites: () => ({ sites: [], scriptSites: ['app.example.com'], project: true }) });
    const other = await project.b.serverFor(BASE, () => 'session-1');
    await expect(project.b.handle({ id: 42, token: token(other), tool: 'evaluate', args: { script: '1' } })).resolves.toEqual({ text: 'ran evaluate' });
    expect(project.asked).toEqual([]);
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
