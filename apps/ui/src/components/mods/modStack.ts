/**
 * What sits between the conversation and the message box, top to bottom: Seshboard's own permission or question
 * cards always first (a mod can never push them down or stand in for them), then the mods' bands in plugin order,
 * then Up next. Pure, so it can be tested.
 */
export type StackItem = { kind: 'permission'; id: string } | { kind: 'band'; plugin: string } | { kind: 'up-next' };

export function promptStack(permissions: readonly string[], bands: readonly string[], pluginOrder: readonly string[], upNext: boolean): StackItem[] {
  const rank = (plugin: string) => {
    const at = pluginOrder.indexOf(plugin);
    return at < 0 ? pluginOrder.length : at;
  };
  const sorted = bands.map((plugin, index) => ({ plugin, index })).sort((a, b) => rank(a.plugin) - rank(b.plugin) || a.index - b.index);
  return [
    ...permissions.map((id) => ({ kind: 'permission' as const, id })),
    ...sorted.map(({ plugin }) => ({ kind: 'band' as const, plugin })),
    ...(upNext ? [{ kind: 'up-next' as const }] : []),
  ];
}

/** The tallest a band gets before it scrolls inside. */
export const BAND_MAX_PX = 160;
