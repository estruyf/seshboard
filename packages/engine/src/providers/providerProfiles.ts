import type { ProviderProfile } from '../profiles/profileStore.ts';
import type { ProviderAdapter } from './provider.ts';

/**
 * One adapter per provider profile (Settings › Profiles), made when the profile is added and kept while its folder
 * stays the same: its runtime (a headless `copilot`) lives as long as the profile. A removed profile's runtime stops.
 */
export class ProviderProfiles {
  private readonly made = new Map<string, ProviderAdapter>();

  constructor(
    private readonly profiles: () => ProviderProfile[],
    private readonly make: (profile: ProviderProfile) => ProviderAdapter,
  ) {}

  /** Every provider profile's adapter, made or dropped to match the profiles now. */
  adapters(): ProviderAdapter[] {
    const wanted = this.profiles();
    const keys = new Set(wanted.map(keyOf));
    for (const [key, adapter] of this.made) {
      if (keys.has(key)) continue;
      this.made.delete(key);
      void adapter.driver?.dispose().catch(() => {});
    }
    return wanted.map((profile) => {
      const key = keyOf(profile);
      let adapter = this.made.get(key);
      if (!adapter) this.made.set(key, (adapter = this.make(profile)));
      return adapter;
    });
  }

  adapter(profileId: string | null | undefined): ProviderAdapter | undefined {
    return profileId ? this.adapters().find((a) => a.profileId === profileId) : undefined;
  }

  /** Stops every runtime (the engine closes). */
  dispose(): void {
    for (const adapter of this.made.values()) void adapter.driver?.dispose().catch(() => {});
    this.made.clear();
  }
}

const keyOf = (profile: ProviderProfile) => `${profile.id}\0${profile.provider}\0${profile.home}`;
