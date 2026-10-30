import type { DriverEvents } from '../provider.ts';
import { claudeTool, CopilotConverter, isHiddenTool, type CopilotEvent } from './copilotEvents.ts';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/**
 * Translates the events of a Copilot session running here into what a Claude Code session reports (`DriverEvents`):
 * streamed text, thinking and tool names while a reply is written, the complete messages once it is, and when a turn
 * starts, ends or fails. The complete messages come from the same converter as a session read from disk, so the live
 * transcript and the file agree.
 */
export class CopilotLive {
  private readonly converter = new CopilotConverter();
  private streaming = false;
  /** Premium requests this session has used while it ran here. */
  private spent = 0;

  constructor(private readonly events: Pick<DriverEvents, 'stream' | 'messages' | 'state' | 'usage'>) {}

  handle(event: CopilotEvent): void {
    const data = (event.data ?? {}) as Record<string, unknown>;
    // A subagent's own steps stay out of the conversation, as on disk.
    const sub = !!str(data.parentToolCallId);
    switch (event.type) {
      case 'assistant.turn_start':
        if (!sub) this.events.state('running');
        break;
      case 'assistant.message_delta':
        if (!sub && str(data.deltaContent)) this.delta('text', str(data.deltaContent)!);
        break;
      case 'assistant.reasoning_delta':
        if (!sub && str(data.deltaContent)) this.delta('thinking', str(data.deltaContent)!);
        break;
      case 'tool.execution_start': {
        const name = str(data.toolName);
        if (!sub && name && !isHiddenTool(name)) this.delta('tool', claudeTool(name, data.arguments).name);
        break;
      }
      case 'session.usage_info': {
        // How full the context is: what the next request sends, of what the model takes.
        const tokens = data.currentTokens;
        const limit = data.tokenLimit;
        if (typeof tokens === 'number' && typeof limit === 'number' && limit > 0) this.events.usage({ contextTokens: tokens, contextMax: limit });
        break;
      }
      case 'assistant.usage':
        // Each model call's cost, in premium requests (a cheaper model costs a fraction of one).
        if (typeof data.cost === 'number') {
          this.spent += data.cost;
          this.events.usage({ spent: { amount: Math.round(this.spent * 100) / 100, unit: 'premium requests' } });
        }
        break;
      case 'session.idle':
        this.clear();
        this.events.state('idle');
        break;
      case 'session.error':
        this.clear();
        this.events.state('error', str(data.message) ?? 'GitHub Copilot stopped with an error');
        break;
      default:
        break;
    }
    const messages = this.converter.push(event);
    if (messages.length) {
      // The complete message takes the place of what streamed.
      this.clear();
      this.events.messages(messages);
    }
  }

  private delta(kind: 'text' | 'thinking' | 'tool', text: string): void {
    this.streaming = true;
    this.events.stream({ kind, text });
  }

  private clear(): void {
    if (!this.streaming) return;
    this.streaming = false;
    this.events.stream({ kind: 'clear', text: '' });
  }
}
