import { describe, expect, it } from 'vitest';
import type { Computer, RemoteAppUpdate } from '@seshboard/protocol/client';
import { quickTunnel, rowUpdate, workingThere, type RowAsk } from './computerUpdate.ts';

const NOW = 1_000_000;
const here = { version: '1.2.0', availableVersion: null, channel: 'stable' as const };
const updater = (status: string, rest: Partial<RemoteAppUpdate> = {}): RemoteAppUpdate => ({ status, currentVersion: '1.1.0', availableVersion: null, downloadedVersion: null, downloadPercent: null, channel: 'stable', error: null, disabledReason: null, checkedAt: 1, whenIdle: false, ...rest });
const computer = (rest: Partial<Computer> = {}) => ({ name: 'involv', state: 'connected' as const, version: '1.1.0', features: ['app.update'], update: updater('up-to-date'), address: 'https://involv.example.com', ...rest });
const ask = (rest: Partial<RowAsk> = {}): RowAsk => ({ kind: 'install', from: '1.1.0', version: '1.2.0', at: NOW - 1_000, error: null, ...rest });
const of = (input: Partial<Parameters<typeof rowUpdate>[0]>) => rowUpdate({ computer: computer(), here, ask: null, updatedTo: null, now: NOW, ...input });

describe('rowUpdate', () => {
  it('shows what it found itself, or what only this Mac knows, with Update', () => {
    expect(of({ computer: computer({ update: updater('available', { availableVersion: '1.2.0' }) }), here: { ...here, version: '1.1.0' } })).toMatchObject({ state: 'behind', line: '1.2.0 available', aside: null, button: { kind: 'update', aria: 'Update involv to 1.2.0' }, offer: '1.2.0' });
    expect(of({})).toMatchObject({ state: 'behind', line: '1.2.0 is out', aside: 'involv hasn’t seen it yet', detail: 'This Mac knows about 1.2.0. Update makes involv check now, then installs it.', offer: '1.2.0' });
  });

  it('says nothing when it runs this version, and offers this Mac’s update when it is newer', () => {
    expect(of({ computer: computer({ version: '1.2.0' }) })).toMatchObject({ state: 'none', line: null, button: null, offer: null });
    expect(of({ computer: computer({ version: '1.2.5' }) })).toMatchObject({ state: 'ahead', line: 'newer than this Mac', button: { kind: 'update-here', label: 'Update this Mac' } });
  });

  it('follows the update: when idle, downloading, restarting, then Updated', () => {
    expect(of({ ask: ask(), computer: computer({ update: updater('available', { availableVersion: '1.2.0', whenIdle: true }) }) })).toMatchObject({ state: 'waiting', line: 'updates to 1.2.0 when idle', button: { kind: 'cancel', label: 'Cancel update' } });
    expect(of({ ask: ask(), computer: computer({ update: updater('downloading', { availableVersion: '1.2.0', downloadPercent: 40 }) }) })).toMatchObject({ state: 'downloading', line: 'Downloading 1.2.0… 40%' });
    expect(of({ ask: ask(), computer: computer({ update: updater('installing', { downloadedVersion: '1.2.0' }) }) })).toMatchObject({ state: 'restarting', line: 'Updating to 1.2.0, restarting…', restarting: true });
    expect(of({ ask: ask(), computer: computer({ state: 'connecting', version: null, update: null }) })).toMatchObject({ state: 'restarting', restarting: true, detail: null });
    expect(of({ computer: computer({ version: '1.2.0' }), updatedTo: '1.2.0' })).toMatchObject({ state: 'updated', line: 'Updated', tone: 'ok' });
  });

  it('says how to reconnect a quick tunnel after the restart', () => {
    const quick = computer({ state: 'offline', version: null, update: null, address: 'https://a-b.trycloudflare.com' });
    expect(of({ ask: ask(), computer: quick }).detail).toBe('involv gets a new address when it restarts. Copy the link from Reconnect a paired device in Settings › Remote there, and paste it below.');
    expect(quickTunnel('https://seshboard.example.com')).toBe(false);
  });

  it('checks: Checking for updates…, then Up to date, or what it found', () => {
    const check = ask({ kind: 'check', version: null });
    expect(of({ ask: check, computer: computer({ version: '1.2.0', update: updater('checking') }) })).toMatchObject({ state: 'checking', line: 'Checking for updates…' });
    expect(of({ ask: check, computer: computer({ version: '1.2.0', update: updater('up-to-date', { checkedAt: NOW }) }) })).toMatchObject({ state: 'up-to-date', line: 'Up to date' });
    // An up to date from before the check is no answer yet.
    expect(of({ ask: check, computer: computer({ version: '1.2.0', update: updater('up-to-date', { checkedAt: 1 }) }) })).toMatchObject({ state: 'none' });
    expect(of({ ask: check, computer: computer({ update: updater('available', { availableVersion: '1.2.0', checkedAt: NOW }) }) })).toMatchObject({ state: 'behind', line: '1.2.0 available' });
  });

  it('says it didn’t find the version this Mac knows, with the channel when that is why', () => {
    expect(of({ ask: ask(), computer: computer({ update: updater('up-to-date', { checkedAt: NOW }) }) })).toMatchObject({ state: 'not-found', line: 'involv didn’t find 1.2.0', detail: null, button: { kind: 'retry', label: 'Try again' } });
    expect(of({ ask: ask({ version: '1.3.0-beta.2' }), computer: computer({ update: updater('up-to-date', { checkedAt: NOW }) }) }).detail).toBe('involv gets Stable releases, and 1.3.0-beta.2 is a Beta. Change its channel there, or wait for Stable.');
  });

  it('says it couldn’t update from here: refused, failed, or turned off there', () => {
    expect(of({ ask: ask({ error: 'Seshboard can’t be updated from here' }) })).toMatchObject({ state: 'failed', line: 'Couldn’t update from here', detail: 'Seshboard can’t be updated from here. Update it on that computer.', button: { kind: 'retry' } });
    expect(of({ ask: ask(), computer: computer({ update: updater('error', { error: 'involv can’t write to its app folder' }) }) })).toMatchObject({ state: 'failed', detail: 'involv can’t write to its app folder. Update it on that computer.' });
    expect(of({ computer: computer({ update: updater('disabled', { disabledReason: 'Updates are turned off in development builds' }) }) })).toMatchObject({ state: 'failed', detail: 'Updates are turned off in development builds. Update it on that computer.', button: null });
  });

  it('hides Update for an older version, and says to update it there', () => {
    expect(of({ computer: computer({ features: [], update: null }) })).toMatchObject({ state: 'old', button: null, offer: null, note: 'Update it on that computer (needs 1.3.0 or later to update from here).' });
  });

  it('forgets an ask that is too old', () => {
    expect(of({ ask: ask({ at: NOW - 60 * 60_000 }), computer: computer({ state: 'offline', version: null, update: null }) })).toMatchObject({ state: 'none' });
  });
});

describe('workingThere', () => {
  const sessions = [
    { id: 'a', status: 'working' as const, parentId: null },
    { id: 'b', status: 'needs-you' as const, parentId: null },
    { id: 'c', status: 'background' as const, parentId: null },
    { id: 'd', status: 'idle' as const, parentId: null },
  ];
  it('counts the sessions working there and how many are other people’s', () => {
    expect(workingThere({ name: 'involv', mineHere: ['a'] }, sessions)).toBe('3 sessions are working on involv, 2 of them from other people.');
    expect(workingThere({ name: 'involv', mineHere: ['a', 'b', 'c'] }, sessions)).toBe('3 sessions are working on involv.');
    expect(workingThere({ name: 'involv', mineHere: [] }, sessions.slice(0, 1))).toBe('1 session is working on involv, from someone else.');
    expect(workingThere({ name: 'involv', mineHere: [] }, sessions.slice(3))).toBeNull();
  });
});
