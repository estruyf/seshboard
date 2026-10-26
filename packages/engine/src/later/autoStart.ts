import { promptLabel, queueStates, type LaterItem, type QueueAuto, type QueueEntry, type QueueSession, type SessionOutcome, type SessionHostInfo, type UsageLimitHit } from '@seshboard/protocol';
import type { LaterStore } from './laterStore.ts';

/** A queued item started by itself. */
export interface AutoStarted {
  itemId: string;
  sessionId: string;
  prompt: string;
  cwd: string;
  projectName: string;
}

/** A queued item that would have started by itself, but the session it waited for didn't end cleanly. */
export interface AutoSkipped {
  itemId: string;
  prompt: string;
  sessionId: string;
  title: string;
  outcome: 'error' | 'stopped';
}

export interface AutoStartDeps {
  store: LaterStore;
  /** Every session the engine knows, with whether it is busy and whether it runs outside Seshboard. */
  sessions(): QueueSession[];
  projectName(root: string): string;
  /** The usage limit the item's Claude profile is at, or null. */
  limitOf(item: LaterItem): UsageLimitHit | null;
  /** How many sessions count toward the focus limit now, and the limit (null: off). */
  focus(): { limit: number | null; count: number };
  /** Starts the item the way Start does (`later.start`): the session is created and the item leaves the queue. */
  start(item: LaterItem): Promise<string>;
  /** Outcomes or holds changed: the windows should hear the queue again. */
  changed(): void;
  started(event: AutoStarted): void;
  skipped(event: AutoSkipped): void;
  log(level: 'info' | 'warn', message: string): void;
  now?(): number;
}

const BUSY: ReadonlySet<SessionHostInfo['state']> = new Set(['starting', 'running', 'needs-you']);

/**
 * Starts queued items that start by themselves (`autoStart`), in the engine, so it happens once whatever number of
 * windows are open, and with none. The rules are the queue's own (`queueStates`), plus:
 *
 * - An item is armed once it was seen waiting. Only an armed item starts, so nothing starts at launch, or because
 *   it was queued while what it waits for was already done.
 * - It starts only when every session it waited on ended its turn cleanly. After an error or a stop it stays in the
 *   queue, ready, and `skipped` says why. A turn that ended without a known outcome (the app quit, a message sent
 *   with Send now) starts nothing.
 * - At the focus limit it never asks: it waits for a free slot. At a usage limit it waits for the reset.
 */
export class QueueAutoStarter {
  /** How each session's last turn ended; dropped when a new turn starts. */
  private readonly outcomes = new Map<string, SessionOutcome>();
  /** Armed items and the sessions they waited on while waiting. */
  private readonly armed = new Map<string, Set<string>>();
  /**
   * Items queued only because of a limit (a scheduled run at the focus limit or a usage limit): they start when the
   * slot frees or the limit resets, without a session to wait on. Kept for this run only, like `armed`.
   */
  private readonly heldByLimit = new Set<string>();
  /** Items being started, so each starts once. */
  private readonly starting = new Set<string>();
  private focusHeld = new Set<string>();
  private readonly hostStates = new Map<string, SessionHostInfo['state']>();
  private running: Promise<void> | null = null;
  private again = false;
  private limitTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(private readonly deps: AutoStartDeps) {
    // What items wait on now ended before this run, most likely while Seshboard quit: nothing starts after it.
    const started = new Map(deps.store.startedLinks().map((s) => [s.itemId, s.sessionId]));
    for (const item of deps.store.list()) {
      const id = item.waitFor.kind === 'session' ? item.waitFor.sessionId : item.waitFor.kind === 'item' ? started.get(item.waitFor.itemId) : undefined;
      if (id) this.outcomes.set(id, 'quit');
    }
  }

  /** What the windows show: how the sessions items wait on ended, and the items held at the focus limit. */
  auto(): QueueAuto {
    return { outcomes: [...this.outcomes].map(([sessionId, outcome]) => ({ sessionId, outcome })), focusHeld: [...this.focusHeld] };
  }

  /** Arms an item that waits only for a limit: it starts by itself once nothing holds it (#173's scheduled runs). */
  armForLimit(itemId: string): void {
    this.heldByLimit.add(itemId);
    if (!this.armed.has(itemId)) this.armed.set(itemId, new Set());
    void this.check();
  }

  outcomeOf(sessionId: string): SessionOutcome | null {
    return this.outcomes.get(sessionId) ?? null;
  }

  /** A turn ended (its `result`). A turn Send now stopped to send a message is followed by another: no outcome. */
  turnEnded(sessionId: string, outcome: { ok: boolean; stopped?: boolean; superseded?: boolean }): void {
    if (outcome.superseded) this.outcomes.delete(sessionId);
    else this.outcomes.set(sessionId, outcome.stopped ? 'stopped' : outcome.ok ? 'clean' : 'error');
    this.changedIfWaitedOn(sessionId);
  }

  /** A session this app runs changed state: a new turn forgets the last one's outcome, a crash or a close mid-turn is one. */
  onHost(info: SessionHostInfo): void {
    const before = this.hostStates.get(info.sessionId);
    this.hostStates.set(info.sessionId, info.state);
    const wasBusy = before !== undefined && BUSY.has(before);
    if (BUSY.has(info.state) && !wasBusy) this.outcomes.delete(info.sessionId);
    else if (wasBusy && info.state === 'error') this.outcomes.set(info.sessionId, 'error');
    else if (wasBusy && info.state === 'closed' && !this.outcomes.has(info.sessionId)) this.outcomes.set(info.sessionId, 'stopped');
    if (info.state === 'closed' || info.state === 'error') this.hostStates.delete(info.sessionId);
    this.check();
  }

