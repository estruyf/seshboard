import { PROVIDER_SHORT_NAMES, type OptionalProvider } from '@seshboard/protocol/client';
import { levelOf, LEVEL_TEXT } from '../../lib/levels.ts';
import { useProviderQuota } from '../../state/providersStore.ts';
import { openUsage } from '../../state/usageViewStore.ts';
import { Meter } from '../ui/Meter.tsx';
import { quotaLine, quotaSummary } from './quotaText.ts';

/** A usage bar is a button that opens the Usage view: it keeps its look and lights up on hover (as `UsageBand`'s). */
const HOVER = 'no-drag cursor-pointer hover:bg-border/45 focus-visible:bg-border/45';

/**
 * A provider profile's premium requests (Copilot's), where Claude Code's plan usage goes. `line`: New session's usage
 * line. `footer`: a ring that fills as they are used, on the left of a session's footer, like Claude Code's windows;
 * it shows the details on hover and opens Usage. Nothing while the provider hasn't said, or doesn't have them. (Home's
 * usage column draws its own, `ProfileUsageCard`.)
 */
export function ProviderUsage({ profileId, provider, form = 'line' }: { profileId: string; provider: OptionalProvider; form?: 'line' | 'footer' }) {
  const quota = useProviderQuota(profileId);
  if (!quota) return null;
  const level = quota.entitlement === null ? null : levelOf(quota.percentUsed);
  const summary = quotaSummary(quota);
  if (form === 'line') {
    return (
      <span className={`truncate tabular-nums ${level && level !== 'ok' ? LEVEL_TEXT[level] : ''}`} data-provider-usage={provider}>
        {quotaLine(PROVIDER_SHORT_NAMES[provider], quota)}
      </span>
    );
  }
  const unlimited = quota.entitlement === null;
  return (
    <button type="button" onClick={() => openUsage(profileId)} aria-label={`${summary}. Open usage`} data-tooltip={summary} className={`flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-meta text-muted ${HOVER}`} data-provider-usage={provider}>
      {unlimited ? (
        <span className="whitespace-nowrap tabular-nums">{quota.used.toLocaleString()} premium requests</span>
      ) : (
        <Meter kind="ring" percent={quota.percentUsed} showValue hideTrackNarrow>
          <span>Premium</span>
        </Meter>
      )}
    </button>
  );
}
