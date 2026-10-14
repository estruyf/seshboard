import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { CatchUp, reviewMinutes, type GitChanges, type LogLevel, type PermissionRequest } from '@switchboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';
import type { CatchUpStore } from './catchUpStore.ts';
import { fallbackSummary, waitingNeed, type Summary } from './fallback.ts';
import { signalsOf, type Exists } from './signals.ts';
import { parseSummary, summaryInput } from './summary.ts';
import { lastTurn, mergeMessages, oneLine, promptText, ASK_MAX, type Turn } from './turn.ts';

export interface CatchUpServiceOptions {
  store: CatchUpStore;
  /** The session's transcript as Claude Code has written it so far. */
  transcript(sessionId: string): Promise<RawSessionMessage[]>;
  /** The folder the session works in (a worktree's own folder). */
  cwd(sessionId: string): string | null;
  profileOf(sessionId: string): string;
  /** The checkout's uncommitted changes; null outside git. */
  changes(cwd: string): Promise<GitChanges | null>;
  /** Asks Haiku for the summary; null when it gave nothing in time. */
  summarize(profileId: string, sessionId: string, input: string): Promise<string | null>;
  /** Settings › Conversation: "Write catch-up summaries with Haiku". Off, the fallback always writes the card. */
  useModel(): boolean;
  emit(sessionId: string, catchUp: CatchUp | null): void;
  log(level: LogLevel, message: string): void;
}

/** Whether a path is in the checkout (or the session's folder outside git). */
const existsIn = (root: string | null): Exists | undefined => (root ? (relative) => existsSync(join(root, relative)) : undefined);

/** How a turn ended: finished, or stopped with an error (with Claude Code's message). */
export interface TurnOutcome {
  ok: boolean;
  error: string | null;
}

/** The most live messages kept per session between two prompts (a long turn); the transcript has the rest. */
const LIVE_LIMIT = 3_000;

/**
 * Makes, keeps and clears the catch-up cards. A card is made when a turn ends (finished, or stopped with an error) and
 * while a session waits for a permission or an answer; your next message clears it, and so does Claude going back to
 * work. Working sessions have no card. The turn's messages come live from the sessions this app runs (ahead of the
 * file), merged with the transcript for earlier prompts and the plan.
 */
export class CatchUpService {
  /** Each session's messages since its last prompt, as they came live. */
  private readonly live = new Map<string, RawSessionMessage[]>();
  /** Bumped on every change of a session's state, so a card made for an older state is dropped. */
  private readonly generation = new Map<string, number>();
  /** Sessions you stopped: their turn's end needs no briefing. */
  private readonly interrupted = new Set<string>();
  /** Open requests per session, oldest first. */
  private readonly waiting = new Map<string, PermissionRequest[]>();

  constructor(private readonly options: CatchUpServiceOptions) {}

  get(sessionId: string): CatchUp | null {
    return this.options.store.get(sessionId);
  }

  list(): CatchUp[] {
    return this.options.store.all();
  }

  /** Messages straight from a session this app runs: a prompt of yours starts a new piece of work. */
  messages(sessionId: string, raw: readonly RawSessionMessage[]): void {
    for (const message of raw) {
      if (message.parent_tool_use_id !== null) continue;
      if (promptText(message) !== null) {
        this.started(sessionId);
        this.live.set(sessionId, [message]);
        continue;
      }
      const kept = this.live.get(sessionId) ?? [];
      kept.push(message);
      if (kept.length > LIVE_LIMIT) kept.splice(1, kept.length - LIVE_LIMIT);
      this.live.set(sessionId, kept);
    }
  }

  /** A new message or turn started: the card goes (working sessions have none). */
  started(sessionId: string): void {
    this.bump(sessionId);
    this.interrupted.delete(sessionId);
    this.waiting.delete(sessionId);
    this.clear(sessionId);
  }

  /** You stopped Claude: the end of this turn is yours, not news. */
  interrupt(sessionId: string): void {
    this.interrupted.add(sessionId);
  }

  /** A turn ended. Makes its card, unless you stopped it. */
  async turnEnded(sessionId: string, outcome: TurnOutcome): Promise<CatchUp | null> {
    this.waiting.delete(sessionId);
    if (this.interrupted.delete(sessionId)) {
      this.bump(sessionId);
      this.clear(sessionId);
      return null;
    }
    return this.build(sessionId, outcome.ok ? { state: 'finished', error: null } : { state: 'error', error: outcome.error });
  }

  /** The session waits for you: a card about the request, the oldest one first. */
  async permission(request: PermissionRequest): Promise<CatchUp | null> {
    const list = this.waiting.get(request.sessionId) ?? [];
    if (!list.some((r) => r.requestId === request.requestId)) list.push(request);
    this.waiting.set(request.sessionId, list);
    return this.buildWaiting(request.sessionId);
  }

  /** A request was answered: the next one gets the card, or Claude is working again and the card goes. */
  async permissionResolved(requestId: string, sessionId: string): Promise<CatchUp | null> {
    const list = (this.waiting.get(sessionId) ?? []).filter((r) => r.requestId !== requestId);
    if (list.length) {
      this.waiting.set(sessionId, list);
      return this.buildWaiting(sessionId);
    }
    this.waiting.delete(sessionId);
    if (this.options.store.get(sessionId)?.state === 'waiting') {
      this.bump(sessionId);
      this.clear(sessionId);
    }
    return null;
  }

