import { describe, expect, it } from 'vitest';
import { detectInstall } from './claudeInstall.ts';
import * as reduce from './claudeUpdateState.ts';

const native = detectInstall('/Users/me/.local/bin/claude', '/Users/me/.local/share/claude/versions/2.1.0', { home: '/Users/me', channel: 'latest', platform: 'darwin' });
const found = (version: string, extra: Partial<reduce.FoundInstall> = {}): reduce.FoundInstall => ({
  path: '/Users/me/.local/bin/claude',
  version,
  info: native,
  channel: 'latest',
  override: false,
  quiet: false,
  ...extra,
});
const start = (version = '2.1.0') => reduce.installFound(reduce.initialClaudeUpdateState({ enabled: true, dismissedVersion: null }), found(version));

describe('Claude Code update state', () => {
  it('checking → available → updating (with output) → updated', () => {
    let state = reduce.checking(start());
    expect(state.status).toBe('checking');
    state = reduce.checked(state, '2.2.0', 1000);
    expect(state).toMatchObject({ status: 'available', latestVersion: '2.2.0', checkedAt: 1000, command: 'claude update', canUpdate: true });
    state = reduce.updating(state);
    expect(state.status).toBe('updating');
    expect(reduce.updating(state)).toBe(state);
    expect(reduce.checking(state)).toBe(state);
    state = reduce.appendOutput(state, 'Updating…\n');
    state = reduce.updateFinished(state, { exitCode: 0, version: '2.2.0' });
    expect(state).toMatchObject({ status: 'updated', installedVersion: '2.2.0', updatedTo: '2.2.0', output: 'Updating…\n' });
    // A later check confirms it until dismissed.
    expect(reduce.checked(state, '2.2.0', 2000).status).toBe('updated');
    expect(reduce.dismiss(state)).toMatchObject({ status: 'up-to-date', updatedTo: null });
  });

  it('checking → up to date', () => {
    expect(reduce.checked(reduce.checking(start('2.2.0')), '2.2.0', 1).status).toBe('up-to-date');
    // An installed version newer than the channel (on latest while comparing stable) is up to date too.
    expect(reduce.checked(reduce.checking(start('2.3.0')), '2.2.0', 1).status).toBe('up-to-date');
  });

  it('an unreadable installed version is an error, not up to date', () => {
    const state = reduce.checked(reduce.checking(reduce.installFound(start(), { ...found('2.1.0'), version: null })), '2.2.0', 1);
    expect(state).toMatchObject({ status: 'error', latestVersion: '2.2.0' });
    expect(state.error).toContain('Couldn’t read the version');
  });

  it('a failed check keeps what was known, and Retry checks again', () => {
    const failed = reduce.failed(reduce.checking(start()), 'offline');
    expect(failed).toMatchObject({ status: 'error', error: 'offline' });
    expect(reduce.retryCommand(failed)).toBe('check');
    expect(reduce.checking(failed)).toMatchObject({ status: 'checking', error: null });
  });

  it('a failed update keeps the newer version, and Retry updates again', () => {
    let state = reduce.updating(reduce.checked(start(), '2.2.0', 1));
    state = reduce.updateFinished(state, { exitCode: 1, version: '2.1.0' });
    expect(state).toMatchObject({ status: 'error', error: 'The update command exited with code 1.', latestVersion: '2.2.0' });
    expect(reduce.retryCommand(state)).toBe('update');
    expect(reduce.updating(state).status).toBe('updating');
  });

  it('a command that succeeds without changing the version is an error', () => {
    const state = reduce.updateFinished(reduce.updating(reduce.checked(start(), '2.2.0', 1)), { exitCode: 0, version: '2.1.0' });
    expect(state.status).toBe('error');
    expect(state.error).toContain('still v2.1.0');
  });

  it('an update that moved forward but not all the way still offers the newest', () => {
    const state = reduce.updateFinished(reduce.updating(reduce.checked(start(), '2.3.0', 1)), { exitCode: 0, version: '2.2.0' });
    expect(state).toMatchObject({ status: 'available', installedVersion: '2.2.0', updatedTo: '2.2.0' });
  });

  it('keeps output to its last OUTPUT_LIMIT characters, only while updating', () => {
    let state = reduce.updating(reduce.checked(start(), '2.2.0', 1));
    state = reduce.appendOutput(state, 'a'.repeat(reduce.OUTPUT_LIMIT));
    state = reduce.appendOutput(state, 'end');
    expect(state.output).toHaveLength(reduce.OUTPUT_LIMIT);
    expect(state.output.endsWith('end')).toBe(true);
    expect(reduce.appendOutput(start(), 'x').output).toBe('');
  });

  it('a custom path or an unknown install can only be updated by hand', () => {
    const custom = reduce.installFound(start(), found('2.1.0', { override: true }));
    expect(custom).toMatchObject({ canUpdate: false, command: 'claude update' });
    expect(custom.manualReason).toContain('custom path');
    const unknown = reduce.installFound(start(), found('2.1.0', { info: detectInstall('/opt/claude', '/opt/claude', { home: '/Users/me', channel: 'latest', platform: 'darwin' }) }));
    expect(unknown).toMatchObject({ canUpdate: false, method: 'unknown' });
    expect(reduce.updating(reduce.checked(unknown, '2.2.0', 1)).status).toBe('available');
    expect(reduce.retryCommand(reduce.failed(reduce.checked(unknown, '2.2.0', 1), 'x'))).toBe('check');
  });

  it('no claude binary: missing, and nothing to check', () => {
    const missing = reduce.installFound(start(), null);
    expect(missing).toMatchObject({ status: 'missing', path: null, canUpdate: false });
    expect(reduce.checking(missing)).toBe(missing);
    expect(reduce.installFound(missing, found('2.1.0')).status).toBe('idle');
    // Found missing while checking: the check stops there.
    expect(reduce.installFound(reduce.checking(start()), null).status).toBe('missing');
  });

  it('a new channel forgets the version found on the old one', () => {
    const state = reduce.checked(start(), '2.2.0', 1);
    expect(reduce.installFound(state, found('2.1.0', { channel: 'stable' }))).toMatchObject({ channel: 'stable', latestVersion: null });
    expect(reduce.installFound(state, found('2.1.0')).latestVersion).toBe('2.2.0');
  });

  it('dismissing remembers the version on offer', () => {
    const state = reduce.dismiss(reduce.checked(start(), '2.2.0', 1));
    expect(state.dismissedVersion).toBe('2.2.0');
    expect(state.status).toBe('available');
  });

  it('turned off: off, nothing on offer; turned on: idle again', () => {
    const off = reduce.setEnabled(reduce.checked(start(), '2.2.0', 1), false);
    expect(off).toMatchObject({ status: 'off', enabled: false, latestVersion: null });
    expect(reduce.setEnabled(off, true)).toMatchObject({ status: 'idle', enabled: true });
    expect(reduce.initialClaudeUpdateState({ enabled: false, dismissedVersion: null }).status).toBe('off');
    // A check you start still runs.
    expect(reduce.checked(reduce.checking(off), '2.2.0', 1).status).toBe('available');
    // Turning it off mid-update leaves the update alone.
    const running = reduce.updating(reduce.checked(start(), '2.2.0', 1));
    expect(reduce.setEnabled(running, false).status).toBe('updating');
  });
});
