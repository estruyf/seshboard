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

  constructor(private readonly events: Pick<DriverEvents, 'stream' | 'messages' | 'state'>) {}

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
