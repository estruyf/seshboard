import type { ClaudeChannel, ClaudeUpdateState } from '@switchboard/protocol';
import { compareVersions, type ClaudeInstallInfo } from './claudeInstall.ts';

/**
 * The Claude Code check's state machine. Every change is a pure function from one state to the next, so the
 * flow (checking → up to date / available → updating → updated, failures and retry, turned off) is tested
 * without a network or a process; `claudeUpdater.ts` only calls these.
 */

/** Output kept from an update command: the end is what matters when it fails. */
export const OUTPUT_LIMIT = 8_000;

export function initialClaudeUpdateState(options: { enabled: boolean; dismissedVersion: string | null }): ClaudeUpdateState {
  return {
    status: options.enabled ? 'idle' : 'off',
    enabled: options.enabled,
    path: null,
    installedVersion: null,
    latestVersion: null,
    channel: 'latest',
    method: 'unknown',
    command: null,
    canUpdate: false,
    manualReason: null,
    quiet: false,
    dismissedVersion: options.dismissedVersion,
    checkedAt: null,
    error: null,
    output: '',
    updatedTo: null,
  };
}

export const isBusy = (state: ClaudeUpdateState) => state.status === 'checking' || state.status === 'updating';

/** What was found about the installed `claude` (or that there is none). */
export interface FoundInstall {
  path: string;
  version: string | null;
  info: ClaudeInstallInfo;
  channel: ClaudeChannel;
  /** The path came from Switchboard's settings, not a search: show the command, never run it. */
  override: boolean;
  quiet: boolean;
}

/** Records the install. Doesn't change the status, except to and from `missing`. */
export function installFound(state: ClaudeUpdateState, found: FoundInstall | null): ClaudeUpdateState {
  if (!found) {
    return { ...state, status: state.status === 'updating' ? 'updating' : 'missing', path: null, installedVersion: null, method: 'unknown', command: null, canUpdate: false, manualReason: null };
  }
  const manualReason = found.override
    ? 'Claude Code runs from a custom path, so Switchboard leaves updating it to you.'
    : !found.info.run
      ? 'Switchboard can’t tell how this Claude Code was installed.'
      : null;
  const channelChanged = found.channel !== state.channel;
  return {
    ...state,
    status: state.status === 'missing' ? (state.enabled ? 'idle' : 'off') : state.status,
    path: found.path,
    installedVersion: found.version,
    method: found.info.method,
    command: found.info.command,
    canUpdate: manualReason === null,
    manualReason,
    channel: found.channel,
    quiet: found.quiet,
    // What a check found on the other channel no longer applies.
    latestVersion: channelChanged ? null : state.latestVersion,
  };
}

export function checking(state: ClaudeUpdateState): ClaudeUpdateState {
  if (isBusy(state) || state.status === 'missing') return state;
  return { ...state, status: 'checking', error: null };
}

/** A check finished: `latest` is the newest version on the channel. */
export function checked(state: ClaudeUpdateState, latest: string, at: number): ClaudeUpdateState {
  if (state.status === 'missing' || state.status === 'updating') return state;
  if (state.installedVersion === null) return { ...state, status: 'error', latestVersion: latest, checkedAt: at, error: `Couldn’t read the version of ${state.path ?? 'claude'}.` };
  const newer = compareVersions(latest, state.installedVersion) > 0;
  // A finished update stays on screen until dismissed, unless an even newer one came out.
  const status = newer ? 'available' : state.updatedTo !== null ? 'updated' : 'up-to-date';
  return { ...state, status, latestVersion: latest, checkedAt: at, error: null };
}

/** Something failed. What was known (the latest version) is kept, so Retry can update or check again. */
export function failed(state: ClaudeUpdateState, message: string): ClaudeUpdateState {
  if (state.status === 'missing') return state;
  return { ...state, status: 'error', error: message };
}

export function updating(state: ClaudeUpdateState): ClaudeUpdateState {
  if (isBusy(state) || !state.canUpdate || state.status === 'missing') return state;
  return { ...state, status: 'updating', error: null, output: '', updatedTo: null };
}

/** Appends output from the running command, keeping the last OUTPUT_LIMIT characters. */
export function appendOutput(state: ClaudeUpdateState, chunk: string): ClaudeUpdateState {
  if (state.status !== 'updating' || !chunk) return state;
  const output = state.output + chunk;
  return { ...state, output: output.length > OUTPUT_LIMIT ? output.slice(-OUTPUT_LIMIT) : output };
}

/**
 * The command finished and `claude` was read again. Still the old version means it didn't do what it should
 * (Homebrew without the new cask yet, say), which is an error worth retrying later.
 */
export function updateFinished(state: ClaudeUpdateState, result: { exitCode: number | null; version: string | null; error?: string }): ClaudeUpdateState {
  if (state.status !== 'updating') return state;
  const before = state.installedVersion;
  const after = result.version ?? before;
  if (result.error || result.exitCode !== 0) {
    const message = result.error ?? `The update command exited with ${result.exitCode === null ? 'a signal' : `code ${result.exitCode}`}.`;
    return { ...state, status: 'error', error: message, installedVersion: after };
  }
  if (after !== null && before !== null && compareVersions(after, before) <= 0) {
    // Homebrew's cask trails the registry: brew has nothing newer to install, so retrying later is the fix.
    if (state.method === 'homebrew') {
      return { ...state, status: 'error', error: `Homebrew’s Claude Code cask is still v${after}, so brew has no newer version to install yet. Try again later, or use the native installer.`, installedVersion: after };
    }
    const offered = state.latestVersion ? ` v${state.latestVersion} may not be available for this install yet.` : '';
    return { ...state, status: 'error', error: `The update finished, but Claude Code is still v${after}.${offered}`, installedVersion: after };
  }
  const stillBehind = after !== null && state.latestVersion !== null && compareVersions(state.latestVersion, after) > 0;
  return { ...state, status: stillBehind ? 'available' : 'updated', installedVersion: after, updatedTo: after, error: null };
}

/** Hides the notice for the version on offer, and clears "Updated to". */
export function dismiss(state: ClaudeUpdateState): ClaudeUpdateState {
  const dismissedVersion = state.status === 'available' || state.status === 'error' ? (state.latestVersion ?? state.dismissedVersion) : state.dismissedVersion;
  const status = state.status === 'updated' ? 'up-to-date' : state.status;
  return { ...state, status, dismissedVersion, updatedTo: null };
}

export function setEnabled(state: ClaudeUpdateState, enabled: boolean): ClaudeUpdateState {
  if (enabled === state.enabled) return state;
  if (!enabled) {
    // Turned off: nothing to show until checked again (a check you start still runs).
    const status = isBusy(state) || state.status === 'missing' ? state.status : 'off';
    return { ...state, enabled, status, latestVersion: status === 'off' ? null : state.latestVersion, error: null };
  }
  return { ...state, enabled, status: state.status === 'off' ? 'idle' : state.status };
}

/** Retry: update again when an update failed with a newer version known, else check again. */
export function retryCommand(state: ClaudeUpdateState): 'update' | 'check' | null {
  if (isBusy(state) || state.status === 'missing') return null;
  const newer = state.latestVersion !== null && state.installedVersion !== null && compareVersions(state.latestVersion, state.installedVersion) > 0;
  return newer && state.canUpdate ? 'update' : 'check';
}

