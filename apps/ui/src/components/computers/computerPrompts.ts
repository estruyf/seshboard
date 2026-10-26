import type { PermissionDecision, RemotePrompt } from '@seshboard/protocol/client';
import { toolLine } from './computerSessions.ts';

/** What another computer's prompt asks for: a tool to allow, a question to answer, or a plan to start. */
export type PromptKind = 'tool' | 'question' | 'plan';

export function promptKind(prompt: Pick<RemotePrompt, 'toolName'>): PromptKind {
  if (prompt.toolName === 'AskUserQuestion') return 'question';
  if (prompt.toolName === 'ExitPlanMode') return 'plan';
  return 'tool';
}

/** An MCP tool by its own name (`mcp__github__create_issue` → `create_issue`). */
export function toolLabel(name: string): string {
  const parts = name.split('__');
  return name.startsWith('mcp__') && parts.length >= 3 ? parts.slice(2).join('__') : name;
}

/** The card's heading, as the card on that computer says it. */
export function promptTitle(prompt: RemotePrompt): string {
  const kind = promptKind(prompt);
  if (kind === 'question') return 'Claude has a question for you';
  if (kind === 'plan') return 'Claude has a plan. Ready to start?';
  return prompt.title ?? `Allow ${toolLabel(prompt.toolName)}?`;
}

/** The line in the card's code box: the command, the file or the address. */
export function promptSubject(prompt: Pick<RemotePrompt, 'toolName' | 'input'>): string {
  const input = (prompt.input ?? {}) as Record<string, unknown>;
  if (typeof input.command === 'string') return input.command;
  return toolLine(prompt.toolName, prompt.input);
}

export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

/** The questions of an AskUserQuestion prompt, skipping anything malformed. */
export function promptQuestions(prompt: Pick<RemotePrompt, 'input'>): Question[] {
  const questions = (prompt.input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.filter((q): q is Question => !!q && typeof (q as Question).question === 'string' && Array.isArray((q as Question).options));
}

/** The answer to a question prompt: each question's picks, joined, in the tool's input, as the computer's card sends it. */
export function questionDecision(prompt: Pick<RemotePrompt, 'input'>, picks: Record<string, string[]>): PermissionDecision {
  const answers = Object.fromEntries(promptQuestions(prompt).map((q) => [q.question, (picks[q.question] ?? []).join(', ')]));
  return { behavior: 'allow', updatedInput: { ...(prompt.input as Record<string, never>), answers } };
}

/** What the computer's card says when you decline (apps/ui PermissionCard). */
export const DECLINED = 'The user declined this action.';
