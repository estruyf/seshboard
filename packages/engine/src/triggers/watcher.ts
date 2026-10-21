import {
  assignsOnPickUp,
  blockingStateLabel,
  eventKey,
  eventRef,
  newEvents,
  nextStateLabel,
  seedSeen,
  slots,
  stateLabelEdit,
  stateLabelNames,
  TRIGGER_FAILURES_TO_PAUSE,
  TRIGGER_RATE_LIMIT_MS,
  triggerDue,
  triggerPrompt,
  triggerSessionTitle,
  waitingFullReason,
  type IssueItem,
  type LaterDraft,
  type SourceItem,
  type Trigger,
  type TriggerContext,
  type TriggerEvent,
  type TriggerNotice,
  type TriggerWorkState,
} from '@switchboard/protocol';
import { GITHUB_CACHE_MS } from '../git/github.ts';
import type { RunHold } from '../schedules/scheduler.ts';
import { readFailedLog, readFailedRuns } from './sources/ci.ts';
import { readLogin, readRepo, type GhRun, type SourceRead } from './sources/gh.ts';
import { editIssue, ensureStateLabels, readAssociations, readIssue, readIssues } from './sources/issues.ts';
import type { TriggerStore } from './triggerStore.ts';

export interface TriggerWatcherDeps {
  store: TriggerStore;
  /** Runs gh in a project's folder. */
  gh: GhRun;
  folderExists(root: string): boolean;
  /** A session a trigger started, if it is busy: working, or waiting for you. */
  sessionState(sessionId: string): 'working' | 'waiting' | null;
  /** A pull request the session opened (or works on); null without one. */
  sessionPr(sessionId: string): { number: number; url: string } | null;
  /** The queued item an event became is still on the queue. */
  queued(itemId: string): boolean;
  /** Why a session can't start now (the focus limit, or its profile's usage limit), or null when it can. */
  hold(draft: LaterDraft): RunHold | null;
  /** Starts a new session from the draft, titled `title`, the way a schedule run does. */
  start(draft: LaterDraft, title: string): Promise<string>;
  /** Puts the draft on the queue, as an item that starts by itself when the slot frees or the limit resets. */
  queue(draft: LaterDraft): string;
  projectName(root: string): string;
  /** Triggers or their events changed: the windows should hear them again. */
  changed(): void;
  /** Things to tell you about: a session started, an issue picked up, a trigger paused. */
  notify(notices: TriggerNotice[]): void;
  log(level: 'info' | 'warn', message: string): void;
  now?(): number;
}

/** What a check read from its source. */
type Answer = { items: SourceItem[]; branch: string | null };

/** How long the gh account and a project's default branch are kept. */
const ACCOUNT_MS = 60 * 60_000;

/**
 * Event triggers (#180), in the engine, so they run with no window open. It has no timer of its own: the Scheduler's
 * tick (at least once a minute, on wake and when the clock jumps) calls `check`, which reads the sources of the
 * triggers that are due through gh, records what is new, starts what fits under each trigger's `maxAtOnce` (through
 * the same path as a schedule run, so the focus limit and usage limits hold it in the queue), and keeps the state
 * label on each issue in step with its session.
 *
 * The first check of a new or resumed trigger marks what is there as seen and starts nothing. A rate limit stops a
 * trigger's checks for an hour; five other failures in a row pause it, with the reason. Nothing is written to GitHub
 * but state labels and Assign to me when picked up, and only when they are on.
 */
