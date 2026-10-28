import type { ModelOption } from '@seshboard/protocol/client';

/**
 * The model row a session's model belongs to. Claude Code reports the full id (`claude-opus-5-5`) while
 * the list holds aliases (`opus`), so fall back to the alias that resolves to it, preferring a named
 * alias over `default`, which may resolve to the same id.
 */
export function findModelOption(models: ModelOption[], model: string | null | undefined): ModelOption | undefined {
  if (!model) return undefined;
  const exact = models.find((m) => m.value === model);
  if (exact) return exact;
  const resolved = models.filter((m) => m.resolvedModel === model);
  return resolved.find((m) => m.value !== 'default') ?? resolved[0];
}
