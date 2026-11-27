import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COMPANION_DIR, COMPANION_PROTOCOL, type BrowserHostMessage } from '@seshboard/protocol/companion-client';
import { CompanionHub } from '../../../../packages/engine/src/companion/companionHub.ts';
import { BROWSER_CLIENT } from '../../../../packages/engine/src/companion/companionServer.ts';
import { encodeFrame, FrameDecoder, lineSplitter } from './frames.ts';
import { BrowserHost, HOST_CLIENT_NAME, HOST_PROTOCOL, type HostConfig, type HostIo } from './host.ts';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

describe('native messaging frames', () => {
  it('round-trips messages split across chunks', () => {
    const decoder = new FrameDecoder();
    const bytes = Buffer.concat([encodeFrame({ a: 1 }), encodeFrame({ b: 'é' })]);
    expect(decoder.push(bytes.subarray(0, 3))).toEqual([]);
    expect(decoder.push(bytes.subarray(3, 12))).toEqual([{ a: 1 }]);
    expect(decoder.push(bytes.subarray(12))).toEqual([{ b: 'é' }]);
  });

  it('refuses a frame over the limit', () => {
    const decoder = new FrameDecoder(10);
    expect(() => decoder.push(encodeFrame({ text: 'more than ten bytes' }))).toThrow(/too large/);
  });

  it('splits lines', () => {
    const lines: string[] = [];
    const take = lineSplitter((line) => lines.push(line));
    take('{"a":1}\n{"b"');
    take(':2}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('says hello as the protocol and the engine expect', () => {
    expect(HOST_PROTOCOL).toBe(COMPANION_PROTOCOL);
    expect(HOST_CLIENT_NAME).toBe(BROWSER_CLIENT);
  });
});

/** A host with real sockets, whose messages to the browser are collected. */
function startHost(config: HostConfig, launched: string[] = []) {
  const received: BrowserHostMessage[] = [];
  const decoder = new FrameDecoder();
  const io: HostIo = {
    write: (frame) => received.push(...(decoder.push(frame) as BrowserHostMessage[])),
    readFile: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    alive: (pid) => pid === process.pid,
    connect: (path) => {
      const socket = connect(path);
      socket.setEncoding('utf8');
      return socket;
    },
    launch: (command) => launched.push(command),
    retryMs: 50,
  };
  const host = new BrowserHost(config, io);
  cleanups.push(() => host.stop());
  host.start();
  return { host, received };
}

async function until(check: () => boolean, ms = 3_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error('Timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const statuses = (received: BrowserHostMessage[]) => received.flatMap((m) => (m.type === 'status' ? [m.state] : []));
const responses = (received: BrowserHostMessage[]) => received.flatMap((m) => (m.type === 'wire' && m.message.kind === 'response' ? [m.message] : []));

function startHub() {
  const dataDir = mkdtempSync(join(tmpdir(), 'seshboard-host-'));
  const hub = new CompanionHub({
    infoDir: join(dataDir, COMPANION_DIR),
    appVersion: '9.9.9',
    sources: () => ({ summaries: [], live: [], hosts: [] }),
    archiveAfterDays: () => 3,
    windows: () => 0,
    projects: () => [{ root: dataDir, name: 'demo' }],
    checkoutOf: async () => null,
    respond: () => {},
    log: () => {},
  });
  cleanups.push(() => {
    hub.stop();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { hub, dataDir };
}

describe('the browser host', () => {
  it('connects with the token and relays requests and answers', async () => {
    const { hub, dataDir } = startHub();
    await hub.start();
    const { host, received } = startHost({ infoFiles: [join(dataDir, 'missing.json'), hub.infoFile], launch: null, version: '1.0.0' });
    await until(() => statuses(received).includes('connected'));
    expect(received.find((m) => m.type === 'status' && m.state === 'connected')).toMatchObject({ appVersion: '9.9.9' });
    expect(hub.status()).toMatchObject({ browsers: 1, clients: 0 });

    host.receive({ type: 'wire', message: { kind: 'request', id: 1, method: 'projects.list', params: {} } });
    await until(() => responses(received).length === 1);
    expect(responses(received)[0]).toEqual({ kind: 'response', id: 1, ok: true, result: { projects: [{ root: dataDir, name: 'demo' }], matched: null } });

    // The extension can't say hello itself, or reach the token.
    host.receive({ type: 'wire', message: { kind: 'request', id: 2, method: 'hello', params: { token: 'x' } } });
    expect(responses(received)[1]).toMatchObject({ id: 2, ok: false });
    expect(JSON.stringify(received)).not.toContain(JSON.parse(readFileSync(hub.infoFile, 'utf8')).token);
  });

  it('answers NOT_RUNNING without Seshboard, opens it when asked, and connects once it is up', async () => {
    const { hub, dataDir } = startHub();
    const launched: string[] = [];
    const { host, received } = startHost({ infoFiles: [hub.infoFile], launch: { command: '/Applications/Seshboard.app', args: [] }, version: '1.0.0' }, launched);
    await until(() => statuses(received).includes('not-running'));
    expect(received.find((m) => m.type === 'status' && m.state === 'not-running')).toMatchObject({ canLaunch: true });
    host.receive({ type: 'wire', message: { kind: 'request', id: 1, method: 'projects.list', params: {} } });
    expect(responses(received)[0]).toMatchObject({ id: 1, ok: false, error: { code: 'NOT_RUNNING' } });

    host.receive({ type: 'launch' });
    expect(launched).toEqual(['/Applications/Seshboard.app']);
    await hub.start();
    await until(() => statuses(received).includes('connected'));

    // Seshboard quits: back to looking for it.
    hub.stop();
    await until(() => statuses(received).at(-1) === 'not-running');
    expect(dataDir).toBeTruthy();
  });

  it('skips an engine.json whose process is gone, and reports another protocol', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'seshboard-host-'));
    cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
    const gone = join(dataDir, 'gone.json');
    const other = join(dataDir, 'other.json');
    writeFileSync(gone, JSON.stringify({ protocol: 1, socket: '/nowhere', token: 't', pid: 999_999_999, startedAt: 0, appVersion: '1' }));
    writeFileSync(other, JSON.stringify({ protocol: 99, socket: '/nowhere', token: 't', pid: process.pid, startedAt: 0, appVersion: '1' }));
    const { received } = startHost({ infoFiles: [gone], launch: null, version: '1' });
    await until(() => statuses(received).includes('not-running'));
    expect(received.find((m) => m.type === 'status' && m.state === 'not-running')).toMatchObject({ canLaunch: false });
    const second = startHost({ infoFiles: [gone, other], launch: null, version: '1' });
    await until(() => statuses(second.received).includes('incompatible'));
  });
});
