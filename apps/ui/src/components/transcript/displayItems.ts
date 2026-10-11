import type { ImageRef, TranscriptMessage } from '@switchboard/protocol/client';

export interface ToolResultView {
  text: string;
  isError: boolean;
  truncated: boolean;
  images: ImageRef[];
  /** When the result came back (epoch ms), if known. */
  at: number | null;
}

/** Every item carries `at`: when its message was written (epoch ms), if known. */
export type DisplayItem =
  | { kind: 'user'; key: string; at: number | null; text: string; images: ImageRef[]; subagent: boolean }
  | { kind: 'command'; key: string; at: number | null; name: string; args: string }
  | { kind: 'text'; key: string; at: number | null; text: string; subagent: boolean }
  | { kind: 'thinking'; key: string; at: number | null; text: string }
  | {
      kind: 'tool';
      key: string;
      at: number | null;
      id: string;
      name: string;
      input: unknown;
      inputTruncated: boolean;
      result: ToolResultView | null;
      subagent: boolean;
    }
  | { kind: 'notice'; key: string; at: number | null; text: string }
  /**
   * A background agent or task finishing: its report, handed back to the session. `toolUseId`
   * ties it to the call that started it (task notifications carry it; agent hand-backs don't).
   */
  | { kind: 'agent-report'; key: string; at: number | null; agentId: string; toolUseId: string | null; status: string; title: string; text: string };

const SYSTEM_REMINDER = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const tag = (text: string, name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(text)?.[1]?.trim() ?? null;

const NOTICE_LABELS: Record<string, string> = {
  compact_boundary: 'Conversation compacted',
  informational: 'Information',
};

const AGENT_MESSAGE = /<agent-message from="([^"]+)">([\s\S]*?)<\/agent-message>/;

type Report = { agentId: string; toolUseId: string | null; status: string; title: string; text: string };

/**
 * A background agent or task reporting back, in either of Claude Code's forms: an agent hand-back
 * (`<agent-message from="…">`, desktop and terminal sessions) or a `<task-notification>` (SDK sessions,
 * also used for background commands).
 */
export function agentReport(text: string): Report | null {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<task-notification>')) {
    const field = (name: string) => new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(trimmed)?.[1]?.trim() ?? null;
    const taskId = field('task-id');
    if (!taskId) return null;
    const summary = field('summary') ?? 'Background task finished';
    return { agentId: taskId, toolUseId: field('tool-use-id'), status: field('status') ?? 'completed', title: summary, text: field('result') ?? summary };
  }
  // The saved transcript puts a line before the tag; the live stream sends the tag on its own.
  if (!/^(Another Claude session sent a message:\s*)?<agent-message from="/.test(trimmed)) return null;
  const match = AGENT_MESSAGE.exec(trimmed);
  if (!match) return null;
  const body = match[2]!;
  const start = body.indexOf('The report follows:');
  const report = (start === -1 ? body : body.slice(start + 'The report follows:'.length)).replace(/^\n/, '').replace(/^ {2}/gm, '').trim();
  return { agentId: match[1]!, toolUseId: null, status: 'completed', title: report.split('\n')[0] ?? 'Agent report', text: report };
}

/** Recognises the markup Claude Code writes into user turns (slash commands, command output, interrupts, agent reports). */
function userTextItem(text: string, key: string, at: number | null, subagent: boolean, images: ImageRef[]): DisplayItem | null {
  const report = agentReport(text);
  if (report) return { kind: 'agent-report', key, at, ...report };
  const name = tag(text, 'command-name');
  if (name) return { kind: 'command', key, at, name: name.startsWith('/') ? name : `/${name}`, args: tag(text, 'command-args') ?? '' };
  const stdout = tag(text, 'local-command-stdout');
  if (stdout !== null) return stdout ? { kind: 'notice', key, at, text: stdout } : null;
  if (/^\[Request interrupted by user/.test(text)) return { kind: 'notice', key, at, text: 'Interrupted by you' };
  const cleaned = text.replace(SYSTEM_REMINDER, '').trim();
  if (!cleaned && images.length === 0) return null;
  return { kind: 'user', key, at, text: cleaned, images, subagent };
}

/**
 * Turns transcript messages into the items the viewer renders: tool calls are
 * paired with their results (matched by id), and user turns that only carry
 * tool results disappear into those cards.
 */
export function buildDisplayItems(messages: readonly TranscriptMessage[]): DisplayItem[] {
  const results = new Map<string, ToolResultView>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === 'tool_result') {
        results.set(block.toolUseId, { text: block.text, isError: block.isError, truncated: block.truncated, images: block.images ?? [], at: message.timestamp });
      }
    }
  }

  const items: DisplayItem[] = [];
  for (const message of messages) {
    const subagent = message.parentToolUseId !== null;
    const at = message.timestamp;
    if (message.role === 'user') {
      const texts = message.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : []));
      const images = message.blocks.flatMap((b) => (b.type === 'image' && b.ref ? [b.ref] : []));
      if (texts.length === 0 && images.length === 0) continue;
      const item = userTextItem(texts.join('\n\n'), message.uuid, at, subagent, images);
      if (item) items.push(item);
      continue;
    }

    if (message.role === 'system') {
      for (const [i, block] of message.blocks.entries()) {
        const key = `${message.uuid}:${i}`;
        if (block.type === 'text') items.push({ kind: 'notice', key, at, text: block.text });
        else if (block.type === 'unknown') items.push({ kind: 'notice', key, at, text: NOTICE_LABELS[block.kind] ?? block.kind.replace(/_/g, ' ') });
      }
      continue;
    }

    for (const [i, block] of message.blocks.entries()) {
      const key = `${message.uuid}:${i}`;
      switch (block.type) {
        case 'text':
          if (block.text.trim()) items.push({ kind: 'text', key, at, text: block.text, subagent });
          break;
        case 'thinking':
          if (block.text.trim()) items.push({ kind: 'thinking', key, at, text: block.text });
          break;
        case 'tool_use':
          items.push({
            kind: 'tool',
            key,
            at,
            id: block.id,
            name: block.name,
            input: block.input,
            inputTruncated: block.truncated,
            result: results.get(block.id) ?? null,
            subagent,
          });
          break;
        default:
          break;
      }
    }
  }
  return items;
}

/** A run of tool calls and thinking between Claude's messages, shown as one summary line. */
export type ActivityGroup = { kind: 'activity'; key: string; items: DisplayItem[] };
export type RenderItem = DisplayItem | ActivityGroup;

/** Plans stay visible; everything else Claude does between messages can be summarised. */
const isActivity = (item: DisplayItem) =>
  item.kind === 'thinking' ||
  item.kind === 'agent-report' || (item.kind === 'tool' && item.name !== 'ExitPlanMode') || ((item.kind === 'text' || item.kind === 'user') && item.subagent);

/**
 * Collapses each run of activity (tool calls, thinking, subagent output) into one
 * group, like Claude Code does. Claude's messages, your prompts, commands, notices
 * and plans break a run and stay as they are. The group's key is its first item's,
 * so it stays stable while the run grows.
 */
export function groupActivity(items: readonly DisplayItem[], standalone: (item: DisplayItem) => boolean = () => false): RenderItem[] {
  const out: RenderItem[] = [];
  let group: ActivityGroup | null = null;
  for (const item of items) {
    // A memory Claude saved stays a line of its own, between runs.
    if (!isActivity(item) || standalone(item)) {
      group = null;
      out.push(item);
      continue;
    }
    if (!group) {
      group = { kind: 'activity', key: `activity:${item.key}`, items: [] };
      out.push(group);
    }
    group.items.push(item);
  }
  return out;
}
