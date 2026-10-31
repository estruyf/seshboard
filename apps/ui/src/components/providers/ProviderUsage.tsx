import { PROVIDER_SHORT_NAMES, type OptionalProvider } from '@seshboard/protocol/client';
import { levelOf, LEVEL_TEXT } from '../../lib/levels.ts';
import { useProviderQuota } from '../../state/providersStore.ts';
import { quotaFooter, quotaLine } from './quotaText.ts';

/**
 * A provider profile's premium requests (Copilot's), where Claude Code's plan usage goes: New session's usage line, or
 * a session's footer. Nothing while the provider hasn't said, or doesn't have them.
 */
export function ProviderUsage({ profileId, provider, footer = false }: { profileId: string; provider: OptionalProvider; footer?: boolean }) {
  const quota = useProviderQuota(profileId);
  if (!quota) return null;
  const level = quota.entitlement === null ? null : levelOf(quota.percentUsed);
  return (
    <span className={`truncate tabular-nums ${level && level !== 'ok' ? LEVEL_TEXT[level] : ''}`} data-provider-usage={provider}>
      {footer ? quotaFooter(quota) : quotaLine(PROVIDER_SHORT_NAMES[provider], quota)}
    </span>
  );
}
