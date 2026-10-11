import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { isLocalAbsolutePath, ProjectDefaults, RpcError, type ProjectIcon, type ProjectIconChoice, type ProjectInfo } from '@switchboard/protocol';
import { detectIconPath, iconDataUrl, MAX_ICON_BYTES } from './projectIcons.ts';

/** A custom icon as stored: a file is Switchboard's own copy, in the icon folder. */
export type StoredIcon = { kind: 'emoji'; value: string } | { kind: 'file'; path: string } | { kind: 'none' };

interface Row {
  root: string;
  name: string | null;
  icon_json: string | null;
  added_at: number | null;
  sort: number | null;
  defaults_json: string | null;
  profile_id: string | null;
}

/** Sessions per folder, from the session index. */
export interface FolderActivity {
  count: number;
  lastActivity: number;
}

/**
 * What identifies a folder: a Windows drive path without regard to case or the kind of slash, as Windows compares
 * them, and without a trailing separator; any other path exactly.
 */
export const folderKey = (root: string) => (/^[A-Za-z]:[\\/]/.test(root) ? root.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase() : root);

/** What a project is called until you rename it. */
const folderName = (root: string) => basename(root) || root;

const NO_DEFAULTS: ProjectDefaults = ProjectDefaults.parse({});

/** Reads defaults leniently: a field that no longer validates falls back to unset. */
export function parseDefaults(input: unknown): ProjectDefaults {
  const raw = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>;
  const shape = ProjectDefaults.shape;
  const out = { ...NO_DEFAULTS } as Record<string, unknown>;
  for (const key of Object.keys(shape) as Array<keyof typeof shape>) {
    const parsed = shape[key].safeParse(raw[key]);
    if (parsed.success) out[key] = parsed.data;
  }
  return out as ProjectDefaults;
}

function readDefaults(json: string | null): ProjectDefaults {
  if (!json) return NO_DEFAULTS;
  try {
    return parseDefaults(JSON.parse(json));
  } catch {
    return NO_DEFAULTS;
  }
}

/**
 * The user's projects: folders added by hand, in their order, each with an icon (custom, detected,
 * or none → the UI draws a letter) and defaults for new sessions. Folders that only have Claude Code
 * sessions are described too (`added: false`), for the Add project picker and sidebar icons.
 */
export class ProjectRegistry {
  private readonly detected = new Map<string, { at: number; path: string | null }>();
  private readonly statements;

  constructor(
    private readonly db: DatabaseSync,
    private readonly iconDir: string,
  ) {
    this.statements = {
      all: db.prepare('SELECT root, name, icon_json, added_at, sort, defaults_json, profile_id FROM project_settings'),
      get: db.prepare('SELECT root, name, icon_json, added_at, sort, defaults_json, profile_id FROM project_settings WHERE root = ?'),
      upsertIcon: db.prepare(
        'INSERT INTO project_settings (root, icon_json) VALUES (?, ?) ON CONFLICT (root) DO UPDATE SET icon_json = excluded.icon_json',
      ),
      // New projects go to the end of the list; adding one again keeps its place.
      add: db.prepare(`
        INSERT INTO project_settings (root, added_at, sort) VALUES (?, ?, (SELECT COALESCE(MAX(sort), -1) + 1 FROM project_settings WHERE added_at IS NOT NULL))
        ON CONFLICT (root) DO UPDATE SET
          added_at = COALESCE(project_settings.added_at, excluded.added_at),
          sort = CASE WHEN project_settings.added_at IS NULL THEN excluded.sort ELSE project_settings.sort END`),
      unadd: db.prepare('UPDATE project_settings SET added_at = NULL, sort = NULL WHERE root = ?'),
      setSort: db.prepare('UPDATE project_settings SET sort = ? WHERE root = ?'),
      upsertName: db.prepare('INSERT INTO project_settings (root, name) VALUES (?, ?) ON CONFLICT (root) DO UPDATE SET name = excluded.name'),
      upsertDefaults: db.prepare(
        'INSERT INTO project_settings (root, defaults_json) VALUES (?, ?) ON CONFLICT (root) DO UPDATE SET defaults_json = excluded.defaults_json',
      ),
    };
  }

