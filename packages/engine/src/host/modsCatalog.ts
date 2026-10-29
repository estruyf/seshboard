import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { ModInfo, ModSource } from '@seshboard/protocol';

/**
 * Which plugins are mods, for Settings › Mods. A mod is a plugin whose `hooks/hooks.json` names a module under
 * `modules`. Only that manifest is read: the module itself is Claude Code's to load and run, never Seshboard's.
 * Best effort: a file in an unknown format just lists nothing.
 */

function readJson(file: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** True when the plugin in `folder` has a mod module. */
export function isModFolder(folder: string): boolean {
  const hooks = readJson(join(folder, 'hooks', 'hooks.json'));
  return Array.isArray(hooks?.modules) && hooks.modules.some((m) => typeof m === 'string' && m.trim() !== '');
}

/** A plugin's name: its manifest's, else its folder's. */
function pluginName(folder: string): string {
  const manifest = readJson(join(folder, '.claude-plugin', 'plugin.json'));
  if (typeof manifest?.name === 'string' && manifest.name) return manifest.name;
  return folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder;
}

/** Plugins switched on in a settings file (`enabledPlugins`, keyed `name@marketplace`). */
function enabledIn(settings: Record<string, unknown> | null): Set<string> {
  const enabled = settings?.enabledPlugins;
  if (!enabled || typeof enabled !== 'object') return new Set();
  return new Set(Object.entries(enabled as Record<string, unknown>).flatMap(([id, on]) => (on === true ? [id] : [])));
}

/** Where installed plugins live: `installed_plugins.json` in the config folder's `plugins`. */
function installPaths(configDir: string): Map<string, string> {
  const file = readJson(join(configDir, 'plugins', 'installed_plugins.json'));
  const plugins = file?.plugins;
  const paths = new Map<string, string>();
  if (!plugins || typeof plugins !== 'object') return paths;
  for (const [id, installs] of Object.entries(plugins as Record<string, unknown>)) {
    const latest = (Array.isArray(installs) ? installs.at(-1) : installs) as { installPath?: unknown } | undefined;
    if (typeof latest?.installPath === 'string') paths.set(id, latest.installPath);
  }
  return paths;
}

/** The managed settings file Claude Code reads on this platform. */
export function managedSettingsPath(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json';
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json';
  return '/etc/claude-code/managed-settings.json';
}

/** When managed settings last changed (0 without them), for the hooked cache key. */
export function managedSettingsMtime(file = managedSettingsPath()): number {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/** Folders named in `CLAUDE_CODE_PLUGIN_DIRS` (absolute, or starting with `~`), split on the platform's path separator. */
export function pluginDirs(value: string | undefined, home = homedir(), separator = delimiter): string[] {
  if (!value) return [];
  return value
    .split(separator === ';' ? /[;\n]/ : /[:\n]/)
    .map((d) => d.trim())
    .filter(Boolean)
    .map((d) => (d === '~' ? home : d.startsWith('~/') || d.startsWith('~\\') ? join(home, d.slice(2)) : d));
}

export interface CatalogProfile {
  profileId: string;
  configDir: string;
  /** The environment Claude Code runs with in this profile (for `CLAUDE_CODE_PLUGIN_DIRS`). */
  env: Record<string, string | undefined>;
}

/** The mods each profile's sessions load, once per profile: managed first, then plugin folders, then the profile's own. */
export function listMods(profiles: readonly CatalogProfile[], managedFile = managedSettingsPath()): ModInfo[] {
  const managedOn = enabledIn(readJson(managedFile));
  const mods: ModInfo[] = [];
  for (const profile of profiles) {
    const seen = new Set<string>();
    const add = (folder: string, source: ModSource, name = pluginName(folder)) => {
      if (seen.has(name) || !isModFolder(folder)) return;
      seen.add(name);
      mods.push({ name, profileId: profile.profileId, source, path: folder });
    };
    const installs = installPaths(profile.configDir);
    const settings = readJson(join(profile.configDir, 'settings.json'));
    for (const id of managedOn) {
      const path = installs.get(id);
      if (path) add(path, 'managed', id.split('@')[0]);
    }
    // The settings' `env` block can name the folders too.
    const env = settings?.env && typeof settings.env === 'object' ? (settings.env as Record<string, unknown>) : {};
    const fromSettings = typeof env.CLAUDE_CODE_PLUGIN_DIRS === 'string' ? env.CLAUDE_CODE_PLUGIN_DIRS : undefined;
    for (const dir of [...pluginDirs(profile.env.CLAUDE_CODE_PLUGIN_DIRS), ...pluginDirs(fromSettings)]) add(dir, 'dir');
    for (const id of enabledIn(settings)) {
      const path = installs.get(id);
      if (path) add(path, 'marketplace', id.split('@')[0]);
    }
  }
  return mods;
}

/**
 * The key the hooked cache is kept under, per profile: a hash of what decides which plugins load (the profile's and
 * the managed `enabledPlugins`, the plugin folders) and when managed settings last changed. A change to any of them
 * gives another key, so a list cached before it is never used.
 */
export function hookedCacheKey(profile: CatalogProfile, managedFile = managedSettingsPath()): string {
  const settings = readJson(join(profile.configDir, 'settings.json'));
  const env = settings?.env && typeof settings.env === 'object' ? (settings.env as Record<string, unknown>).CLAUDE_CODE_PLUGIN_DIRS : undefined;
  const managed = readJson(managedFile);
  return createHash('sha256')
    .update(
      JSON.stringify({
        enabled: settings?.enabledPlugins ?? null,
        managedEnabled: managed?.enabledPlugins ?? null,
        dirs: [profile.env.CLAUDE_CODE_PLUGIN_DIRS ?? null, typeof env === 'string' ? env : null],
        managedMtime: managedSettingsMtime(managedFile),
      }),
    )
    .digest('hex')
    .slice(0, 32);
}
