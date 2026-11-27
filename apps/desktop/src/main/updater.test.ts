import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UpdateState } from '@seshboard/protocol/bridge';
import { readUpdateMarker, Updater, type UpdaterOptions } from './updater.ts';

const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true }));
});
const markerPath = () => {
  const dir = mkdtempSync(join(tmpdir(), 'seshboard-update-'));
  dirs.push(dir);
  return join(dir, 'update-marker.json');
};

function fakeUpdater(offer: { version: string; releaseNotes?: unknown } | Error) {
  const progress: Array<(p: { percent: number }) => void> = [];
  const fake = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    allowDowngrade: false,
    channel: null as string | null,
    forceDevUpdateConfig: false,
    logger: null as unknown,
    updateConfigPath: null as string | null,
    feed: null as unknown,
    installed: 0,
    checks: 0,
    /** Set to hold the download until it resolves. */
    downloadGate: null as Promise<void> | null,
    /** quitAndInstall throws, as when Squirrel refuses to update. */
    failInstall: false,
    setFeedURL(options: unknown) {
      this.feed = options;
    },
    async checkForUpdates() {
      this.checks++;
      if (offer instanceof Error) throw offer;
      return { updateInfo: offer, isUpdateAvailable: offer.version !== '0.0.3' };
    },
    async downloadUpdate() {
      progress.forEach((l) => l({ percent: 50 }));
      if (this.downloadGate) await this.downloadGate;
      return [];
    },
    quitAndInstall() {
      if (this.failInstall) throw new Error('Cannot update while running on a read-only volume.');
      this.installed++;
    },
    /** Reports download progress, which keeps a held download from counting as stalled. */
    progress(percent: number) {
      progress.forEach((l) => l({ percent }));
    },
    on(_event: 'download-progress', listener: (p: { percent: number }) => void) {
      progress.push(listener);
    },
  };
  return fake;
}

function setup(fake: ReturnType<typeof fakeUpdater>, extra: Partial<UpdaterOptions> = {}) {
  const states: UpdateState[] = [];
  let stopped = 0;
  let resumed = 0;
  const updater = new Updater({
    currentVersion: '0.0.3',
    channel: 'stable',
    autoCheck: false,
    disabledReason: null,
    markerFile: markerPath(),
    onState: (s) => states.push(s),
    beforeInstall: () => void stopped++,
    installFailed: () => void resumed++,
    log: () => {},
    load: async () => fake,
    ...extra,
  });
  return { updater, states, stopped: () => stopped, resumed: () => resumed };
}

const MISSING = 'Cannot find latest-mac.yml in the latest release artifacts (https://github.com/estruyf/seshboard/releases/download/v1.5.0-beta.10/latest-mac.yml): HttpError: 404';
const ATOM = ['v1.5.0-beta.10', 'v1.5.0-beta.9', 'v1.5.0-beta.8', 'v1.4.0']
  .map((t) => `<entry><link rel="alternate" href="https://github.com/estruyf/seshboard/releases/tag/${t}"/></entry>`)
  .join('');

