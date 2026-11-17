import { useEffect, useState } from 'react';
import { PROVIDER_NAMES, type OptionalProvider, type ProviderQuota } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { levelOf, LEVEL_FILL, LEVEL_TEXT } from '../../lib/levels.ts';
import { usePreferences } from '../../state/preferencesStore.ts';
import { quotaLeft, quotaUsed, resetDay } from '../providers/quotaText.ts';
import { costText } from '../usageFormat.ts';
import { useBreakdown } from './useUsageData.ts';

/**
 * The Usage view for a profile of another provider (GitHub Copilot): its premium requests this period, from the
 * provider's own account (`providers.quota`), in place of Claude Code's plan limits and tokens. `refresh` asks again.
 */
export function ProviderUsagePanel({ profileId, provider, refresh }: { profileId: string; provider: OptionalProvider; refresh: number }) {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [state, setState] = useState<{ profileId: string; quota: ProviderQuota | null; error: string | null } | null>(null);
  useEffect(() => {
    if (!client) return;
    let current = true;
    void client.call('providers.quota', { profileId }).then(
      ({ quota }) => current && setState({ profileId, quota, error: null }),
      (error: Error) => current && setState({ profileId, quota: null, error: error.message }),
    );
    return () => {
      current = false;
    };
  }, [client, profileId, refresh]);

  const name = PROVIDER_NAMES[provider];
  const shown = state?.profileId === profileId ? state : null;
  if (!shown || !shown.quota) {
    const text = !shown ? `Asking ${name}…` : (shown.error ?? `${name} didn't say how many premium requests are left. Sign in on this profile in Settings › Profiles, then refresh.`);
    return (
      <p className="rounded-xl border border-border bg-card p-4 text-ui text-muted" data-usage-status data-provider-quota-status>
        {text}
      </p>
    );
  }
  const { quota } = shown;
  if (quota.tokenBilling) return <AiCredits profileId={profileId} provider={provider} name={name} />;
  const left = quotaLeft(quota);
  const used = left === null ? null : 100 - left;
  const level = used === null ? null : levelOf(used);
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
      <article className="grid min-w-0 gap-2.5 rounded-xl border border-border bg-card p-4" aria-label={left === null ? `Premium requests: ${quota.used} used` : `Premium requests: ${Math.round(left)}% left`} data-provider-quota={provider}>
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-ui font-semibold text-text">Premium requests</span>
          <span className="truncate text-meta text-muted">{name}</span>
        </p>
        <p className="flex items-baseline gap-1.5">
          <span className={`text-display font-semibold tabular-nums ${level && level !== 'ok' ? LEVEL_TEXT[level] : 'text-text'}`} data-provider-quota-left>
            {left === null ? quota.used.toLocaleString() : `${Math.round(left)}%`}
          </span>
          <span className="text-body text-muted">{left === null ? 'used' : 'left'}</span>
        </p>
        {used !== null && level && (
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/30" role="meter" aria-label={`Premium requests: ${Math.round(used)}% used`} aria-valuenow={Math.round(used)} aria-valuemin={0} aria-valuemax={100}>
            <span className={`block h-full ${LEVEL_FILL[level]}`} style={{ width: `${used}%` }} />
          </div>
        )}
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-meta text-muted">
          <span>{quotaUsed(quota)}</span>
          {quota.resetsAt && (
            <span>
              Resets <span className="font-semibold text-text">{resetDay(quota.resetsAt)}</span>
            </span>
          )}
        </p>
      </article>
      <p className="self-start text-meta text-muted">
        {name} counts premium requests per account, for every session it runs, in Seshboard or elsewhere, and Ask about this session too. A model can cost less or more than one request per message.
      </p>
    </div>
  );
}

/**
 * Copilot billed per token, in AI credits (a US cent each): no requests to count, so the card shows what this
 * computer's sessions charged in the last 30 days, from what Copilot wrote in their files when each one ended. No reset
 * date: the quota's is about premium requests, and Copilot answers it with the current time there.
 */
function AiCredits({ profileId, provider, name }: { profileId: string; provider: OptionalProvider; name: string }) {
  const usd = useBreakdown(profileId, 'month', 'session')?.totals.cost ?? null;
  const currency = usePreferences((s) => s.prefs.costCurrency);
  const credits = usd === null ? null : Math.round(usd * 100);
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
      <article className="grid min-w-0 gap-2.5 rounded-xl border border-border bg-card p-4" aria-label={credits === null ? 'AI credits' : `AI credits: ${credits} in the last 30 days`} data-provider-quota={provider} data-provider-credits>
        <p className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-ui font-semibold text-text">AI credits</span>
          <span className="truncate text-meta text-muted">{name}</span>
        </p>
        <p className="flex items-baseline gap-1.5">
          <span className="text-display font-semibold tabular-nums text-text" data-provider-credits-used>
            {credits === null ? '…' : credits.toLocaleString()}
          </span>
          <span className="text-body text-muted">in the last 30 days</span>
        </p>
        <p className="text-meta text-muted">{usd === null ? 'Counting…' : `${costText(usd, currency)} on this computer`}</p>
      </article>
      <p className="self-start text-meta text-muted">
        {name} bills this account per token, in AI credits. One credit is US$0.01. This counts the sessions on this computer once each one ends. The Tokens tab shows what each session cost.
      </p>
    </div>
  );
}
