import { z } from 'zod';

/** How the `claude` binary was installed, which decides how to update it. */
export const ClaudeInstallMethod = z.enum(['native', 'homebrew', 'npm', 'local', 'winget', 'unknown']);
export type ClaudeInstallMethod = z.infer<typeof ClaudeInstallMethod>;

/** Claude Code's release channels (the npm dist-tags of the same name). */
export const ClaudeChannel = z.enum(['latest', 'stable']);
export type ClaudeChannel = z.infer<typeof ClaudeChannel>;

/**
 * Where the Claude Code check is. `idle` hasn't checked yet; `off` means automatic checks are turned off
 * (a check you start still runs); `missing` means no `claude` binary was found.
 * `error` keeps what was known before it failed, so Retry knows what to try again.
 */
export const ClaudeUpdateStatus = z.enum(['idle', 'checking', 'up-to-date', 'available', 'updating', 'updated', 'error', 'off', 'missing']);
export type ClaudeUpdateStatus = z.infer<typeof ClaudeUpdateStatus>;

/** The Claude Code check's whole state: one plain object the engine pushes to every window on each change. */
export const ClaudeUpdateState = z.object({
  status: ClaudeUpdateStatus,
  /** Check automatically shortly after launch and every few hours. */
  enabled: z.boolean(),
  path: z.string().nullable(),
  installedVersion: z.string().nullable(),
  /** The newest version on `channel`, once a check found it. */
  latestVersion: z.string().nullable(),
  channel: ClaudeChannel,
  method: ClaudeInstallMethod,
  /** The command that updates this install, to run here or (when `canUpdate` is false) in a terminal. */
  command: z.string().nullable(),
  /** Switchboard can run `command` itself. */
  canUpdate: z.boolean(),
  /** Why Update isn't offered (a custom binary path, an unknown install), shown with the command. */
  manualReason: z.string().nullable(),
  /** Claude Code's own auto-updater is turned off (DISABLE_AUTOUPDATER and the like): show an update, but don't nag. */
  quiet: z.boolean(),
  /** A newer version you dismissed; the notice stays hidden until a newer one than this. */
  dismissedVersion: z.string().nullable(),
  /** Epoch ms of the last finished check. */
  checkedAt: z.number().nullable(),
  error: z.string().nullable(),
  /** Output of the running or last update command, capped at its last few thousand characters. */
  output: z.string(),
  /** Set by a successful update until dismissed: new sessions use this version. */
  updatedTo: z.string().nullable(),
});
export type ClaudeUpdateState = z.infer<typeof ClaudeUpdateState>;
