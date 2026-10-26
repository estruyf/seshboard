import type { PermissionRequest } from '@seshboard/protocol/companion-client';

/**
 * Seshboard's prompts (a permission, a question, a plan) as VS Code notifications: what they say, and the answer
 * they send back. Pure (no `vscode` import), so it can be tested; the cards in Seshboard are the model.
 */

export type PromptKind = 'tool' | 'question' | 'plan';

export const promptKind = (request: Pick<PermissionRequest, 'toolName'>): PromptKind =>
  request.toolName === 'AskUserQuestion' ? 'question' : request.toolName === 'ExitPlanMode' ? 'plan' : 'tool';

/** The longest command or path a notification shows; it is one line in a small box. */
const MAX_DETAIL = 160;

const clip = (text: string) => {
  const line = text.replace(/\s*\n\s*/g, ' ').trim();
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL - 1)}…` : line;
};

const base = (path: string) => path.split('/').pop() || path;

/** What a tool asks to do, when Claude Code gave no prompt text of its own. */
function toolAsk(request: Pick<PermissionRequest, 'toolName' | 'input'>): string {
  const input = (request.input && typeof request.input === 'object' && !Array.isArray(request.input) ? request.input : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : null);
  const path = text('file_path') ?? text('notebook_path') ?? text('path');
  switch (request.toolName) {
    case 'Bash':
      return 'Claude wants to run a command';
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return path ? `Claude wants to edit ${base(path)}` : 'Claude wants to edit a file';
    case 'Write':
      return path ? `Claude wants to write ${base(path)}` : 'Claude wants to write a file';
    case 'Read':
      return path ? `Claude wants to read ${base(path)}` : 'Claude wants to read a file';
    case 'WebFetch':
      return text('url') ? `Claude wants to fetch ${text('url')}` : 'Claude wants to fetch a page';
    case 'WebSearch':
      return text('query') ? `Claude wants to search the web for "${text('query')}"` : 'Claude wants to search the web';
    default:
      return `Claude wants to use ${request.toolName}`;
  }
}

/** The command a Bash prompt runs, when the notification should show it. */
export function promptCommand(request: Pick<PermissionRequest, 'toolName' | 'input'>): string | null {
  if (request.toolName !== 'Bash') return null;
  const command = (request.input as { command?: unknown } | null)?.command;
  return typeof command === 'string' && command.trim() ? command : null;
}

/** The questions an AskUserQuestion prompt asks. */
export interface Question {
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: Array<{ label: string; description?: string }>;
}

export function promptQuestions(request: Pick<PermissionRequest, 'input'>): Question[] {
  const questions = (request.input as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return [];
  return questions.filter((q): q is Question => !!q && typeof q === 'object' && typeof (q as Question).question === 'string').map((q) => ({ ...q, options: Array.isArray(q.options) ? q.options.filter((o) => typeof o?.label === 'string') : [] }));
}

/** The plan an ExitPlanMode prompt asks you to approve. */
export const promptPlan = (request: Pick<PermissionRequest, 'input'>): string => {
  const plan = (request.input as { plan?: unknown } | null)?.plan;
  return typeof plan === 'string' ? plan : '';
};

/**
 * The notification's text: the session, then what Claude asks, as Seshboard's card heads it ("Claude wants to
 * run npm test"), with the command when the heading doesn't already say it.
 */
export function promptMessage(request: PermissionRequest, sessionTitle: string | null): string {
  const kind = promptKind(request);
  let ask: string;
  if (kind === 'question') {
    const questions = promptQuestions(request);
    ask = questions.length === 1 ? `Claude has a question: ${clip(questions[0]!.question)}` : questions.length > 1 ? `Claude has ${questions.length} questions for you` : 'Claude has a question for you';
  } else if (kind === 'plan') {
    ask = 'Claude has a plan. Ready to start?';
  } else {
    ask = request.title?.trim() || toolAsk(request);
    const command = promptCommand(request);
    if (command && !ask.includes(command.trim())) ask = `${ask}: ${clip(command)}`;
    else ask = clip(ask);
  }
  const from = request.agentId ? ' (from a subagent)' : '';
  return sessionTitle ? `${sessionTitle}: ${ask}${from}` : `${ask}${from}`;
}

/** "Allow Bash(npm test:*) in this project" reads as "Always allow Bash(npm test:*) in this project". */
export function alwaysText(label: string): string {
  return /^allow\s/i.test(label) ? `Always allow ${label.slice(6)}` : `Always allow: ${label}`;
}

/**
 * The input to answer an AskUserQuestion prompt with: its own input plus `answers`, each question's picks (and
 * what you typed) joined with commas, as Seshboard's card sends them. Null while a question has no answer.
 */
export function questionAnswers(request: Pick<PermissionRequest, 'input'>, picks: Readonly<Record<string, readonly string[]>>): Record<string, unknown> | null {
  const questions = promptQuestions(request);
  if (questions.length === 0) return null;
  const answers: Record<string, string> = {};
  for (const q of questions) {
    const picked = (picks[q.question] ?? []).map((p) => p.trim()).filter(Boolean);
    if (picked.length === 0) return null;
    answers[q.question] = picked.join(', ');
  }
  const input = request.input && typeof request.input === 'object' && !Array.isArray(request.input) ? request.input : {};
  return { ...input, answers };
}

/**
 * The prompts to announce: those not announced yet. `seen` is updated, and forgets prompts that are gone, so it
 * doesn't grow for as long as VS Code runs.
 */
export function newPrompts(prompts: readonly PermissionRequest[], seen: Set<string>): PermissionRequest[] {
  const open = new Set(prompts.map((p) => p.requestId));
  for (const id of seen) if (!open.has(id)) seen.delete(id);
  const fresh = prompts.filter((p) => !seen.has(p.requestId));
  for (const p of fresh) seen.add(p.requestId);
  return fresh;
}
