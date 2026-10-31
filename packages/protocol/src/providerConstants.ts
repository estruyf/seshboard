/**
 * The agents Seshboard reads sessions from. Claude Code is always on; the others stay hidden until a profile of theirs
 * is added in Settings › Profiles. Kept free of zod for the renderer.
 */
export const SESSION_PROVIDERS = ['claude', 'copilot'] as const;
export type SessionProvider = (typeof SESSION_PROVIDERS)[number];

/** The providers besides Claude Code, which can be allowed or not. */
export const OPTIONAL_PROVIDERS = ['copilot'] as const satisfies readonly SessionProvider[];
export type OptionalProvider = (typeof OPTIONAL_PROVIDERS)[number];

export const PROVIDER_NAMES: Record<SessionProvider, string> = { claude: 'Claude Code', copilot: 'GitHub Copilot' };

/** A session's provider: summaries from before providers existed (and the phone's) have none, and are Claude's. */
export const providerOf = (session: { provider?: SessionProvider | null | undefined }): SessionProvider => session.provider ?? 'claude';

/** The provider of another agent's session; null for Claude Code's. */
export const otherProviderOf = (session: { provider?: SessionProvider | null | undefined }): OptionalProvider | null => {
  const provider = providerOf(session);
  return provider === 'claude' ? null : provider;
};

/**
 * Another provider's session: Claude Code's own actions (fork, rewind, Ask, rename, delete, the clean-up) don't apply.
 * Sending does when the provider can start sessions (`ProviderInfo.canStart`); otherwise it is read-only.
 */
export const isOtherProviderSession = (session: { provider?: SessionProvider | null | undefined }): boolean => otherProviderOf(session) !== null;
