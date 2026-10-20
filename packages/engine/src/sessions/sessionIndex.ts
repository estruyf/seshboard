import { existsSync, mkdirSync, readdirSync, statSync, watch, type FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { BUILTIN_PROFILE_ID, withoutBriefs, type LogLevel, type SessionsChanged, type SessionSummary } from '@switchboard/protocol';
import { originFromEntrypoint, readHead, readLastActivity, type TranscriptHead } from '../claude/origin.ts';
import type { ProjectResolver } from '../claude/projectResolver.ts';
import type { RawSessionInfo, SessionSource } from '../claude/sessionSource.ts';
import { coalesce } from '../util/coalesce.ts';

/** What the index derives from disk; user flags are added on the way out (see `decorate`). */
type RawSummary = Omit<SessionSummary, 'pinned' | 'archivedAt' | 'restoredAt' | 'viewedAt' | 'unread' | 'inApp'>;

interface Flags {
  pinned: boolean;
  archivedAt: number | null;
  restoredAt: number | null;
  viewedAt: number | null;
}

const NO_FLAGS: Flags = { pinned: false, archivedAt: null, restoredAt: null, viewedAt: null };
/** Writes that land right after the user looked are not "new" for them. */
const UNREAD_SLACK_MS = 2_000;

interface Entry {
  summary: RawSummary;
  path: string | null;
  mtime: number | null;
  entrypoint: string | null;
}

interface TranscriptFile {
  path: string;
  mtime: number;
  profileId: string;
}

/** One profile's `projects` folder. */
export interface ProjectsRoot {
  profileId: string;
  dir: string;
}

export interface SessionIndexOptions {
  db: DatabaseSync;
  source: SessionSource;
  /** Every profile's `projects` folder (`~/.claude/projects` and the like); read again by `rootsChanged`. */
  projectsDirs: () => ProjectsRoot[];
  resolver: ProjectResolver;
  onChange: (change: SessionsChanged) => void;
  /** A transcript file was written (its summary may or may not have changed). */
  onTranscriptChanged: (sessionId: string) => void;
  log: (level: LogLevel, message: string) => void;
  /**
   * Sessions that changed after this moment and were never opened in the app
   * count as unread (so a first launch doesn't mark every old session unread).
   */
  baseline: number;
  /** Sessions this app created; they get the `app` origin whatever Claude Code recorded. */
  isOwned?: (sessionId: string) => boolean;
  /** Sessions started elsewhere that the user continued in this app. */
  isContinued?: (sessionId: string) => boolean;
  /** Safety-net full rescan, in case file events were missed. */
  refreshIntervalMs?: number;
}

const SESSION_FILE = /^([^\\/]+)[\\/]([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;
const TITLE_MAX = 300;

const oneLine = (text: string, max: number) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/**
 * The sidebar's source of truth inside the engine. Starts from the SQLite cache
 * (instant), reconciles with ~/.claude through the SDK, then follows file
 * changes. Every change is persisted and emitted as a `sessions.changed` delta.
 */
export class SessionIndex {
  private readonly entries = new Map<string, Entry>();
  private readonly flags = new Map<string, Flags>();
  private complete = false;
  private refreshing: Promise<void> | undefined;
  private readonly watchers = new Map<string, FSWatcher>();
  private started = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly perFile = new Map<string, ReturnType<typeof coalesce>>();
  /** Sessions changed or forgotten while a full scan awaited the source; that scan's older view must not undo them. */
  private touchedDuringScan: Set<string> | undefined;
  private readonly statements;

  constructor(private readonly options: SessionIndexOptions) {
    const { db } = options;
    this.statements = {
      all: db.prepare('SELECT id, jsonl_path, jsonl_mtime, entrypoint, summary_json FROM sessions'),
      upsert: db.prepare(`
        INSERT INTO sessions (id, project_root, updated_at, jsonl_path, jsonl_mtime, entrypoint, summary_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          project_root = excluded.project_root, updated_at = excluded.updated_at,
          jsonl_path = excluded.jsonl_path, jsonl_mtime = excluded.jsonl_mtime,
          entrypoint = excluded.entrypoint, summary_json = excluded.summary_json`),
      remove: db.prepare('DELETE FROM sessions WHERE id = ?'),
      flagsAll: db.prepare('SELECT id, pinned, archived_at, restored_at, viewed_at FROM session_flags'),
      flagsDelete: db.prepare('DELETE FROM session_flags WHERE id = ?'),
      flagsUpsert: db.prepare(`
        INSERT INTO session_flags (id, pinned, archived_at, restored_at, viewed_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          pinned = excluded.pinned, archived_at = excluded.archived_at, restored_at = excluded.restored_at, viewed_at = excluded.viewed_at`),
    };
    this.loadFlags();
    this.loadCache();
  }

  private loadFlags(): void {
    this.flags.clear();
    for (const row of this.statements.flagsAll.all() as Array<{ id: string; pinned: number; archived_at: number | null; restored_at: number | null; viewed_at: number | null }>) {
      this.flags.set(row.id, { pinned: row.pinned === 1, archivedAt: row.archived_at, restoredAt: row.restored_at, viewedAt: row.viewed_at });
    }
  }

  /** Reads the flags again after they were written elsewhere (a settings import), and sends every session again. */
  reloadFlags(): void {
    this.loadFlags();
    if (this.entries.size === 0) return;
    this.options.onChange({ upserted: [...this.entries.values()].map((e) => this.decorate(e.summary)), removed: [], complete: this.complete });
  }

  private loadCache(): void {
    for (const row of this.statements.all.all() as Array<Record<string, unknown>>) {
      try {
        const summary = JSON.parse(String(row.summary_json)) as RawSummary;
        // Summaries cached before profiles existed came from the built-in profile.
        summary.profileId ??= BUILTIN_PROFILE_ID;
        this.entries.set(String(row.id), {
          summary,
          path: (row.jsonl_path as string | null) ?? null,
          mtime: (row.jsonl_mtime as number | null) ?? null,
          entrypoint: (row.entrypoint as string | null) ?? null,
        });
      } catch {
        // A bad row only costs us a cache miss; the refresh rebuilds it.
      }
    }
  }

  get(sessionId: string): SessionSummary | null {
    const entry = this.entries.get(sessionId);
    return entry ? this.decorate(entry.summary) : null;
  }

  /** Sessions newest first, plus whether the first full scan has finished. */
  snapshot(): { sessions: SessionSummary[]; complete: boolean } {
    const sessions = [...this.entries.values()].map((e) => this.decorate(e.summary)).sort((a, b) => b.updatedAt - a.updatedAt);
    return { sessions, complete: this.complete };
  }

  private decorate(raw: RawSummary): SessionSummary {
    const flags = this.flags.get(raw.id) ?? NO_FLAGS;
    const seen = flags.viewedAt ?? this.options.baseline;
    const inApp = raw.origin === 'app' || (this.options.isContinued?.(raw.id) ?? false);
    return { ...raw, ...flags, unread: raw.updatedAt > seen + UNREAD_SLACK_MS, inApp };
  }

  /** The transcript file behind a session, when known. */
  pathFor(sessionId: string): string | null {
    return this.entries.get(sessionId)?.path ?? null;
  }

  /** Drops a deleted session from the index and its flags, and tells every window. */
  forget(sessionId: string): void {
    this.touchedDuringScan?.add(sessionId);
    this.flags.delete(sessionId);
    this.statements.flagsDelete.run(sessionId);
    if (this.entries.has(sessionId)) this.apply([], [sessionId]);
  }

  /**
   * Pins or archives a session (or undoes it) and tells every window. Unarchiving keeps the session in the main
   * list until it has new activity: one quiet for longer than the archive days would otherwise stay under Archived.
   */
  setFlags(sessionId: string, change: { pinned?: boolean; archived?: boolean }): void {
    const current = this.flags.get(sessionId) ?? NO_FLAGS;
    const now = Date.now();
    const next: Flags = {
      ...current,
      ...(change.pinned !== undefined ? { pinned: change.pinned } : {}),
      ...(change.archived !== undefined ? { archivedAt: change.archived ? now : null, restoredAt: change.archived ? null : now } : {}),
    };
    this.writeFlags(sessionId, next);
  }

  /**
   * Brings an archived session back to the main list because the user wrote to it.
   * Its activity alone wouldn't: an archived session stays archived while it works.
   */
  wake(sessionId: string): void {
    const current = this.flags.get(sessionId);
    if (!current || current.archivedAt === null) return;
    this.writeFlags(sessionId, { ...current, archivedAt: null });
  }

  markViewed(sessionId: string): void {
    this.writeFlags(sessionId, { ...(this.flags.get(sessionId) ?? NO_FLAGS), viewedAt: Date.now() });
  }

  /** Unread again (Undo after Mark as read on a phone): seen last just before its latest activity. */
  markUnviewed(sessionId: string): void {
    const updatedAt = this.entries.get(sessionId)?.summary.updatedAt;
    if (updatedAt === undefined) return;
    this.writeFlags(sessionId, { ...(this.flags.get(sessionId) ?? NO_FLAGS), viewedAt: updatedAt - UNREAD_SLACK_MS - 1 });
  }

  private writeFlags(sessionId: string, flags: Flags): void {
    this.flags.set(sessionId, flags);
    this.statements.flagsUpsert.run(sessionId, flags.pinned ? 1 : 0, flags.archivedAt, flags.restoredAt, flags.viewedAt);
    this.republish(sessionId);
  }

  /** Reads one session again now, rather than when the file watcher notices (after a rename). */
  async reread(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (entry?.path) await this.updateOne(sessionId, entry.path, entry.summary.profileId);
  }

  /** Sends a session again after something `decorate` reads changed (flags, continued). */
  republish(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (entry) this.options.onChange({ upserted: [this.decorate(entry.summary)], removed: [], complete: this.complete });
  }

  start(): void {
    this.started = true;
    void this.refresh();
    this.watch();
    this.timer = setInterval(() => void this.refresh(), this.options.refreshIntervalMs ?? 120_000);
    this.timer.unref?.();
  }

  /** Profiles were added or removed: watch their folders and rescan (sessions of removed ones drop out). */
  rootsChanged(): Promise<void> {
    if (this.started) this.watch();
    // A scan already running read the old folders: scan again after it.
    return (this.refreshing ?? Promise.resolve()).then(() => this.refresh());
  }

  /** Watches every profile's projects folder, and stops watching folders no longer listed. */
  private watch(): void {
    const roots = this.options.projectsDirs();
    for (const [dir, watcher] of this.watchers) {
      if (!roots.some((r) => r.dir === dir)) {
        watcher.close();
        this.watchers.delete(dir);
      }
    }
    for (const { dir, profileId } of roots) {
      if (this.watchers.has(dir)) continue;
      try {
        // A new profile has no projects folder until its first session. Create it when the profile's own
        // folder exists, so that first session shows up at once; otherwise the next refresh tries again.
        if (!existsSync(dir) && existsSync(dirname(dir))) mkdirSync(dir);
        if (!existsSync(dir)) continue;
        const watcher = watch(dir, { recursive: true }, (_event, filename) => {
          const match = filename ? SESSION_FILE.exec(filename.toString()) : null;
          if (match) this.fileChanged(match[2]!, join(dir, filename!.toString()), profileId);
        });
        watcher.on('error', (error) => {
          this.options.log('warn', `Watching ${dir} failed: ${error.message}`);
          // Dropped, so the next refresh watches the folder again (it may have been removed and made again).
          watcher.close();
          if (this.watchers.get(dir) === watcher) this.watchers.delete(dir);
        });
        this.watchers.set(dir, watcher);
      } catch (error) {
        this.options.log('warn', `Cannot watch ${dir}: ${(error as Error).message}`);
      }
    }
  }

  stop(): void {
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    if (this.timer) clearInterval(this.timer);
    for (const c of this.perFile.values()) c.stop();
    this.perFile.clear();
  }

  /** Full reconcile with ~/.claude. Concurrent calls share one run. */
  refresh(): Promise<void> {
    this.refreshing ??= this.runRefresh().finally(() => (this.refreshing = undefined));
    return this.refreshing;
  }

  private async runRefresh(): Promise<void> {
    const started = performance.now();
    // Folders that could not be watched before (not made yet, or a watcher that failed) get another try.
    if (this.started) this.watch();
    const touched = new Set<string>();
    this.touchedDuringScan = touched;
    try {
      const files = this.scanFiles();
      const infos = await this.options.source.list();
      this.touchedDuringScan = undefined;
      this.options.resolver.clear();
      const seen = new Set<string>();
      const upserted: Entry[] = [];
      for (const info of infos) {
        seen.add(info.sessionId);
        // Written or forgotten meanwhile: what the file watcher or a delete did is newer than this list.
        if (touched.has(info.sessionId)) continue;
        const previous = this.entries.get(info.sessionId);
        const entry = this.build(info, files.get(info.sessionId) ?? null, previous);
        if (!previous || JSON.stringify(previous.summary) !== JSON.stringify(entry.summary) || previous.path !== entry.path) {
          upserted.push(entry);
        }
      }
      const removed = [...this.entries.keys()].filter((id) => !seen.has(id) && !touched.has(id));
      const firstCompletion = !this.complete;
      this.complete = true;
      if (upserted.length || removed.length || firstCompletion) this.apply(upserted, removed);
      this.options.log(
        'debug',
        `Indexed ${infos.length} sessions in ${Math.round(performance.now() - started)}ms (${upserted.length} changed, ${removed.length} removed)`,
      );
    } catch (error) {
      this.options.log('error', `Session scan failed: ${(error as Error).message}`);
    } finally {
      if (this.touchedDuringScan === touched) this.touchedDuringScan = undefined;
    }
  }

  /** Maps session id → transcript file for every top-level transcript under each profile's projects/. */
  private scanFiles(): Map<string, TranscriptFile> {
    const files = new Map<string, TranscriptFile>();
    for (const { dir: root, profileId } of this.options.projectsDirs()) {
      let projectDirs: string[];
      try {
        projectDirs = readdirSync(root);
      } catch {
        continue;
      }
      for (const dir of projectDirs) {
        let names: string[];
        try {
          names = readdirSync(join(root, dir));
        } catch {
          continue;
        }
        for (const name of names) {
          const match = SESSION_FILE.exec(`${dir}/${name}`);
          if (!match) continue;
          const path = join(root, dir, name);
          const stat = statSync(path, { throwIfNoEntry: false });
          if (stat?.isFile()) files.set(match[2]!, { path, mtime: Math.round(stat.mtimeMs), profileId });
        }
      }
    }
    return files;
  }

  private build(info: RawSessionInfo, file: TranscriptFile | null, previous: Entry | undefined): Entry {
    // Read the head ourselves only when needed: the SDK misses the folder when the first prompt is
    // huge (a pasted image), and the session would then be filed under "Unknown folder".
    let head: TranscriptHead | undefined;
    const readOnce = () => (head ??= file ? readHead(file.path) : { entrypoint: null, cwd: null });
    const entrypoint = previous?.entrypoint ?? readOnce().entrypoint;
    const cwd = info.cwd ?? previous?.summary.cwd ?? readOnce().cwd;
    const location = cwd ? this.options.resolver.resolve(cwd) : null;
    // A linked session's brief is part of the first message, but not what you asked (session linking).
    const firstPrompt = info.firstPrompt ? withoutBriefs(info.firstPrompt) : '';
    const title = oneLine(info.customTitle || info.summary || firstPrompt || 'Untitled session', TITLE_MAX);
    // The SDK's lastModified is the file's mtime, which moves when Claude Code merely exits or
    // reopens the session; use the last message instead. Read again only when the file changed.
    const unchanged = previous && file && previous.mtime === file.mtime;
    const updatedAt = unchanged ? previous.summary.updatedAt : ((file && readLastActivity(file.path)) ?? info.lastModified);
    const summary: RawSummary = {
      id: info.sessionId,
      title,
      firstPrompt: firstPrompt ? oneLine(firstPrompt, 500) : null,
      customTitle: info.customTitle ?? null,
      cwd,
      projectRoot: location?.root ?? cwd ?? 'Unknown folder',
      gitBranch: info.gitBranch ?? null,
      worktree: location?.worktree
        ? { name: location.worktree.name, branch: this.options.resolver.branch(location) }
        : null,
      origin: this.options.isOwned?.(info.sessionId) ? 'app' : originFromEntrypoint(entrypoint),
      createdAt: info.createdAt ?? null,
      updatedAt,
      fileSize: info.fileSize ?? null,
      tag: info.tag ?? null,
      profileId: info.profileId ?? file?.profileId ?? previous?.summary.profileId ?? BUILTIN_PROFILE_ID,
    };
    return { summary, path: file?.path ?? previous?.path ?? null, mtime: file?.mtime ?? previous?.mtime ?? null, entrypoint };
  }

  private apply(upserted: Entry[], removed: string[]): void {
    for (const entry of upserted) this.touchedDuringScan?.add(entry.summary.id);
    for (const id of removed) this.touchedDuringScan?.add(id);
    const { db } = this.options;
    db.exec('BEGIN');
    try {
      for (const entry of upserted) {
        const s = entry.summary;
        this.statements.upsert.run(s.id, s.projectRoot, s.updatedAt, entry.path, entry.mtime, entry.entrypoint, JSON.stringify(s));
        this.entries.set(s.id, entry);
      }
      for (const id of removed) {
        this.statements.remove.run(id);
        this.entries.delete(id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    this.options.onChange({ upserted: upserted.map((e) => this.decorate(e.summary)), removed, complete: this.complete });
  }

  private fileChanged(sessionId: string, path: string, profileId: string): void {
    let runner = this.perFile.get(sessionId);
    if (!runner) {
      runner = coalesce(() => this.updateOne(sessionId, path, profileId), 200);
      this.perFile.set(sessionId, runner);
    }
    runner.trigger();
  }

  private async updateOne(sessionId: string, path: string, profileId: string): Promise<void> {
    try {
      if (!existsSync(path)) {
        if (this.entries.has(sessionId)) this.apply([], [sessionId]);
        this.options.onTranscriptChanged(sessionId);
        return;
      }
      const info = await this.options.source.info(sessionId);
      // A brand-new transcript has no prompt yet, so no summary; the next write will bring it in.
      if (info) {
        const stat = statSync(path, { throwIfNoEntry: false });
        const previous = this.entries.get(sessionId);
        const entry = this.build(info, { path, mtime: Math.round(stat?.mtimeMs ?? Date.now()), profileId }, previous);
        if (!previous || JSON.stringify(previous.summary) !== JSON.stringify(entry.summary)) this.apply([entry], []);
      }
      this.options.onTranscriptChanged(sessionId);
    } catch (error) {
      this.options.log('warn', `Updating session ${sessionId} failed: ${(error as Error).message}`);
    }
  }
}
