import { PROVIDER_NAMES, PROVIDER_SHORT_NAMES, type OptionalProvider, type ProviderQuota } from '@seshboard/protocol/client';

/**
 * Whether Seshboard shows a provider's usage: Copilot's premium requests. OpenAI Codex's rate limits come later (#276,
 * Phase 3). A new provider must say.
 */
export const SHOWS_USAGE: Record<OptionalProvider, boolean> = { copilot: true, codex: false };

/** The Usage view for a provider whose usage isn't shown: "Seshboard doesn't show OpenAI Codex usage yet." */
export const usageNotShown = (provider: OptionalProvider) => `Seshboard doesn't show ${PROVIDER_NAMES[provider]} usage yet.`;

/** The same under the message box, where there is little room: "Codex usage not shown yet". */
export const usageNotShownShort = (provider: OptionalProvider) => `${PROVIDER_SHORT_NAMES[provider]} usage not shown yet`;

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