  /** Folders added by hand, in the user's order. */
  addedRoots(): string[] {
    return this.addedRows().map((r) => r.root);
  }

  private addedRows(): Row[] {
    return (this.statements.all.all() as unknown as Row[])
      .filter((r) => r.added_at !== null)
      .sort((a, b) => (a.sort ?? Infinity) - (b.sort ?? Infinity) || (a.added_at ?? 0) - (b.added_at ?? 0) || a.root.localeCompare(b.root));
  }

  /** Added projects in order, with their own name (null: the folder's), stored icon (null: detected) and defaults (null: none), for a settings file. */
  addedEntries(): Array<{ root: string; name: string | null; icon: StoredIcon | null; defaults: ProjectDefaults | null }> {
    return this.addedRows().map((row) => ({
      root: row.root,
      name: row.name,
      icon: row.icon_json ? (JSON.parse(row.icon_json) as StoredIcon) : null,
      defaults: row.defaults_json ? readDefaults(row.defaults_json) : null,
    }));
  }

  /** Added projects in order, then every other folder with sessions, most recently active first. */
  list(activity: Map<string, FolderActivity>): ProjectInfo[] {
    const added = this.addedRows();
    // One folder per project, however its sessions spelled it: on Windows `C:\Repo`, `c:\repo` and `C:/Repo` are the
    // same folder. Their activity adds up, under the most recent spelling.
    const folders = new Map<string, { root: string; activity: FolderActivity }>();
    for (const [root, a] of activity) {
      // Only folders this computer can open: transcripts copied from another OS carry its paths, which every project RPC refuses.
      if (!isLocalAbsolutePath(root, process.platform)) continue;
      const seen = folders.get(folderKey(root));
      folders.set(
        folderKey(root),
        seen
          ? { root: seen.activity.lastActivity >= a.lastActivity ? seen.root : root, activity: { count: seen.activity.count + a.count, lastActivity: Math.max(seen.activity.lastActivity, a.lastActivity) } }
          : { root, activity: a },
      );
    }
    const addedKeys = new Set(added.map((r) => folderKey(r.root)));
    const others = [...folders.entries()]
      .filter(([key]) => !addedKeys.has(key))
      .map(([, folder]) => folder)
      .sort((a, b) => b.activity.lastActivity - a.activity.lastActivity);
    return [
      ...added.map((row, index) => this.describe(row.root, row, index, folders.get(folderKey(row.root))?.activity)),
      ...others.map(({ root, activity: a }) => this.describe(root, this.row(root), null, a)),
    ];
  }

  add(path: string): void {
    if (!existsSync(path) || !statSync(path).isDirectory()) throw new RpcError('NOT_FOUND', `Not a folder: ${path}`);
    this.statements.add.run(path, Date.now());
  }

  /** Takes a project off the list. Its icon and defaults are kept in case it is added again. */
  remove(root: string): void {
    this.statements.unadd.run(root);
  }

