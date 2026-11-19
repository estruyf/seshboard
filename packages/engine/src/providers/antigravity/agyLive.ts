import type { RawSessionMessage } from '../../claude/transcript.ts';
import type { AcpContentBlock } from '../acp/acpTypes.ts';
import type { DriverEvents } from '../provider.ts';
import { AGY_ID_JOIN, agyMessages, agyToolCard } from './agyEvents.ts';
import { currentValue } from './agyModes.ts';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** What `AgyLive` reports. */
export type AgyLiveEvents = Pick<DriverEvents, 'stream' | 'messages' | 'usage' | 'model'> & {
  /** Antigravity named the session (`session_info_update`). */
  title?(title: string): void;
};

/**
 * One running Antigravity session's updates as the events a Claude Code session reports: the reply, thoughts and the
 * tool that runs as stream deltas, and complete messages built by the reader's own converter (`agyMessages`) over this
 * run's updates, so the live transcript and a read later have the same messages with the same ids. A message goes once
 * it can't change any more: a thought or a reply when something comes after it, a tool call with its result, your
 * prompt at once; the rest when the turn ends. Messages go in order, so one waits for the ones before it.
 */
export class AgyLive {
  /** This run's updates since the last turn that ended, with your prompts in their place. */
  private updates: unknown[] = [];
  /** The prompts before `updates` (the conversation's, then those of turns that ended here). */
  private promptsBefore: number;
  /** When each prompt in `updates` went, for its messages' times. */
  private times: number[] = [];
  /** The messages already reported, by id. */
  private readonly sent = new Set<string>();
  private streaming = false;

  constructor(
    readonly sessionId: string,
    private readonly events: AgyLiveEvents,
    prompts: number,
    private readonly now: () => number = Date.now,
  ) {
    this.promptsBefore = prompts;
  }

  /** How many prompts the session has had: the next one you send is this plus one. */
  prompts(): number {
    return this.promptsBefore + this.updates.filter((u) => obj(u).sessionUpdate === 'user_message_chunk' && obj(obj(u).content).type === 'text').length;
  }

  /** Your message, as the replay will have it: its text, then a chunk per file and image. Returns its number. */
  prompted(blocks: readonly AcpContentBlock[]): number {
    this.times.push(this.now());
    for (const content of blocks) this.updates.push({ sessionUpdate: 'user_message_chunk', content });
    this.flush(false);
    return this.prompts();
  }

  /** One `session/update` of Antigravity's. Never throws: a broken update can't stop the session. */
  handle(update: unknown): void {
    try {
      this.dispatch(obj(update));
    } catch {
      // An update of a shape not handled: the read transcript shows it when the session is read again.
    }
  }

  /** The turn ended (every prompt under way answered): what is left goes, and the next turn starts its own list. */
  turnEnded(): void {
    this.flush(true);
    this.clear();
    this.promptsBefore = this.prompts();
    this.updates = [];
    this.times = [];
    this.sent.clear();
  }

  private dispatch(update: Record<string, unknown>): void {
    // Messages are built from a prompt sent here on: what comes before one (the end of a turn that ended) only streams.
    const building = this.times.length > 0;
    switch (str(update.sessionUpdate)) {
      case 'agent_message_chunk':
      case 'agent_thought_chunk': {
        const text = str(obj(update.content).text);
        if (!text) return;
        if (building) {
          this.updates.push(update);
          this.flush(false);
        }
        this.streaming = true;
        this.events.stream({ kind: update.sessionUpdate === 'agent_thought_chunk' ? 'thinking' : 'text', text });
        return;
      }
      case 'tool_call': {
        if (building) {
          this.updates.push(update);
          this.flush(false);
        }
        // A tool's name shows while it runs, as Claude Code's do.
        this.streaming = true;
        this.events.stream({ kind: 'tool', text: agyToolCard(update as never).toolName });
        return;
      }
      case 'tool_call_update':
        if (!building) return;
        this.updates.push(update);
        this.flush(false);
        return;
      case 'usage_update': {
        const used = num(update.used);
        const size = num(update.size);
        if (used !== null && size !== null && size > 0) this.events.usage({ contextTokens: used, contextMax: size });
        return;
      }
      case 'session_info_update': {
        const title = str(update.title)?.trim();
        if (title) this.events.title?.(title);
        return;
      }
      case 'config_option_update': {
        const model = currentValue(update.configOptions, 'model');
        if (model) this.events.model(model);
        return;
      }
      default:
        return;
    }
  }

  /** Reports the messages that can't change any more, in order; all of them when the turn ended. */
  private flush(ended: boolean): void {
    const messages = agyMessages(this.sessionId, this.updates, { prompts: this.times, fallback: this.now() }, this.promptsBefore);
    const ids = new Set(messages.map((m) => m.uuid));
    const out: RawSessionMessage[] = [];
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i]!;
      if (this.sent.has(message.uuid)) continue;
      if (!ended && !this.done(message, i === messages.length - 1, ids)) break;
      this.sent.add(message.uuid);
      out.push(message);
    }
    if (!out.length) return;
    // The complete message takes the place of what streamed.
    this.clear();
    this.events.messages(out);
  }

  /** Whether a message is complete before its turn ends. */
  private done(message: RawSessionMessage, last: boolean, ids: ReadonlySet<string>): boolean {
    if (message.type === 'user') return true;
    const block = obj((obj(message.message).content as unknown[] | undefined)?.[0]);
    // A tool call waits for its result; a thought or a reply for what comes after it.
    if (block.type === 'tool_use') return ids.has(`${message.uuid}${AGY_ID_JOIN}result`);
    return !last;
  }

  private clear(): void {
    if (!this.streaming) return;
    this.streaming = false;
    this.events.stream({ kind: 'clear', text: '' });
  }
}
