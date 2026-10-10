import { posix, win32 } from 'node:path';
import type { ClaudeChannel, ClaudeInstallMethod } from '@switchboard/protocol';

/** How to update one install: the command to show, and the program and arguments to run it with. */
export interface ClaudeInstallInfo {
  method: ClaudeInstallMethod;
  /** Homebrew: `claude-code` (stable) or `claude-code@latest`. */
  cask: string | null;
  /** What to show, e.g. `brew upgrade --cask claude-code`. */
  command: string;
  /** What to run. Null when only the command to type is known. */
  run: { file: string; args: string[] } | null;
  /** Added to the error when the update fails: what usually stops it for this install. */
  failureHint?: string;
}

/**
 * Works out how `claude` was installed from where it lives. `path` is the binary that is run, `realPath` the
 * same with symlinks followed (the native installer links `~/.local/bin/claude` to a versioned file).
 */
export function detectInstall(path: string, realPath: string, options: { home: string; channel: ClaudeChannel; platform?: NodeJS.Platform }): ClaudeInstallInfo {
  const { home, channel, platform = process.platform } = options;
  const windows = platform === 'win32';
  const { join, sep } = windows ? win32 : posix;
  // Windows paths compare without regard to case, as Windows does.
  const same = (a: string) => (windows ? a.toLowerCase() : a);
  const under = (dir: string) => same(realPath).startsWith(same(dir.endsWith(sep) ? dir : `${dir}${sep}`));

  // ~/.claude/local is the old "migrate to local" install: an npm package with a wrapper script, updated by `claude update`.
  if (under(join(home, '.claude', 'local'))) return { method: 'local', cask: null, command: 'claude update', run: { file: path, args: ['update'] } };
  if (under(join(home, '.local', 'share', 'claude'))) return { method: 'native', cask: null, command: 'claude update', run: { file: path, args: ['update'] } };
  // On Windows the native installer copies claude.exe into ~/.local/bin instead of linking it there.
  if (windows && same(realPath) === same(join(home, '.local', 'bin', 'claude.exe'))) return { method: 'native', cask: null, command: 'claude update', run: { file: path, args: ['update'] } };
  if (windows) {
    // WinGet installs under its own Packages folder (in AppData for one user, in Program Files with `--scope machine`),
    // and only WinGet should update what it installed. It may ask for permission, so Switchboard shows the command.
    if (/\\WinGet\\Packages\\/i.test(realPath)) return { method: 'winget', cask: null, command: 'winget upgrade Anthropic.ClaudeCode', run: null };
    // npm's package, below a prefix (`<prefix>\node_modules\…` on Windows). Its npm.cmd lives with Node and is found on
    // PATH, so the prefix is named: another npm first on PATH would otherwise update its own prefix, not this install.
    const npmPrefix = /^(.*)\\node_modules\\@anthropic-ai\\claude-code\\/i.exec(realPath)?.[1];
    if (npmPrefix) {
      const spec = `@anthropic-ai/claude-code@${channel}`;
      return {
        method: 'npm',
        cask: null,
        command: `npm install -g --prefix "${npmPrefix}" ${spec}`,
        run: { file: 'npm', args: ['install', '-g', '--prefix', npmPrefix, spec] },
        // npm replaces claude.exe, which Windows refuses while a Claude Code process runs it.
        failureHint: 'On Windows, npm can’t replace claude.exe while Claude Code runs: stop your sessions and try again.',
      };
    }
  }

  const cask = /^(.*)\/Caskroom\/(claude-code(?:@[\w.-]+)?)\//.exec(realPath);
  if (cask) {
    const name = cask[2]!;
    return { method: 'homebrew', cask: name, command: `brew upgrade --cask ${name}`, run: { file: join(cask[1]!, 'bin', 'brew'), args: ['upgrade', '--cask', name] } };
  }

  const npm = /^(.*)\/lib\/node_modules\/@anthropic-ai\/claude-code\//.exec(realPath) ?? /^(.*)\/node_modules\/@anthropic-ai\/claude-code\//.exec(realPath);
  if (npm) {
    const spec = `@anthropic-ai/claude-code@${channel}`;
    // The npm next to the package, so the same Node install (nvm, Homebrew node…) is updated.
    const prefix = realPath.includes('/lib/node_modules/') ? npm[1]! : null;
    return { method: 'npm', cask: null, command: `npm install -g ${spec}`, run: { file: prefix ? join(prefix, 'bin', 'npm') : 'npm', args: ['install', '-g', spec] } };
  }

  return { method: 'unknown', cask: null, command: 'claude update', run: null };
}

/** The channel to compare against: the Homebrew cask that is installed, else `autoUpdatesChannel` from Claude's settings. */
export function claudeChannel(settings: Record<string, unknown> | null, cask: string | null): ClaudeChannel {
  if (cask) return cask === 'claude-code' ? 'stable' : 'latest';
  return settings?.autoUpdatesChannel === 'stable' ? 'stable' : 'latest';
}

const TRUTHY = (value: unknown) => typeof value === 'string' ? value !== '' && value !== '0' && value.toLowerCase() !== 'false' : value === true || value === 1;

/**
 * Claude Code's own auto-updater is turned off, by the environment or Claude's settings. Switchboard then still
 * shows that an update exists, but doesn't put up a notice.
 */
export function autoUpdaterDisabled(env: Record<string, string | undefined>, settings: Record<string, unknown> | null): boolean {
  const settingsEnv = (settings?.env ?? {}) as Record<string, unknown>;
  const keys = ['DISABLE_AUTOUPDATER', 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC'];
  if (keys.some((key) => TRUTHY(env[key]) || TRUTHY(settingsEnv[key]))) return true;
  return settings?.autoUpdates === false;
}

/** `X.Y.Z` (with an optional `-pre` part, which sorts before the release) as numbers; null when it isn't one. */
function parse(version: string): { parts: [number, number, number]; pre: string | null } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?/.exec(version.trim());
  return match ? { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? null } : null;
}

/** Negative when `a` is older than `b`, positive when newer, 0 when equal or either can't be read. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.parts[i] !== y.parts[i]) return x.parts[i]! - y.parts[i]!;
  if (x.pre === y.pre) return 0;
  if (x.pre === null) return 1;
  if (y.pre === null) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** The npm registry's dist-tags for Claude Code, e.g. `{ latest: '2.1.0', stable: '2.0.9' }`. */
export const CLAUDE_DIST_TAGS_URL = 'https://registry.npmjs.org/-/package/@anthropic-ai/claude-code/dist-tags';

/** The version a dist-tags answer gives for a channel (stable falls back to latest when the registry has no stable tag). */
export function versionFromDistTags(tags: unknown, channel: ClaudeChannel): string | null {
  if (!tags || typeof tags !== 'object') return null;
  const record = tags as Record<string, unknown>;
  const value = record[channel] ?? (channel === 'stable' ? record.latest : undefined);
  return typeof value === 'string' && parse(value) ? value : null;
}
