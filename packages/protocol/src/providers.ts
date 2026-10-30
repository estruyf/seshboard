import { z } from 'zod';
import { OPTIONAL_PROVIDERS, SESSION_PROVIDERS } from './providerConstants.ts';

export * from './providerConstants.ts';

export const SessionProviderSchema = z.enum(SESSION_PROVIDERS);
export const OptionalProviderSchema = z.enum(OPTIONAL_PROVIDERS);

/** One provider in Settings › Providers. */
export const ProviderInfo = z.object({
  id: OptionalProviderSchema,
  name: z.string(),
  /** Its sessions show up in the sidebar. Off until the user allows it. */
  allowed: z.boolean(),
  /** Its data folder exists on this computer (the provider was used here). */
  found: z.boolean(),
  /** Where its sessions are read from (`~/.copilot/session-state`). */
  folder: z.string(),
  /** The command that continues one of its sessions in its own CLI, with `{sessionId}` where the id goes. */
  resumeCommand: z.string(),
});
export type ProviderInfo = z.infer<typeof ProviderInfo>;

export const ProvidersSnapshot = z.object({ providers: z.array(ProviderInfo) });
export type ProvidersSnapshot = z.infer<typeof ProvidersSnapshot>;
