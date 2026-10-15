import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_PREFERENCES,
  BUILTIN_PROFILE_ID,
  ExportedProfile,
  ExportedProject,
  ICON_EXTENSIONS,
  ProjectAction,
  RpcError,
  SETTINGS_FILE_FORMAT,
  isLocalAbsolutePath,
  parseSettingsFile,
  sanitizePreferences,
  type BackupSection,
  type ExportedIcon,
  type FolderMapping,
  type ImportChange,
  type ImportMode,
  type ImportPreview,
  type Preferences,
  type SettingsFile,
  tierLabel,
  type AutoModelPrefs,
  NO_SOUND,
  SOUND_EVENTS,
  type NotificationPrefs,
  type SoundEvent,
  type SoundPrefs,
} from '@switchboard/protocol';
import { parseThemeFile } from '@switchboard/protocol/theme';
import type { ActionStore } from '../actions/actionStore.ts';
import type { AppStateStore, JsonValue } from '../db/appState.ts';
import { readProfileDefaults, type ProfileStore } from '../profiles/profileStore.ts';
import { parseDefaults, type ProjectRegistry, type StoredIcon } from '../projects/projectRegistry.ts';

/**
 * App choices a settings file carries, with their names in the import preview. The rest of app_state is
 * cache or belongs to this Mac (window layout, the open session, command lists, the shell's PATH).
 */
/** Where the personal memory folder is, when one was chosen. Backed up as a path; the memories themselves never are. */
export const PERSONAL_DIR_KEY = 'memory.personalDir';

export const CHOICE_KEYS: Record<string, string> = {
  'editor.default': 'Default editor',
  'newSession.defaults': 'New session defaults',
  'claudeUpdate.enabled': 'Check for Claude Code updates',
  [PERSONAL_DIR_KEY]: 'Personal memory folder',
};

const PREFERENCE_LABELS: Record<keyof Preferences, string> = {
  colorScheme: 'Appearance',
  sidebarStyle: 'Sidebar style',
  sidebarCollapsed: 'When the sidebar is collapsed',
  toolActivity: 'Tool activity',
  fileLinkClick: 'Clicking a file link',
  confirmQuit: 'Ask before quitting',
  sessionScope: 'Sessions in the sidebar',
  startupView: 'On startup',
  projectOrder: 'Project order',
  newSessionMode: 'Permission mode for new sessions',
  autoUpdate: 'Automatic updates',
  updateChannel: 'Update channel',
  focusLimit: 'Focus limit',
  focusMode: 'At the focus limit',
  focusCountExternal: 'Count terminal and IDE sessions',
  themeId: 'Theme',
  archiveAfterDays: 'Archive finished sessions after',
  deleteArchived: 'Delete archived sessions',
  whileWorking: 'Enter while Claude is working',
  autoModel: 'Auto model',
  catchUpSummaries: 'Write catch-up summaries with Haiku',
  resumeAtLimit: 'Resume after a usage limit resets',
  sidebarSort: 'Sidebar order',
  githubStar: 'Star on GitHub',
  notifications: 'Notifications',
  sounds: 'Sounds',
};

/** The sounds' moments as Settings › Notifications names them. */
const SOUND_LABELS: Record<SoundEvent, string> = { needsYou: 'Needs you', finished: 'Finished', error: 'Stopped with an error', actionEnded: 'Project action ended' };

/** What the settings file is read from and written to. */
export interface SettingsStores {
  db: DatabaseSync;
  appState: AppStateStore;
  projects: ProjectRegistry;
  profiles: ProfileStore;
  actions: ActionStore;
}

