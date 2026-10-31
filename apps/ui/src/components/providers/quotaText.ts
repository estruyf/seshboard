import type { ProviderQuota } from '@seshboard/protocol/client';

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
