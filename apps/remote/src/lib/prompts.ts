import type { RemotePrompt } from '@seshboard/protocol/remote-client';
import { toolSummary } from './transcript.ts';

/** What the computer's card says when you decline (apps/ui PermissionCard). */
export const DECLINED = 'The user declined this action.';

/** What a prompt asks for: a tool to allow, a question to answer, or a plan to start. */
export type PromptKind = 'tool' | 'question' | 'plan';

export function promptKind(prompt: Pick<RemotePrompt, 'toolName'>): PromptKind {
  if (prompt.toolName === 'AskUserQuestion') return 'question';
  if (prompt.toolName === 'ExitPlanMode') return 'plan';
  return 'tool';
}

const EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

/** The tag on a prompt's card: "Allow a command", "Allow an edit", "Question". */
export function promptTag(prompt: Pick<RemotePrompt, 'toolName'>): string {
  const kind = promptKind(prompt);
  if (kind === 'question') return 'Question';
  if (kind === 'plan') return 'Plan';
  if (prompt.toolName === 'Bash' || prompt.toolName === 'PowerShell') return 'Allow a command';
  if (EDITS.has(prompt.toolName)) return 'Allow an edit';
  if (prompt.toolName === 'WebFetch') return 'Allow a fetch';
  if (prompt.toolName === 'WebSearch') return 'Allow a search';
  return `Allow ${toolLabel(prompt.toolName)}`;
}

/** An MCP tool by its own name (`mcp__github__create_issue` → `create_issue`). */
export function toolLabel(name: string): string {
  const parts = name.split('__');
  return name.startsWith('mcp__') && parts.length >= 3 ? parts.slice(2).join('__') : name;
}

/** The one line a card shows in its code box: the command, the file or the address. */
export function promptSubject(prompt: Pick<RemotePrompt, 'toolName' | 'input'>): string {
  return toolSummary(prompt.toolName, prompt.input);
}

/**
 * All of what a tool prompt asks, every line of it: the command, the file or the address. Allow approves all of it,
 * so the card that offers Allow shows all of it.
 */
export function promptText(prompt: Pick<RemotePrompt, 'toolName' | 'input'>): string {
  const input = (prompt.input ?? {}) as Record<string, unknown>;
  const text = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt'].map((key) => input[key]).find((value): value is string => typeof value === 'string' && value.trim() !== '');
  return text?.trim() ?? prompt.toolName;
}

/** Whether the one line of a home card shows all of what a tool prompt asks, so Allow can sit under it. */
export function promptFitsLine(prompt: Pick<RemotePrompt, 'toolName' | 'input' | 'truncated'>): boolean {
  const text = promptText(prompt);
  return !prompt.truncated && !text.includes('\n') && text.length <= 120;
}

/** The first line of a question (the first of several), or the plan's first line, for the compact row. */
export function promptLine(prompt: Pick<RemotePrompt, 'toolName' | 'input'>): string {
  const input = (prompt.input ?? {}) as { questions?: Array<{ question?: unknown }>; plan?: unknown };
  const text = promptKind(prompt) === 'question' ? input.questions?.find((q) => typeof q?.question === 'string')?.question : input.plan;
  const line = typeof text === 'string' ? (text.split('\n').find((l) => l.trim()) ?? '').replace(/^#+\s*/, '').trim() : '';
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}

/** What a prompt asks, for the one line the docked prompt folds to while you type: "Allow Bash?", "A question". */
export function promptAsk(prompt: Pick<RemotePrompt, 'toolName'>): string {
  const kind = promptKind(prompt);
  if (kind === 'question') return 'A question';
  if (kind === 'plan') return 'A plan to start';
  return `Allow ${toolLabel(prompt.toolName)}?`;
}

/** What a prompt asks, in a few words, for its row in the wide sidebar: "Allow Bash", "a question", "a plan". */
export function promptShort(prompt: Pick<RemotePrompt, 'toolName'>): string {
  const kind = promptKind(prompt);
  if (kind === 'question') return 'a question';
  if (kind === 'plan') return 'a plan';
  return `Allow ${toolLabel(prompt.toolName)}`;
}
