import { AUTO_TIERS, type AutoPick, type AutoTier, type Effort } from '@seshboard/protocol/client';
import type { DisplayItem } from '../components/transcript/displayItems.ts';

/** What a session shows of its size, read from the transcript alone (no model call). */
export interface SuggestSignals {
  /** Your latest message. */
  prompt: string;
  /** Files Claude edited or wrote. */
  editedFiles: number;
  /** Messages you sent. */
  userTurns: number;
  /** Tool calls in a row, at the end, that failed. */
  failedInARow: number;
}

/** Past these, a session has grown beyond its first prompt. */
export const SUGGEST_LIMITS = { editedFiles: 8, userTurns: 12, failedInARow: 3 } as const;

/** A message that asks to plan, refactor or design across many files. */
const BIG_ASK = /\b(plan|refactor|redesign|design|architect\w*|migrat\w*|rewrite|restructure|overhaul)\b[\s\S]{0,80}\b(across|whole|entire|every|all|many|codebase|project|app|modules|files|layers|services)\b/i;

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** The signals of a session's transcript. */
export function suggestSignals(items: readonly DisplayItem[]): SuggestSignals {
  const files = new Set<string>();
  let prompt = '';
  let userTurns = 0;
  let failedInARow = 0;
  for (const item of items) {
    if (item.kind === 'user' && !item.subagent) {
      prompt = item.text;
      userTurns++;
    }
    if (item.kind !== 'tool' || item.subagent) continue;
    const input = item.input as { file_path?: unknown; notebook_path?: unknown } | null;
    const path = input?.file_path ?? input?.notebook_path;
    if (EDIT_TOOLS.has(item.name) && typeof path === 'string') files.add(path);
    if (item.result) failedInARow = item.result.isError ? failedInARow + 1 : 0;
  }
  return { prompt, editedFiles: files.size, userTurns, failedInARow };
}

export type SuggestReason = 'ask' | 'files' | 'turns' | 'errors';

/** Why the session looks bigger than its first prompt, or null when it doesn't. */
export function suggestReason(signals: SuggestSignals): SuggestReason | null {
  // The first message is the one Auto already read; only later ones count as a new ask.
  if (signals.userTurns > 1 && BIG_ASK.test(signals.prompt)) return 'ask';
  if (signals.editedFiles > SUGGEST_LIMITS.editedFiles) return 'files';
  if (signals.userTurns > SUGGEST_LIMITS.userTurns) return 'turns';
  if (signals.failedInARow >= SUGGEST_LIMITS.failedInARow) return 'errors';
  return null;
}

/** The next allowed model above the one Auto picked (one step, not the strongest), or null when there is none. */
export function strongerTier(pick: AutoPick): AutoTier | null {
  if (!pick.model) return null;
  return AUTO_TIERS.slice(AUTO_TIERS.indexOf(pick.model) + 1).find((t) => pick.allowed.includes(t)) ?? null;
}

/** What Auto suggests: more effort on the same model, or the next model up at `effort`. */
export type SuggestStep = { kind: 'effort'; effort: Effort } | { kind: 'model'; tier: AutoTier; effort: Effort };

/** The efforts a suggestion steps through. Past `high` the next model up often costs less, so it moves up a model instead. */
const EFFORT_STEPS: readonly Effort[] = ['low', 'medium', 'high'];

/**
 * The next step up, in the model guide's order: raise effort one level first, then move one model up, starting
 * again at `medium` (lower than the `high` it left). A new big ask goes straight to the next model: more thinking
 * won't give a model a skill it lacks. `effort` is the session's now; null is the model's default, `medium`.
 */
export function nextStep(pick: AutoPick, effort: Effort | null, reason: SuggestReason): SuggestStep | null {
  const at = EFFORT_STEPS.indexOf(effort ?? 'medium');
  const raise = at >= 0 && at < EFFORT_STEPS.length - 1 ? EFFORT_STEPS[at + 1]! : null;
  const tier = strongerTier(pick);
  if (raise && (reason !== 'ask' || !tier)) return { kind: 'effort', effort: raise };
  return tier ? { kind: 'model', tier, effort: 'medium' } : null;
}

/**
 * Whether to suggest a step up now: the setting is on, the session still runs on what Auto picked, it wasn't
 * suggested in this session before, the session has grown, and there is a step left (more effort or a stronger
 * allowed model).
 */
export function shouldSuggest(input: { enabled: boolean; pick: AutoPick | null; seen: boolean; signals: SuggestSignals; effort: Effort | null }): SuggestStep | null {
  const { pick } = input;
  if (!input.enabled || !pick?.model || pick.left || input.seen) return null;
  const reason = suggestReason(input.signals);
  return reason ? nextStep(pick, input.effort, reason) : null;
}