describe('Updater', () => {
  it('checks, downloads with progress, and installs after writing the marker', async () => {
    const fake = fakeUpdater({ version: '0.0.4', releaseNotes: '<ul><li>Restart works</li></ul>' });
    const { updater, states, stopped } = setup(fake);
    await updater.check();
    expect(fake.autoDownload).toBe(false);
    expect(fake).toMatchObject({ channel: 'latest', allowPrerelease: false, allowDowngrade: false });
    expect(updater.state).toMatchObject({ status: 'available', availableVersion: '0.0.4', releaseNotes: '- Restart works' });
    await updater.download();
    expect(states.map((s) => s.status)).toEqual(['checking', 'available', 'downloading', 'downloading', 'downloaded']);
    expect(states[3]!.downloadPercent).toBe(50);
    await updater.install();
    expect(updater.state.status).toBe('installing');
    expect(fake.installed).toBe(1);
    expect(stopped()).toBe(1);
  });

  it('updates and restarts in one go, from a phone', async () => {
    const fake = fakeUpdater({ version: '0.0.4' });
    const { updater, states, stopped } = setup(fake);
    await updater.updateAndRestart();
    expect(states.map((s) => s.status)).toEqual(['checking', 'available', 'downloading', 'downloading', 'downloaded', 'installing']);
    expect(fake.installed).toBe(1);
    expect(stopped()).toBe(1);
  });

  it('restarts nothing when there is nothing newer, and installs what was downloaded when the check fails', async () => {
    const current = fakeUpdater({ version: '0.0.3' });
    const { updater } = setup(current);
    await updater.updateAndRestart();
    expect(updater.state.status).toBe('up-to-date');
    expect(current.installed).toBe(0);

    const offline = fakeUpdater({ version: '0.0.4' });
    const { updater: second } = setup(offline);
    await second.check();
    await second.download();
    offline.checkForUpdates = async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    };
    await second.updateAndRestart();
    expect(second.state.status).toBe('installing');
    expect(offline.installed).toBe(1);
  });

  it('turns a failed check into a retryable error, and Retry checks again', async () => {
    const fake = fakeUpdater(new Error('net::ERR_INTERNET_DISCONNECTED\nmore detail'));
    const { updater } = setup(fake);
    await updater.check();
    expect(updater.state).toMatchObject({ status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED', canRetry: true });
    const feedError = Object.assign(new Error('Cannot parse releases feed'), { code: 'ERR_UPDATER_INVALID_RELEASE_FEED' });
    const { updater: second } = setup(fakeUpdater(feedError));
    await second.check();
    expect(second.state).toMatchObject({ status: 'error', canRetry: false });
  });

  it('is up to date while the newest release is still being built and no earlier one is newer', async () => {
    const missing = Object.assign(new Error(MISSING), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' });
    const fetched: string[] = [];
    const { updater, states } = setup(fakeUpdater(missing), { channel: 'beta', currentVersion: '1.5.0-beta.9', fetchText: async (url) => (fetched.push(url), url.endsWith('.atom') ? ATOM : 'version: x') });
    await updater.check();
    expect(updater.state).toMatchObject({ status: 'up-to-date', error: null });
    expect(updater.state.checkedAt).not.toBeNull();
    expect(states.some((s) => s.status === 'error')).toBe(false);
    expect(fetched).toEqual(['https://github.com/estruyf/seshboard/releases.atom']);
  });

  it('offers the release before the newest while the newest has no feed yet, then goes back to GitHub', async () => {
    const missing = Object.assign(new Error(MISSING), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' });
    const fake = fakeUpdater(missing);
    // The generic feed of the earlier release answers; the GitHub feed still has nothing.
    fake.checkForUpdates = async function () {
      this.checks++;
      if (!this.feed) throw missing;
      return { updateInfo: { version: '1.5.0-beta.9' }, isUpdateAvailable: true };
    };
    const fetched: string[] = [];
    const { updater } = setup(fake, {
      channel: 'beta',
      currentVersion: '1.5.0-beta.7',
      // beta.9 has its feed; the feed of beta.10 is not attached yet.
      fetchText: async (url) => (fetched.push(url), url.endsWith('.atom') ? ATOM : url.includes('beta.9/') ? 'version: 1.5.0-beta.9' : null),
    });
    await updater.check();
    expect(updater.state).toMatchObject({ status: 'available', availableVersion: '1.5.0-beta.9' });
    expect(fake.feed).toEqual({ provider: 'generic', url: 'https://github.com/estruyf/seshboard/releases/download/v1.5.0-beta.9' });
    expect(fake.channel).toBe('beta');
    expect(fake.allowDowngrade).toBe(false);
    expect(fetched).toContain('https://github.com/estruyf/seshboard/releases/download/v1.5.0-beta.9/beta-mac.yml');
    await updater.download();
    expect(updater.state).toMatchObject({ status: 'downloaded', downloadedVersion: '1.5.0-beta.9' });
    // The next check reads the GitHub feed again.
    fake.feed = null;
    let reset = 0;
    Object.defineProperty(fake, 'updateConfigPath', { set: () => void reset++, configurable: true });
    await updater.check();
    expect(reset).toBe(1);
  });

  it('is up to date when looking for an earlier release fails', async () => {
    const missing = Object.assign(new Error(MISSING), { code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND' });
    const { updater } = setup(fakeUpdater(missing), { channel: 'beta', currentVersion: '1.5.0-beta.7', fetchText: async () => { throw new Error('offline'); } });
    await updater.check();
    expect(updater.state).toMatchObject({ status: 'up-to-date', error: null });
  });

  it('switches to Beta and checks pre-releases at once; going back to Stable never downgrades', async () => {
    const fake = fakeUpdater({ version: '0.0.4-beta.1' });
    const { updater } = setup(fake);
    updater.setChannel('beta');
    await new Promise((r) => setTimeout(r, 0));
    expect(fake).toMatchObject({ channel: 'beta', allowPrerelease: true, allowDowngrade: false });
    expect(updater.state).toMatchObject({ channel: 'beta', status: 'available', availableVersion: '0.0.4-beta.1' });

    // From a beta, Stable waits for that version's release.
    const onBeta = fakeUpdater({ version: '0.0.4' });
    const { updater: back } = setup(onBeta, { currentVersion: '0.0.4-beta.1', channel: 'beta' });
    back.setChannel('stable');
    await new Promise((r) => setTimeout(r, 0));
    expect(onBeta).toMatchObject({ channel: 'latest', allowPrerelease: false, allowDowngrade: false });
    expect(back.state.status).toBe('available');
  });

  it('brings the engine back when the install fails or the app is not restarted', async () => {
    const fake = fakeUpdater({ version: '0.0.4' });
    fake.failInstall = true;
    const { updater, stopped, resumed } = setup(fake);
    const marker = (updater as unknown as { options: UpdaterOptions }).options.markerFile;
    await updater.check();
    await updater.download();
    await updater.install();
    expect([stopped(), resumed()]).toEqual([1, 1]);
    expect(updater.state).toMatchObject({ status: 'error', downloadedVersion: '0.0.4', canRetry: true });
    expect(existsSync(marker)).toBe(false);

    vi.useFakeTimers();
    fake.failInstall = false;
    await updater.install();
    expect(fake.installed).toBe(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect([stopped(), resumed()]).toEqual([2, 2]);
    expect(updater.state).toMatchObject({ status: 'error', error: 'Seshboard didn’t restart to install the update.' });

    // Quitting (stop) during an install that works is not a failure.
    await updater.install();
    updater.stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(resumed()).toBe(2);
    expect(updater.state.status).toBe('installing');
  });

  it('switches channel only after a running download ends, so its version is not kept', async () => {
    const fake = fakeUpdater({ version: '0.0.4' });
    let finish = () => {};
    fake.downloadGate = new Promise<void>((resolve) => (finish = resolve));
    const { updater } = setup(fake);
    await updater.check();
    const download = updater.download();
    await new Promise((r) => setTimeout(r, 0));
    updater.setChannel('beta');
    expect(updater.state).toMatchObject({ status: 'downloading', channel: 'stable' });
    finish();
    await download;
    // The download is forgotten and Beta is checked, which offers the release again.
    expect(updater.state).toMatchObject({ channel: 'beta', downloadedVersion: null });
    await new Promise((r) => setTimeout(r, 0));
    expect(fake.channel).toBe('beta');
    expect(fake.checks).toBe(2);
    expect(updater.state).toMatchObject({ channel: 'beta', status: 'available', availableVersion: '0.0.4', downloadedVersion: null });
  });

  it('switching back before a download ends keeps it', async () => {
    const fake = fakeUpdater({ version: '0.0.4' });
    let finish = () => {};
    fake.downloadGate = new Promise<void>((resolve) => (finish = resolve));
    const { updater } = setup(fake);
    await updater.check();
    const download = updater.download();
    await new Promise((r) => setTimeout(r, 0));
    updater.setChannel('beta');
    updater.setChannel('stable');
    finish();
    await download;
    expect(updater.state).toMatchObject({ channel: 'stable', status: 'downloaded', downloadedVersion: '0.0.4' });
    expect(fake.checks).toBe(1);
  });

  it('keeps checking automatically when a scheduled check finds the updater busy', async () => {
    vi.useFakeTimers();
    const fake = fakeUpdater({ version: '0.0.4' });
    let finish = () => {};
    fake.downloadGate = new Promise<void>((resolve) => (finish = resolve));
    const { updater } = setup(fake, { autoCheck: true });
    await updater.check();
    void updater.download();
    // The download runs past the next scheduled check, reporting progress every minute.
    for (let minute = 0; minute < 4 * 60 + 1; minute++) {
      await vi.advanceTimersByTimeAsync(60_000);
      fake.progress(50);
    }
    expect(updater.state.status).toBe('downloading');
    expect(fake.checks).toBe(1);
    finish();
    await vi.advanceTimersByTimeAsync(4 * 60 * 60_000);
    expect(fake.checks).toBe(2);
    updater.stop();
  });

  it('points at the mock feed', async () => {
    const fake = fakeUpdater({ version: '0.0.3' });
    const { updater } = setup(fake, { mockFeedUrl: 'http://localhost:8484' });
    await updater.check();
    expect(fake.feed).toEqual({ provider: 'generic', url: 'http://localhost:8484' });
    expect(fake.forceDevUpdateConfig).toBe(true);
    expect(updater.state.status).toBe('up-to-date');
  });

  it('never loads electron-updater when turned off', async () => {
    let loaded = false;
    const updater = new Updater({
      currentVersion: '0.0.3',
      channel: 'stable',
      autoCheck: true,
      disabledReason: 'Updates are turned off in development builds.',
      markerFile: markerPath(),
      onState: () => {},
      beforeInstall: () => {},
      installFailed: () => {},
      log: () => {},
      load: async () => ((loaded = true), fakeUpdater({ version: '9.9.9' })),
    });
    updater.start();
    updater.run('check');
    await updater.check();
    expect(loaded).toBe(false);
    expect(updater.state).toMatchObject({ status: 'disabled', disabledReason: 'Updates are turned off in development builds.' });
    updater.stop();
  });
});

describe('update marker', () => {
  it('says the update installed, or that it did not, once', () => {
    const file = markerPath();
    writeFileSync(file, JSON.stringify({ version: '0.0.4', at: 1000 }));
    expect(readUpdateMarker(file, '0.0.4', 2000)).toEqual({ updatedTo: '0.0.4', error: null });
    expect(existsSync(file)).toBe(false);
    expect(readUpdateMarker(file, '0.0.4', 2000)).toEqual({ updatedTo: null, error: null });
    writeFileSync(file, JSON.stringify({ version: '0.0.4', at: 1000 }));
    expect(readUpdateMarker(file, '0.0.3', 2000).error).toMatch(/v0\.0\.4 didn’t install/);
    writeFileSync(file, JSON.stringify({ version: '0.0.4', at: 1000 }));
    expect(readUpdateMarker(file, '0.0.4', 1000 + 60 * 60_000)).toEqual({ updatedTo: null, error: null });
    writeFileSync(file, 'not json');
    expect(readUpdateMarker(file, '0.0.4')).toEqual({ updatedTo: null, error: null });
  });
});
