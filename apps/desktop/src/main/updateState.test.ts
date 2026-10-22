import { describe, expect, it } from 'vitest';
import { cleanReleaseNotes } from './releaseNotes.ts';
import { available, changeChannel, channelOf, checking, dismissUpdated, downloaded, downloading, failed, initialUpdateState, installing, nextCommand, updatesDisabledReason, upToDate } from './updateState.ts';

const start = (channel: 'stable' | 'beta' = 'stable') => initialUpdateState({ currentVersion: '0.0.3', channel, disabledReason: null });

describe('update state', () => {
  it('reads the channel from the version', () => {
    expect(channelOf('1.2.3')).toBe('stable');
    expect(channelOf('1.2.3-beta.1')).toBe('beta');
    expect(channelOf('1.2.3-nightly.20261006.1')).toBe('stable');
  });

  it('goes from checking to available, downloading, downloaded and installing', () => {
    let state = checking(start());
    expect(state.status).toBe('checking');
    expect(nextCommand(state)).toBeNull();
    state = available(state, { version: '0.0.4', releaseNotes: 'Fixes' }, 1000);
    expect(state).toMatchObject({ status: 'available', availableVersion: '0.0.4', releaseNotes: 'Fixes', checkedAt: 1000 });
    expect(nextCommand(state)).toBe('download');
    state = downloading(state, 41.6);
    expect(state).toMatchObject({ status: 'downloading', downloadPercent: 42 });
    state = downloading(state, 140);
    expect(state.downloadPercent).toBe(100);
    state = downloaded(state, '0.0.4');
    expect(state).toMatchObject({ status: 'downloaded', downloadedVersion: '0.0.4' });
    expect(nextCommand(state)).toBe('install');
    state = installing(state);
    expect(state.status).toBe('installing');
    expect(checking(state)).toBe(state);
  });

  it('reports up to date, and keeps a downloaded update ready across checks', () => {
    expect(upToDate(checking(start()), 5)).toMatchObject({ status: 'up-to-date', checkedAt: 5, availableVersion: null });
    const ready = downloaded(available(start(), { version: '0.0.4', releaseNotes: null }, 1), '0.0.4');
    const again = checking(ready);
    expect(again).toMatchObject({ status: 'checking', downloadedVersion: '0.0.4' });
    expect(upToDate(again, 9)).toMatchObject({ status: 'downloaded', downloadedVersion: '0.0.4', checkedAt: 9 });
    expect(available(again, { version: '0.0.4', releaseNotes: null }, 9).status).toBe('downloaded');
  });

  it('offers a beta only on Beta, and a release on both channels', () => {
    expect(available(checking(start('stable')), { version: '0.0.4-beta.1', releaseNotes: null }, 2)).toMatchObject({ status: 'up-to-date', availableVersion: null });
    expect(available(checking(start('stable')), { version: '0.0.4', releaseNotes: null }, 2).status).toBe('available');
    expect(available(checking(start('beta')), { version: '0.0.4-beta.1', releaseNotes: null }, 2).status).toBe('available');
    expect(available(checking(start('beta')), { version: '0.0.4', releaseNotes: null }, 2).status).toBe('available');
  });

  it('fails with what it knew, and retries the step that failed', () => {
    const checkFailed = failed(checking(start()), 'offline', true);
    expect(checkFailed).toMatchObject({ status: 'error', error: 'offline', canRetry: true });
    expect(nextCommand(checkFailed)).toBe('check');

    const found = available(start(), { version: '0.0.4', releaseNotes: null }, 1);
    const downloadFailed = failed(downloading(found, 30), 'connection reset', true);
    expect(downloadFailed).toMatchObject({ status: 'error', availableVersion: '0.0.4', downloadPercent: null });
    expect(nextCommand(downloadFailed)).toBe('download');
    expect(downloading(downloadFailed, 0)).toMatchObject({ status: 'downloading', error: null });

    const installFailed = failed(installing(downloaded(found, '0.0.4')), 'did not restart', true);
    expect(nextCommand(installFailed)).toBe('install');
    expect(installing(installFailed).status).toBe('installing');
  });

  it('stays turned off', () => {
    const off = initialUpdateState({ currentVersion: '0.0.3', channel: 'stable', disabledReason: 'Updates are turned off in development builds' });
    expect(off.status).toBe('disabled');
    expect(checking(off)).toBe(off);
    expect(available(off, { version: '9.9.9', releaseNotes: null }, 1)).toBe(off);
    expect(failed(off, 'x', true)).toBe(off);
    expect(nextCommand(off)).toBeNull();
    expect(changeChannel(off, 'beta')).toMatchObject({ status: 'disabled', channel: 'beta' });
  });

  it('says why a build cannot update', () => {
    const release = { env: {}, packaged: true, devServer: false, hasFeed: true, mockFeed: false };
    expect(updatesDisabledReason(release)).toBeNull();
    expect(updatesDisabledReason({ ...release, env: { SWITCHBOARD_DISABLE_AUTO_UPDATE: '1' } })).toMatch(/SWITCHBOARD_DISABLE_AUTO_UPDATE/);
    expect(updatesDisabledReason({ ...release, packaged: false, devServer: true })).toBe('Updates are turned off in development builds.');
    expect(updatesDisabledReason({ ...release, packaged: false })).toMatch(/aren’t packaged/);
    expect(updatesDisabledReason({ ...release, hasFeed: false })).toMatch(/no update feed/);
    expect(updatesDisabledReason({ ...release, installer: false })).toMatch(/AppImage, \.deb or \.rpm/);
    expect(updatesDisabledReason({ ...release, installer: true })).toBeNull();
    // The mock server works from a development build too.
    expect(updatesDisabledReason({ ...release, packaged: false, devServer: true, hasFeed: false, mockFeed: true })).toBeNull();
  });

  it('forgets what it found when the channel changes, and says once that it updated', () => {
    const found = available(start(), { version: '0.0.4', releaseNotes: 'x' }, 1);
    expect(changeChannel(found, 'beta')).toMatchObject({ status: 'idle', channel: 'beta', availableVersion: null, releaseNotes: null });
    expect(changeChannel(found, 'stable')).toBe(found);
    const updated = initialUpdateState({ currentVersion: '0.0.4', channel: 'stable', disabledReason: null, updatedTo: '0.0.4' });
    expect(dismissUpdated(updated).updatedTo).toBeNull();
  });
});

