import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BUILTIN_PROFILE_ID, RpcError, SESSION_PROVIDERS, type ClaudeProfile, type OptionalProvider, type ProfileColor, type ProfileDefaults, type ProfilesSnapshot, type SessionProvider } from '@seshboard/protocol';
import type { AppStateStore } from '../db/appState.ts';
import { parseDefaults } from '../projects/projectRegistry.ts';

const DEFAULT_KEY = 'profiles.default';

interface Row {
  id: string;
  name: string;
  color: string;
  config_dir: string | null;
  sort: number;
  defaults_json: string | null;
  provider: string;
}

/** A profile of another provider (GitHub Copilot): its config folder (`COPILOT_HOME`) is the provider's own. */
export interface ProviderProfile {
  id: string;
  provider: OptionalProvider;
  home: string;
}

const providerOfRow = (row: Row): SessionProvider => ((SESSION_PROVIDERS as readonly string[]).includes(row.provider) ? (row.provider as SessionProvider) : 'claude');

/** What the engine needs to read and run a profile. */
export interface ProfileRuntime {
  id: string;
  /** The folder holding `projects/`, `sessions/` and `plugins/`. */
  configDir: string;
  /**
   * CLAUDE_CONFIG_DIR for Claude Code processes, or undefined to leave the environment as it is.
   * The built-in profile must not set it: Claude Code keys its global config file and keychain
   * entry on whether the variable is set, so setting it to ~/.claude would act like another login.
   */
  envDir: string | undefined;
}

/**
 * The account Claude Code last signed in with in a config folder. Claude Code keeps it in
 * `.claude.json`: inside the folder when CLAUDE_CONFIG_DIR is set, in the home folder otherwise.
 * The format is Claude Code's own, so anything unexpected reads as "unknown".
 */
export function readAccount(globalConfigFile: string): ClaudeProfile['account'] {
  try {
    const json = JSON.parse(readFileSync(globalConfigFile, 'utf8')) as { oauthAccount?: { emailAddress?: unknown; organizationName?: unknown } };
    const account = json.oauthAccount;
    if (!account || typeof account !== 'object') return null;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    const email = str(account.emailAddress);
    const organization = str(account.organizationName);
    return email || organization ? { email, organization } : null;
  } catch {
    return null;
  }
}

/** Where Claude Code keeps the login for a profile: see `readAccount`. */
const accountFile = (envDir: string | undefined) => (envDir ? join(envDir, '.claude.json') : join(homedir(), '.claude.json'));

/** Reads a profile's defaults leniently, as a project's: a field that no longer validates is unset. */
export function readProfileDefaults(json: string | null): ProfileDefaults {
  let raw: unknown = {};
  try {
    raw = json ? JSON.parse(json) : {};
  } catch {}
  const { branch: _branch, defaultBranch: _defaultBranch, baseRef, ...defaults } = parseDefaults(raw);
  // A branch to start a worktree from belongs to a repository, as `branch` does.
  return { ...defaults, baseRef: baseRef === 'fresh' || baseRef === 'head' ? baseRef : null };
}

const COLORS: readonly ProfileColor[] = ['yellow', 'blue', 'green', 'purple', 'red', 'orange', 'gray'];
const asColor = (value: string): ProfileColor => (COLORS.includes(value as ProfileColor) ? (value as ProfileColor) : 'gray');

/**
 * Profiles: the built-in one (Claude Code's own config folder, whatever $CLAUDE_CONFIG_DIR says) plus any folders the
 * user added, and which one is the default for projects without a link. A profile is Claude Code's, or another
 * provider's (GitHub Copilot, with its `COPILOT_HOME`): `runtimes()` is only Claude Code's, `providerProfiles()` the rest.
 */
export class ProfileStore {
  private readonly statements;
  /** The accounts in the last snapshot, to tell whether a login changed since. */
  private accountsSeen = '';