  /**
   * Looks at the items that start by themselves and starts the ones that may. Call it whenever a session's state,
   * the queue, a usage limit or the focus limit changes. Calls made while it runs fold into one more run.
   */
  check(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.pass();
        } while (this.again && !this.closed);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.limitTimer);
  }

  private summary() {
    return queueStates({
      items: this.deps.store.list(),
      started: this.deps.store.startedLinks(),
      sessions: this.deps.sessions(),
      projectName: (root) => this.deps.projectName(root),
      limitOf: (item) => this.deps.limitOf(item),
      now: this.now(),
      outcomeOf: (id) => this.outcomeOf(id),
    });
  }

  private async pass(): Promise<void> {
    // Most queues have nothing that starts by itself: this runs on every change, so leave early.
    if (this.armed.size === 0 && this.focusHeld.size === 0 && !this.deps.store.list().some((item) => item.autoStart)) return;
    const ready: QueueEntry[] = [];
    let nextReset: number | null = null;
    let changed = false;
    const live = new Set<string>();
    for (const entry of this.summary().entries) {
      const { item } = entry;
      live.add(item.id);
      if (!entry.autoStart) {
        this.armed.delete(item.id);
        this.heldByLimit.delete(item.id);
        continue;
      }
      if (this.starting.has(item.id)) continue;
      if (entry.baseState === 'waiting') {
        // It waits on a session now: its finish decides, as for any item that starts by itself.
        this.heldByLimit.delete(item.id);
        const blockers = this.armed.get(item.id) ?? new Set<string>();
        entry.blockers.forEach((id) => blockers.add(id));
        this.armed.set(item.id, blockers);
        continue;
      }
      const blockers = this.armed.get(item.id);
      if (entry.baseState !== 'ready' || !blockers) continue;
      // Nothing it waited on ran (the item above it left the queue without starting): you start it.
      if (blockers.size === 0 && !this.heldByLimit.has(item.id)) {
        this.armed.delete(item.id);
        continue;
      }
      const ends = [...blockers].map((sessionId) => ({ sessionId, outcome: this.outcomeOf(sessionId) }));
      const bad = ends.find((end) => end.outcome === 'error' || end.outcome === 'stopped');
      if (bad) {
        this.armed.delete(item.id);
        changed = true;
        const title = this.deps.sessions().find((s) => s.id === bad.sessionId)?.title || 'Untitled session';
        this.deps.skipped({ itemId: item.id, prompt: item.prompt, sessionId: bad.sessionId, title, outcome: bad.outcome as 'error' | 'stopped' });
        continue;
      }
      if (ends.some((end) => end.outcome === 'quit')) {
        this.armed.delete(item.id);
        continue;
      }
      // A turn whose end isn't known yet (Send now's) is followed by another: wait for that one.
      if (ends.some((end) => end.outcome !== 'clean')) continue;
      // At a usage limit: it starts when the limit resets.
      if (entry.hold === 'limit') {
        const resetsAt = this.deps.limitOf(item)?.resetsAt ?? null;
        if (resetsAt !== null) nextReset = Math.min(nextReset ?? resetsAt, resetsAt);
        continue;
      }
      ready.push(entry);
    }
    for (const id of this.armed.keys()) if (!live.has(id)) this.armed.delete(id);
    for (const id of this.heldByLimit) if (!live.has(id)) this.heldByLimit.delete(id);

    const held = new Set<string>();
    for (const entry of ready) {
      // Counted again before each start: the one started before it counts now.
      const focus = this.deps.focus();
      if (focus.limit !== null && focus.count >= focus.limit) {
        held.add(entry.item.id);
        continue;
      }
      await this.start(entry);
    }
    if (!sameSet(held, this.focusHeld)) {
      this.focusHeld = held;
      changed = true;
    }
    if (changed) this.deps.changed();
    this.scheduleReset(nextReset);
  }

  private async start(entry: QueueEntry): Promise<void> {
    const { item } = entry;
    this.starting.add(item.id);
    this.armed.delete(item.id);
    this.heldByLimit.delete(item.id);
    try {
      const sessionId = await this.deps.start(item);
      this.deps.log('info', `Queue: started “${promptLabel(item.prompt)}” by itself as ${sessionId}`);
      this.deps.started({ itemId: item.id, sessionId, prompt: item.prompt, cwd: item.cwd, projectName: this.deps.projectName(item.cwd) });
      // Items that waited on it follow the new session now: look again, so they are armed on it.
      this.again = true;
    } catch (error) {
      // It stays in the queue, ready: you can start it yourself and see what is wrong.
      this.deps.log('warn', `Queue: could not start “${promptLabel(item.prompt)}” by itself: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.starting.delete(item.id);
    }
  }

  /** An item waits for a usage limit to reset: look again just after it. */
  private scheduleReset(at: number | null): void {
    clearTimeout(this.limitTimer);
    if (at === null || this.closed) return;
    this.limitTimer = setTimeout(() => void this.check(), Math.max(1_000, at - this.now() + 1_000));
    this.limitTimer.unref?.();
  }

  private changedIfWaitedOn(sessionId: string): void {
    const started = new Map(this.deps.store.startedLinks().map((s) => [s.itemId, s.sessionId]));
    const waitedOn = this.deps.store
      .list()
      .some((item) => item.autoStart && ((item.waitFor.kind === 'session' && item.waitFor.sessionId === sessionId) || (item.waitFor.kind === 'item' && started.get(item.waitFor.itemId) === sessionId) || item.waitFor.kind === 'project'));
    if (waitedOn) this.deps.changed();
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));
