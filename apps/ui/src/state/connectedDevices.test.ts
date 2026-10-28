import { describe, expect, it } from 'vitest';
import type { RemoteStatus } from '@seshboard/protocol/client';
import {
  actionOf,
  connectedRows,
  connectionAnnouncement,
  connectionChanges,
  connectToastDue,
  countLabel,
  dayKey,
  JUST_PAIRED_MS,
  lastActionText,
  remoteFooter,
  sectionTitle,
  sinceText,
  throughText,
  type LastAction,
} from './connectedDevices.ts';

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const NOW = at(15, 16, 30);

const devices: RemoteStatus['devices'] = [
  { id: 'phone', name: "Elio's iPhone", kind: 'phone', createdAt: at(12, 9), lastSeenAt: null },
  { id: 'safari', name: 'Safari on MacBook Air', kind: 'browser', createdAt: at(1, 9), lastSeenAt: null },
  { id: 'idle', name: 'iPad', kind: 'phone', createdAt: at(1, 9), lastSeenAt: null },
];

function status(change: Partial<RemoteStatus> = {}): RemoteStatus {
  return {
    available: true,
    settings: { enabled: true, tunnel: 'cloudflare', customUrl: null, ngrokDomain: null, port: 47615 },
    appUrl: 'https://app.example/remote/',
    address: 'https://remote.example.com',
    tunnel: { state: 'running', message: null },
    tools: { cloudflare: true, ngrok: false, tailscale: false },
    problem: null,
    devices,
    connections: [],
    addressChanged: false,
    pairing: { offer: null, request: null, locked: false },
    ...change,
  } as RemoteStatus;
}

describe('connectedRows', () => {
  it('joins connections with their devices, the first to connect first', () => {
    const rows = connectedRows({
      devices,
      connections: [
        { deviceId: 'safari', name: 'Safari on MacBook Air', since: at(15, 16, 40) },
        { deviceId: 'phone', name: "Elio's iPhone", since: at(15, 14, 2) },
      ],
    });
    expect(rows).toEqual([
      { id: 'phone', name: "Elio's iPhone", kind: 'phone', since: at(15, 14, 2), createdAt: at(12, 9), lastAction: null },
      { id: 'safari', name: 'Safari on MacBook Air', kind: 'browser', since: at(15, 16, 40), createdAt: at(1, 9), lastAction: null },
    ]);
  });

  it('shows a device with two connections once, with the earliest since', () => {
    const rows = connectedRows({
      devices,
      connections: [
        { deviceId: 'phone', name: "Elio's iPhone", since: at(15, 15) },
        { deviceId: 'phone', name: "Elio's iPhone", since: at(15, 14, 2) },
      ],
    });
    expect(rows.map((r) => [r.id, r.since])).toEqual([['phone', at(15, 14, 2)]]);
  });

  it('leaves out a connection whose device was revoked, and adds the last action', () => {
    const action: LastAction = { sessionId: 's1', kind: 'prompt', answer: null, at: NOW };
    const rows = connectedRows(
      { devices, connections: [{ deviceId: 'gone', name: 'Old', since: 1 }, { deviceId: 'phone', name: "Elio's iPhone", since: 2 }] },
      new Map([['phone', action]]),
    );
    expect(rows.map((r) => [r.id, r.lastAction])).toEqual([['phone', action]]);
  });
});

describe('remoteFooter', () => {
  it('shows nothing while Remote is off, the problem, the devices, or the quiet line', () => {
    expect(remoteFooter(null, true)).toBe('hidden');
    expect(remoteFooter(status({ settings: { ...status().settings, enabled: false } }), true)).toBe('hidden');
    expect(remoteFooter(status({ problem: { kind: 'port-in-use', port: 1, suggestedPort: null } }), true)).toBe('problem');
    expect(remoteFooter(status({ connections: [{ deviceId: 'phone', name: 'x', since: 1 }] }), true)).toBe('devices');
    expect(remoteFooter(status(), true)).toBe('idle');
    expect(remoteFooter(status(), false)).toBe('hidden');
  });
});

