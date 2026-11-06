import type { OptionalProvider, ProviderQuota, SessionProvider } from '@seshboard/protocol/client';

/**
 * How a provider's usage comes: Copilot's premium requests (`providers.quota`), or plan windows as Claude Code's
 * (`usage.get`: Codex's rate limits, its 5-hour and weekly windows). A new provider must say.
 */
export const USAGE_KIND: Record<OptionalProvider, 'quota' | 'plan'> = { copilot: 'quota', codex: 'plan' };

/** Whether a profile's usage is plan windows (`usage.get`): Claude Code's, and Codex's. */
export const hasPlanUsage = (provider: SessionProvider): boolean => provider === 'claude' || USAGE_KIND[provider] === 'plan';

/**
 * Plan windows only (Codex): no history, costs, breakdowns or charts, which read Claude Code's transcripts and its
 * recorded readings.
 */
export const planWindowsOnly = (provider: SessionProvider): boolean => provider !== 'claude' && USAGE_KIND[provider] === 'plan';

/** A reset date as Copilot gives it (`2026-12-01`, or a full ISO time), as "Dec 1"; a date alone is a local day. */
export function resetDay(resetsAt: string, locale?: string): string {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(resetsAt);
  const date = day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(resetsAt);
  return Number.isNaN(date.getTime()) ? resetsAt : date.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/** New session's usage line for a provider profile: "Copilot · Premium requests 14% · resets Dec 1". */
export function quotaLine(short: string, quota: ProviderQuota, locale?: string): string {
  const used = quota.entitlement === null ? `${quota.used.toLocaleString(locale)} used` : `${Math.round(quota.percentUsed)}%`;
  return [`${short}`, `Premium requests ${used}`, ...(quota.resetsAt ? [`resets ${resetDay(quota.resetsAt, locale)}`] : [])].join(' · ');
}

/** A session's footer: "Premium requests 212 of 1,500" (unlimited: "212 premium requests"). */
export function quotaFooter(quota: ProviderQuota, locale?: string): string {
  return quota.entitlement === null ? `${quota.used.toLocaleString(locale)} premium requests` : `Premium requests ${quota.used.toLocaleString(locale)} of ${quota.entitlement.toLocaleString(locale)}`;
}

/** What is left of the premium requests, in percent; null without a limit (an unlimited plan). */
export const quotaLeft = (quota: ProviderQuota): number | null => (quota.entitlement === null ? null : Math.max(0, Math.min(100, 100 - quota.percentUsed)));

/** The Usage view's line under the bar: "212 of 1,500 used", or "212 used, no limit on this plan". */
export function quotaUsed(quota: ProviderQuota, locale?: string): string {
  return quota.entitlement === null ? `${quota.used.toLocaleString(locale)} used, no limit on this plan` : `${quota.used.toLocaleString(locale)} of ${quota.entitlement.toLocaleString(locale)} used`;
}

/** The ring's tooltip: "Premium requests: 212 of 1,500 used (14%) · resets Dec 1". */
export function quotaSummary(quota: ProviderQuota, locale?: string): string {
  const used = quota.entitlement === null ? `${quota.used.toLocaleString(locale)} used, no limit on this plan` : `${quotaUsed(quota, locale)} (${Math.round(quota.percentUsed)}%)`;
  return [`Premium requests: ${used}`, ...(quota.resetsAt ? [`resets ${resetDay(quota.resetsAt, locale)}`] : [])].join(' · ');
}
