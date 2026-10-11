import type { ClaudeInstallMethod, ClaudeUpdateState } from '@switchboard/protocol/client';

/** `2.1.10` is newer than `2.1.9`: compared numerically. */
export function newer(a: string, b: string): boolean {
  const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map(Number);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}

export const INSTALL_METHOD_LABEL: Record<ClaudeInstallMethod, string> = {
  native: 'Native installer',
  homebrew: 'Homebrew',
  npm: 'npm',
  local: 'Local install (~/.claude/local)',
  winget: 'WinGet',
  unknown: 'Unknown',
};

export interface ClaudeUpdateToast {
  /** Changes with the status and the version, so hiding the "Updating…" toast doesn't hide "Updated". */
  key: string;
  title: string;
  body: string | null;
  tone: 'accent' | 'busy' | 'ok';
  /** Run the update, or open Settings → About (the command to copy, the output). */
  action: { label: string; run: 'update' | 'about'; primary: boolean } | null;
  /** The close button dismisses this version for good (`dismiss`), or only hides the toast for now (`hide`). */
  close: 'dismiss' | 'hide';
}

/**
 * The Claude Code toast: a newer version that wasn't dismissed (unless its own auto-updater is turned off,
 * when Settings → About still says so), an update running, or one that just finished.
 */
export function claudeUpdateToast(state: ClaudeUpdateState | null): ClaudeUpdateToast | null {
  if (!state) return null;
  if (state.status === 'updating') {
    return { key: 'updating', title: 'Updating Claude Code…', body: null, tone: 'busy', action: { label: 'Show output', run: 'about', primary: false }, close: 'hide' };
  }
  if (state.status === 'updated' && state.updatedTo) {
    return { key: `updated:${state.updatedTo}`, title: `Claude Code updated to v${state.updatedTo}`, body: 'New sessions use it.', tone: 'ok', action: null, close: 'dismiss' };
  }
  if (state.status !== 'available' || !state.latestVersion || !state.enabled || state.quiet) return null;
  if (state.dismissedVersion && !newer(state.latestVersion, state.dismissedVersion)) return null;
  return {
    key: `available:${state.latestVersion}`,
    title: `Claude Code v${state.latestVersion} is available`,
    body: state.installedVersion ? `You have v${state.installedVersion}.` : null,
    tone: 'accent',
    action: state.canUpdate ? { label: 'Update', run: 'update', primary: true } : { label: 'Show how', run: 'about', primary: false },
    close: 'dismiss',
  };
}

/** One line for Settings → About. */
export function claudeUpdateStatusText(state: ClaudeUpdateState): string {
  switch (state.status) {
    case 'missing':
      return 'Claude Code isn’t installed, or Switchboard can’t find it.';
    case 'off':
      return 'Automatic checks are off.';
    case 'idle':
      return 'Not checked yet.';
    case 'checking':
      return 'Checking for a newer Claude Code…';
    case 'up-to-date':
      return 'Claude Code is up to date.';
    case 'available':
      return `Version ${state.latestVersion} is available${state.channel === 'stable' ? ' on the stable channel' : ''}.`;
    case 'updating':
      return `Updating with ${state.command}…`;
    case 'updated':
      return `Updated to version ${state.updatedTo ?? state.installedVersion}. New sessions use it; sessions already running keep their version until they restart.`;
    case 'error':
      return state.error ?? 'Something went wrong.';
  }
}