export interface ExportOptions {
  sections: readonly BackupSection[];
  /** Main keeps the preferences; the renderer passes them in. */
  preferences: unknown;
  /** Main keeps imported themes too: their files. */
  themes?: readonly unknown[];
  appVersion: string;
  now?: Date;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** "name, icon and defaults": the parts that are set, joined for a sentence. */
const listOf = (parts: Array<string | false>) => {
  const set = parts.filter((p): p is string => Boolean(p));
  return set.length < 2 ? (set[0] ?? '') : `${set.slice(0, -1).join(', ')} and ${set.at(-1)}`;
};
/** Deleting archived sessions: "off", or "after 30 days". */
const isDeleting = (value: unknown): value is { enabled: boolean; afterDays: number } => typeof value === 'object' && value !== null && 'enabled' in value && 'afterDays' in value;
/** Notifications: only the switch. */
const isNotifications = (value: unknown): value is NotificationPrefs => typeof value === 'object' && value !== null && Object.keys(value).length === 1 && 'enabled' in value;
/** Sounds: "off, Needs you Ping, Finished Glass, …, 50%" (off keeps the sounds, so they show either way). */
const isSounds = (value: unknown): value is SoundPrefs => typeof value === 'object' && value !== null && 'byEvent' in value && 'volume' in value;
const showSounds = (sounds: SoundPrefs) =>
  `${sounds.enabled ? 'on' : 'off'}, ${SOUND_EVENTS.map((event) => `${SOUND_LABELS[event]} ${sounds.byEvent[event] === NO_SOUND ? 'None' : sounds.byEvent[event]}`).join(', ')}, ${Math.round(sounds.volume * 100)}%`;
/** Auto model: "off", or "on, picks Haiku, Sonnet and Opus, balanced". */
const isAutoModel = (value: unknown): value is AutoModelPrefs => typeof value === 'object' && value !== null && 'allowed' in value && 'lean' in value;
// A focus limit of null is the limit turned off.
const showValue = (value: unknown) =>
  typeof value === 'boolean'
    ? value
      ? 'on'
      : 'off'
    : value === null
      ? 'off'
      : isNotifications(value)
        ? value.enabled
          ? 'on'
          : 'off'
      : isSounds(value)
        ? showSounds(value)
      : isDeleting(value)
        ? value.enabled
          ? `after ${value.afterDays} days`
          : 'off'
        : isAutoModel(value)
          ? value.enabled
            ? `on, picks ${listOf(value.allowed.map(tierLabel))}, ${value.lean}`
            : 'off'
          : String(value);

/** A stored icon as it travels in a file; an image that is gone or unreadable falls back to the detected icon. */
function exportIcon(icon: StoredIcon | null): ExportedIcon | null {
  if (!icon) return null;
  if (icon.kind !== 'file') return icon;
  const ext = extname(icon.path).toLowerCase();
  if (!(ICON_EXTENSIONS as readonly string[]).includes(ext)) return null;
  try {
    return { kind: 'image', ext: ext as (typeof ICON_EXTENSIONS)[number], data: readFileSync(icon.path).toString('base64') };
  } catch {
    return null;
  }
}

/** Builds a settings file from the chosen sections. Only user choices; nothing derived from ~/.claude. */
export function exportSettings(stores: SettingsStores, options: ExportOptions): SettingsFile {
  const want = new Set(options.sections);
  const file: SettingsFile = {
    kind: 'switchboard-settings',
    format: SETTINGS_FILE_FORMAT,
    appVersion: options.appVersion,
    exportedAt: (options.now ?? new Date()).toISOString(),
  };
  if (want.has('preferences')) file.preferences = { ...DEFAULT_PREFERENCES, ...sanitizePreferences(options.preferences) };
  if (want.has('themes')) file.themes = (options.themes ?? []).filter((raw) => !('error' in parseThemeFile(raw)));
  if (want.has('profiles')) {
    const entries = stores.profiles.exportEntries();
    const dirOf = (id: string) => entries.find((e) => e.id === id)?.dir ?? null;
    file.profiles = {
      list: entries.map(({ dir, name, color, defaults }) => ({ dir, name, color, defaults: Object.values(defaults).some((v) => v !== null) ? defaults : null })),
      default: dirOf(stores.profiles.defaultId()),
      links: stores.profiles.links().map(({ root, profileId }) => ({ path: root, profile: dirOf(profileId) })),
    };
  }
  if (want.has('projects')) {
    file.projects = stores.projects.addedEntries().map((entry) => ({
      path: entry.root,
      name: entry.name,
      icon: exportIcon(entry.icon),
      defaults: entry.defaults && Object.values(entry.defaults).some((v) => v !== null) ? entry.defaults : null,
    }));
  }
  if (want.has('actions')) {
    const global: ProjectAction[] = [];
    const byProject = new Map<string, ProjectAction[]>();
    for (const { projectRoot, action } of stores.actions.all()) {
      if (projectRoot === null) global.push(action);
      else byProject.set(projectRoot, [...(byProject.get(projectRoot) ?? []), action]);
    }
    file.actions = { global, projects: [...byProject].map(([path, actions]) => ({ path, actions })) };
  }
  if (want.has('choices')) {
    const choices: Record<string, JsonValue> = {};
    for (const key of Object.keys(CHOICE_KEYS)) {
      const value = stores.appState.get(key);
      if (value !== null) choices[key] = value;
    }
    file.choices = choices;
  }
  if (want.has('sessions')) {
    const ids = (sql: string) => (stores.db.prepare(sql).all() as Array<{ id: string }>).map((r) => r.id);
    file.sessions = {
      pinned: ids('SELECT id FROM session_flags WHERE pinned = 1 ORDER BY id'),
      archived: stores.db.prepare('SELECT id, archived_at AS at FROM session_flags WHERE archived_at IS NOT NULL ORDER BY id').all() as Array<{ id: string; at: number }>,
      owned: ids('SELECT id FROM owned_sessions ORDER BY id'),
      continued: ids('SELECT id FROM continued_sessions ORDER BY id'),
    };
  }
  return file;
}

export function writeSettingsFile(path: string, file: SettingsFile): void {
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`);
}

/** Reads and validates a settings file; errors are worded for the person importing it. */
export function readSettingsFile(path: string): SettingsFile {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === 'ENOENT';
    throw new RpcError(missing ? 'NOT_FOUND' : 'INVALID', missing ? `No file at ${path}` : 'This file is not valid JSON, so it is not a Switchboard settings file.');
  }
  const parsed = parseSettingsFile(raw);
  if ('error' in parsed) throw new RpcError('INVALID', parsed.error);
  return parsed.file;
}

const BACKUPS_KEPT = 10;

/** Writes the current settings next to the app's data before an import, keeping the newest few. Returns its path. */
export function writeBackup(dir: string, file: SettingsFile, now = new Date()): string {
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const path = join(dir, `switchboard-settings-before-import-${stamp}.json`);
  writeSettingsFile(path, file);
  const old = readdirSync(dir)
    .filter((name) => name.startsWith('switchboard-settings-before-import-') && name.endsWith('.json'))
    .sort()
    .reverse()
    .slice(BACKUPS_KEPT);
  for (const name of old) rmSync(join(dir, name), { force: true });
  return path;
}

export interface ImportOptions {
  sections: readonly BackupSection[];
  mode: ImportMode;
  /** Project folders from the file pointed at folders on this Mac. */
  relocate: readonly FolderMapping[];
  /** The current preferences (from main), to compare with. */
  preferences: unknown;
  /** The imported themes there are now (their files, from main), to compare with. */
  themes?: readonly unknown[];
}

export interface ImportPlan {
  preview: ImportPreview;
  /**
   * Applies the import. Returns the preferences for main to apply (null when they weren't imported), and
   * the themes for main to add (or to replace the one with the same name).
   */
  apply(): { preferences: Partial<Preferences> | null; themes: ThemeToAdd[] };
}

/** A theme from a settings file, for main: added, or replacing the imported theme with the same name. */
export interface ThemeToAdd {
  raw: unknown;
  how: 'add' | 'replace';
}

/**
 * A folder here. A path in another platform's form (a Mac folder in a file imported on Windows) is never one,
 * though Windows would read `/Users/…` as a folder on the current drive.
 */
const isFolder = (path: string) => isLocalAbsolutePath(path, process.platform) && existsSync(path) && statSync(path).isDirectory();

/** How the import preview names the machine. */
const THIS_COMPUTER = process.platform === 'darwin' ? 'this Mac' : 'this computer';

/**
 * Works out what importing a file would change and how. Merge adds what is missing and keeps your
 * values where both have one; Replace makes projects, actions, app choices and preferences match the
 * file. Sessions are only ever added. Imported shell actions need approval before they run, unless the
 * same command is already yours here.
 */
export function planImport(stores: SettingsStores, file: SettingsFile, options: ImportOptions): ImportPlan {
  const replace = options.mode === 'replace';
  const want = new Set(options.sections);
  const present = (['preferences', 'themes', 'profiles', 'projects', 'actions', 'choices', 'sessions'] as const).filter((s) => file[s] !== undefined);
  const has = (section: BackupSection) => want.has(section) && file[section] !== undefined;
  const relocated = new Map(options.relocate.map((m) => [m.from, m.to]));
  const target = (path: string) => relocated.get(path) ?? path;

  const changes: ImportChange[] = [];
  let unchanged = 0;
  const missing = new Set<string>();
  /** Database writes, run in one transaction. */
  const writes: Array<() => void> = [];
  /** Run after the transaction (they open their own). */
  const after: Array<() => void> = [];
  const note = (section: BackupSection, label: string, change: ImportChange['change'], detail: string | null = null) => changes.push({ section, label, change, detail });
  /** Where a folder from the file is on this Mac, or null (then noted as missing). */
  const locate = (path: string): string | null => {
    const to = target(path);
    if (isFolder(to)) return to;
    missing.add(path);
    return null;
  };
  const relocatedNote = (from: string, to: string) => (from === to ? null : `from ${from}`);

  // --- Preferences --------------------------------------------------------------------------
  let preferences: Partial<Preferences> | null = null;
  if (has('preferences')) {
    preferences = {};
    const current: Preferences = { ...DEFAULT_PREFERENCES, ...sanitizePreferences(options.preferences) };
    const incoming = sanitizePreferences(file.preferences);
    for (const key of Object.keys(incoming) as Array<keyof Preferences>) {
      const value = incoming[key];
      if (same(current[key], value)) unchanged++;
      // A preference still at its default counts as never set: Merge fills it in.
      else if (replace || same(current[key], DEFAULT_PREFERENCES[key])) {
        Object.assign(preferences, { [key]: value });
        note('preferences', PREFERENCE_LABELS[key], 'change', `${showValue(current[key])} → ${showValue(value)}`);
      } else note('preferences', PREFERENCE_LABELS[key], 'keep', `yours: ${showValue(current[key])}, file: ${showValue(value)}`);
    }
  }

  // --- Themes -------------------------------------------------------------------------------
  // Only ever added or replaced (by name), never removed: built-in themes are always there.
  const themes: ThemeToAdd[] = [];
  if (has('themes')) {
    const names = new Map<string, string>();
    for (const raw of options.themes ?? []) {
      const parsed = parseThemeFile(raw);
      if (!('error' in parsed)) names.set(parsed.theme.name.toLowerCase(), JSON.stringify(parsed.theme));
    }
    for (const [index, raw] of file.themes!.entries()) {
      const parsed = parseThemeFile(raw);
      if ('error' in parsed) {
        note('themes', `Theme ${index + 1}`, 'skip', parsed.error);
        continue;
      }
      const { name } = parsed.theme;
      const existing = names.get(name.toLowerCase());
      if (existing === undefined) {
        note('themes', name, 'add');
        themes.push({ raw, how: 'add' });
      } else if (existing === JSON.stringify(parsed.theme)) unchanged++;
      else if (replace) {
        note('themes', name, 'change', 'replaced by the file');
        themes.push({ raw, how: 'replace' });
      } else note('themes', name, 'keep', 'you have a theme with this name');
    }
  }

  // --- Claude profiles ----------------------------------------------------------------------
  // A profile is its config folder; the built-in one (dir null) is always here. Profiles are added with the folder
  // (made if it's missing: Claude Code fills it in, and you sign in again), and only Replace removes the ones the file lacks.
  if (has('profiles')) {
    const incoming = file.profiles!;
    /** Where a profile's folder is on this computer, or null (then noted as missing): a folder, or one that can be made. */
    const placeProfile = (dir: string): string | null => {
      const to = target(dir);
      if (isLocalAbsolutePath(to, process.platform) && (isFolder(to) || isFolder(dirname(to)))) return to;
      missing.add(dir);
      return null;
    };
    /** The folder a profile in the file has here, by the file's name for it (null: built-in). */
    const here = new Map<string | null, string | null>([[null, null]]);
    const kept = new Set<string>();
    for (const [index, raw] of incoming.list.entries()) {
      const parsed = ExportedProfile.safeParse(raw);
      if (!parsed.success) {
        note('profiles', `Profile ${index + 1}`, 'skip', 'not readable');
        continue;
      }
      const entry = parsed.data;
      const dir = entry.dir === null ? null : placeProfile(entry.dir);
      if (entry.dir !== null && dir === null) {
        note('profiles', entry.name, 'skip', `folder not found on ${THIS_COMPUTER}`);
        continue;
      }
      here.set(entry.dir, dir);
      const defaults = entry.defaults ? readProfileDefaults(JSON.stringify(entry.defaults)) : null;
      const usefulDefaults = defaults && Object.values(defaults).some((v) => v !== null) ? defaults : null;
      const id = stores.profiles.idOfDir(dir);
      if (id === null) {
        note('profiles', entry.name, 'add', dir === null ? null : relocatedNote(entry.dir!, dir));
        writes.push(() => {
          const added = stores.profiles.add(entry.name, entry.color, dir!);
          if (usefulDefaults) stores.profiles.setDefaults(added, usefulDefaults);
        });
        continue;
      }
      kept.add(id);
      const existing = stores.profiles.exportEntries().find((e) => e.id === id)!;
      const existingDefaults = Object.values(existing.defaults).some((v) => v !== null) ? existing.defaults : null;
      const nameDiffers = existing.name !== entry.name;
      const colorDiffers = existing.color !== entry.color;
      const defaultsDiffer = !same(existingDefaults, usefulDefaults);
      if (!nameDiffers && !colorDiffers && !defaultsDiffer) {
        unchanged++;
        continue;
      }
      const what = listOf([nameDiffers && 'name', colorDiffers && 'colour', defaultsDiffer && 'defaults for new sessions']);
      // Merge fills in only what isn't set here: the defaults. A name and colour are always set.
      const takeDefaults = defaultsDiffer && (replace || existingDefaults === null);
      const takeLook = replace && (nameDiffers || colorDiffers);
      if (takeDefaults || takeLook) {
        note('profiles', existing.name, 'change', what);
        writes.push(() => {
          if (takeLook) stores.profiles.update(id, { name: entry.name, color: entry.color });
          if (takeDefaults) stores.profiles.setDefaults(id, usefulDefaults ?? readProfileDefaults(null));
        });
      } else note('profiles', existing.name, 'keep', `your ${what} ${what === 'name' || what === 'colour' ? 'differs' : 'differ'}`);
    }
    if (replace) {
      for (const entry of stores.profiles.exportEntries()) {
        if (entry.dir === null || kept.has(entry.id)) continue;
        note('profiles', entry.name, 'remove', 'its folder, login and sessions stay');
        writes.push(() => stores.profiles.removeWithin(entry.id));
      }
    }
    // The default profile, and which projects use which, by folder. A profile that wasn't imported can't be used.
    if (incoming.default !== undefined && here.has(incoming.default)) {
      const wanted = here.get(incoming.default)!;
      const currentDefault = stores.profiles.defaultId();
      const currentDir = stores.profiles.exportEntries().find((e) => e.id === currentDefault)?.dir ?? null;
      if (wanted === currentDir) unchanged++;
      else if (replace || currentDefault === BUILTIN_PROFILE_ID) {
        note('profiles', 'Default profile', 'change', `${stores.profiles.exportEntries().find((e) => e.id === currentDefault)?.name} → ${incoming.default === null ? 'built-in' : basename(incoming.default)}`);
        writes.push(() => {
          const id = stores.profiles.idOfDir(wanted);
          if (id) stores.profiles.setDefault(id);
        });
      } else note('profiles', 'Default profile', 'keep', 'yours differs');
    }
    for (const link of incoming.links) {
      const root = locate(link.path);
      if (!root || !here.has(link.profile)) continue;
      const wantedDir = here.get(link.profile)!;
      const existing = stores.profiles.projectProfile(root);
      const label = `${basename(root)} uses ${link.profile === null ? 'the built-in profile' : basename(link.profile)}`;
      const existingDir = existing === null ? undefined : (stores.profiles.exportEntries().find((e) => e.id === existing)?.dir ?? null);
      if (existingDir === wantedDir) unchanged++;
      else if (existing === null || replace) {
        note('profiles', label, existing === null ? 'add' : 'change');
        writes.push(() => {
          const id = stores.profiles.idOfDir(wantedDir);
          if (id) stores.profiles.linkProject(root, id);
        });
      } else note('profiles', label, 'keep', 'yours differs');
    }
  }

  // --- Projects -----------------------------------------------------------------------------
  if (has('projects')) {
    const current = new Map(stores.projects.addedEntries().map((e) => [e.root, e]));
    const order: string[] = [];
    for (const [index, raw] of file.projects!.entries()) {
      const parsed = ExportedProject.safeParse(raw);
      if (!parsed.success) {
        note('projects', `Project ${index + 1}`, 'skip', 'not readable');
        continue;
      }
      const entry = parsed.data;
      const root = locate(entry.path);
      if (!root) {
        note('projects', entry.path, 'skip', `folder not found on ${THIS_COMPUTER}`);
        continue;
      }
      if (order.includes(root)) continue;
      order.push(root);
      const defaults = entry.defaults ? parseDefaults(entry.defaults) : null;
      const usefulDefaults = defaults && Object.values(defaults).some((v) => v !== null) ? defaults : null;
      const setIcon = () => {
        const icon = entry.icon;
        if (!icon) stores.projects.setIcon(root, { kind: 'auto' });
        else if (icon.kind === 'image') {
          try {
            stores.projects.setIconImage(root, icon.ext, Buffer.from(icon.data, 'base64'));
          } catch {
            // An unusable image: the project keeps the detected icon.
            stores.projects.setIcon(root, { kind: 'auto' });
          }
        } else stores.projects.setIcon(root, icon);
      };
      const setDefaults = () => stores.projects.setDefaults(root, usefulDefaults ?? parseDefaults({}));
      const setName = () => stores.projects.rename(root, entry.name);
      const existing = current.get(root);
      if (!existing) {
        note('projects', root, 'add', relocatedNote(entry.path, root));
        writes.push(() => {
          stores.projects.add(root);
          setName();
          setIcon();
          setDefaults();
        });
        continue;
      }
      const nameDiffers = (existing.name ?? null) !== entry.name;
      const iconDiffers = !same(exportIcon(existing.icon), entry.icon);
      const defaultsDiffer = !same(existing.defaults, usefulDefaults);
      if (!nameDiffers && !iconDiffers && !defaultsDiffer) {
        unchanged++;
        continue;
      }
      const what = listOf([nameDiffers && 'name', iconDiffers && 'icon', defaultsDiffer && 'defaults for new sessions']);
      // Merge fills in only what isn't set here.
      const takeName = nameDiffers && (replace || existing.name === null);
      const takeIcon = iconDiffers && (replace || existing.icon === null);
      const takeDefaults = defaultsDiffer && (replace || existing.defaults === null);
      if (takeName || takeIcon || takeDefaults) {
        note('projects', root, 'change', what);
        writes.push(() => {
          if (takeName) setName();
          if (takeIcon) setIcon();
          if (takeDefaults) setDefaults();
        });
      } else note('projects', root, 'keep', `your ${what} ${what === 'name' || what === 'icon' ? 'differs' : 'differ'}`);
    }
    if (replace) {
      for (const root of current.keys()) {
        if (order.includes(root)) continue;
        note('projects', root, 'remove', 'off the list; nothing on disk changes');
        writes.push(() => stores.projects.remove(root));
      }
      after.push(() => stores.projects.reorder(order));
    }
  }

  // --- Actions ------------------------------------------------------------------------------
  if (has('actions')) {
    const key = (scope: string | null, id: string) => `${scope ?? ''}\0${id}`;
    const current = new Map(stores.actions.all().map((e) => [key(e.projectRoot, e.action.id), e]));
    const seen = new Set<string>();
    const scopes: Array<{ path: string | null; actions: unknown[] }> = [
      { path: null, actions: file.actions!.global },
      ...file.actions!.projects,
    ];
    for (const scope of scopes) {
      const root = scope.path === null ? null : locate(scope.path);
      const where = scope.path === null ? 'all projects' : basename(root ?? scope.path);
      for (const [index, raw] of scope.actions.entries()) {
        const parsed = ProjectAction.safeParse(raw);
        const name = (raw as { name?: unknown })?.name;
        const label = `${parsed.success ? parsed.data.name : typeof name === 'string' ? name : `Action ${index + 1}`} · ${where}`;
        if (!parsed.success) {
          note('actions', label, 'skip', 'not readable');
          continue;
        }
        if (scope.path !== null && !root) {
          note('actions', label, 'skip', `folder not found on ${THIS_COMPUTER}`);
          continue;
        }
        const action = parsed.data;
        const k = key(root, action.id);
        if (seen.has(k)) continue;
        seen.add(k);
        const existing = current.get(k);
        const shell = action.type === 'shell';
        if (!existing) {
          note('actions', label, 'add', shell ? 'needs your approval before it runs' : null);
          writes.push(() => stores.actions.save(root, action, undefined, shell));
        } else if (same(existing.action, action)) unchanged++;
        else if (replace) {
          // Approval is for a command: one you already have here (and approved) stays approved.
          const needsApproval = shell && (existing.imported || existing.action.type !== 'shell' || existing.action.command !== action.command);
          note('actions', label, 'change', needsApproval ? 'needs your approval before it runs' : null);
          writes.push(() => stores.actions.save(root, action, undefined, needsApproval));
        } else note('actions', label, 'keep', 'yours differs');
      }
    }
    if (replace) {
      for (const [k, entry] of current) {
        if (seen.has(k)) continue;
        note('actions', `${entry.action.name} · ${entry.projectRoot === null ? 'all projects' : basename(entry.projectRoot)}`, 'remove');
        writes.push(() => stores.actions.remove(entry.projectRoot, entry.action.id));
      }
    }
  }

  // --- App choices --------------------------------------------------------------------------
  if (has('choices')) {
    for (const [choice, label] of Object.entries(CHOICE_KEYS)) {
      if (!Object.hasOwn(file.choices!, choice)) continue;
      const value = file.choices![choice] as JsonValue;
      const existing = stores.appState.get(choice);
      if (same(existing, value)) unchanged++;
      else if (existing === null || replace) {
        note('choices', label, existing === null ? 'add' : 'change');
        writes.push(() => stores.appState.set(choice, value));
      } else note('choices', label, 'keep', 'yours differs');
    }
  }

  // --- Sessions (only ever added) -------------------------------------------------------------
  if (has('sessions')) {
    const { pinned, settled, archived, owned, continued } = file.sessions!;
    const ids = (sql: string) => new Set((stores.db.prepare(sql).all() as Array<{ id: string }>).map((r) => r.id));
    const groups = [
      { label: 'pinned', ids: pinned, have: ids('SELECT id FROM session_flags WHERE pinned = 1'), sql: 'INSERT INTO session_flags (id, pinned) VALUES (?, 1) ON CONFLICT (id) DO UPDATE SET pinned = 1' },
      { label: 'started in Switchboard', ids: owned, have: ids('SELECT id FROM owned_sessions'), sql: 'INSERT OR IGNORE INTO owned_sessions (id, created_at) VALUES (?, ?)' },
      { label: 'continued in Switchboard', ids: continued, have: ids('SELECT id FROM continued_sessions'), sql: 'INSERT OR IGNORE INTO continued_sessions (id, created_at) VALUES (?, ?)' },
    ];
    for (const group of groups) {
      const add = [...new Set(group.ids)].filter((id) => !group.have.has(id));
      unchanged += group.ids.length - add.length;
      if (add.length === 0) continue;
      note('sessions', `${add.length} ${add.length === 1 ? 'session' : 'sessions'} ${group.label}`, 'add', 'shows only where their transcripts are');
      writes.push(() => {
        const statement = stores.db.prepare(group.sql);
        const at = Date.now();
        for (const id of add) (group.sql.includes('created_at') ? statement.run(id, at) : statement.run(id));
      });
    }
    // Archived sessions keep their moment: activity after it is what brings a session back. Older files list
    // settled sessions apart; they're archived now too, from the later moment when a session is in both.
    const archivedAt = new Map<string, number>();
    for (const { id, at } of [...(settled ?? []), ...archived]) archivedAt.set(id, Math.max(at, archivedAt.get(id) ?? 0));
    const here = ids('SELECT id FROM session_flags WHERE archived_at IS NOT NULL');
    const add = [...archivedAt].filter(([id]) => !here.has(id));
    unchanged += archivedAt.size - add.length;
    if (add.length > 0) {
      note('sessions', `${add.length} ${add.length === 1 ? 'session' : 'sessions'} archived`, 'add', 'shows only where their transcripts are');
      writes.push(() => {
        const statement = stores.db.prepare(
          'INSERT INTO session_flags (id, archived_at) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET archived_at = COALESCE(session_flags.archived_at, excluded.archived_at)',
        );
        for (const [id, at] of add) statement.run(id, at);
      });
    }
  }

  const preview: ImportPreview = {
    format: file.format,
    appVersion: file.appVersion,
    exportedAt: file.exportedAt,
    sections: present,
    changes,
    unchanged,
    missingFolders: [...missing],
  };

  return {
    preview,
    apply() {
      stores.db.exec('BEGIN');
      try {
        for (const write of writes) write();
        stores.db.exec('COMMIT');
      } catch (error) {
        stores.db.exec('ROLLBACK');
        throw error;
      }
      for (const step of after) step();
      return { preferences, themes };
    },
  };
}
