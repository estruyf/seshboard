import { randomUUID } from 'node:crypto';
import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { DriverEvents } from '../provider.ts';
import { codexContext, codexItemId, codexItemMessages, codexTurnEnd } from './codexEvents.ts';
import type { ServerNotification, ThreadItem, Turn } from './protocol.ts';

type Loose = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** What `CodexLive` reports. */
export type CodexLiveEvents = Pick<DriverEvents, 'stream' | 'messages' | 'state' | 'usage' | 'model' | 'permissionDone'>;

export interface CodexLiveOptions {
  /** The card id of a request of Codex's, as the driver gives its cards (`codexCardId`): `String` of Codex's id when left out. */
  requestId?: (codexId: string | number) => string;
  /** The clock for kept notes' times. */
  now?: () => number;
}

/**
 * A card id for a request of Codex's. Codex numbers its requests from 0 in every app-server, and Seshboard keeps open
 * cards by id across sessions and profiles: the thread's id makes them unique.
 */
export const codexCardId = (threadId: string, codexId: string | number) => `${threadId}:${codexId}`;

/** Codex's plan steps' statuses as TodoWrite's. */
const TODO_STATUS: Record<string, string> = { pending: 'pending', inProgress: 'in_progress', completed: 'completed' };

/**
 * One running Codex thread's notifications as the events a Claude Code session reports: stream deltas while a reply or
 * a tool runs, complete messages as items finish (built as `codexMessages` builds them, with the same ids, so the live
 * transcript and the one read later agree), the turn's state, the context meter and the model.
 *
 * Messages go out in the order the items started, as the thread read back has them: an item that completes waits for
 * the ones started before it (tools that run side by side, a message you steer in while a tool runs), while the stream
 * shows what runs. Your own message goes as soon as it can, from its start (the driver sends it but doesn't report it);
 * every other item when it completes, with its result. A tool still running when its turn ends gets the result the
 * reader gives it then ("Interrupted"). Codex's plan steps (`turn/plan/updated`) and its warnings aren't in the thread Codex keeps, so they
 * go as notes Seshboard keeps (`keep`).
 */
export class CodexLive {
  /** The latest of each item while it runs, by Codex's item id (dropped once it completes, so a long session holds little). */
  private readonly items = new Map<string, Loose>();
  /** Each turn as `turn/started` had it, for its start time. */
  private readonly turns = new Map<string, Turn>();
  /** Each turn's items not reported yet, in the order they started; `item` is set once it can go (completed, or your prompt). */
  private readonly queues = new Map<string, Array<{ id: string; itemId: string; item: Loose | null }>>();
  /** This turn's items already reported (your prompt, from its start), so their completion doesn't report them again. */
  private readonly sent = new Set<string>();
  /** What items carry to later ones (spawned agents, for their reports), fed in the items' order. */
  private readonly context = codexContext();
  /** Reasoning items whose summary streams: their raw text, should Codex send it too, doesn't. */
  private readonly summaries = new Set<string>();
  private streaming = false;
  /** The last error Codex gave up on, for a turn that fails without one. */
  private lastError: string | null = null;

  private readonly now: () => number;
  private readonly requestId: (codexId: string | number) => string;
  /** Turns whose prompt went: a later message in the turn is one you steered in. */
  private readonly prompted = new Set<string>();

