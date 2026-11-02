import type { ClaudeUpdateState } from '@seshboard/protocol';
import { compareVersions, type ClaudeInstallInfo } from './claudeInstall.ts';

/**
 * The Claude Code check's state machine, also another provider's CLI's (`ProviderUpdateState`, the same with whose it
 * is). Every change is a pure function from one state to the next, so the flow (checking → up to date / available →
 * updating → updated, failures and retry, turned off) is tested without a network or a process; `toolUpdater.ts` only
 * calls these.
 */

/** What every check's state has: Claude Code's, with any channel (null when the CLI keeps its own). */
export type UpdateState = Omit<ClaudeUpdateState, 'channel'> & { channel: string | null };

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

export const isBusy = (state: UpdateState) => state.status === 'checking' || state.status === 'updating';

/** What was found about the installed CLI (or that there is none). */
export interface FoundInstall<Channel extends string | null = ClaudeUpdateState['channel']> {
  path: string;
  version: string | null;
  info: ClaudeInstallInfo;
  channel: Channel;
  /** The path came from Seshboard's settings, not a search: show the command, never run it. */
  override: boolean;
  quiet: boolean;
}

/** Records the install. Doesn't change the status, except to and from `missing`. */
export function installFound<S extends UpdateState>(state: S, found: FoundInstall<S['channel']> | null, name = 'Claude Code'): S {
  if (!found) {
    return { ...state, status: state.status === 'updating' ? 'updating' : 'missing', path: null, installedVersion: null, method: 'unknown', command: null, canUpdate: false, manualReason: null };
  }
  const manualReason = found.override
    ? `${name} runs from a custom path, so Seshboard leaves updating it to you.`
    : !found.info.run
      ? `Seshboard can’t tell how this ${name} was installed.`
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

export function checking<S extends UpdateState>(state: S): S {
  if (isBusy(state) || state.status === 'missing') return state;
  return { ...state, status: 'checking', error: null };
}

/** A check finished: `latest` is the newest version on the channel. */
export function checked<S extends UpdateState>(state: S, latest: string, at: number): S {
  if (state.status === 'missing' || state.status === 'updating') return state;
  if (state.installedVersion === null) return { ...state, status: 'error', latestVersion: latest, checkedAt: at, error: `Couldn’t read the version of ${state.path ?? 'claude'}.` };
  const newer = compareVersions(latest, state.installedVersion) > 0;
  // A finished update stays on screen until dismissed, unless an even newer one came out.
  const status = newer ? 'available' : state.updatedTo !== null ? 'updated' : 'up-to-date';
  return { ...state, status, latestVersion: latest, checkedAt: at, error: null };
}

/** Something failed. What was known (the latest version) is kept, so Retry can update or check again. */
export function failed<S extends UpdateState>(state: S, message: string): S {
  if (state.status === 'missing') return state;
  return { ...state, status: 'error', error: message };
}

export function updating<S extends UpdateState>(state: S): S {
  if (isBusy(state) || !state.canUpdate || state.status === 'missing') return state;
  return { ...state, status: 'updating', error: null, output: '', updatedTo: null };
}

/** Appends output from the running command, keeping the last OUTPUT_LIMIT characters. */
export function appendOutput<S extends UpdateState>(state: S, chunk: string): S {
  if (state.status !== 'updating' || !chunk) return state;
  const output = state.output + chunk;
  return { ...state, output: output.length > OUTPUT_LIMIT ? output.slice(-OUTPUT_LIMIT) : output };
}

/**
 * The command finished and `claude` was read again. Still the old version means it didn't do what it should
 * (Homebrew without the new cask yet, say), which is an error worth retrying later.
 */
export function updateFinished<S extends UpdateState>(state: S, result: { exitCode: number | null; version: string | null; error?: string }, name = 'Claude Code'): S {
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
      return { ...state, status: 'error', error: `Homebrew’s ${name} cask is still v${after}, so brew has no newer version to install yet. Try again later, or use the native installer.`, installedVersion: after };
    }
    const offered = state.latestVersion ? ` v${state.latestVersion} may not be available for this install yet.` : '';
    return { ...state, status: 'error', error: `The update finished, but ${name} is still v${after}.${offered}`, installedVersion: after };
  }
  const stillBehind = after !== null && state.latestVersion !== null && compareVersions(state.latestVersion, after) > 0;
  return { ...state, status: stillBehind ? 'available' : 'updated', installedVersion: after, updatedTo: after, error: null };
}

/** Hides the notice for the version on offer, and clears "Updated to". */
export function dismiss<S extends UpdateState>(state: S): S {
  const dismissedVersion = state.status === 'available' || state.status === 'error' ? (state.latestVersion ?? state.dismissedVersion) : state.dismissedVersion;
  const status = state.status === 'updated' ? 'up-to-date' : state.status;
  return { ...state, status, dismissedVersion, updatedTo: null };
}

export function setEnabled<S extends UpdateState>(state: S, enabled: boolean): S {
  if (enabled === state.enabled) return state;
  if (!enabled) {
    // Turned off: nothing to show until checked again (a check you start still runs).
    const status = isBusy(state) || state.status === 'missing' ? state.status : 'off';
    return { ...state, enabled, status, latestVersion: status === 'off' ? null : state.latestVersion, error: null };
  }
  return { ...state, enabled, status: state.status === 'off' ? 'idle' : state.status };
}

/** Retry: update again when an update failed with a newer version known, else check again. */
export function retryCommand(state: UpdateState): 'update' | 'check' | null {
  if (isBusy(state) || state.status === 'missing') return null;
  const newer = state.latestVersion !== null && state.installedVersion !== null && compareVersions(state.latestVersion, state.installedVersion) > 0;
  return newer && state.canUpdate ? 'update' : 'check';
}

