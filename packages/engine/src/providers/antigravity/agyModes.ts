import type { Effort, ModelOption, PermissionMode, ProviderMode } from '@seshboard/protocol';

/**
 * Seshboard's modes for an Antigravity session, named as Claude Code's. Antigravity has the same four
 * (`session/set_mode`), so each is its own: it asks, approves edits or keeps going itself, as in its CLI.
 */
export const AGY_MODES: ProviderMode[] = [
  { value: 'default', label: 'Ask before edits', description: 'Approve every edit and command' },
  { value: 'acceptEdits', label: 'Accept edits', description: 'Edits in the folder apply, commands still ask' },
  { value: 'plan', label: 'Plan mode', description: 'Antigravity plans before it changes anything' },
  { value: 'auto', label: 'Auto mode', description: 'Edits and safe commands go on, irreversible ones still ask' },
];

const MODE_IDS: Partial<Record<PermissionMode, string>> = { default: 'default', acceptEdits: 'accept-edits', plan: 'plan', auto: 'auto' };

/**
 * Antigravity's mode for one of Seshboard's. A read-only session (a pipeline's read-only step) asks before every edit
 * and command, and the driver refuses whatever would write. A mode Antigravity has no match for is Ask before edits.
 */
export const agyModeId = (mode: PermissionMode, readOnly = false): string => (readOnly ? 'default' : (MODE_IDS[mode] ?? 'default'));

/** One choice of a `select` config option (`model`, `thought_level`). */
export interface AgyConfigChoice {
  value: string;
  name?: string;
  description?: string;
}

/** A config option of a session (`session/new`'s `configOptions`). */
export interface AgyConfigOption {
  id: string;
  name?: string;
  type?: string;
  currentValue?: unknown;
  options?: AgyConfigChoice[];
}

/** Antigravity's thinking levels as Seshboard's effort (`Extra` is `xhigh`). */
const EFFORTS: Record<string, Effort> = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' };

/** A session's config option by id, when it is a list to choose from. */
export function configOption(options: unknown, id: string): AgyConfigOption | null {
  if (!Array.isArray(options)) return null;
  const found = options.find((o) => o && typeof o === 'object' && (o as AgyConfigOption).id === id) as AgyConfigOption | undefined;
  return found && Array.isArray(found.options) ? found : null;
}

/** The value a config option is set to now. */
export const currentValue = (options: unknown, id: string): string | null => {
  const value = configOption(options, id)?.currentValue;
  return typeof value === 'string' ? value : null;
};

/** The thinking levels a session offers, as Seshboard's effort. */
export function agyEfforts(options: unknown): Effort[] {
  return (configOption(options, 'thought_level')?.options ?? []).flatMap((o) => (typeof o.value === 'string' && EFFORTS[o.value] ? [EFFORTS[o.value]!] : []));
}

/** Seshboard's effort as one of the session's thinking levels: the nearest it has below (`max` is `xhigh`). */
export function agyThoughtLevel(effort: Effort, options: unknown): string | null {
  const levels = (configOption(options, 'thought_level')?.options ?? []).map((o) => o.value);
  const order: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
  for (let i = order.indexOf(effort); i >= 0; i--) if (levels.includes(order[i]!)) return order[i]!;
  return levels[0] ?? null;
}

/**
 * The models a session offers (its `model` config option) as the model picker shows them. Every model takes the
 * session's thinking levels: Antigravity sets them per session, not per model.
 */
export function agyModels(options: unknown): ModelOption[] {
  const efforts = agyEfforts(options);
  return (configOption(options, 'model')?.options ?? []).flatMap((o) =>
    typeof o.value === 'string' && o.value ? [{ value: o.value, displayName: o.name || o.value, description: o.description ?? '', supportsEffort: efforts.length > 0, ...(efforts.length ? { efforts } : {}) }] : [],
  );
}
