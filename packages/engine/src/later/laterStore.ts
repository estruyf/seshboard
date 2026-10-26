import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { LaterDraft, QueueWaitFor, type LaterItem, type QueueStarted } from '@seshboard/protocol';

/** The choices stored next to a prompt, as JSON (everything in a draft except the folder and the prompt). */
type Settings = Omit<LaterItem, 'id' | 'cwd' | 'prompt' | 'createdAt' | 'position' | 'waitFor'>;

interface Row {
  id: string;
  cwd: string;
  prompt: string;
  settings_json: string;
  created_at: number;
  position: number;
  wait_json: string | null;
}

/** What an item waits for when it says nothing: any session in its project. */
const DEFAULT_WAIT: QueueWaitFor = { kind: 'project' };

/** Where `add` puts an item back (Undo), and what it waited for. */
export interface Restore {
  id?: string;
  createdAt?: number;
  /** Its place in the queue; the end when left out. */
  index?: number;
  waitFor?: QueueWaitFor;
}

/**
 * The queue (first called the Later list, hence the names): prompts to start later, in an order of their own.
 * Kept in `later_prompts`, a user choice, so the queue survives a cache rebuild. Positions are kept as 0..n-1;
 * every change that moves items numbers them again in one transaction.
 */
export class LaterStore {
  private readonly statements;

  constructor(private readonly db: DatabaseSync) {
    this.statements = {
      // Queue order; the age and then the id break ties (rows from before positions, or a crash mid-renumber).
      all: db.prepare('SELECT * FROM later_prompts ORDER BY position, created_at, id'),
      one: db.prepare('SELECT * FROM later_prompts WHERE id = ?'),
      upsert: db.prepare(`
        INSERT INTO later_prompts (id, cwd, prompt, settings_json, created_at, position, wait_json) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET cwd = excluded.cwd, prompt = excluded.prompt, settings_json = excluded.settings_json,
          created_at = excluded.created_at, position = excluded.position, wait_json = excluded.wait_json`),
      setPosition: db.prepare('UPDATE later_prompts SET position = ? WHERE id = ?'),
      setWait: db.prepare('UPDATE later_prompts SET wait_json = ? WHERE id = ?'),
      setDraft: db.prepare('UPDATE later_prompts SET cwd = ?, prompt = ?, settings_json = ? WHERE id = ?'),
      remove: db.prepare('DELETE FROM later_prompts WHERE id = ?'),
      started: db.prepare('SELECT item_id, session_id FROM later_started'),
      markStarted: db.prepare('INSERT INTO later_started (item_id, session_id, started_at) VALUES (?, ?, ?) ON CONFLICT (item_id) DO UPDATE SET session_id = excluded.session_id, started_at = excluded.started_at'),
      forgetStarted: db.prepare('DELETE FROM later_started WHERE item_id = ?'),
    };
  }

  /** The queue in order, or one folder's. */
  list(cwd?: string): LaterItem[] {
    const items = this.readAll();
    return cwd ? items.filter((item) => item.cwd === cwd) : items;
  }

  get(id: string): LaterItem | null {
    const row = this.statements.one.get(id) as unknown as Row | undefined;
    return row ? toItem(row) : null;
  }

  /** Queues a prompt at the end, or (Undo) puts a removed item back where it was, as it was. */
  add(draft: LaterDraft, restore: Restore = {}): LaterItem {
    const { cwd, prompt, ...parsed } = LaterDraft.parse(draft);
    const waitFor = restore.waitFor ? QueueWaitFor.parse(restore.waitFor) : DEFAULT_WAIT;
    const settings = startsBy(parsed, waitFor);
    const id = restore.id ?? randomUUID();
    const createdAt = restore.createdAt ?? Date.now();
    this.transaction(() => {
      const others = this.readAll().filter((item) => item.id !== id);
      const index = Math.min(restore.index ?? others.length, others.length);
      this.statements.upsert.run(id, cwd, prompt, JSON.stringify(settings satisfies Settings), createdAt, index, waitJson(waitFor));
      this.number([...others.slice(0, index).map((i) => i.id), id, ...others.slice(index).map((i) => i.id)]);
    });
    return this.get(id)!;
  }

