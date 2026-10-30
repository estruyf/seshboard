import { describe, expect, it } from 'vitest';
import type { PermissionMode, SessionHostInfo } from '@seshboard/protocol';
import type { TurnOutcome } from '../host/sessionHost.ts';
import type { StoredUpNext } from '../host/upNextStore.ts';
import type { DriverEvents, DriverSession, ProviderAdapter, ProviderDriver } from './provider.ts';
import { ProviderHosts } from './providerHosts.ts';

const ID = 'c0ffee00-0000-4000-8000-000000000002';

/** A provider whose driver records what it is asked, and lets the test end turns. */
function setup(stored: StoredUpNext[] = []) {
  const calls: string[] = [];
  let events: DriverEvents | undefined;
  const session: DriverSession = {
    sessionId: ID,
    send: async (text, _a, steer) => (calls.push(`${steer ? 'steer' : 'send'}:${text}`), 'm'),
    interrupt: async () => {
      calls.push('interrupt');
      // A stopped turn ends like any other.
      events!.state('idle');
    },
    setModel: async (m) => void calls.push(`model:${m}`),
    setMode: async (m) => void calls.push(`mode:${m}`),
    commands: async () => [{ name: 'review', description: 'Review the changes', argumentHint: '' }],
    capabilities: async () => ({ live: true, mcp: [], agents: [], commands: [], plugins: [] }),
    mcp: async (server, action) => void calls.push(`mcp:${action}:${server}`),
    respond: () => {},
    close: async () => void calls.push('close'),
  };
  const driver: ProviderDriver = {
    modes: [
      { value: 'default', label: 'Ask', description: '' },
      { value: 'plan', label: 'Plan', description: '' },
    ],
    status: async () => ({ binary: '/c', version: null, signedIn: true, account: null, problem: null }),
    models: async () => [],
    commands: async () => [{ name: 'init', description: '', argumentHint: '' }],
    start: async (config, e) => ((events = e), calls.push(`start:${config.resume ?? 'new'}:${config.permissionMode}`), session),
    dispose: async () => {},
  };
  const adapter = { id: 'copilot', driver } as unknown as ProviderAdapter;
  const saved = new Map<string, StoredUpNext[]>([[ID, stored]]);
  const settings = new Map<string, { model?: string | null; permissionMode?: PermissionMode }>();
  const infos: SessionHostInfo[] = [];
  const turns: TurnOutcome[] = [];
  const hosts = new ProviderHosts({
    providers: () => [adapter],
    providerOf: () => 'copilot',
    sessionCwd: () => '/w',
    settings: { get: (id) => settings.get(id) ?? null, set: (id, c) => settings.set(id, { ...settings.get(id), ...c }) },
    upNext: { list: (id) => saved.get(id) ?? [], save: (id, m) => saved.set(id, [...m]) },
    onInfo: (info) => infos.push(info),
    onStream: () => {},
    onMessages: () => {},
    onPermission: () => {},
    onPermissionResolved: () => {},
    onTurnEnd: (_id, outcome) => turns.push(outcome),
    onCreated: () => {},
    log: () => {},
  });
  const last = () => infos.at(-1)!;
  const turn = { start: () => events!.state('running'), end: () => events!.state('idle') };
  return { hosts, calls, saved, settings, last, turn, turns };
}

const send = (hosts: ProviderHosts, text: string, mode?: 'queue' | 'steer' | 'now') => hosts.send({ sessionId: ID, text, attachments: [], ...(mode ? { mode } : {}) });

describe('ProviderHosts Up next', () => {
  it('queues while a turn runs, sends the next when it ends, and steers or stops it on request', async () => {
    const { hosts, calls, saved, last, turn, turns } = setup();
    await hosts.create({ provider: 'copilot', cwd: '/w', prompt: 'first', attachments: [], model: null, permissionMode: 'plan' });
    expect(calls).toEqual(['start:new:plan', 'send:first']);
    turn.start();
    expect((await send(hosts, 'second')).queued).toBe(true);
    expect(last().queue.map((q) => q.text)).toEqual(['second']);
    expect(saved.get(ID)!.map((q) => q.text)).toEqual(['second']);
    await send(hosts, 'join in', 'steer');
    expect(calls.at(-1)).toBe('steer:join in');

    turn.end();
    await Promise.resolve();
    expect(calls.at(-1)).toBe('send:second');
    expect(last().queue).toEqual([]);

    // Send now: the turn stops, the message goes first, and the turn's end says it was superseded.
    turn.start();
    await send(hosts, 'later');
    await send(hosts, 'urgent', 'now');
    await Promise.resolve();
    expect(calls.slice(-2)).toEqual(['interrupt', 'send:urgent']);
    expect(turns.at(-1)).toMatchObject({ stopped: true, superseded: true });
    expect(last().queue.map((q) => q.text)).toEqual(['later']);
  });

  it('holds Up next after Stop until resumed, and edits and reorders it', async () => {
    const { hosts, calls, last, turn } = setup();
    await hosts.create({ provider: 'copilot', cwd: '/w', prompt: 'first', attachments: [], model: null });
    turn.start();
    await send(hosts, 'a');
    await send(hosts, 'b');
    const [a, b] = last().queue;
    hosts.moveQueued(ID, b!.id, 0);
    expect(last().queue.map((q) => q.text)).toEqual(['b', 'a']);
    expect(hosts.dequeue(ID, a!.id)).toEqual({ text: 'a', attachments: [] });

    await hosts.interrupt(ID);
    expect(last()).toMatchObject({ state: 'idle', queueHold: 'stopped' });
    expect(calls.at(-1)).toBe('interrupt');
    await hosts.resumeQueue(ID);
    expect(calls.at(-1)).toBe('send:b');
    expect(last().queueHold).toBeNull();
  });

  it('brings back what was waiting after a restart, held, and resumes in the last mode', async () => {
    const { hosts, calls, settings, last } = setup([{ id: 'q1', text: 'kept', attachments: [], createdAt: 1 }]);
    settings.set(ID, { permissionMode: 'plan' });
    await hosts.resumeQueue(ID);
    expect(calls).toEqual(['start:c0ffee00-0000-4000-8000-000000000002:plan', 'send:kept']);
    expect(last().queue).toEqual([]);
  });

  it('keeps a mode picked while not running for the next resume, and checks it is one the provider has', async () => {
    const { hosts, settings, calls } = setup();
    expect((await hosts.commands(ID)).map((c) => c.name)).toEqual(['init']);
    await hosts.setPermissionMode(ID, 'plan');
    expect(settings.get(ID)).toEqual({ permissionMode: 'plan' });
    await send(hosts, 'go');
    expect(calls[0]).toBe(`start:${ID}:plan`);
    await expect(hosts.setPermissionMode(ID, 'bypassPermissions')).rejects.toMatchObject({ code: 'INVALID' });
    // A running session's own commands; before that, a new session's.
    expect((await hosts.commands(ID)).map((c) => c.name)).toEqual(['review']);
    await hosts.setPermissionMode(ID, 'default');
    expect(calls.at(-1)).toBe('mode:default');
  });
});
