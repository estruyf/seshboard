import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents } from '../provider.ts';
import { codexItemId, codexItemMessages, codexTurnEnd, noteAgentStates, type AgentStates } from './codexEvents.ts';
import type { ServerNotification, ThreadItem, Turn } from './protocol.ts';

type Loose = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** What `CodexLive` reports. */
export type CodexLiveEvents = Pick<DriverEvents, 'stream' | 'messages' | 'state' | 'usage' | 'model' | 'permissionDone'>;

/** Codex's plan steps' statuses as TodoWrite's. */
const TODO_STATUS: Record<string, string> = { pending: 'pending', inProgress: 'in_progress', completed: 'completed' };

/**
 * One running Codex thread's notifications as the events a Claude Code session reports: stream deltas while a reply or
 * a tool runs, complete messages as items finish (built as `codexMessages` builds them, with the same ids, so the live
 * transcript and the one read later agree), the turn's state, the context meter and the model.
 *
 * Your own message is reported when its item starts (the driver sends it but doesn't report it), every other item when
 * it completes, with its result. A tool still running when its turn ends gets the result the reader gives it then
 * ("Interrupted"). Codex's plan steps (`turn/plan/updated`) and its warnings aren't in the thread Codex keeps, so they
 * go as notes Seshboard keeps (`keep`).
 */
export class CodexLive {
  /** The latest of each item while it runs, by Codex's item id (dropped once it completes, so a long session holds little). */
  private readonly items = new Map<string, Loose>();
  /** Each turn as `turn/started` had it, for its start time. */
  private readonly turns = new Map<string, Turn>();
  /** Items started and not completed, by their message id. */
  private readonly running = new Map<string, { turnId: string; itemId: string }>();
  /** Messages already reported (your prompt, when it started). */
  private readonly sent = new Set<string>();
  private readonly agentStates: AgentStates = new Map();
  /** Reasoning items whose summary streams: their raw text, should Codex send it too, doesn't. */
  private readonly summaries = new Set<string>();
  private streaming = false;
  /** The last error Codex gave up on, for a turn that fails without one. */
  private lastError: string | null = null;
  private notes = 0;

