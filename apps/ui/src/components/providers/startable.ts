import type { ClaudeProfile, ProviderInfo, SessionProvider } from '@seshboard/protocol/client';

type Catalog = readonly Pick<ProviderInfo, 'id' | 'canStart'>[];

/**
 * Whether Seshboard can start sessions with a provider: Claude Code always, another one when the engine's catalog says
 * so (`canStart`). OpenAI Codex can't yet: its sessions are read-only. Not in the catalog (not loaded yet): no.
 */
export function providerCanStart(provider: SessionProvider, catalog: Catalog): boolean {
  return provider === 'claude' || catalog.some((p) => p.id === provider && p.canStart);
}

/**
 * The profiles that can start a session, for everything that picks one to start with: New session's profile chip, a
 * project's profile, the default, triggers. `keep` stays listed anyway (the one picked now), so a choice never shows
 * empty.
 */
export function startableProfiles<T extends Pick<ClaudeProfile, 'id' | 'provider'>>(profiles: readonly T[], catalog: Catalog, keep?: string | null): T[] {
  return profiles.filter((p) => p.id === keep || providerCanStart(p.provider, catalog));
}

/**
 * The other tools that can run a pipeline's step: each provider that can start sessions and has a profile here, with
 * its first profile (whose models the step offers), in the catalog's order.
 */
export function stepToolProfiles<P extends Pick<ProviderInfo, 'id' | 'canStart'>>(profiles: readonly Pick<ClaudeProfile, 'id' | 'provider'>[], catalog: readonly P[]): Array<{ info: P; profileId: string }> {
  return catalog.flatMap((info) => {
    const profile = info.canStart ? profiles.find((p) => p.provider === info.id) : undefined;
    return profile ? [{ info, profileId: profile.id }] : [];
  });
}
