import { describe, expect, it } from 'vitest';
import type { UpdateState } from '@seshboard/protocol/bridge';
import { lastChecked, updateStatusText, updateToast, versionLabel } from './updates.ts';

const base: UpdateState = {
  status: 'idle',
  currentVersion: '0.0.3',
  availableVersion: null,
  downloadedVersion: null,
  downloadPercent: null,
  releaseNotes: null,
  error: null,
  canRetry: false,
  disabledReason: null,
  channel: 'stable',
  checkedAt: null,
  updatedTo: null,
};

describe('version and update labels', () => {
  it('never shows a release number for a development build', () => {
    expect(versionLabel({ version: '0.0.3', commit: 'abc1234', dev: false, fromSwitchboard: false })).toBe('v0.0.3');
    expect(versionLabel({ version: '0.0.3', commit: 'abc1234', dev: true, fromSwitchboard: false })).toBe('dev · abc1234');
    expect(versionLabel({ version: '0.0.3', commit: null, dev: true, fromSwitchboard: false })).toBe('dev');
  });

  it('shows a toast only when there is something to act on', () => {
    expect(updateToast(null)).toBeNull();
    expect(updateToast(base)).toBeNull();
    expect(updateToast({ ...base, status: 'disabled', disabledReason: 'off' })).toBeNull();
    expect(updateToast({ ...base, status: 'up-to-date' })).toBeNull();
    // A background check that failed (offline) stays in Settings.
    expect(updateToast({ ...base, status: 'error', error: 'offline', canRetry: true })).toBeNull();
    expect(updateToast({ ...base, status: 'available', availableVersion: '0.0.4', releaseNotes: 'Fixes' })).toMatchObject({ title: 'Seshboard v0.0.4 is available', action: { run: 'download' }, notes: 'Fixes', close: 'hide' });
    expect(updateToast({ ...base, status: 'downloading', availableVersion: '0.0.4', downloadPercent: 42 })).toMatchObject({ tone: 'busy', progress: 42, action: null });
    expect(updateToast({ ...base, status: 'downloaded', downloadedVersion: '0.0.4' })).toMatchObject({ title: 'Seshboard v0.0.4 is ready', action: { label: 'Restart to update', run: 'install' } });
    expect(updateToast({ ...base, status: 'error', availableVersion: '0.0.4', canRetry: true, error: 'timed out' })).toMatchObject({ title: 'The update failed', body: 'timed out', action: { run: 'retry' } });
    expect(updateToast({ ...base, status: 'error', downloadedVersion: '0.0.4', canRetry: false })).toMatchObject({ action: null, tone: 'error' });
    expect(updateToast({ ...base, status: 'up-to-date', updatedTo: '0.0.3' })).toMatchObject({ title: 'Updated to Seshboard v0.0.3', tone: 'ok', close: 'dismiss' });
  });

  it('gives each step its own key, so hiding one doesn’t hide the next', () => {
    const keys = [
      updateToast({ ...base, status: 'available', availableVersion: '0.0.4' }),
      updateToast({ ...base, status: 'downloading', availableVersion: '0.0.4' }),
      updateToast({ ...base, status: 'downloaded', downloadedVersion: '0.0.4' }),
      updateToast({ ...base, status: 'available', availableVersion: '0.0.5' }),
    ].map((t) => t?.key);
    expect(new Set(keys).size).toBe(4);
  });

  it('describes the state in Settings', () => {
    expect(updateStatusText({ ...base, status: 'disabled', disabledReason: 'Updates are turned off in development builds.' })).toBe('Updates are turned off in development builds.');
    expect(updateStatusText({ ...base, status: 'downloading', availableVersion: '0.0.4', downloadPercent: 7 })).toBe('Downloading version 0.0.4… 7%');
    expect(updateStatusText({ ...base, status: 'error', error: 'offline' })).toBe('The update failed: offline');
  });

  it('says when it last checked', () => {
    const now = 10 * 3_600_000;
    expect(lastChecked(null, now)).toBe('Never checked');
    expect(lastChecked(now - 10_000, now)).toBe('Last checked just now');
    expect(lastChecked(now - 60_000, now)).toBe('Last checked 1 minute ago');
    expect(lastChecked(now - 3 * 3_600_000, now)).toBe('Last checked 3 hours ago');
  });
});