  constructor(
    readonly threadId: string,
    private readonly events: CodexLiveEvents,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * The latest of a running item Codex reported (`item/started`, a patch update), for a permission card: a file
   * change's approval request has no diff, and a command's may have its command only on the item. Null once it completed.
   */
  item(itemId: string): ThreadItem | null {
    return (this.items.get(itemId) as ThreadItem | undefined) ?? null;
  }

  /** One notification Codex sent; those about other threads are ignored. Never throws: a broken Codex can't stop the session. */
  handle(notification: ServerNotification): void {
    try {
      this.dispatch(str(obj(notification).method) ?? '', obj(obj(notification).params));
    } catch {
      // Data of a shape not handled: the read transcript shows it when the session is read again.
    }
  }

  private dispatch(method: string, params: Loose): void {
    if (str(params.threadId) !== this.threadId) return;
    const turnId = str(params.turnId) ?? '';
    const itemId = str(params.itemId) ?? '';
    switch (method) {
      case 'turn/started': {
        const turn = obj(params.turn) as unknown as Turn;
        if (str(turn.id)) this.turns.set(turn.id, turn);
        this.lastError = null;
        this.events.state('running');
        break;
      }
      case 'turn/completed':
        this.turnCompleted(obj(params.turn) as unknown as Turn);
        break;
      case 'item/started':
        this.itemStarted(turnId, obj(params.item), num(params.startedAtMs));
        break;
      case 'item/completed':
        this.itemCompleted(turnId, obj(params.item), num(params.completedAtMs));
        break;
      case 'item/fileChange/patchUpdated': {
        const item = this.items.get(itemId);
        if (item && Array.isArray(params.changes)) this.items.set(itemId, { ...item, changes: params.changes });
        break;
      }
      case 'item/agentMessage/delta':
      case 'item/plan/delta':
        this.delta('text', params.delta);
        break;
      case 'item/reasoning/summaryTextDelta':
        this.summaries.add(itemId);
        this.delta('thinking', params.delta);
        break;
      case 'item/reasoning/summaryPartAdded':
        // The reader joins summary parts with a blank line.
        if ((num(params.summaryIndex) ?? 0) > 0) this.delta('thinking', '\n\n');
        break;
      case 'item/reasoning/textDelta':
        if (!this.summaries.has(itemId)) this.delta('thinking', params.delta);
        break;
      case 'thread/tokenUsage/updated': {
        // Codex counts the context as the last request's tokens (`last`), of the model's window.
        const usage = obj(params.tokenUsage);
        const tokens = num(obj(usage.last).totalTokens);
        const max = num(usage.modelContextWindow);
        if (tokens !== null && max !== null && max > 0) this.events.usage({ contextTokens: tokens, contextMax: max });
        break;
      }
      case 'model/rerouted': {
        const model = str(params.toModel);
        if (model) this.events.model(model);
        break;
      }
      case 'error': {
        // An error Codex retries isn't the turn's end; one it gives up on is, with `turn/completed` after it.
        const message = str(obj(params.error).message);
        if (params.willRetry !== true && message) this.lastError = message;
        break;
      }
      case 'warning': {
        const message = str(params.message)?.trim();
        if (message) this.note(turnId, [{ role: 'system', content: [{ type: 'text', text: message }] }]);
        break;
      }
      case 'turn/plan/updated':
        this.planUpdated(turnId, params.plan);
        break;
      case 'serverRequest/resolved':
        // Answered here, or dropped by Codex (the turn was stopped): the card goes.
        if (typeof params.requestId === 'string' || typeof params.requestId === 'number') this.events.permissionDone(String(params.requestId));
        break;
      default:
        // `thread/compacted` is the `contextCompaction` item's too; output deltas have no place in a stream delta.
        break;
    }
  }

  private turnOf(turnId: string): Turn {
    return this.turns.get(turnId) ?? ({ id: turnId, items: [], itemsView: 'full', status: 'inProgress', error: null, startedAt: null, completedAt: null, durationMs: null } as Turn);
  }

  private itemStarted(turnId: string, raw: Loose, startedAtMs: number | null): void {
    const itemId = str(raw.id);
    if (!turnId || !itemId) return;
    // An item without times of its own gets the notification's, as Codex records them for the thread read back.
    const item = num(raw.startedAtMs) === null && num(raw.completedAtMs) === null && startedAtMs !== null ? { ...raw, startedAtMs } : raw;
    this.items.set(itemId, item);
    const id = codexItemId(turnId, itemId);
    if (item.type === 'userMessage') {
      const messages = codexItemMessages(this.turnOf(turnId), item, id);
      this.sent.add(id);
      if (messages.length) this.emit(messages);
      return;
    }
    this.running.set(id, { turnId, itemId });
    if (item.type === 'plan') return;
    // A tool's name shows while it runs, as Claude Code's do.
    const tool = codexItemMessages(this.turnOf(turnId), item, id)
      .flatMap((m) => (Array.isArray(obj(m.message).content) ? (obj(m.message).content as unknown[]) : []))
      .map(obj)
      .find((b) => b.type === 'tool_use');
    // A file change starts before its changes are known: it's an edit all the same.
    this.delta('tool', str(tool?.name) ?? (item.type === 'fileChange' ? 'Edit' : null));
  }

  private itemCompleted(turnId: string, raw: Loose, completedAtMs: number | null): void {
    const itemId = str(raw.id);
    if (!turnId || !itemId) return;
    const started = this.items.get(itemId);
    let item = raw;
    if (num(raw.startedAtMs) === null && num(raw.completedAtMs) === null) {
      item = { ...raw, startedAtMs: num(started?.startedAtMs), completedAtMs };
    }
    this.items.delete(itemId);
    noteAgentStates(item, this.agentStates);
    const id = codexItemId(turnId, itemId);
    this.running.delete(id);
    if (this.sent.has(id)) return;
    this.sent.add(id);
    const messages = codexItemMessages(this.turnOf(turnId), item, id, this.agentStates);
    if (messages.length) this.emit(messages);
  }

  private turnCompleted(raw: Turn): void {
    const turnId = str(raw.id);
    if (!turnId) return;
    const turn = { ...this.turnOf(turnId), ...raw, startedAt: num(raw.startedAt) ?? num(this.turnOf(turnId).startedAt) } as Turn;
    // Tools the turn left running: the reader gives them their end now ("Interrupted"), and so does this.
    const left: RawSessionMessage[] = [];
    for (const [id, open] of this.running) {
      if (open.turnId !== turnId) continue;
      this.running.delete(id);
      this.sent.add(id);
      left.push(...codexItemMessages(turn, this.items.get(open.itemId) ?? {}, id, this.agentStates));
      this.items.delete(open.itemId);
    }
    const end = codexTurnEnd(turn);
    this.clear();
    if (left.length || end.length) this.events.messages([...left, ...end]);
    this.turns.delete(turnId);
    for (const id of this.sent) if (id.startsWith(`${turnId}:`)) this.sent.delete(id);
    if (turn.status === 'failed') this.events.state('error', str(obj(turn.error).message) ?? this.lastError ?? 'Codex stopped with an error');
    else this.events.state('idle');
    this.lastError = null;
  }

  /** Codex's plan steps as Claude Code's to-do list, kept by Seshboard since Codex's thread doesn't have them. */
  private planUpdated(turnId: string, plan: unknown): void {
    if (!Array.isArray(plan)) return;
    const todos = plan.map(obj).flatMap((step) => {
      const content = str(step.step);
      return content ? [{ content, status: TODO_STATUS[str(step.status) ?? ''] ?? 'pending' }] : [];
    });
    if (!todos.length) return;
    const n = this.notes++;
    const id = `${turnId || this.threadId}:todos:${n}`;
    this.note(turnId, [
      { role: 'assistant', content: [{ type: 'tool_use', id, name: 'TodoWrite', input: { todos } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: 'Updated the to-do list' }] },
    ]);
  }

  /** Messages Codex's thread doesn't have, which Seshboard keeps and puts back where they were when the session is read. */
  private note(turnId: string, bodies: Array<{ role: 'user' | 'assistant' | 'system'; content: unknown[] }>): void {
    const timestamp = new Date(this.now()).toISOString();
    const n = this.notes++;
    const messages: RawSessionMessage[] = bodies.map((body, i) => ({
      type: body.role,
      uuid: `${turnId || this.threadId}:note:${n}:${i}`,
      message: body,
      parent_tool_use_id: null,
      timestamp,
    }));
    this.clear();
    this.events.messages(messages, { keep: true });
  }

  private emit(messages: RawSessionMessage[]): void {
    // The complete message takes the place of what streamed.
    this.clear();
    this.events.messages(messages);
  }

  private delta(kind: 'text' | 'thinking' | 'tool', text: unknown): void {
    if (typeof text !== 'string' || !text) return;
    this.streaming = true;
    this.events.stream({ kind, text });
  }

  private clear(): void {
    if (!this.streaming) return;
    this.streaming = false;
    this.events.stream({ kind: 'clear', text: '' });
  }
}
