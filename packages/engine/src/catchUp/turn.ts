import { withoutBriefs } from '@switchboard/protocol';
import type { RawSessionMessage } from '../claude/transcript.ts';

/** One tool call of a turn, as much of it as the catch-up needs. */
export interface ToolCall {
  id: string;
  name: string;
  /** The file a file tool worked on, as Claude passed it. */
  file: string | null;
  /** A shell command. */
  command: string | null;
  /** 0 for a success, the exit code (or 1) for a failure; null until its result came back. */
  exitCode: number | null;
  /** You said no to it (a permission you denied). */
  declined: boolean;
  /** The end of its output, where test runners print their summary. */
  output: string;
}

/** The last turn of a session: your prompt, what Claude did, and what it said at the end. */
export interface Turn {
  /** The uuid of the turn's last message. */
  id: string;
  /** The prompt that started this piece of work (see `askOf`). */
  ask: string;
  /** Claude's last reply in the turn. */
  finalText: string;
  tools: ToolCall[];
  /** The last plan of the session (ExitPlanMode), if it had one. */
  plan: string | null;
}

/** Tools that change files. */
export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
/** How much of a tool's output is kept: test summaries are in the last lines. */
const OUTPUT_TAIL = 4_000;
/** How long an ask may be. */
export const ASK_MAX = 240;

type Block = { type?: unknown; [key: string]: unknown };

const blocksOf = (message: RawSessionMessage): Block[] => {
  const content = (message.message as { content?: unknown } | null)?.content;
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content.filter((b): b is Block => typeof b === 'object' && b !== null) : [];
};

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part: Block) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : '')).filter(Boolean).join('\n');
};

const tag = (text: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() ?? null;
const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

/**
 * What you typed, when a message is a prompt of yours: plain text, or a slash command as `/name args`. Null for what
 * Claude Code writes into user turns itself (tool results, command output, interrupts, agent reports, reminders), and
 * for subagents' messages.
 */
export function promptText(message: RawSessionMessage): string | null {
  if (message.type !== 'user' || message.parent_tool_use_id !== null || message.isCompactSummary) return null;
  const blocks = blocksOf(message);
  if (blocks.some((b) => b.type === 'tool_result')) return null;
  const text = blocks.flatMap((b) => (b.type === 'text' && typeof b.text === 'string' ? [b.text] : [])).join('\n\n');
  const hasImage = blocks.some((b) => b.type === 'image');
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<task-notification>') || /^(Another Claude session sent a message:\s*)?<agent-message from="/.test(trimmed)) return null;
  const command = tag(text, 'command-name');
  if (command) {
    const args = tag(text, 'command-args') ?? '';
    return `${command.startsWith('/') ? command : `/${command}`}${args ? ` ${args}` : ''}`;
  }
  if (tag(text, 'local-command-stdout') !== null || /^\[Request interrupted by user/.test(trimmed)) return null;
  // A linked session's brief is not what you asked (session linking).
  const cleaned = withoutBriefs(text.replace(SYSTEM_REMINDER, '')).trim();
  return cleaned || (hasImage ? '(an image)' : null);
}

/** A reply that only answers Claude ("yes", "go ahead") doesn't say what the work is: the prompt before it does. */
const isShortReply = (text: string) => text.split(/\s+/).filter(Boolean).length < 5 && !/[/\\.]\w/.test(text);

/** One line, at most `max` characters, cut at a word with an ellipsis. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/**
 * The prompt that started this piece of work: the last one, unless that only answered Claude ("yes, go on"), then the
 * one before it (a few steps back at most).
 */
export function askOf(prompts: readonly string[]): string {
  let at = prompts.length - 1;
  for (let steps = 0; steps < 3 && at > 0 && isShortReply(prompts[at]!); steps++) at--;
  return oneLine(prompts[at] ?? '', ASK_MAX);
}

/** The exit code a failed shell command reported ("Exit code 2"), else 1. */
function exitCodeOf(output: string): number {
  const match = /\bexit code:?\s*(\d+)/i.exec(output.slice(0, 300));
  return match ? Number(match[1]) : 1;
}

const DECLINED = /user (doesn't|does not) want to proceed|user declined|was rejected|permission.*denied by the user/i;

/** Main-thread messages in order, the file's first, then live ones the file doesn't have yet. */
export function mergeMessages(file: readonly RawSessionMessage[], live: readonly RawSessionMessage[]): RawSessionMessage[] {
  const seen = new Set(file.map((m) => m.uuid));
  return [...file, ...live.filter((m) => !seen.has(m.uuid))].filter((m) => m.parent_tool_use_id === null);
}

/**
 * The session's last turn: from its last prompt to the end. Null when there is no prompt, or Claude hasn't answered it
 * yet. Subagents' messages are left out (their work shows as the Task call).
 */
export function lastTurn(messages: readonly RawSessionMessage[]): Turn | null {
  const main = messages.filter((m) => m.parent_tool_use_id === null);
  const prompts: Array<{ index: number; text: string }> = [];
  main.forEach((m, index) => {
    const text = promptText(m);
    if (text !== null) prompts.push({ index, text });
  });
  const start = prompts.at(-1);
  if (!start) return null;
  const turn = main.slice(start.index + 1);
  if (!turn.some((m) => m.type === 'assistant')) return null;

  const tools = new Map<string, ToolCall>();
  let finalText = '';
  for (const message of turn) {
    for (const block of blocksOf(message)) {
      if (message.type === 'assistant' && block.type === 'text' && typeof block.text === 'string' && block.text.trim()) finalText = block.text.trim();
      if (message.type === 'assistant' && block.type === 'tool_use') {
        const input = (block.input ?? {}) as Record<string, unknown>;
        const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
        tools.set(String(block.id ?? ''), {
          id: String(block.id ?? ''),
          name: String(block.name ?? 'unknown'),
          file: str(input.file_path) ?? str(input.notebook_path),
          command: block.name === 'Bash' ? str(input.command) : null,
          exitCode: null,
          declined: false,
          output: '',
        });
      }
      if (block.type === 'tool_result') {
        const call = tools.get(String(block.tool_use_id ?? ''));
        if (!call) continue;
        const output = textOf(block.content);
        call.output = output.slice(-OUTPUT_TAIL);
        call.declined = block.is_error === true && DECLINED.test(output.slice(0, 300));
        call.exitCode = block.is_error === true ? exitCodeOf(output) : 0;
      }
    }
  }

  let plan: string | null = null;
  for (const message of main) {
    if (message.type !== 'assistant') continue;
    for (const block of blocksOf(message)) {
      const input = block.input as { plan?: unknown } | undefined;
      if (block.type === 'tool_use' && block.name === 'ExitPlanMode' && typeof input?.plan === 'string') plan = input.plan;
    }
  }

  return {
    id: turn.at(-1)!.uuid,
    ask: askOf(prompts.map((p) => p.text)),
    finalText,
    tools: [...tools.values()],
    plan,
  };
}