  constructor(
    readonly threadId: string,
    private readonly events: CodexLiveEvents,
    options: CodexLiveOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.requestId = options.requestId ?? String;
  }

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
        // Codex is done with it (answered, or dropped when the turn stopped): the card goes, if it's still there.
        if (typeof params.requestId === 'string' || typeof params.requestId === 'number') this.events.permissionDone(this.requestId(params.requestId));
        break;
      default:
        // `thread/compacted` is the `contextCompaction` item's too; output deltas have no place in a stream delta.
        break;
    }
  }

  private turnOf(turnId: string): Turn {
    return this.turns.get(turnId) ?? ({ id: turnId, items: [], itemsView: 'full', status: 'inProgress', error: null, startedAt: null, completedAt: null, durationMs: null } as Turn);
  }

  private queueOf(turnId: string): Array<{ id: string; itemId: string; item: Loose | null }> {
    let queue = this.queues.get(turnId);
    if (!queue) this.queues.set(turnId, (queue = []));
    return queue;
  }

  /** The turn's entry for an item, added at the end the first time it's seen. */
  private entry(turnId: string, itemId: string): { id: string; itemId: string; item: Loose | null } {
    const id = codexItemId(turnId, itemId);
    const queue = this.queueOf(turnId);
    let entry = queue.find((e) => e.id === id);
    if (!entry) queue.push((entry = { id, itemId, item: null }));
    return entry;
  }

  /** The messages of the items at the head of the turn's queue that can go, in order. */
  private take(turnId: string, turn: Turn): RawSessionMessage[] {
    const queue = this.queueOf(turnId);
    const out: RawSessionMessage[] = [];
    while (queue[0]?.item) {
      const { id, item } = queue.shift()!;
      this.sent.add(id);
      out.push(...codexItemMessages(turn, item, id, this.context));
    }
    return out;
  }

  private itemStarted(turnId: string, raw: Loose, startedAtMs: number | null): void {
    const itemId = str(raw.id);
    if (!turnId || !itemId) return;
    const id = codexItemId(turnId, itemId);
    if (this.sent.has(id)) return;
    // An item without times of its own gets the notification's, as Codex records them for the thread read back.
    const item = num(raw.startedAtMs) === null && num(raw.completedAtMs) === null && startedAtMs !== null ? { ...raw, startedAtMs } : raw;
    this.items.set(itemId, item);
    const entry = this.entry(turnId, itemId);
    if (item.type === 'userMessage') {
      entry.item = item;
      // A turn starts with your prompt, even when its item comes late (Codex starts its MCP servers first on a thread's
      // first turn): it goes before what started meanwhile. A later one is a message you steered in, in its place.
      if (!this.prompted.has(turnId)) {
        this.prompted.add(turnId);
        const queue = this.queueOf(turnId);
        queue.splice(queue.indexOf(entry), 1);
        queue.unshift(entry);
      }
      this.emit(this.take(turnId, this.turnOf(turnId)));
      return;
    }
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
    this.items.delete(itemId);
    if (this.sent.has(codexItemId(turnId, itemId))) return;
    const item = num(raw.startedAtMs) === null && num(raw.completedAtMs) === null ? { ...raw, startedAtMs: num(started?.startedAtMs), completedAtMs } : raw;
    const entry = this.entry(turnId, itemId);
    if (!entry.item) entry.item = item;
    this.emit(this.take(turnId, this.turnOf(turnId)));
  }

  private turnCompleted(raw: Turn): void {
    const turnId = str(raw.id);
    if (!turnId) return;
    const turn = { ...this.turnOf(turnId), ...raw, startedAt: num(raw.startedAt) ?? num(this.turnOf(turnId).startedAt) } as Turn;
    // Items the turn left running go as they are: the reader gives their tools their end now ("Interrupted").
    for (const entry of this.queueOf(turnId)) {
      entry.item ??= this.items.get(entry.itemId) ?? { id: entry.itemId };
      this.items.delete(entry.itemId);
    }
    const messages = [...this.take(turnId, turn), ...codexTurnEnd(turn)];
    this.clear();
    if (messages.length) this.events.messages(messages);
    this.turns.delete(turnId);
    this.queues.delete(turnId);
    this.prompted.delete(turnId);
    this.sent.clear();
    this.summaries.clear();
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
    const id = `${turnId || this.threadId}:todos:${randomUUID()}`;
    this.note(turnId, [
      { role: 'assistant', content: [{ type: 'tool_use', id, name: 'TodoWrite', input: { todos } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error: false, content: 'Updated the to-do list' }] },
    ]);
  }

  /**
   * Messages Codex's thread doesn't have, which Seshboard keeps and puts back by their time when the session is read.
   * Their ids are new each time: Seshboard keeps a note once per id, and a session runs here again after a restart.
   */
  private note(turnId: string, bodies: Array<{ role: 'user' | 'assistant' | 'system'; content: unknown[] }>): void {
    const timestamp = new Date(this.now()).toISOString();
    const note = randomUUID();
    const messages: RawSessionMessage[] = bodies.map((body, i) => ({
      type: body.role,
      uuid: `${turnId || this.threadId}:note:${note}:${i}`,
      message: body,
      parent_tool_use_id: null,
      timestamp,
    }));
    this.clear();
    this.events.messages(messages, { keep: true });
  }

  private emit(messages: RawSessionMessage[]): void {
    if (!messages.length) return;
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
