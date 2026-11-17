/**
 * "Fable" for `claude-fable-5-1`, "Sonnet" for `claude-3-5-sonnet-20241022`, "Opus" for `opus[1m]`: the model's family,
 * as the plan names it. The id itself when it has none; "Unknown" without one. Pure, with tests in `modelName.test.ts`.
 */
export function modelName(model: string | null | undefined): string {
  if (!model) return 'Unknown';
  // A context suffix (`opus[1m]`) is not part of the family.
  const id = model.replace(/\[[^\]]*\]$/, '');
  const family = id.split(/[-_]/).find((part) => part !== 'claude' && /^[a-z]+$/i.test(part));
  return family ? family[0]!.toUpperCase() + family.slice(1) : model;
}