describe('release notes', () => {
  it('turns GitHub’s HTML into plain text', () => {
    const html = '<h3>Projects</h3><ul><li>A <strong>new</strong> view &amp; more</li><li>Fixes&nbsp;#4</li></ul><p>Thanks!</p><script>alert(1)</script>';
    expect(cleanReleaseNotes(html)).toBe('Projects\n\n- A new view & more\n- Fixes #4\n\nThanks!');
  });

  it('simplifies Markdown and joins a full changelog', () => {
    expect(cleanReleaseNotes('### Fixed\n\n* **Restart** works, see [#4](https://x)\n\n\n\n')).toBe('Fixed\n\n- Restart works, see #4');
    expect(cleanReleaseNotes([{ version: '0.0.5', note: 'Five' }, { version: '0.0.4', note: '' }, null])).toBe('0.0.5\n\nFive');
  });

  it('caps long notes at a line break, and gives null for nothing usable', () => {
    const long = Array.from({ length: 200 }, (_, i) => `- Change number ${i}`).join('\n');
    const capped = cleanReleaseNotes(long, 500)!;
    expect(capped.length).toBeLessThanOrEqual(502);
    expect(capped.endsWith('\n…')).toBe(true);
    expect(capped.split('\n').at(-2)).toMatch(/^- Change number \d+$/);
    expect(cleanReleaseNotes(null)).toBeNull();
    expect(cleanReleaseNotes({ html: 'x' })).toBeNull();
    expect(cleanReleaseNotes('  <p> </p> ')).toBeNull();
  });
});
