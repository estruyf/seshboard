import { describe, expect, it } from 'vitest';
import type { RemoteStatus } from '@seshboard/protocol/client';
import { addressCanChange, connectionLine, joinNames, remoteStatusView } from './remoteStatusView.ts';

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;

function status(change: Partial<RemoteStatus> = {}, settings: Partial<RemoteStatus['settings']> = {}): RemoteStatus {
  return {
    available: true,
    settings: { enabled: true, tunnel: 'cloudflare', customUrl: null, ngrokDomain: null, port: 47615, ...settings },
    appUrl: 'https://switchboard.example/remote/',
    address: 'https://quiet-river.trycloudflare.com',
    tunnel: { state: 'running', message: null },
    tools: { cloudflare: true, ngrok: false, tailscale: false },
    problem: null,
    devices: [],
    connections: [],
    addressChanged: false,
    pairing: { offer: null, request: null, locked: false },
    ...change,
  };
}

const device = (id: string, name: string, lastSeenAt: number | null) => ({ id, name, kind: 'phone' as const, createdAt: 0, lastSeenAt });
const labels = (view: ReturnType<typeof remoteStatusView>) => view?.actions.map((a) => a.label);

describe('Settings › Remote status card', () => {
  it('shows nothing while Remote is off', () => {
    expect(remoteStatusView(status({}, { enabled: false }))).toBeNull();
  });

  it('says the tunnel is starting', () => {
    const view = remoteStatusView(status({ tunnel: { state: 'starting', message: null }, address: null }));
    expect(view).toMatchObject({ tone: 'accent', title: 'Starting the Cloudflare tunnel…', detail: 'This takes a few seconds.', actions: [] });
    expect(remoteStatusView(status({ tunnel: { state: 'starting', message: null }, address: null }, { tunnel: 'tailscale' }))?.title).toBe('Starting Tailscale…');
  });

  it('names who is connected, two at most, then how many more', () => {
    const one = remoteStatusView(status({ connections: [{ deviceId: 'a', name: "Elio's iPhone", since: 1 }] }), NOW);
    expect(one).toMatchObject({ tone: 'ok', title: 'Running · 1 device connected', detail: "Elio's iPhone is connected now.", address: 'https://quiet-river.trycloudflare.com' });
    expect(labels(one)).toEqual(['Pair a device']);
    const four = remoteStatusView(
      status({ connections: ['A', 'B', 'C', 'D'].map((name) => ({ deviceId: name, name, since: 1 })) }),
      NOW,
    );
    expect(four).toMatchObject({ title: 'Running · 4 devices connected', detail: 'A, B and 2 more are connected now.' });
    // The same device in two tabs counts once.
    const twice = remoteStatusView(status({ connections: [{ deviceId: 'a', name: 'A', since: 1 }, { deviceId: 'a', name: 'A', since: 2 }] }), NOW);
    expect(twice?.title).toBe('Running · 1 device connected');
  });

  it('says when the last device connected, or that none is paired', () => {
    const devices = [device('a', 'A', NOW - 6 * HOUR), device('b', 'B', NOW - 30 * HOUR), device('c', 'C', null)];
    expect(remoteStatusView(status({ devices }), NOW)).toMatchObject({ title: 'Running', detail: 'No device connected. Last one 6 hours ago.' });
    expect(remoteStatusView(status({ devices: [device('c', 'C', null)] }), NOW)?.detail).toBe('No device connected yet.');
    const none = remoteStatusView(status(), NOW);
    expect(none?.detail).toBe('No device paired yet.');
    expect(none?.actions[0]).toMatchObject({ label: 'Pair a device', primary: true });
  });

  it('offers to install a missing tool, or to use Cloudflare instead', () => {
    const view = remoteStatusView(status({ problem: { kind: 'tool-missing', tunnel: 'tailscale' }, address: null, tunnel: { state: 'failed', message: null } }, { tunnel: 'tailscale' }));
    expect(view).toMatchObject({ tone: 'caution', title: "Remote can't start", detail: "Tailscale isn't installed on this computer." });
    expect(labels(view)).toEqual(['Install Tailscale', 'Use Cloudflare instead']);
    expect(view?.actions[0]?.action).toMatchObject({ kind: 'install', url: expect.stringContaining('tailscale.com') });
    const cloudflare = remoteStatusView(status({ problem: { kind: 'tool-missing', tunnel: 'cloudflare' }, address: null }));
    expect(labels(cloudflare)).toEqual(['Install cloudflared']);
  });

  it('offers the next free port when the port is in use', () => {
    const view = remoteStatusView(status({ problem: { kind: 'port-in-use', port: 47615, suggestedPort: 47616 }, address: null, tunnel: { state: 'off', message: null } }));
    expect(view).toMatchObject({ tone: 'error', title: 'Port 47615 is in use', detail: 'Another app listens on it. Pick another port, or quit that app.' });
    expect(view?.actions.map((a) => a.action)).toEqual([{ kind: 'use-port', port: 47616 }, { kind: 'change-port' }]);
    expect(labels(remoteStatusView(status({ problem: { kind: 'port-in-use', port: 47615, suggestedPort: null }, address: null })))).toEqual(['Change port…']);
  });

  it('shows the first line of a failure, and the rest behind Show details', () => {
    const view = remoteStatusView(status({ problem: { kind: 'failed', message: 'It broke\nat line 2' }, address: null }));
    expect(view).toMatchObject({ tone: 'error', title: "Remote can't start", detail: 'It broke', details: 'It broke\nat line 2' });
    expect(labels(view)).toEqual(['Try again', 'Show details']);
    expect(labels(remoteStatusView(status({ problem: { kind: 'failed', message: 'One line' }, address: null })))).toEqual(['Try again']);
  });

  it('says a tunnel that stopped isn\'t running, and asks for your own address when there is none', () => {
    const stopped = remoteStatusView(status({ tunnel: { state: 'failed', message: 'ERR 429 Too Many Requests' }, address: null }));
    expect(stopped).toMatchObject({ tone: 'error', title: "The Cloudflare tunnel isn't running", detail: 'ERR 429 Too Many Requests' });
    const custom = remoteStatusView(status({ tunnel: { state: 'failed', message: 'Add the address that forwards to Remote.' }, address: null }, { tunnel: 'custom' }));
    expect(custom).toMatchObject({ title: 'Add your address' });
    expect(custom?.actions[0]?.action).toEqual({ kind: 'change-connection' });
  });

  it('offers Reconnect a paired device when the address changed', () => {
    const view = remoteStatusView(status({ addressChanged: true, devices: [device('a', 'A', NOW - HOUR)] }), NOW);
    expect(view).toMatchObject({ tone: 'caution', title: 'Address changed', detail: "The quick tunnel restarted with a new address. Paired devices can't find it yet." });
    expect(view?.actions.map((a) => a.action)).toEqual([{ kind: 'reconnect' }]);
  });
});

describe('the connection row and names', () => {
  it('says where the address goes', () => {
    expect(connectionLine(status({}, { tunnel: 'custom', customUrl: 'https://remote.example.com' }))).toEqual({ name: 'My own address', address: 'https://remote.example.com → 127.0.0.1:47615' });
    expect(connectionLine(status())).toEqual({ name: 'Cloudflare quick tunnel', address: 'Address changes each time it starts' });
    expect(connectionLine(status({}, { tunnel: 'ngrok', ngrokDomain: 'me.ngrok.app' })).address).toBe('https://me.ngrok.app');
  });

  it('knows which addresses can change', () => {
    expect(addressCanChange(status().settings)).toBe(true);
    expect(addressCanChange(status({}, { tunnel: 'ngrok', ngrokDomain: 'me.ngrok.app' }).settings)).toBe(false);
    expect(addressCanChange(status({}, { tunnel: 'custom' }).settings)).toBe(false);
  });

  it('joins names', () => {
    expect([[], ['A'], ['A', 'B'], ['A', 'B', 'C']].map(joinNames)).toEqual(['', 'A', 'A and B', 'A, B and 1 more']);
  });
});