export class TriggerWatcher {
  private running: Promise<void> | null = null;
  private again = false;
  private closed = false;
  /** Checks asked for by hand (Check now), done at the next pass whether due or not. */
  private readonly forced = new Set<string>();
  /** Events found by the last check of each trigger: picked up (labels, a notification) when they get a slot or wait. */
  private readonly fresh = new Set<string>();
  /** How the last turn of each triggered session ended, for its state label. */
  private readonly outcomes = new Map<string, 'clean' | 'error' | 'stopped'>();
  /** Triggers whose state labels the repository has (made this run). */
  private readonly labelsReady = new Set<string>();
  /** Events whose work ended by hand (the session archived or deleted, the queued item removed): their state label comes off. */
  private readonly releasing = new Set<string>();
  /** Events being started, so each starts once. */
  private readonly starting = new Set<string>();
  /** gh's answers to reads, for a minute (Check now asks again). */
  private readonly reads = new Map<string, { at: number; result: Awaited<ReturnType<GhRun>> }>();
  private readonly accounts = new Map<string, { at: number; login: string | null; defaultBranch: string | null }>();
  private nudgeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: TriggerWatcherDeps) {}

  /** Looks at every trigger that is due, starts what fits, and moves state labels on. Calls made meanwhile fold into one more. */
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
      } catch (error) {
        this.deps.log('warn', `Triggers: a check failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Checks one trigger now, due or not (Check now). Its source is read again, not from the last minute's answer. */
  checkNow(id: string): Promise<void> {
    const trigger = this.deps.store.get(id);
    if (trigger) {
      for (const key of [...this.reads.keys()]) if (key.startsWith(`${trigger.projectRoot}\u0000`)) this.reads.delete(key);
      this.forced.add(id);
    }
    return this.check();
  }

  /** A session's state changed (it finished, it waits for you): a slot may be free, a label may move. */
  nudge(): void {
    if (this.closed) return;
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => void this.check(), 1_000);
    this.nudgeTimer.unref?.();
  }

  /** How a triggered session's turn ended: an error or a stop moves its issue to failed. */
  turnEnded(sessionId: string, outcome: { ok: boolean; stopped?: boolean }): void {
    if (!this.deps.store.eventOfSession(sessionId)) return;
    this.outcomes.set(sessionId, outcome.stopped ? 'stopped' : outcome.ok ? 'clean' : 'error');
    this.nudge();
  }

  /**
   * A triggered session was archived or deleted: its issue's state label comes off, when it still says working or needs
   * input. Unarchiving it doesn't put the label back.
   */
  released(sessionId: string): void {
    const stored = this.deps.store.eventOfSession(sessionId);
    if (!stored || stored.event.kind !== 'issue') return;
    this.releasing.add(stored.event.id);
    void this.check();
  }

  /** A queued item an event became was removed by hand: the event is skipped, and its issue's state label comes off. */
  queueRemoved(itemId: string): void {
    const stored = this.deps.store.eventOfItem(itemId);
    if (!stored || stored.event.status !== 'queued') return;
    this.deps.store.setStatus(stored.event.id, 'skipped', { reason: 'removed from the queue' });
    if (stored.event.kind === 'issue') this.releasing.add(stored.event.id);
    this.deps.changed();
    void this.check();
  }

  /**
   * A queued item an event became has started: the event follows its session, and is told as a direct start is.
   * Returns the session's title, which the queue doesn't know, or null when the item isn't a trigger's.
   */
  queuedStarted(itemId: string, sessionId: string): string | null {
    const stored = this.deps.store.eventOfItem(itemId);
    if (!stored) return null;
    const trigger = this.deps.store.get(stored.event.triggerId);
    const event = this.deps.store.setStatus(stored.event.id, 'started', { sessionId, itemId, startedAt: this.now() });
    const title = triggerSessionTitle(stored.event);
    if (event) {
      this.linkSession(trigger, event, sessionId);
      if (trigger) this.announce(trigger, event, title, sessionId);
    }
    this.deps.changed();
    this.nudge();
    return title;
  }

  /**
   * Starts an event now, past `maxAtOnce`: Start now on a waiting one, Start anyway on a skipped one (picked up first,
   * so its labels and assignee are set as for any other). The focus limit and usage limits still hold it.
   */
  async startEvent(eventId: string): Promise<TriggerEvent | null> {
    const stored = this.deps.store.event(eventId);
    const trigger = stored ? this.deps.store.get(stored.event.triggerId) : null;
    if (!stored || !trigger) return null;
    if (stored.event.status === 'skipped' || stored.event.status === 'replaced') {
      this.deps.store.setStatus(eventId, 'waiting');
      await this.pickUp(trigger, { ...stored.event, status: 'waiting' });
    }
    await this.startOne(trigger, this.deps.store.event(eventId)!.event);
    this.deps.changed();
    return this.deps.store.event(eventId)?.event ?? null;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.nudgeTimer);
  }

  private async pass(): Promise<void> {
    const now = this.now();
    const before = this.snapshot();
    // First, so a check in this pass already knows which state labels Switchboard took off.
    await this.releaseLabels();
    for (const trigger of this.deps.store.list()) {
      const forced = this.forced.delete(trigger.id);
      if (!forced && !triggerDue(trigger, now)) continue;
      if (trigger.paused) continue;
      await this.checkOne(trigger);
    }
    for (const trigger of this.deps.store.list()) {
      if (!trigger.paused) await this.advance(trigger);
    }
    await this.syncLabels();
    if (this.snapshot() !== before) this.deps.changed();
  }

  /** Triggers and their events as text, to tell the windows only when something changed. */
  private snapshot(): string {
    return JSON.stringify([this.deps.store.list(), this.deps.store.events()]);
  }

  /** Reads a trigger's source and records what is new; a failure is counted, and five pause it. */
  private async checkOne(trigger: Trigger): Promise<void> {
    const { store } = this.deps;
    const at = this.now();
    if (!this.deps.folderExists(trigger.projectRoot)) {
      this.pause(trigger, 'Folder not found');
      return;
    }
    const answer = await this.read(trigger);
    if (!answer.ok) {
      this.failed(trigger, answer, at);
      return;
    }
    const { items, branch } = answer.value;
    if (trigger.seededAt === null) {
      store.checked(trigger.id, { at, seen: seedSeen(trigger, items, branch), seeded: true });
      this.deps.log('info', `Triggers: “${trigger.name}” looked for the first time; ${items.length} there now, marked as seen`);
      return;
    }
    const seen = store.seen(trigger.id);
    let list = items;
    if (trigger.source.kind === 'issues' && trigger.source.collaboratorsOnly) {
      // Only issues that may start are looked up: gh issue list doesn't say who opened them, to the repository.
      const candidates = (items as IssueItem[]).filter((i) => seen[eventKey(trigger.source, i)] !== 'match' && !blockingStateLabel(trigger, i));
      if (candidates.length) {
        const associations = await readAssociations(this.reads_gh, trigger.projectRoot, candidates);
        if (!associations.ok) {
          this.failed(trigger, associations, at);
          return;
        }
        list = (items as IssueItem[]).map((i) => ({ ...i, authorAssociation: associations.value.get(i.number) ?? null }));
      }
    }
    const found = newEvents(trigger, list, seen, branch);
    for (const skip of found.skipped) store.addEvent(trigger.id, skip, 'skipped', skip.reason);
    // A millisecond apart, so events of one check keep their order (oldest first) in the line for a slot.
    found.events.forEach((event, i) => this.fresh.add(store.addEvent(trigger.id, event, 'waiting', null, at + i).id));
    store.checked(trigger.id, { at, seen: found.seen });
    if (found.events.length || found.skipped.length) this.deps.log('info', `Triggers: “${trigger.name}” found ${found.events.length} new, skipped ${found.skipped.length}`);
    if (trigger.source.kind === 'issues') await this.followAssignees(trigger, items as IssueItem[]);
  }

  /** The trigger's source, as items: failed runs on its branch, or the issues that match. */
  private async read(trigger: Trigger): Promise<SourceRead<Answer>> {
    const root = trigger.projectRoot;
    if (trigger.source.kind === 'ci') {
      let branch = trigger.source.branch;
      if (!branch) {
        const account = await this.account(root);
        if (!account.ok) return account;
        branch = account.value.defaultBranch;
        if (!branch) return { ok: false, message: 'The repository has no default branch', rateLimited: false };
      }
      const runs = await readFailedRuns(this.reads_gh, root, branch, trigger.source.workflows);
      return runs.ok ? { ok: true, value: { items: runs.value, branch } } : runs;
    }
    const issues = await readIssues(this.reads_gh, root, trigger.source);
    return issues.ok ? { ok: true, value: { items: issues.value, branch: null } } : issues;
  }

  /** gh for reads: the same answer for a minute, so a window's Check now and the tick don't ask twice. */
  private readonly reads_gh: GhRun = async (args, cwd, timeout) => {
    const key = `${cwd}\u0000${args.join('\u0000')}`;
    const hit = this.reads.get(key);
    if (hit && this.now() - hit.at < GITHUB_CACHE_MS) return hit.result;
    const result = await this.deps.gh(args, cwd, timeout);
    if (result.code === 0 && !result.missing) this.reads.set(key, { at: this.now(), result });
    return result;
  };

  /** The gh account and the project's default branch, kept for an hour. */
  private async account(root: string): Promise<SourceRead<{ login: string | null; defaultBranch: string | null }>> {
    const kept = this.accounts.get(root);
    if (kept && this.now() - kept.at < ACCOUNT_MS) return { ok: true, value: kept };
    const repo = await readRepo(this.deps.gh, root);
    if (!repo.ok) return repo;
    const login = await readLogin(this.deps.gh, root);
    const value = { at: this.now(), login: login.ok ? login.value : null, defaultBranch: repo.value.defaultBranch };
    this.accounts.set(root, value);
    return { ok: true, value };
  }

  private failed(trigger: Trigger, failure: { message: string; rateLimited: boolean }, at: number): void {
    if (failure.rateLimited) {
      this.deps.store.blocked(trigger.id, at, at + TRIGGER_RATE_LIMIT_MS, failure.message);
      this.deps.log('warn', `Triggers: “${trigger.name}” was rate limited; no checks for an hour`);
      return;
    }
    const after = this.deps.store.checked(trigger.id, { at, error: failure.message });
    this.deps.log('warn', `Triggers: “${trigger.name}” couldn't check (${after?.failures ?? '?'} in a row): ${failure.message}`);
    if (after && after.failures >= TRIGGER_FAILURES_TO_PAUSE) this.pause(after, failure.message, `${after.failures} failed checks in a row: ${failure.message}`);
  }

  /** Pauses a trigger with the reason its card shows; the notification may say more (`told`). */
  private pause(trigger: Trigger, reason: string, told = reason): void {
    this.deps.store.setPaused(trigger.id, true, reason);
    this.deps.log('warn', `Triggers: paused “${trigger.name}”: ${told}`);
    this.deps.notify([{ kind: 'paused', triggerId: trigger.id, triggerName: trigger.name, projectRoot: trigger.projectRoot, projectName: this.deps.projectName(trigger.projectRoot), eventKind: null, branch: null, ref: null, title: null, sessionId: null, reason: told }]);
  }

  /** Starts what fits under `maxAtOnce`, lets the next wait, skips past `maxWaiting`, and picks up what is new. */
  private async advance(trigger: Trigger): Promise<void> {
    const { store } = this.deps;
    const events = store.eventsOf(trigger.id).map((s) => s.event);
    const line = events.filter((e) => e.status === 'waiting' && !this.starting.has(e.id));
    if (!line.length) return;
    const plan = slots(trigger, this.busy(events), line);
    for (const event of plan.replaced) {
      store.setStatus(event.id, 'replaced', { reason: `a newer failure of ${event.fields.workflow || 'the workflow'} took its place` });
      this.fresh.delete(event.id);
    }
    for (const event of plan.skip) {
      store.setStatus(event.id, 'skipped', { reason: waitingFullReason(trigger.maxWaiting) });
      this.fresh.delete(event.id);
    }
    for (const event of [...plan.start, ...plan.wait]) {
      if (this.fresh.delete(event.id)) await this.pickUp(trigger, event);
    }
    for (const event of plan.start) await this.startOne(trigger, store.event(event.id)?.event ?? event);
  }

  /** How many of a trigger's sessions are busy: working, waiting for you, or held in the queue. */
  private busy(events: readonly TriggerEvent[]): number {
    return events.filter((e) => (e.status === 'started' && e.sessionId && this.deps.sessionState(e.sessionId)) || (e.status === 'queued' && e.itemId && this.deps.queued(e.itemId)) || this.starting.has(e.id)).length;
  }

  /**
   * An event is picked up: it starts now or waits for a slot. An issue gets `switchboard: working` and loses the trigger's
   * label (state labels on), and is assigned to you (Assign to me when picked up), in one `gh issue edit`.
   */
  private async pickUp(trigger: Trigger, event: TriggerEvent): Promise<void> {
    if (event.kind !== 'issue' || trigger.source.kind !== 'issues') return;
    const number = Number(event.fields.number);
    const labels = trigger.stateLabels.on;
    const names = stateLabelNames(trigger.stateLabels);
    const working = labels ? names.working : null;
    // An issue picked up again (labelled again after it failed) still has its last state label: that one comes off.
    const had = (event.fields.labels ?? '').split(',').map((l) => l.trim()).find((l) => Object.values(names).some((n) => n.toLowerCase() === l.toLowerCase()));
    const args = stateLabelEdit(number, working, labels ? (event.label ?? had ?? null) : null, { removeTrigger: labels ? trigger.source.label : null, assign: assignsOnPickUp(trigger) });
    if (args && (await this.edit(trigger, event, args)) && working) this.deps.store.setLabel(event.id, working);
    this.deps.notify([{ kind: 'pickedUp', triggerId: trigger.id, triggerName: trigger.name, projectRoot: trigger.projectRoot, projectName: this.deps.projectName(trigger.projectRoot), eventKind: 'issue', branch: null, ref: eventRef(event), title: event.title, sessionId: null, reason: null }]);
  }

  /** One `gh issue edit`, after making the state labels the repository lacks. False when it failed (said on the event). */
  private async edit(trigger: Trigger, event: TriggerEvent, args: string[]): Promise<boolean> {
    if (trigger.stateLabels.on && args.includes('--add-label') && !this.labelsReady.has(trigger.id)) {
      const made = await ensureStateLabels(this.deps.gh, trigger.projectRoot, stateLabelNames(trigger.stateLabels));
      if (!made.ok) {
        this.deps.log('warn', `Triggers: couldn't make the state labels for “${trigger.name}”: ${made.message}`);
        this.deps.store.setStatus(event.id, event.status, { reason: `Couldn't make the state labels: ${made.message}`, sessionId: event.sessionId, itemId: event.itemId });
        return false;
      }
      this.labelsReady.add(trigger.id);
    }
    const done = await editIssue(this.deps.gh, trigger.projectRoot, args);
    if (!done.ok) {
      this.deps.log('warn', `Triggers: couldn't change issue ${event.fields.number} for “${trigger.name}”: ${done.message}`);
      this.deps.store.setStatus(event.id, event.status, { reason: `Couldn't change the issue on GitHub: ${done.message}`, sessionId: event.sessionId, itemId: event.itemId });
    }
    return done.ok;
  }

  /** Starts one event: a new session with the filled prompt and what it read, or the queue when a limit holds it. */
  private async startOne(trigger: Trigger, event: TriggerEvent): Promise<void> {
    if (this.starting.has(event.id) || event.status !== 'waiting') return;
    const { store } = this.deps;
    this.starting.add(event.id);
    try {
      if ((trigger.draft.permissionMode as string) === 'bypassPermissions') throw new Error('A trigger never bypasses permissions');
      const prompt = triggerPrompt(trigger.prompt, event, await this.context(trigger, event));
      const draft: LaterDraft = {
        cwd: trigger.projectRoot,
        prompt,
        model: trigger.draft.model,
        effort: trigger.draft.effort,
        permissionMode: trigger.draft.permissionMode,
        workspace: trigger.draft.workspace,
        baseRef: trigger.draft.baseRef,
        profileId: trigger.draft.profileId,
        autoStart: false,
      };
      const hold = this.deps.hold(draft);
      if (hold) {
        const itemId = this.deps.queue(draft);
        store.setStatus(event.id, 'queued', { itemId, reason: hold.reason });
        this.deps.log('info', `Triggers: queued ${eventRef(event)} of “${trigger.name}”: ${hold.reason}`);
        return;
      }
      const title = triggerSessionTitle(event);
      const sessionId = await this.deps.start(draft, title);
      const started = store.setStatus(event.id, 'started', { sessionId, startedAt: this.now() });
      if (started) this.linkSession(trigger, started, sessionId);
      this.deps.log('info', `Triggers: “${trigger.name}” started ${eventRef(event)} as ${sessionId}`);
      this.announce(trigger, event, title, sessionId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.deps.log('warn', `Triggers: couldn't start ${eventRef(event)} of “${trigger.name}”: ${reason}`);
      const skipped = store.setStatus(event.id, 'skipped', { reason: `couldn't start: ${reason}` });
      if (skipped) await this.moveLabel(trigger, skipped, 'gone');
    } finally {
      this.starting.delete(event.id);
    }
  }

  /** Tells about a CI session that started, now or from the queue. An issue was told about when it was picked up. */
  private announce(trigger: Trigger, event: TriggerEvent, title: string, sessionId: string): void {
    if (event.kind !== 'ci') return;
    this.deps.notify([{ kind: 'started', triggerId: trigger.id, triggerName: trigger.name, projectRoot: trigger.projectRoot, projectName: this.deps.projectName(trigger.projectRoot), eventKind: 'ci', branch: event.fields.branch ?? null, ref: eventRef(event), title, sessionId, reason: null }]);
  }

  /** What the session gets to read: the issue's text and comments, or the end of the failed jobs' log. */
  private async context(trigger: Trigger, event: TriggerEvent): Promise<TriggerContext> {
    if (event.kind === 'ci') return { log: event.fields.run ? await readFailedLog(this.deps.gh, trigger.projectRoot, event.fields.run) : null };
    const issue = await readIssue(this.reads_gh, trigger.projectRoot, Number(event.fields.number));
    if (issue.ok) return { body: issue.value.body, comments: issue.value.comments };
    return { body: this.deps.store.event(event.id)?.context ?? null };
  }

  private linkSession(trigger: Trigger | null, event: TriggerEvent, sessionId: string): void {
    this.deps.store.addSession({ sessionId, triggerId: event.triggerId, eventId: event.id, triggerName: trigger?.name ?? '', kind: event.kind, ref: eventRef(event), url: event.url, at: this.now() });
  }

  /** Where the work on an event is now, for its state label. */
  private workState(event: TriggerEvent): TriggerWorkState | null {
    if (event.status === 'waiting' || event.status === 'queued') return 'waiting';
    if (event.status !== 'started' || !event.sessionId) return null;
    if (this.deps.sessionPr(event.sessionId)) return 'prOpen';
    const state = this.deps.sessionState(event.sessionId);
    if (state === 'waiting') return 'needsYou';
    if (state === 'working') return 'working';
    const outcome = this.outcomes.get(event.sessionId);
    return outcome === 'error' ? 'error' : outcome === 'stopped' ? 'stopped' : 'idle';
  }

  /** Keeps each issue's state label where its work is, for triggers with state labels on. */
  private async syncLabels(): Promise<void> {
    for (const trigger of this.deps.store.list()) {
      if (!trigger.stateLabels.on || trigger.source.kind !== 'issues') continue;
      const prOpen = stateLabelNames(trigger.stateLabels).prOpen.toLowerCase();
      for (const { event } of this.deps.store.eventsOf(trigger.id)) {
        // Once a pull request is open, the issue's work is done here; a label changed by hand stays.
        if (event.kind !== 'issue' || !event.label || event.label.toLowerCase() === prOpen) continue;
        const state = this.workState(event);
        if (state) await this.moveLabel(trigger, event, state);
      }
    }
  }

  /** Moves an issue's state label to `state`'s, when it is a change from the one Switchboard put there last. */
  private async moveLabel(trigger: Trigger, event: TriggerEvent, state: TriggerWorkState): Promise<void> {
    if (!trigger.stateLabels.on || event.kind !== 'issue' || !event.label) return;
    const key = nextStateLabel(state);
    if (!key) return;
    const next = stateLabelNames(trigger.stateLabels)[key];
    const args = stateLabelEdit(Number(event.fields.number), next, event.label);
    if (!args) return;
    if (await this.edit(trigger, event, args)) {
      this.deps.store.setLabel(event.id, next);
      this.deps.log('info', `Triggers: issue ${event.fields.number} is now “${next}”`);
    }
  }

  /**
   * Takes the state label off the issues whose work ended by hand, when it still says working or needs input (a pull
   * request open or a failure stays). With an assignee alone the issue would match again without it, so it is marked
   * `released`: it doesn't start again while it stays in the answer.
   */
  private async releaseLabels(): Promise<void> {
    const ids = [...this.releasing];
    this.releasing.clear();
    for (const id of ids) {
      const event = this.deps.store.event(id)?.event;
      const trigger = event ? this.deps.store.get(event.triggerId) : null;
      if (!event || !trigger || !event.label || !trigger.stateLabels.on || trigger.source.kind !== 'issues') continue;
      const names = stateLabelNames(trigger.stateLabels);
      if (![names.working, names.needsInput].some((name) => name.toLowerCase() === event.label!.toLowerCase())) continue;
      const args = stateLabelEdit(Number(event.fields.number), null, event.label);
      if (!args || !(await this.edit(trigger, event, args))) continue;
      this.deps.store.setLabel(event.id, null);
      if (!trigger.source.label) this.deps.store.setSeen(trigger.id, event.key, 'released');
      this.deps.log('info', `Triggers: took “${event.label}” off issue ${event.fields.number}; its work ended`);
    }
  }

  /**
   * Who has each issue a session works on: one assigned to someone else while its session works goes on, and its
   * header says who has it now. Issues no longer in the answer (assigned away from you) are read one by one.
   */
  private async followAssignees(trigger: Trigger, listed: readonly IssueItem[]): Promise<void> {
    const active = this.deps.store.eventsOf(trigger.id).map((s) => s.event).filter((e) => e.kind === 'issue' && e.status === 'started' && e.sessionId && this.deps.sessionState(e.sessionId));
    if (!active.length) return;
    const account = await this.account(trigger.projectRoot);
    const me = account.ok ? account.value.login : null;
    if (!me) return;
    for (const event of active) {
      const number = Number(event.fields.number);
      let assignees = listed.find((i) => i.number === number)?.assignees.map((a) => a.login) ?? null;
      if (!assignees) {
        const issue = await readIssue(this.reads_gh, trigger.projectRoot, number);
        if (!issue.ok) continue;
        assignees = issue.value.assignees;
      }
      const atPickUp = (event.fields.assignees ?? '').split(',').map((a) => a.trim()).filter(Boolean);
      const mine = assignees.some((a) => a.toLowerCase() === me.toLowerCase());
      const same = assignees.length === atPickUp.length && assignees.every((a) => atPickUp.includes(a));
      const now = assignees.length && !mine && !same ? assignees[0]! : null;
      if (now !== event.reassignedTo) this.deps.store.setReassigned(event.id, now);
    }
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