  /** Orders projects as given; added projects missing from `roots` keep their relative order after them. */
  reorder(roots: string[]): void {
    const current = this.addedRoots();
    const known = new Set(current);
    const first = [...new Set(roots)].filter((r) => known.has(r));
    const rest = current.filter((r) => !first.includes(r));
    this.db.exec('BEGIN');
    try {
      [...first, ...rest].forEach((root, index) => this.statements.setSort.run(index, root));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  setDefaults(root: string, defaults: ProjectDefaults): void {
    if (this.row(root)?.added_at == null) throw new RpcError('NOT_FOUND', 'Add this folder as a project first');
    const empty = Object.values(defaults).every((v) => v === null);
    this.statements.upsertDefaults.run(root, empty ? null : JSON.stringify(defaults));
  }

  /**
   * Gives a project a name of its own. Spaces are tidied into one line; an empty name, or the folder's
   * own name, goes back to following the folder. Nothing on disk changes.
   */
  rename(root: string, name: string | null): void {
    const tidy = name?.replace(/\s+/g, ' ').trim() ?? '';
    this.statements.upsertName.run(root, tidy && tidy !== folderName(root) ? tidy : null);
  }

  setIcon(root: string, choice: ProjectIconChoice): void {
    let stored: StoredIcon | null;
    switch (choice.kind) {
      case 'auto':
        stored = null;
        break;
      case 'none':
        stored = { kind: 'none' };
        break;
      case 'emoji':
        stored = { kind: 'emoji', value: choice.value };
        break;
      case 'file': {
        const stat = statSync(choice.path, { throwIfNoEntry: false });
        if (!stat?.isFile()) throw new RpcError('NOT_FOUND', `Not a file: ${choice.path}`);
        if (stat.size > MAX_ICON_BYTES) throw new RpcError('TOO_LARGE', 'Icons must be 200 KB or smaller');
        // Copy it in, so the icon survives the original being moved or deleted.
        stored = this.storeIcon(root, extname(choice.path), (target) => copyFileSync(choice.path, target));
        break;
      }
    }
    this.statements.upsertIcon.run(root, stored ? JSON.stringify(stored) : null);
  }

  /** Sets a custom icon from image bytes (from a settings file). */
  setIconImage(root: string, ext: string, data: Buffer): void {
    if (data.length > MAX_ICON_BYTES) throw new RpcError('TOO_LARGE', 'Icons must be 200 KB or smaller');
    const stored = this.storeIcon(root, ext, (target) => writeFileSync(target, data));
    this.statements.upsertIcon.run(root, JSON.stringify(stored));
  }

  private storeIcon(root: string, ext: string, write: (target: string) => void): StoredIcon {
    mkdirSync(this.iconDir, { recursive: true });
    const target = join(this.iconDir, `${createHash('sha1').update(root).digest('hex').slice(0, 16)}${ext.toLowerCase()}`);
    write(target);
    if (!iconDataUrl(target)) throw new RpcError('UNSUPPORTED', 'Use an SVG, PNG, ICO, JPEG, WebP or GIF image');
    return { kind: 'file', path: target };
  }

  private row(root: string): Row | undefined {
    return this.statements.get.get(root) as unknown as Row | undefined;
  }

  private describe(root: string, row: Row | undefined, order: number | null, activity: FolderActivity | undefined): ProjectInfo {
    const stored = row?.icon_json ? (JSON.parse(row.icon_json) as StoredIcon) : null;
    let icon: ProjectIcon | null = null;
    let iconSource: ProjectInfo['iconSource'] = null;
    if (stored?.kind === 'emoji') {
      icon = { kind: 'emoji', value: stored.value };
      iconSource = 'custom';
    } else if (stored?.kind === 'file') {
      icon = iconDataUrl(stored.path);
      iconSource = icon ? 'custom' : null;
    } else if (!stored) {
      const path = this.detect(root);
      icon = path ? iconDataUrl(path) : null;
      iconSource = icon ? 'detected' : null;
    }
    const added = row?.added_at != null;
    return {
      root,
      name: row?.name ?? folderName(root),
      nameSource: row?.name ? 'custom' : 'folder',
      icon,
      iconSource,
      added,
      exists: existsSync(root),
      order: added ? order : null,
      defaults: added ? readDefaults(row.defaults_json) : NO_DEFAULTS,
      profileId: row?.profile_id ?? null,
      sessionCount: activity?.count ?? 0,
      lastActivity: activity?.lastActivity ?? null,
    };
  }

  /** Detection is a handful of stat calls; cache it briefly so listing stays instant. */
  private detect(root: string): string | null {
    const hit = this.detected.get(root);
    if (hit && Date.now() - hit.at < 60_000) return hit.path;
    const path = existsSync(root) ? detectIconPath(root) : null;
    this.detected.set(root, { at: Date.now(), path });
    return path;
  }
}
