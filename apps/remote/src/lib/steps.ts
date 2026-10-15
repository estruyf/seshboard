import type { RemoteBlock, RemoteMessage } from '@switchboard/protocol/remote-client';
import { visibleMessages } from './transcript.ts';

type ToolUse = Extract<RemoteBlock, { type: 'tool_use' }>;
type Thinking = Extract<RemoteBlock, { type: 'thinking' }>;

/**
 * The conversation as the phone draws it: your messages, Claude's text, and runs of tool calls in a row folded into
 * one line ("6 steps · edited 3 files, ran 2 commands"). Thinking between two calls belongs to their run. Pure, so the
 * grouping and the counting are easy to check.
 */
export type TranscriptItem =
  | { kind: 'message'; key: string; message: RemoteMessage }
  | { kind: 'text'; key: string; text: string }
  | { kind: 'thinking'; key: string; text: string }
  | { kind: 'image'; key: string }
  /** `steps`: the calls and the thinking between them, in order. */
  | { kind: 'run'; key: string; steps: Array<ToolUse | Thinking> };

export function transcriptItems(messages: readonly RemoteMessage[]): TranscriptItem[] {
  const items: TranscriptItem[] = [];
  /** Thinking after a call, held until the next block says whether the run goes on. */
  let pending: Array<{ key: string; block: Thinking }> = [];
  const flush = () => {
    for (const { key, block } of pending) if (block.text) items.push({ kind: 'thinking', key, text: block.text });
    pending = [];
  };
  for (const message of visibleMessages(messages)) {
    if (message.role !== 'assistant') {
      flush();
      items.push({ kind: 'message', key: message.uuid, message });
      continue;
    }
    message.blocks.forEach((block, index) => {
      const key = `${message.uuid}:${index}`;
      const last = items.at(-1);
      switch (block.type) {
        case 'tool_use':
          if (last?.kind === 'run') last.steps.push(...pending.map((p) => p.block), block);
          else {
            flush();
            items.push({ kind: 'run', key, steps: [block] });
          }
          pending = [];
          break;
        case 'thinking':
          if (last?.kind === 'run') pending.push({ key, block });
          else if (block.text) items.push({ kind: 'thinking', key, text: block.text });
          break;
        case 'text':
          flush();
          if (block.text.trim()) items.push({ kind: 'text', key, text: block.text });
          break;
        case 'image':
          flush();
          items.push({ kind: 'image', key });
          break;
        default:
          break;
      }
    });
  }
  flush();
  return items;
}

const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const COMMANDS = new Set(['Bash', 'PowerShell']);
const SEARCHES = new Set(['Grep', 'Glob', 'LS']);
const FETCHES = new Set(['WebFetch', 'WebSearch']);
const AGENTS = new Set(['Task', 'Agent']);

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "6 steps · edited 3 files, ran 2 commands": how many calls, then what they did, the kinds that change things first. */
export function runSummary(steps: ReadonlyArray<ToolUse | Thinking>): string {
  const calls = steps.filter((s): s is ToolUse => s.type === 'tool_use');
  const file = (call: ToolUse) => {
    const input = (call.input ?? {}) as Record<string, unknown>;
    return typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : null;
  };
  const files = (names: Set<string>) => new Set(calls.filter((c) => names.has(c.name)).map((c) => file(c) ?? c.id)).size;
  const n = (names: Set<string>) => calls.filter((c) => names.has(c.name)).length;
  const parts = [
    files(EDITS) && `edited ${count(files(EDITS), 'file')}`,
    n(COMMANDS) && `ran ${count(n(COMMANDS), 'command')}`,
    files(new Set(['Read'])) && `read ${count(files(new Set(['Read'])), 'file')}`,
    n(SEARCHES) && `searched ${n(SEARCHES) === 1 ? 'once' : `${n(SEARCHES)} times`}`,
    n(FETCHES) && `looked up ${count(n(FETCHES), 'page')}`,
    n(AGENTS) && `ran ${count(n(AGENTS), 'agent')}`,
  ].filter((part): part is string => Boolean(part));
  const shown = parts.slice(0, 3);
  return [count(calls.length, 'step'), shown.join(', ')].filter(Boolean).join(' · ');
}