describe('wording', () => {
  it('says since when, today, yesterday and further back', () => {
    expect(sinceText(at(15, 14, 2), NOW, 'en-GB')).toBe('since 14:02');
    expect(sinceText(at(14, 22, 10), NOW, 'en-GB')).toBe('since yesterday 22:10');
    expect(sinceText(at(12, 9), NOW, 'en-GB')).toBe('since 12 Oct');
    expect(sinceText(new Date(2025, 11, 30, 9).getTime(), NOW, 'en-GB')).toBe('since 30 Dec 2025');
    expect(sinceText(at(15, 14, 2), NOW, 'en-US')).toBe('since 2:02 PM');
  });

  it('says what a device did last: a prompt, an answer, or nothing yet', () => {
    const prompt = actionOf({ sessionId: 's1', requestId: null, deviceId: 'phone' }, NOW - 4 * 60_000);
    expect(prompt).toEqual({ sessionId: 's1', kind: 'prompt', answer: null, at: NOW - 4 * 60_000 });
    expect(lastActionText(prompt, 'Needs review sort', NOW)).toBe('Sent a prompt in Needs review sort · 4m ago');

    const answer = actionOf({ sessionId: 's2', requestId: 'r1', deviceId: 'phone', answer: { toolName: 'Bash', allowed: true } }, NOW - 2 * 60_000);
    expect(lastActionText(answer, 'tideline', NOW)).toBe('Answered Allow Bash in tideline · 2m ago');
    expect(lastActionText({ ...answer, answer: { toolName: 'Bash', allowed: false } }, 'tideline', NOW)).toBe('Answered Deny Bash in tideline · 2m ago');
    expect(lastActionText({ ...answer, answer: { toolName: 'AskUserQuestion', allowed: true }, at: NOW }, 'tideline', NOW)).toBe('Answered a question in tideline · just now');
    // An older engine that doesn't say what was answered.
    expect(lastActionText(actionOf({ sessionId: 's2', requestId: 'r1', deviceId: 'phone' }, NOW), 'tideline', NOW)).toBe('Answered a prompt in tideline · just now');
    expect(lastActionText(null, '', NOW)).toBe('No actions yet');
  });

  it('names the section, the count and the address', () => {
    expect(sectionTitle('darwin')).toBe('Connected to this Mac');
    expect(sectionTitle('win32')).toBe('Connected to this PC');
    expect(countLabel(1)).toBe('1 device connected');
    expect(countLabel(2)).toBe('2 devices connected');
    expect(throughText('https://remote.example.com')).toBe('remote.example.com');
  });
});

describe('connections coming and going', () => {
  const phone = { id: 'phone', name: "Elio's iPhone", kind: 'phone' as const, since: 1, createdAt: 1, lastAction: null };
  const safari = { ...phone, id: 'safari', name: 'Safari on MacBook Air' };

  it('says nothing about the first list, then who connected and who left', () => {
    expect(connectionChanges(null, [phone])).toEqual({ joined: [], left: [] });
    const changes = connectionChanges([phone], [safari]);
    expect(changes).toEqual({ joined: [safari], left: [phone] });
    expect(connectionAnnouncement(changes)).toBe("Safari on MacBook Air connected. Elio's iPhone disconnected.");
  });

  it('shows the toast once per device per day, and not right after pairing', () => {
    const paired = { createdAt: at(12, 9) };
    expect(connectToastDue(paired, null, NOW)).toBe(true);
    expect(connectToastDue(paired, dayKey(NOW), NOW)).toBe(false);
    expect(connectToastDue(paired, dayKey(at(14, 23)), NOW)).toBe(true);
    expect(dayKey(NOW)).toBe('2026-10-15');
    expect(connectToastDue({ createdAt: NOW - 30_000 }, null, NOW)).toBe(false);
    expect(connectToastDue({ createdAt: NOW - JUST_PAIRED_MS }, null, NOW)).toBe(true);
  });
});
