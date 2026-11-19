import { statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { ImageAttachment, PermissionDecision, PermissionRequest } from '@seshboard/protocol';
import { clipJson, LIMITS } from '../../claude/transcript.ts';
import type { AcpContentBlock, AcpPermissionOption, AcpPermissionOutcome, AcpToolCall } from './acpTypes.ts';

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The first web address in a text (a fetch's title names it). */
const firstUrl = (text: string | null): string | null => (text ? (/https?:\/\/[^\s"'<>)]+/.exec(text)?.[0] ?? null) : null);

/** The first diff a tool call shows (an edit's). */
function diffOf(call: AcpToolCall): { path: string; oldText: string; newText: string; added: boolean } | null {
  for (const item of call.content ?? []) {
    if (item.type !== 'diff' || typeof item.path !== 'string') continue;
    const oldText = typeof item.oldText === 'string' ? item.oldText : '';
    const meta = item._meta && typeof item._meta === 'object' ? (item._meta as Record<string, unknown>) : {};
    return { path: item.path, oldText, newText: typeof item.newText === 'string' ? item.newText : '', added: meta.kind === 'add' || item.oldText === null || item.oldText === undefined };
  }
  return null;
}

/**
 * An ACP tool call as Claude Code's tool, for the permission card (and the stream): by its `kind`, since ACP names no
 * tool and an agent may send no input (Gemini sends none). A command as Bash (its title is the command), an edit as
 * Edit with its diff (a new file as Write), a read as Read, a search as Grep, a fetch as WebFetch. `name` is the tool's
 * own name when the agent says it some other way; with it, a kind ACP doesn't map keeps that name. The input the agent
 * sent (`rawInput`) goes with any other.
 */
export function acpToolCard(call: AcpToolCall, name: string | null = null): { toolName: string; input: Record<string, unknown> } {
  const title = str(call.title);
  const path = call.locations?.find((l) => typeof l.path === 'string')?.path ?? null;
  const raw = call.rawInput && typeof call.rawInput === 'object' && !Array.isArray(call.rawInput) ? (call.rawInput as Record<string, unknown>) : null;
  switch (call.kind) {
    case 'execute':
      return { toolName: 'Bash', input: { command: str(raw?.command) ?? title ?? '' } };
    case 'edit': {
      const diff = diffOf(call);
      if (diff?.added) return { toolName: 'Write', input: { file_path: diff.path, content: diff.newText } };
      if (diff) return { toolName: 'Edit', input: { file_path: diff.path, old_string: diff.oldText, new_string: diff.newText } };
      return { toolName: 'Edit', input: { file_path: path ?? title ?? '' } };
    }
    case 'read':
      return { toolName: 'Read', input: { file_path: path ?? title ?? '' } };
    case 'search':
      return { toolName: 'Grep', input: { pattern: title ?? '', ...(path ? { path } : {}) } };
    case 'fetch':
      return { toolName: 'WebFetch', input: { url: firstUrl(title) ?? title ?? '' } };
    default:
      return { toolName: name ?? title ?? call.kind ?? 'tool', input: raw ?? (title ? { description: title } : {}) };
  }
}

/**
 * An agent's permission request as the permission card shows Claude Code's: the tool (`toolCard`), its title as the
 * card's line, and Always allow when the agent offers to allow it for the rest of the session.
 */
export function acpPermissionRequest(requestId: string, call: AcpToolCall, options: readonly AcpPermissionOption[], card: { toolName: string; input: Record<string, unknown> }, now = Date.now()): Omit<PermissionRequest, 'sessionId'> {
  const { value, truncated } = clipJson(card.input, LIMITS.toolInputString);
  const always = options.find((o) => o.kind === 'allow_always');
  return {
    requestId,
    toolName: card.toolName,
    toolUseId: str(call.toolCallId),
    input: value,
    ...(truncated ? { truncated } : {}),
    title: str(call.title),
    description: null,
    decisionReason: null,
    blockedPath: null,
    alwaysLabel: always ? (str(always.name) ?? 'Allow for this session') : null,
    agentId: null,
    createdAt: now,
  };
}

/**
 * Seshboard's answer as the option the agent offered: Allow is its "allow once", Always allow its "allow always" (else
 * once), Deny its "reject once" (else "reject always"). An answer it offers nothing for is `cancelled`, which ACP
 * agents take as a refusal.
 */
export function acpOutcome(decision: PermissionDecision, options: readonly AcpPermissionOption[]): AcpPermissionOutcome {
  const pick = (...kinds: string[]) => kinds.map((kind) => options.find((o) => o.kind === kind)).find(Boolean);
  const option = decision.behavior === 'allow' ? (decision.always ? pick('allow_always', 'allow_once') : pick('allow_once', 'allow_always')) : pick('reject_once', 'reject_always');
  return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } };
}

const MENTION = /^@(?:"([^"\n]+)"|([^\s"]\S*))$/;

/**
 * The files and folders a message mentions, as ACP resource links (`file://` and the path, as Gemini CLI reads them).
 * The message box writes them on one line of `@` mentions (relative to the session's folder, folders ending in `/`, a
 * range as `#L12-40`, quoted when the path has spaces); the line stays in the text too. Only a paragraph made of
 * mentions alone counts, so an `@` in what you typed is left as words. A path that isn't there is left out.
 */
export function acpMentions(text: string, cwd: string): AcpContentBlock[] {
  const links: AcpContentBlock[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const words = paragraph.trim().match(/@"[^"\n]+"|\S+/g) ?? [];
    const matches = words.map((word) => MENTION.exec(word));
    if (!words.length || matches.some((m) => !m)) continue;
    for (const match of matches) {
      const target = match![1] ?? match![2]!;
      // A range of lines is for the reader: the agent gets the file, and reads the lines the text names.
      const bare = target.replace(/#L\d+(?:-\d+)?$/, '').replace(/[\\/]+$/, '');
      if (!bare) continue;
      const path = isAbsolute(bare) ? bare : join(cwd, bare);
      if (statSync(path, { throwIfNoEntry: false })) links.push({ type: 'resource_link', uri: `file://${path}`, name: target });
    }
  }
  return links;
}

/** A message as `session/prompt`'s blocks: its text, the files it mentions, and pasted images. */
export function acpPrompt(text: string, attachments: readonly ImageAttachment[], cwd: string): AcpContentBlock[] {
  return [{ type: 'text', text }, ...acpMentions(text, cwd), ...attachments.map((a): AcpContentBlock => ({ type: 'image', mimeType: a.mediaType, data: a.data }))];
}