  /** Moves an item to `toIndex` (clamped). False when it is gone. */
  reorder(id: string, toIndex: number): boolean {
    let found = false;
    this.transaction(() => {
      const ids = this.readAll().map((item) => item.id);
      const from = ids.indexOf(id);
      if (from === -1) return;
      found = true;
      ids.splice(from, 1);
      ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, id);
      this.number(ids);
    });
    return found;
  }

  /**
   * Changes what an item waits for, whether it starts by itself, or its prompt and choices; it keeps its place and
   * age. Waiting for nothing turns starting by itself off. Null when it is gone.
   */
  update(id: string, patch: { waitFor?: QueueWaitFor; autoStart?: boolean; draft?: LaterDraft }): LaterItem | null {
    const item = this.get(id);
    if (!item) return null;
    this.transaction(() => {
      const waitFor = patch.waitFor ? QueueWaitFor.parse(patch.waitFor) : item.waitFor;
      if (patch.waitFor) this.statements.setWait.run(waitJson(waitFor), id);
      // A draft that doesn't say whether it starts by itself keeps what the item had.
      const { cwd, prompt, ...settings } = patch.draft ? LaterDraft.parse({ ...patch.draft, autoStart: patch.draft.autoStart ?? item.autoStart }) : settingsOf(item);
      const next = startsBy({ ...settings, autoStart: patch.autoStart ?? settings.autoStart }, waitFor);
      this.statements.setDraft.run(cwd, prompt, JSON.stringify(next satisfies Settings), id);
    });
    return this.get(id);
  }

  remove(id: string): void {
    this.transaction(() => {
      this.statements.remove.run(id);
      this.number(this.readAll().map((item) => item.id));
    });
  }

  /**
   * An item was started as `sessionId`: it leaves the queue, and items waiting on it follow the session from now
   * on. The link is kept only while some item still waits on it.
   */
  started(id: string, sessionId: string): void {
    this.transaction(() => {
      this.statements.remove.run(id);
      this.statements.markStarted.run(id, sessionId, Date.now());
      this.number(this.readAll().map((item) => item.id));
      this.pruneStarted();
    });
  }

  /** Started items that a queued item still waits on, and their sessions. */
  startedLinks(): QueueStarted[] {
    const waitedOn = new Set(this.readAll().flatMap((item) => (item.waitFor.kind === 'item' ? [item.waitFor.itemId] : [])));
    return (this.statements.started.all() as unknown as { item_id: string; session_id: string }[])
      .filter((row) => waitedOn.has(row.item_id))
      .map((row) => ({ itemId: row.item_id, sessionId: row.session_id }));
  }

  private pruneStarted(): void {
    const waitedOn = new Set(this.readAll().flatMap((item) => (item.waitFor.kind === 'item' ? [item.waitFor.itemId] : [])));
    for (const row of this.statements.started.all() as unknown as { item_id: string }[]) if (!waitedOn.has(row.item_id)) this.statements.forgetStarted.run(row.item_id);
  }

  private readAll(): LaterItem[] {
    return (this.statements.all.all() as unknown as Row[]).flatMap((row) => {
      const item = toItem(row);
      return item ? [item] : [];
    });
  }

  /** Positions 0..n-1 in this order. */
  private number(ids: readonly string[]): void {
    ids.forEach((id, position) => this.statements.setPosition.run(position, id));
  }

  private transaction(fn: () => void): void {
    this.db.exec('BEGIN');
    try {
      fn();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** A row as an item; null for one a newer build wrote differently, which is skipped rather than failing the whole list. */
function toItem(row: Row): LaterItem | null {
  const parsed = LaterDraft.safeParse({ ...safeJson(row.settings_json), cwd: row.cwd, prompt: row.prompt });
  if (!parsed.success) return null;
  const wait = row.wait_json === null ? null : QueueWaitFor.safeParse(safeJson(row.wait_json));
  return { ...parsed.data, id: row.id, createdAt: row.created_at, position: row.position, waitFor: wait?.success ? wait.data : DEFAULT_WAIT };
}

/** An item's draft: everything but its place in the queue. */
const settingsOf = ({ id: _id, createdAt: _createdAt, position: _position, waitFor: _waitFor, ...draft }: LaterItem) => draft;

/** Starting by itself only means something while the item waits for something: waiting for nothing turns it off. */
const startsBy = <T extends { autoStart: boolean }>(settings: T, waitFor: QueueWaitFor): T => (waitFor.kind === 'none' && settings.autoStart ? { ...settings, autoStart: false } : settings);

/** The default is stored as NULL, so rows from before the queue and new ones read the same. */
const waitJson = (waitFor: QueueWaitFor) => (waitFor.kind === 'project' ? null : JSON.stringify(waitFor));

function safeJson(text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
