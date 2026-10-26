import type { AppInfo, UpdateState } from '@seshboard/protocol/bridge';

/** `v0.0.3`, or `dev · 1a2b3c4` so a development build is never mistaken for a release. */
export function versionLabel(info: AppInfo): string {
  if (info.dev) return info.commit ? `dev · ${info.commit}` : 'dev';
  return `v${info.version}`;
}

/** What the update toast's buttons do. */
export type UpdateAction = 'download' | 'install' | 'retry';

export interface UpdateToast {
  /** Changes with the status and the version, so hiding one toast doesn't hide the next step ("Restart to update"). */
  key: string;
  title: string;
  body: string | null;
  tone: 'accent' | 'busy' | 'error' | 'ok';
  /** 0–100 while downloading. */
  progress: number | null;
  /** The yellow button, if there is something to do. */
  action: { label: string; run: UpdateAction } | null;
  /** The release notes to offer under "What’s new". */
  notes: string | null;
  /** The close button tells main the news was seen (`dismiss`), or only hides the toast for now (`hide`). */
  close: 'dismiss' | 'hide';
}

/**
 * The update toast: only when there is something to act on or to know. Background check failures
 * (offline, say) stay in Settings → About; a failed download or install shows, since you started it.
 */
export function updateToast(state: UpdateState | null): UpdateToast | null {
  if (!state) return null;
  const toast = (key: string, title: string, rest: Partial<UpdateToast> = {}): UpdateToast => ({ key, title, body: null, tone: 'accent', progress: null, action: null, notes: null, close: 'hide', ...rest });
  switch (state.status) {
    case 'available':
      return toast(`available:${state.availableVersion}`, `Seshboard v${state.availableVersion} is available`, {
        body: 'Download it now and restart when you’re ready.',
        action: { label: 'Download', run: 'download' },
        notes: state.releaseNotes,
      });
    case 'downloading':
      return toast(`downloading:${state.availableVersion}`, `Downloading Seshboard v${state.availableVersion}…`, { tone: 'busy', progress: state.downloadPercent ?? 0 });
    case 'downloaded':
      return toast(`downloaded:${state.downloadedVersion}`, `Seshboard v${state.downloadedVersion} is ready`, {
        body: 'Restart Seshboard to install it.',
        action: { label: 'Restart to update', run: 'install' },
        notes: state.releaseNotes,
      });
    case 'installing':
      return toast('installing', 'Restarting to update…', { tone: 'busy' });
    case 'error': {
      const version = state.downloadedVersion ?? state.availableVersion;
      if (version) return toast(`error:${version}`, 'The update failed', { tone: 'error', body: state.error, action: state.canRetry ? { label: 'Retry', run: 'retry' } : null });
      break;
    }
  }
  if (state.updatedTo) return toast(`updated:${state.updatedTo}`, `Updated to Seshboard v${state.updatedTo}`, { tone: 'ok', notes: state.releaseNotes, close: 'dismiss' });
  return null;
}

/** One line for Settings → About. */
export function updateStatusText(state: UpdateState): string {
  switch (state.status) {
    case 'disabled':
      return state.disabledReason ?? 'Updates are turned off.';
    case 'idle':
      return 'Not checked yet.';
    case 'checking':
      return 'Checking for updates…';
    case 'up-to-date':
      return 'Seshboard is up to date.';
    case 'available':
      return `Version ${state.availableVersion} is available.`;
    case 'downloading':
      return `Downloading version ${state.availableVersion}… ${state.downloadPercent ?? 0}%`;
    case 'downloaded':
      return `Version ${state.downloadedVersion} is ready. Restart Seshboard to install it.`;
    case 'installing':
      return 'Restarting to install the update…';
    case 'error':
      return `The update failed: ${state.error ?? 'unknown error'}`;
  }
}

/** "Last checked 5 minutes ago". */
export function lastChecked(checkedAt: number | null, now = Date.now()): string {
  if (checkedAt === null) return 'Never checked';
  const minutes = Math.floor(Math.max(0, now - checkedAt) / 60_000);
  if (minutes < 1) return 'Last checked just now';
  if (minutes < 60) return `Last checked ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last checked ${hours} hour${hours === 1 ? '' : 's'} ago`;
  return `Last checked ${new Date(checkedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}
