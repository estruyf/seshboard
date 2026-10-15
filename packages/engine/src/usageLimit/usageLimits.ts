import { RpcError, type LimitResume, type LimitsState, type LogLevel, type ResumeAtLimit, type UsageLimitHit } from '@switchboard/protocol';
import type { LimitStore } from './limitStore.ts';
import { MAX_RESUME_ATTEMPTS, resumeTime, type LimitStop } from './usageLimit.ts';

/** A resume that was due while the app was closed goes this long after the engine starts, once sessions are known. */
const STARTUP_DELAY_MS = 5_000;
/** `setTimeout` can't wait longer than about 24 days; a later resume waits in steps. */
const MAX_TIMER_MS = 2 ** 31 - 1;
/** A limit without a reset time is forgotten after a week (the longest plan window) when the app starts. */
const UNTIMED_LIMIT_MS = 7 * 24 * 60 * 60_000;

export interface UsageLimitsDeps {
  store: LimitStore;
  /** Sends `RESUME_PROMPT` to a session, starting its process when it isn't running. */
  resume(sessionId: string): Promise<void>;
  /** The Claude profile a session runs with. */
  profileOf(sessionId: string): string;
  /** When /usage says this kind of limit resets, for a stop that came without a time. */
  fallbackReset?(profileId: string, kind: string | null): number | null;
  /** Settings › Conversation › Resume after a usage limit resets. */
  mode(): ResumeAtLimit;
  onChange(state: LimitsState): void;
  /** A profile hit or left its limit: its sessions report it, and their queues move on once it is cleared. */
  onLimitChanged(profileId: string): void;
  /** An armed session was sent its message after the reset. */
  onResumed(sessionId: string): void;
  log(level: LogLevel, message: string): void;
  now?: () => number;
}

/**
 * Plan usage limits per Claude profile, and the sessions that resume by themselves when one resets. A limit is set when
 * a turn stops on it and cleared when a turn in the same profile gets through; while it is set, the profile's queues
 * wait. An armed session is sent `RESUME_PROMPT` a grace period after the reset; if the limit refuses again (the reset
 * moved), it waits for the new reset, `MAX_RESUME_ATTEMPTS` times in all, then gives up and says so.
 */
export class UsageLimits {
  private readonly limits = new Map<string, UsageLimitHit>();
  private readonly resumes = new Map<string, LimitResume>();
  /** Sessions whose resume gave up; the notice says so until the session moves on. */
  private readonly gaveUp = new Set<string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;
  /** When this engine started: a resume due before then was missed while the app was closed. */
  private readonly startedAt: number;

