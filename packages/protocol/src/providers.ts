import { z } from 'zod';
import { PermissionMode } from './host.ts';
import { OPTIONAL_PROVIDERS, SESSION_PROVIDERS } from './providerConstants.ts';

export * from './providerConstants.ts';

export const SessionProviderSchema = z.enum(SESSION_PROVIDERS);
export const OptionalProviderSchema = z.enum(OPTIONAL_PROVIDERS);

/** One of Seshboard's permission modes as a provider has it, in its words ("Autopilot" for Copilot's `auto`). */
export const ProviderMode = z.object({ value: PermissionMode, label: z.string(), description: z.string() });
export type ProviderMode = z.infer<typeof ProviderMode>;

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
  /** Seshboard can start and continue its sessions (else they are read-only). */
  canStart: z.boolean(),
  /** The permission modes its sessions can run in (empty when it can't start sessions); the first is the default. */
  modes: z.array(ProviderMode),
});
export type ProviderInfo = z.infer<typeof ProviderInfo>;

export const ProvidersSnapshot = z.object({ providers: z.array(ProviderInfo) });
export type ProvidersSnapshot = z.infer<typeof ProvidersSnapshot>;

/**
 * Whether a provider's CLI can run sessions here. Signing in is the provider's own: Seshboard only says how, in
 * `problem`, and never handles a credential.
 */
export const ProviderStatus = z.object({
  /** Its CLI (null: not installed). */
  binary: z.string().nullable(),
  version: z.string().nullable(),
  signedIn: z.boolean(),
  /** Who it is signed in as, in the provider's words. */
  account: z.string().nullable(),
  /** What to do before it can run (install it, sign in with its CLI); null when it can. */
  problem: z.string().nullable(),
});
export type ProviderStatus = z.infer<typeof ProviderStatus>;
