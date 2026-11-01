import { otherProviderOf, type ProviderFeature, type ProviderInfo, type SessionProvider } from '@seshboard/protocol/client';

/**
 * Whether one of Claude Code's own actions (rename, delete, fork…) applies to a session: always to Claude Code's, and to
 * another provider's when that provider has it (`ProviderInfo.supports`). A session without a summary yet is Claude
 * Code's as far as the sidebar knows.
 */
export function sessionCan(session: { provider?: SessionProvider | null } | null | undefined, feature: ProviderFeature, providers: ReadonlyArray<Pick<ProviderInfo, 'id' | 'supports'>>): boolean {
  const other = session ? otherProviderOf(session) : null;
  return !other || (providers.find((p) => p.id === other)?.supports.includes(feature) ?? false);
}