  constructor(
    private readonly db: DatabaseSync,
    private readonly appState: AppStateStore,
    /** Claude Code's own config folder, and whether CLAUDE_CONFIG_DIR names it (rather than the ~/.claude fallback). */
    private readonly builtin: { configDir: string; fromEnv: boolean },
    private readonly onChange: (snapshot: ProfilesSnapshot) => void = () => {},
  ) {
    this.statements = {
      all: db.prepare('SELECT id, name, color, config_dir, sort, defaults_json, provider FROM claude_profiles ORDER BY sort, created_at'),
      insert: db.prepare('INSERT INTO claude_profiles (id, name, color, config_dir, sort, created_at, provider) VALUES (?, ?, ?, ?, ?, ?, ?)'),
      rename: db.prepare('UPDATE claude_profiles SET name = ? WHERE id = ?'),
      recolor: db.prepare('UPDATE claude_profiles SET color = ? WHERE id = ?'),
      setDefaults: db.prepare('UPDATE claude_profiles SET defaults_json = ? WHERE id = ?'),
      remove: db.prepare('DELETE FROM claude_profiles WHERE id = ?'),
      unlinkProjects: db.prepare('UPDATE project_settings SET profile_id = NULL WHERE profile_id = ?'),
      linkProject: db.prepare(
        'INSERT INTO project_settings (root, profile_id) VALUES (?, ?) ON CONFLICT (root) DO UPDATE SET profile_id = excluded.profile_id',
      ),
      links: db.prepare('SELECT root, profile_id FROM project_settings WHERE profile_id IS NOT NULL'),
      projectProfile: db.prepare('SELECT profile_id FROM project_settings WHERE root = ?'),
    };
    if (!this.rows().some((r) => r.id === BUILTIN_PROFILE_ID)) {
      this.statements.insert.run(BUILTIN_PROFILE_ID, 'Personal', 'yellow', null, 0, Date.now(), 'claude');
    }
  }

  private rows(): Row[] {
    return this.statements.all.all() as unknown as Row[];
  }

  defaultId(): string {
    const stored = this.appState.get(DEFAULT_KEY);
    return typeof stored === 'string' && this.rows().some((r) => r.id === stored) ? stored : BUILTIN_PROFILE_ID;
  }

  /** Claude Code's profiles, the built-in one first unless reordered: everything that reads or runs Claude Code uses these. */
  runtimes(): ProfileRuntime[] {
    return this.rows().filter((r) => providerOfRow(r) === 'claude').map((r) => this.runtimeOf(r));
  }

  /** A Claude Code profile's runtime. Another provider's profile (or none) falls back to the built-in one. */
  runtime(id: string | null | undefined): ProfileRuntime {
    const claude = this.rows().filter((r) => providerOfRow(r) === 'claude');
    const row = claude.find((r) => r.id === (id ?? this.defaultId())) ?? claude.find((r) => r.id === BUILTIN_PROFILE_ID)!;
    return this.runtimeOf(row);
  }

  /** Other providers' profiles (GitHub Copilot), with their config folders. */
  providerProfiles(): ProviderProfile[] {
    return this.rows().flatMap((r) => {
      const provider = providerOfRow(r);
      return provider !== 'claude' && r.config_dir ? [{ id: r.id, provider, home: r.config_dir }] : [];
    });
  }

  /** Who runs a profile's sessions: Claude Code, unless it is another provider's profile. */
  providerOf(id: string | null | undefined): SessionProvider {
    const row = this.rows().find((r) => r.id === (id ?? this.defaultId()));
    return row ? providerOfRow(row) : 'claude';
  }

  has(id: string): boolean {
    return this.rows().some((r) => r.id === id);
  }

  private runtimeOf(row: Row): ProfileRuntime {
    if (row.config_dir === null) {
      return { id: row.id, configDir: this.builtin.configDir, envDir: this.builtin.fromEnv ? this.builtin.configDir : undefined };
    }
    return { id: row.id, configDir: row.config_dir, envDir: row.config_dir };
  }

  snapshot(): ProfilesSnapshot {
    const defaultId = this.defaultId();
    const profiles = this.rows().map((row): ClaudeProfile => {
      const { configDir, envDir } = this.runtimeOf(row);
      const provider = providerOfRow(row);
      return {
        id: row.id,
        provider,
        name: row.name,
        color: asColor(row.color),
        configDir,
        builtin: row.config_dir === null,
        isDefault: row.id === defaultId,
        exists: existsSync(configDir),
        // Another provider's login is its CLI's own: `providers.status` tells who it is.
        account: provider === 'claude' ? readAccount(accountFile(envDir)) : null,
        defaults: readProfileDefaults(row.defaults_json),
      };
    });
    this.accountsSeen = JSON.stringify(profiles.map((p) => [p.id, p.account]));
    return { profiles, defaultId };
  }

  /** Every profile as a settings file records it. */
  exportEntries(): Array<{ id: string; dir: string | null; name: string; color: ProfileColor; defaults: ProfileDefaults; provider: SessionProvider }> {
    return this.rows().map((r) => ({ id: r.id, dir: r.config_dir, name: r.name, color: asColor(r.color), defaults: readProfileDefaults(r.defaults_json), provider: providerOfRow(r) }));
  }

