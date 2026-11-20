import type { DatabaseSync } from 'node:sqlite';

/** A session an orchestrator started (`sessionId`), or a start still in the queue (`itemId`). */
export interface StoredWorker {
  orchestratorId: string;
  sessionId: string | null;
  itemId: string | null;
  title: string;
  startedAt: number;
}

export interface StoredOrchestrator {
  sessionId: string;
  projectRoot: string;
  createdAt: number;
}

/**
 * `orchestrators` and `orchestrator_workers` (docs/orchestrator.md): which sessions are orchestrators, and what each
 * started. User data: an orchestrator must still know its sessions after a restart and a cache rebuild.
 */
export class OrchestratorStore {
  private readonly statements;
  /** Read once: every start and resume of a session asks whether it is an orchestrator or one's session. */
  private cache: { orchestrators: Map<string, StoredOrchestrator>; workers: StoredWorker[] } | null = null;

  constructor(
    db: DatabaseSync,
    private readonly now: () => number = Date.now,
  ) {
    this.statements = {
      orchestrators: db.prepare('SELECT session_id AS sessionId, project_root AS projectRoot, created_at AS createdAt FROM orchestrators ORDER BY created_at, rowid'),
      add: db.prepare('INSERT OR IGNORE INTO orchestrators (session_id, project_root, created_at) VALUES (?, ?, ?)'),
      remove: db.prepare('DELETE FROM orchestrators WHERE session_id = ?'),
      workers: db.prepare('SELECT orchestrator_id AS orchestratorId, session_id AS sessionId, item_id AS itemId, title, created_at AS startedAt FROM orchestrator_workers ORDER BY created_at, id'),
      addWorker: db.prepare('INSERT INTO orchestrator_workers (orchestrator_id, session_id, item_id, title, created_at) VALUES (?, ?, ?, ?, ?)'),
      started: db.prepare('UPDATE orchestrator_workers SET session_id = ?, item_id = NULL WHERE item_id = ?'),
      removeWorkers: db.prepare('DELETE FROM orchestrator_workers WHERE orchestrator_id = ?'),
      removeWorker: db.prepare('DELETE FROM orchestrator_workers WHERE session_id = ?'),
      removeItem: db.prepare('DELETE FROM orchestrator_workers WHERE item_id = ?'),
    };
  }

  private read() {
    this.cache ??= {
      orchestrators: new Map((this.statements.orchestrators.all() as unknown as StoredOrchestrator[]).map((o) => [o.sessionId, { ...o }])),
      workers: (this.statements.workers.all() as unknown as StoredWorker[]).map((w) => ({ ...w })),
    };
    return this.cache;
  }

  list(): StoredOrchestrator[] {
    return [...this.read().orchestrators.values()];
  }

  get(sessionId: string): StoredOrchestrator | null {
    return this.read().orchestrators.get(sessionId) ?? null;
  }

  /** Makes a session an orchestrator of a project. */
  add(sessionId: string, projectRoot: string): StoredOrchestrator {
    this.statements.add.run(sessionId, projectRoot, this.now());
    this.cache = null;
    return this.get(sessionId)!;
  }

  /** The session is gone (deleted): it is no orchestrator any more, and its sessions stand on their own. */
  remove(sessionId: string): void {
    this.statements.remove.run(sessionId);
    this.statements.removeWorkers.run(sessionId);
    this.cache = null;
  }

  /** What an orchestrator started, oldest first. */
  workersOf(orchestratorId: string): StoredWorker[] {
    return this.read().workers.filter((w) => w.orchestratorId === orchestratorId);
  }

  /** The orchestrator that started a session, or null. */
  orchestratorOf(sessionId: string): string | null {
    return this.read().workers.find((w) => w.sessionId === sessionId)?.orchestratorId ?? null;
  }

  addWorker(orchestratorId: string, worker: { sessionId: string | null; itemId: string | null; title: string }): void {
    this.statements.addWorker.run(orchestratorId, worker.sessionId, worker.itemId, worker.title, this.now());
    this.cache = null;
  }

  /** A queued start became a session; its orchestrator and title, or null when the item was no orchestrator's. */
  itemStarted(itemId: string, sessionId: string): { orchestratorId: string; title: string } | null {
    const worker = this.read().workers.find((w) => w.itemId === itemId);
    if (!worker) return null;
    this.statements.started.run(sessionId, itemId);
    this.cache = null;
    return { orchestratorId: worker.orchestratorId, title: worker.title };
  }

  /** A queued start was removed from the queue before it started. True when it was an orchestrator's. */
  itemRemoved(itemId: string): boolean {
    const known = this.read().workers.some((w) => w.itemId === itemId);
    if (known) {
      this.statements.removeItem.run(itemId);
      this.cache = null;
    }
    return known;
  }

  /** A started session is gone (deleted). True when it was an orchestrator's. */
  workerRemoved(sessionId: string): boolean {
    const known = this.orchestratorOf(sessionId) !== null;
    if (known) {
      this.statements.removeWorker.run(sessionId);
      this.cache = null;
    }
    return known;
  }
}
