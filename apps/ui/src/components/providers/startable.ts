import type { ClaudeProfile, ProviderInfo, SessionProvider } from '@seshboard/protocol/client';

type Catalog = readonly Pick<ProviderInfo, 'id' | 'canStart'>[];

/**
 * Whether Seshboard can start sessions with a provider: no only when the engine's catalog says so (`canStart: false`,
 * OpenAI Codex for now, whose sessions are read-only). Not in the catalog (not loaded yet, or `providers.list` failed):
 * yes, so Copilot keeps its profiles meanwhile; the engine refuses a start that can't run anyway.
 */
export function providerCanStart(provider: SessionProvider, catalog: Catalog): boolean {
  return provider === 'claude' || catalog.find((p) => p.id === provider)?.canStart !== false;
}

/** The word after a profile that can't start sessions, where it stays listed because it is picked (a stale default). */
export const READ_ONLY_LABEL = 'read-only';

/** A profile's name in a list of profiles to start with, marked when it can't start ("Codex (read-only)"). */
export function startLabel(profile: Pick<ClaudeProfile, 'name' | 'provider'>, catalog: Catalog): string {
  return providerCanStart(profile.provider, catalog) ? profile.name : `${profile.name} (${READ_ONLY_LABEL})`;
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