  constructor(private readonly deps: UsageLimitsDeps) {
    const now = this.now();
    this.startedAt = now;
    for (const limit of deps.store.limits()) {
      // Past its reset, or too old to know: a turn will tell again if it still holds.
      const stale = limit.resetsAt !== null ? limit.resetsAt < now : now - limit.since > UNTIMED_LIMIT_MS;
      if (stale) deps.store.deleteLimit(limit.profileId);
      else this.limits.set(limit.profileId, limit);
    }
    for (const resume of deps.store.resumes()) this.resumes.set(resume.sessionId, resume);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /** Starts the timers of the resumes kept from before; one that was due while the app was closed goes shortly. */
  start(): void {
    this.started = true;
    for (const resume of this.resumes.values()) this.schedule(resume);
  }

  close(): void {
    this.started = false;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  /** The limit a profile is at, or null. */
  of(profileId: string): UsageLimitHit | null {
    return this.limits.get(profileId) ?? null;
  }

  state(): LimitsState {
    return { limits: [...this.limits.values()], resumes: [...this.resumes.values()], gaveUp: [...this.gaveUp] };
  }

  /** A usage limit stopped a session's turn. */
  hit(profileId: string, sessionId: string, stop: LimitStop): void {
    const before = this.limits.get(profileId);
    const resetsAt = stop.resetsAt ?? this.deps.fallbackReset?.(profileId, stop.kind) ?? before?.resetsAt ?? null;
    const limit: UsageLimitHit = {
      profileId,
      kind: stop.kind ?? before?.kind ?? null,
      resetsAt,
      since: before?.since ?? this.now(),
      message: stop.message ?? before?.message ?? null,
      sessionIds: [...new Set([...(before?.sessionIds ?? []), sessionId])],
    };
    this.limits.set(profileId, limit);
    this.deps.store.saveLimit(limit);
    this.gaveUp.delete(sessionId);
    const armed = this.resumes.get(sessionId);
    const at = resumeTime(resetsAt);
    if (armed) {
      // Its resume was refused (the reset moved), or it was armed before this stop: wait for the reset as it is now.
      if (armed.attempts >= MAX_RESUME_ATTEMPTS || at === null) this.giveUp(sessionId);
      else this.setResume({ ...armed, profileId, at });
    } else if (this.deps.mode() === 'always' && at !== null) {
      this.setResume({ sessionId, profileId, at, attempts: 0 });
    }
    this.emit();
    this.deps.onLimitChanged(profileId);
  }

  /** A turn got through: the profile is no longer at a limit, and a session that was waiting to resume has. */
  ok(profileId: string, sessionId: string): void {
    let changed = this.dropResume(sessionId);
    changed = this.gaveUp.delete(sessionId) || changed;
    const cleared = this.limits.delete(profileId);
    if (cleared) this.deps.store.deleteLimit(profileId);
    if (changed || cleared) this.emit();
    if (cleared) this.deps.onLimitChanged(profileId);
  }

  /** Resume when it resets, on or off. Needs a reset time: without one there is nothing to wait for. */
  arm(sessionId: string, armed: boolean): void {
    if (!armed) {
      if (this.dropResume(sessionId)) this.emit();
      return;
    }
    const profileId = this.deps.profileOf(sessionId);
    const at = resumeTime(this.limits.get(profileId)?.resetsAt ?? null);
    if (at === null) throw new RpcError('NO_RESET_TIME', 'Claude Code didn’t say when this limit resets. Use Resume now later.');
    this.gaveUp.delete(sessionId);
    this.setResume({ sessionId, profileId, at, attempts: 0 });
    this.emit();
  }

  /**
   * Resume now: the session gets its message at once. The limit stays until a turn gets through, so the profile's
   * queues wait for this one; if it is refused, the session is at the limit again.
   */
  async resumeNow(sessionId: string): Promise<void> {
    this.dropResume(sessionId);
    this.gaveUp.delete(sessionId);
    this.leave(sessionId);
    this.emit();
    await this.deps.resume(sessionId);
  }

  /** The session moved to the Trash: nothing to resume. */
  forget(sessionId: string): void {
    let changed = this.dropResume(sessionId);
    changed = this.gaveUp.delete(sessionId) || changed;
    changed = this.leave(sessionId) || changed;
    if (changed) this.emit();
  }

  /** Takes a session off its profile's list of stopped sessions (it is being resumed); the limit itself stays. */
  private leave(sessionId: string): boolean {
    for (const limit of this.limits.values()) {
      if (!limit.sessionIds.includes(sessionId)) continue;
      const next = { ...limit, sessionIds: limit.sessionIds.filter((id) => id !== sessionId) };
      this.limits.set(limit.profileId, next);
      this.deps.store.saveLimit(next);
      return true;
    }
    return false;
  }

  private setResume(resume: LimitResume): void {
    this.resumes.set(resume.sessionId, resume);
    this.deps.store.saveResume(resume);
    this.schedule(resume);
  }

  private dropResume(sessionId: string): boolean {
    clearTimeout(this.timers.get(sessionId));
    this.timers.delete(sessionId);
    if (!this.resumes.delete(sessionId)) return false;
    this.deps.store.deleteResume(sessionId);
    return true;
  }

  private giveUp(sessionId: string): void {
    this.dropResume(sessionId);
    this.gaveUp.add(sessionId);
    this.deps.log('info', `Session ${sessionId} stopped trying to resume after the usage limit`);
  }

  private schedule(resume: LimitResume): void {
    clearTimeout(this.timers.get(resume.sessionId));
    this.timers.delete(resume.sessionId);
    if (!this.started) return;
    const due = Math.max(resume.at - this.now(), 0);
    // Due before the app started: wait a moment, until the engine knows its sessions.
    const delay = Math.min(resume.at <= this.startedAt ? Math.max(due, STARTUP_DELAY_MS) : due, MAX_TIMER_MS);
    const timer = setTimeout(() => {
      this.timers.delete(resume.sessionId);
      // A long wait in steps: not there yet.
      if (this.now() < resume.at) this.schedule(resume);
      else void this.fire(resume.sessionId);
    }, delay);
    timer.unref?.();
    this.timers.set(resume.sessionId, timer);
  }

  private async fire(sessionId: string): Promise<void> {
    const resume = this.resumes.get(sessionId);
    if (!resume) return;
    // It stays armed (with one more try counted) until its turn gets through or is refused again.
    const next = { ...resume, attempts: resume.attempts + 1 };
    this.resumes.set(sessionId, next);
    this.deps.store.saveResume(next);
    this.leave(sessionId);
    this.emit();
    try {
      await this.deps.resume(sessionId);
      this.deps.onResumed(sessionId);
    } catch (error) {
      this.deps.log('warn', `Couldn't resume session ${sessionId} after the usage limit: ${(error as Error).message}`);
      this.giveUp(sessionId);
      this.emit();
    }
  }

  private emit(): void {
    this.deps.onChange(this.state());
  }
}