  /** Every project linked to a profile, with that profile's id. */
  links(): Array<{ root: string; profileId: string }> {
    return (this.statements.links.all() as Array<{ root: string; profile_id: string }>).map((r) => ({ root: r.root, profileId: r.profile_id })).filter((l) => this.has(l.profileId));
  }

  /** The profile that uses this config folder (null: the built-in one), if there is one. */
  idOfDir(dir: string | null): string | null {
    if (dir === null) return this.rows().find((r) => r.config_dir === null)?.id ?? null;
    const wanted = resolve(dir);
    return this.rows().find((r) => r.config_dir !== null && resolve(r.config_dir) === wanted)?.id ?? null;
  }

  /** The `.claude.json` file each profile's login lives in. */
  accountFiles(): string[] {
    return this.runtimes().map((r) => accountFile(r.envDir));
  }

  /** Each profile's login, read now. Not a snapshot, so `refreshAccounts` still tells the windows about a change. */
  accounts(): Array<{ id: string; account: ClaudeProfile['account'] }> {
    return this.runtimes().map((r) => ({ id: r.id, account: readAccount(accountFile(r.envDir)) }));
  }

  /** Reads the logins again: a new snapshot when one changed since the last, else null. */
  refreshAccounts(): ProfilesSnapshot | null {
    const before = this.accountsSeen;
    const snapshot = this.snapshot();
    return this.accountsSeen === before ? null : snapshot;
  }

  add(name: string, color: ProfileColor, configDir: string, provider: SessionProvider = 'claude'): string {
    const dir = resolve(configDir);
    const taken = [...this.runtimes().map((p) => p.configDir), ...this.providerProfiles().map((p) => p.home)].find((d) => resolve(d) === dir);
    if (taken) throw new RpcError('DUPLICATE', 'Another profile already uses this folder');
    const stat = statSync(dir, { throwIfNoEntry: false });
    if (stat && !stat.isDirectory()) throw new RpcError('NOT_A_FOLDER', `Not a folder: ${dir}`);
    // Claude Code (or Copilot) creates the rest on first use; the folder must exist to be watched.
    if (!stat) mkdirSync(dir, { recursive: true });
    const id = randomUUID();
    const sort = Math.max(0, ...this.rows().map((r) => r.sort)) + 1;
    this.statements.insert.run(id, name, color, dir, sort, Date.now(), provider);
    this.changed();
    return id;
  }

  update(id: string, change: { name?: string; color?: ProfileColor }): void {
    this.require(id);
    if (change.name !== undefined) this.statements.rename.run(change.name, id);
    if (change.color !== undefined) this.statements.recolor.run(change.color, id);
    this.changed();
  }

  /** Replaces what new sessions with this profile start with (where their project sets nothing). */
  setDefaults(id: string, defaults: ProfileDefaults): void {
    this.require(id);
    const empty = Object.values(defaults).every((v) => v === null);
    this.statements.setDefaults.run(empty ? null : JSON.stringify(defaults), id);
    this.changed();
  }

  /** Forgets a profile. Its folder, login and sessions stay on disk; its projects use the default again. */
  remove(id: string): void {
    this.db.exec('BEGIN');
    try {
      this.removeWithin(id);
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  /** `remove` for a caller that already has a transaction open (a settings import). */
  removeWithin(id: string): void {
    const row = this.require(id);
    if (row.config_dir === null) throw new RpcError('BUILTIN', 'The built-in profile uses Claude Code’s own folder and can’t be removed');
    this.statements.remove.run(id);
    this.statements.unlinkProjects.run(id);
    if (this.appState.get(DEFAULT_KEY) === id) this.appState.set(DEFAULT_KEY, BUILTIN_PROFILE_ID);
    this.changed();
  }

  setDefault(id: string): void {
    this.require(id);
    this.appState.set(DEFAULT_KEY, id);
    this.changed();
  }

  /** The profile a project is linked to (null: none, so the default). */
  projectProfile(root: string): string | null {
    const row = this.statements.projectProfile.get(root) as { profile_id: string | null } | undefined;
    return row?.profile_id && this.has(row.profile_id) ? row.profile_id : null;
  }

  linkProject(root: string, id: string | null): void {
    if (id !== null) this.require(id);
    this.statements.linkProject.run(root, id);
  }

  /** The profile a new session in `cwd`'s project runs with. */
  forProject(root: string): string {
    return this.projectProfile(root) ?? this.defaultId();
  }

  private require(id: string): Row {
    const row = this.rows().find((r) => r.id === id);
    if (!row) throw new RpcError('NOT_FOUND', 'No such profile');
    return row;
  }

  private changed(): void {
    this.onChange(this.snapshot());
  }
}
