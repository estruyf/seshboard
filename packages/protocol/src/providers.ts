import { z } from 'zod';
import { PermissionMode } from './host.ts';
import { OPTIONAL_PROVIDERS, PROVIDER_FEATURES, SESSION_PROVIDERS } from './providerConstants.ts';

export * from './providerConstants.ts';

export const SessionProviderSchema = z.enum(SESSION_PROVIDERS);
export const OptionalProviderSchema = z.enum(OPTIONAL_PROVIDERS);

/** One of Seshboard's permission modes as a provider has it, in its words ("Autopilot" for Copilot's `auto`). */
export const ProviderMode = z.object({ value: PermissionMode, label: z.string(), description: z.string() });
export type ProviderMode = z.infer<typeof ProviderMode>;

/**
 * A provider besides Claude Code that a profile can use (Settings › Profiles, Add profile): what it is, not whether it is
 * used. A profile of it is what reads and runs its sessions.
 */
export const ProviderInfo = z.object({
  id: OptionalProviderSchema,
  name: z.string(),
  /** Its own config folder on this computer (`~/.copilot`, or `$COPILOT_HOME`), offered for a new profile. */
  defaultFolder: z.string(),
  /** The command that continues one of its sessions in its own CLI, with `{sessionId}` where the id goes. */
  resumeCommand: z.string(),
  /** Seshboard can start and continue its sessions (else they are read-only). */
  canStart: z.boolean(),
  /** The permission modes its sessions can run in (empty when it can't start sessions); the first is the default. */
  modes: z.array(ProviderMode),
  /** How to install its CLI, for Add profile when it is missing. */
  installCommand: z.string(),
  /** Claude Code's own features it has too (`PROVIDER_FEATURES`); the rest are Claude Code only, for now. */
  supports: z.array(z.enum(PROVIDER_FEATURES)),
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
  /** The account's login name (`estruyf`), when the provider says it. */
  login: z.string().nullable(),
  /** What to do before it can run (install it, sign in with its CLI); null when it can. */
  problem: z.string().nullable(),
});
export type ProviderStatus = z.infer<typeof ProviderStatus>;

/**
 * A provider found on this computer without a profile of it (`providers.detect`): Settings › Profiles offers to add it,
 * and Add profile says what it found. Its CLI's own status for its own folder; Seshboard never handles its login.
 */
export const ProviderDetection = z.object({
  id: OptionalProviderSchema,
  installed: z.boolean(),
  version: z.string().nullable(),
  /** Its own folder (`~/.copilot`, or `$COPILOT_HOME`), and whether it exists. */
  folder: z.string(),
  folderExists: z.boolean(),
  /** The sessions in that folder. */
  sessions: z.number().int().nonnegative(),
  signedIn: z.boolean(),
  /** Who that folder is signed in as (`estruyf`). */
  login: z.string().nullable(),
});
export type ProviderDetection = z.infer<typeof ProviderDetection>;

/** A provider account's premium requests this period (Copilot's), from its own CLI. */
export const ProviderQuota = z.object({
  used: z.number().nonnegative(),
  /** What the plan includes; null when unlimited. */
  entitlement: z.number().nonnegative().nullable(),
  /** 0–100, of the entitlement. */
  percentUsed: z.number().min(0).max(100),
  /** When it resets (ISO date), if the provider says. */
  resetsAt: z.string().nullable(),
});
export type ProviderQuota = z.infer<typeof ProviderQuota>;
