import { PROVIDER_NAMES, type OptionalProvider, type ProviderInfo } from '@seshboard/protocol';
import type { ProviderProfile } from '../profiles/profileStore.ts';
import type { ProviderAdapter } from './provider.ts';
import { COPILOT_MODES, type CreateCopilotClient } from './copilot/copilotDriver.ts';
import { COPILOT_RESUME, copilotProvider } from './copilot/copilotProvider.ts';
import { copilotHome } from './copilot/copilotSource.ts';

export interface ProviderOptions {
  env: NodeJS.ProcessEnv;
  /** The user's home folder. */
  home: string;
  /** The login shell's environment, which providers' CLIs run with (their own config and login are found through it). */
  shellEnv: () => Promise<Record<string, string | undefined>>;
  /** A fake Copilot SDK and `copilot` (tests). */
  copilot?: { createClient?: CreateCopilotClient; binary?: () => Promise<{ path: string; version: string | null } | null> };
}

/**
 * Every provider Seshboard supports besides Claude Code, in the order Add profile lists them: what each is, for
 * Settings and the message box. Adding a provider is a line here and one in `createProvider`.
 */
export function providerCatalog({ env, home }: Pick<ProviderOptions, 'env' | 'home'>): ProviderInfo[] {
  return [{ id: 'copilot', name: PROVIDER_NAMES.copilot, defaultFolder: copilotHome(env, home), resumeCommand: COPILOT_RESUME, canStart: true, modes: COPILOT_MODES }];
}

/** The adapter for one provider profile: its folder, its runtime and its login. */
export function createProvider(profile: ProviderProfile, { home, shellEnv, copilot = {} }: ProviderOptions): ProviderAdapter {
  const kind: OptionalProvider = profile.provider;
  switch (kind) {
    case 'copilot':
      return copilotProvider({ profileId: profile.id, copilotHome: profile.home, userHome: home, shellEnv, ...copilot });
  }
}
