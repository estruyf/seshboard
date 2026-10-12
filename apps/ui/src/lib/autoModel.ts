import { AUTO_MODEL, AUTO_TIERS, estimatePhrase, estimateVsOpus, tierLabel, type AutoPick, type AutoTier, type ModelOption } from '@switchboard/protocol/client';
import type { Choice } from '../components/newSession/ChoiceMenu.tsx';

/** "Haiku, Sonnet or Opus": the models, in tier order, joined for a sentence. */
export function tierList(tiers: readonly AutoTier[], joiner = 'or'): string {
  const names = AUTO_TIERS.filter((t) => tiers.includes(t)).map(tierLabel);
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} ${joiner} ${names.at(-1)}`;
}

/** Auto's line in the model menu. */
export const autoDescription = (allowed: readonly AutoTier[]) => `Haiku reads your prompt and picks ${tierList(allowed)}. Picked once, when the session starts.`;

/** What a model saved as Auto does while Auto is off in Settings. */
export const AUTO_OFF_NOTE = 'Auto is off in Settings, so this session starts on your default model.';

/**
 * The model menu of New session, the palette and the queue: Auto first (when it's on), a line, then Default model
 * and the models. `defaultDescription` is Claude Code's line for its default.
 */
export function modelChoices(models: readonly ModelOption[], auto: { enabled: boolean; allowed: readonly AutoTier[] }, icon?: Choice<string>['icon']): Array<Choice<string>> {
  const rest: Array<Choice<string>> = [
    { value: '', label: 'Default model', description: models.find((m) => m.value === 'default')?.description || 'What Claude Code would pick' },
    ...models.filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.displayName, description: m.description })),
  ];
  if (!auto.enabled) return rest;
  return [{ value: AUTO_MODEL, label: 'Auto', description: autoDescription(auto.allowed), icon, separatorAfter: true }, ...rest];
}

/** The model a choice of Auto really starts with: with Auto off, the default model (''). */
export const effectiveModel = (model: string, autoEnabled: boolean) => (model === AUTO_MODEL && !autoEnabled ? '' : model);

/** The label of a model value for the chip: "Auto", "Default model", or the model's name. */
export function modelLabel(models: readonly ModelOption[], model: string): string {
  if (model === AUTO_MODEL) return 'Auto';
  return model ? (models.find((m) => m.value === model)?.displayName ?? model) : 'Default model';
}

/**
 * What a session's model chip says about Auto: nothing once you changed the model yourself, else the model it
 * picked ("Sonnet"), or "Default model" when picking failed.
 */
export function autoChipModel(pick: AutoPick | null | undefined): string | null {
  if (!pick || pick.left) return null;
  return pick.model ? tierLabel(pick.model) : 'Default model';
}

/** Haiku's reason for the first-turn line: the part before a colon, lower-cased, without the full stop ("a small, local change"). */
export function shortReason(reason: string): string {
  let short = reason.split(':')[0]!.trim().replace(/[.!]+$/, '');
  if (short.length > 60) short = `${short.slice(0, 60).replace(/\s+\S*$/, '')}…`;
  return short && short[0]!.toLowerCase() + short.slice(1);
}

/** The first-turn line when picking failed. */
export const failedLine = (reason: string) => `Auto couldn't pick a model (${reason[0]!.toLowerCase()}${reason.slice(1)}), so this session uses your default model.`;

/** The popover's Estimate: "About three fifths of what Opus would use (est.)". */
export const estimateLine = (tier: AutoTier) => `${estimatePhrase(estimateVsOpus(tier))} (est.)`;

/** The allowed models other than the picked one, strongest first: "Run again with Opus", "Use Opus from the next message". */
export function otherTiers(pick: AutoPick): AutoTier[] {
  return [...AUTO_TIERS].reverse().filter((t) => t !== pick.model && pick.allowed.includes(t));
}

/** The models Auto may pick after toggling `tier`; never none, so the last one stays checked. */
export function toggleTier(allowed: readonly AutoTier[], tier: AutoTier, on: boolean): AutoTier[] {
  const next = AUTO_TIERS.filter((t) => (t === tier ? on : allowed.includes(t)));
  return next.length ? next : [...allowed];
}
