import type { ModelOption } from '@seshboard/protocol';

/**
 * Copilot Fusion: a routing preference of Copilot's `auto` model ("tiers" such as Fusion Standard, High and Max) that
 * picks the models, and the way they work together, for each prompt. The runtime lists the tiers the account has
 * (`models.list`'s `auto`), and a session takes one with `setModel('auto', { autoTier })`. In Seshboard each tier is a
 * model of its own, `auto:<tier id>`, so the model menus, project defaults, queued items and pipelines keep it as they
 * keep a model.
 */

/** One of Auto's routing preferences, as the SDK's `AutoTierDescriptor` has it. */
export interface CopilotAutoTier {
  id: string;
  displayName: string;
  description: string;
  /** `auto` for Auto's own preferences, `fusion` for Fusion's. */
  type: string;
  fusionTier?: string;
  status: { enabled: boolean; pickerVisible?: boolean };
}

const TIER_PREFIX = 'auto:';

/** Seshboard's model value for one of Auto's tiers. */
export const tierModel = (tierId: string): string => `${TIER_PREFIX}${tierId}`;

/** What `model` asks Copilot for: a model, or Auto with one of its tiers. */
export function copilotModel(model: string): { model: string; autoTier?: string } {
  return model.startsWith(TIER_PREFIX) && model.length > TIER_PREFIX.length ? { model: 'auto', autoTier: model.slice(TIER_PREFIX.length) } : { model };
}

/** Whether `model` is one of Auto's tiers (Fusion), which has no effort of its own. */
export const isTierModel = (model: string | null | undefined): boolean => !!model && copilotModel(model).autoTier !== undefined;

/** The model a `session.model_change` names, in Seshboard's values: Auto with a tier is that tier. */
export function modelOfChange(data: { newModel?: unknown; autoTier?: unknown } | undefined): string | null {
  if (typeof data?.newModel !== 'string') return null;
  return data.newModel === 'auto' && typeof data.autoTier === 'string' && data.autoTier ? tierModel(data.autoTier) : data.newModel;
}

/** The Fusion tiers the account can pick, as models: the ones Copilot lists in its picker and has turned on. */
export function fusionModels(tiers: readonly CopilotAutoTier[] | undefined): ModelOption[] {
  return (tiers ?? [])
    .filter((t) => (t.type === 'fusion' || !!t.fusionTier) && t.status?.enabled && t.status.pickerVisible !== false)
    .map((t) => ({ value: tierModel(t.id), displayName: t.displayName, description: t.description ?? '', supportsEffort: false }));
}

/** The models with Fusion's tiers right after Copilot's Auto (first when it isn't listed), where Copilot CLI shows them. */
export function withFusion(models: ModelOption[], fusion: ModelOption[]): ModelOption[] {
  if (!fusion.length) return models;
  const auto = models.findIndex((m) => m.value === 'auto');
  return [...models.slice(0, auto + 1), ...fusion, ...models.slice(auto + 1)];
}