  /** The session's process ended: what came live is in the transcript now. */
  closed(sessionId: string): void {
    this.live.delete(sessionId);
    this.waiting.delete(sessionId);
  }

  /** The session was deleted. */
  forget(sessionId: string): void {
    this.bump(sessionId);
    this.closed(sessionId);
    this.clear(sessionId);
  }

  /**
   * Makes the card for the session's last turn now (`catchup.build`). Null when it has no finished turn, or something
   * newer happened while it was being made.
   */
  async build(sessionId: string, outcome: { state: 'finished' | 'error'; error: string | null } = { state: 'finished', error: null }): Promise<CatchUp | null> {
    const generation = this.bump(sessionId);
    const turn = lastTurn(await this.messagesOf(sessionId));
    if (!turn) return null;
    const cwd = this.options.cwd(sessionId);
    const changes = cwd ? await this.options.changes(cwd).catch(() => null) : null;
    const exists = existsIn(changes?.root ?? cwd);
    let signals = signalsOf(turn, changes, cwd, false, exists);
    let summary: Summary = fallbackSummary(turn, signals, outcome);
    let source: CatchUp['source'] = 'fallback';
    if (this.options.useModel()) {
      const text = await this.options.summarize(this.options.profileOf(sessionId), sessionId, summaryInput(turn, signals)).catch(() => null);
      const parsed = text === null ? null : parseSummary(text, { signals, state: outcome.state, error: outcome.error });
      if (parsed) {
        summary = parsed;
        source = 'model';
        if (parsed.planDeviated) signals = signalsOf(turn, changes, cwd, true, exists);
      } else if (text !== null) this.options.log('debug', `Catch-up summary for ${sessionId} wasn't usable; using the tool calls instead`);
    }
    const card = this.card(sessionId, turn, {
      turnId: turn.id,
      source,
      state: outcome.state,
      summary,
      signals,
      minutes: reviewMinutes({ waiting: false, diff: signals.diff, testsFailed: signals.tests.state === 'failed', outOfScope: signals.outOfScope.length }),
    });
    return this.publish(sessionId, generation, card);
  }

  private async buildWaiting(sessionId: string): Promise<CatchUp | null> {
    const request = this.waiting.get(sessionId)?.[0];
    if (!request) return null;
    const generation = this.bump(sessionId);
    const messages = await this.messagesOf(sessionId);
    // The request comes from a tool call in the turn, so the turn usually has an answer from Claude already.
    const turn: Turn = lastTurn(messages) ?? { id: request.requestId, ask: oneLine(messages.map(promptText).filter((t) => t !== null).at(-1) ?? '', ASK_MAX), finalText: '', tools: [], plan: null };
    const cwd = this.options.cwd(sessionId);
    const changes = cwd ? await this.options.changes(cwd).catch(() => null) : null;
    const signals = signalsOf(turn, changes, cwd, false, existsIn(changes?.root ?? cwd));
    const lines = fallbackSummary(turn, signals, { state: 'finished', error: null });
    const card = this.card(sessionId, turn, {
      // Each request is its own moment: one you collapsed doesn't hide the next.
      turnId: `${turn.id}:${request.requestId}`,
      source: 'fallback',
      state: 'waiting',
      summary: { did: lines.did, skipped: lines.skipped, need: waitingNeed(request) },
      signals,
      minutes: reviewMinutes({ waiting: true, diff: signals.diff, testsFailed: false, outOfScope: 0 }),
    });
    return this.publish(sessionId, generation, card);
  }

  private card(sessionId: string, turn: Turn, parts: { turnId: string; source: CatchUp['source']; state: CatchUp['state']; summary: Summary; signals: CatchUp['signals']; minutes: number }): CatchUp | null {
    const parsed = CatchUp.safeParse({
      sessionId,
      turnId: parts.turnId,
      generatedAt: Date.now(),
      source: parts.source,
      state: parts.state,
      ask: turn.ask,
      did: parts.summary.did,
      skipped: parts.summary.skipped,
      need: parts.summary.need,
      signals: { ...parts.signals, outOfScope: parts.signals.outOfScope.slice(0, 200) },
      reviewMinutes: parts.minutes,
    });
    if (!parsed.success) {
      this.options.log('warn', `Catch-up for ${sessionId} was not made: ${parsed.error.message}`);
      return null;
    }
    return parsed.data;
  }

  /** Keeps and sends the card, unless the session moved on while it was being made. */
  private publish(sessionId: string, generation: number, card: CatchUp | null): CatchUp | null {
    if (!card || this.generation.get(sessionId) !== generation) return null;
    this.options.store.save(card);
    this.options.emit(sessionId, card);
    return card;
  }

  private async messagesOf(sessionId: string): Promise<RawSessionMessage[]> {
    const file = await this.options.transcript(sessionId).catch(() => [] as RawSessionMessage[]);
    return mergeMessages(file, this.live.get(sessionId) ?? []);
  }

  private bump(sessionId: string): number {
    const next = (this.generation.get(sessionId) ?? 0) + 1;
    this.generation.set(sessionId, next);
    return next;
  }

  private clear(sessionId: string): void {
    if (this.options.store.clear(sessionId)) this.options.emit(sessionId, null);
  }
}
