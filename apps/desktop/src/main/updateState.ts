import type { UpdateChannel, UpdateCommand, UpdateState } from '@switchboard/protocol/bridge';

/**
 * The updater's state machine. Every change is a pure function from one state to the next,
 * so the flow (checking → available → downloading → downloaded → installing, failures and retry)
 * is tested without Electron; `updater.ts` only calls these.
 */

/** `1.2.3-beta.1` is on the beta channel; anything else is stable. */
export function channelOf(version: string): UpdateChannel {
  return /-beta\./.test(version) ? 'beta' : 'stable';
}

/**
 * Whether Remote also lets in the preview's remote app (`REMOTE_PREVIEW_APP_URL`, built from `dev`): a development
 * build, a beta build, or a release on the Beta channel, so a phone set up on the preview keeps working when the beta
 * becomes a release. A release on the Stable channel only lets in the website's.
 */
export function acceptsPreviewRemote(options: { packaged: boolean; version: string; channel: UpdateChannel }): boolean {
  return !options.packaged || channelOf(options.version) === 'beta' || options.channel === 'beta';
}

export function initialUpdateState(options: { currentVersion: string; channel: UpdateChannel; disabledReason: string | null; updatedTo?: string | null }): UpdateState {
  return {
    status: options.disabledReason ? 'disabled' : 'idle',
    currentVersion: options.currentVersion,
    availableVersion: null,
    downloadedVersion: null,
    downloadPercent: null,
    releaseNotes: null,
    error: null,
    canRetry: false,
    disabledReason: options.disabledReason,
    channel: options.channel,
    checkedAt: null,
    updatedTo: options.updatedTo ?? null,
  };
}

/** Busy: a second check, download or install must wait. */
export const isBusy = (state: UpdateState) => state.status === 'checking' || state.status === 'downloading' || state.status === 'installing';

export function checking(state: UpdateState): UpdateState {
  if (state.status === 'disabled' || isBusy(state)) return state;
  // A finished download stays ready while checking for something newer.
  return { ...state, status: 'checking', error: null, canRetry: false };
}

/** No newer version on the channel. A downloaded update stays ready to install. */
export function upToDate(state: UpdateState, at: number): UpdateState {
  if (state.status === 'disabled') return state;
  if (state.downloadedVersion) return { ...state, status: 'downloaded', checkedAt: at };
  return { ...state, status: 'up-to-date', availableVersion: null, releaseNotes: null, checkedAt: at };
}

/**
 * A check found `version`. Beta takes beta versions and releases; a beta version offered on Stable is ignored
 * (treated as up to date), and so is the version already downloaded.
 */
export function available(state: UpdateState, update: { version: string; releaseNotes: string | null }, at: number): UpdateState {
  if (state.status === 'disabled') return state;
  if (state.channel === 'stable' && channelOf(update.version) === 'beta') return upToDate(state, at);
  if (update.version === state.downloadedVersion) return { ...state, status: 'downloaded', checkedAt: at };
  return { ...state, status: 'available', availableVersion: update.version, downloadedVersion: null, downloadPercent: null, releaseNotes: update.releaseNotes, checkedAt: at };
}

export function downloading(state: UpdateState, percent: number): UpdateState {
  if (!state.availableVersion || (state.status !== 'available' && state.status !== 'downloading' && state.status !== 'error')) return state;
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));
  return { ...state, status: 'downloading', downloadPercent: clamped, error: null, canRetry: false };
}

export function downloaded(state: UpdateState, version: string): UpdateState {
  if (state.status === 'disabled') return state;
  return { ...state, status: 'downloaded', downloadedVersion: version, availableVersion: version, downloadPercent: 100, error: null, canRetry: false };
}

export function installing(state: UpdateState): UpdateState {
  if (state.status !== 'downloaded' && !(state.status === 'error' && state.downloadedVersion)) return state;
  return { ...state, status: 'installing', error: null, canRetry: false };
}

/** Something failed. What was known (the available or downloaded version) is kept for Retry. */
export function failed(state: UpdateState, message: string, canRetry: boolean): UpdateState {
  if (state.status === 'disabled') return state;
  return { ...state, status: 'error', error: message, canRetry, downloadPercent: null };
}

export function changeChannel(state: UpdateState, channel: UpdateChannel): UpdateState {
  if (channel === state.channel) return state;
  // What was found or downloaded may not be on the new channel: check again.
  return { ...state, channel, status: state.status === 'disabled' ? 'disabled' : 'idle', availableVersion: null, downloadedVersion: null, downloadPercent: null, releaseNotes: null, error: null, canRetry: false };
}

export function dismissUpdated(state: UpdateState): UpdateState {
  return state.updatedTo ? { ...state, updatedTo: null } : state;
}

/** What Retry (or the pill) should do from here: install a downloaded update, download a found one, or check again. */
export function nextCommand(state: UpdateState): Exclude<UpdateCommand, 'retry'> | null {
  if (state.status === 'disabled' || isBusy(state)) return null;
  if (state.downloadedVersion) return 'install';
  if (state.availableVersion) return 'download';
  return 'check';
}

/**
 * Why this build can't update itself, or null when it can. Checked in this order. `installer` is false on Linux for a
 * copy that isn't the AppImage, .deb or .rpm (the unpacked folder), which electron-updater has no way to replace.
 */
export function updatesDisabledReason(build: {
  env: Record<string, string | undefined>;
  packaged: boolean;
  devServer: boolean;
  hasFeed: boolean;
  mockFeed: boolean;
  installer?: boolean;
}): string | null {
  if (build.env.SWITCHBOARD_DISABLE_AUTO_UPDATE) return 'Updates are turned off by SWITCHBOARD_DISABLE_AUTO_UPDATE.';
  if (build.mockFeed) return null;
  if (build.devServer) return 'Updates are turned off in development builds.';
  if (!build.packaged) return 'Updates are turned off in builds that aren’t packaged.';
  if (!build.hasFeed) return 'This build has no update feed (app-update.yml), so it can’t update itself. Preview builds don’t have one.';
  if (build.installer === false) return 'This copy wasn’t installed from the AppImage, .deb or .rpm, so it can’t update itself.';
  return null;
}
