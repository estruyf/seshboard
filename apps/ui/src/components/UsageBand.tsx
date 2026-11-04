import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { ClaudeProfile, ProviderQuota, UsageLimit, UsageSnapshot } from '@seshboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useProfiles } from '../state/profilesStore.ts';
import { ProfileBadge, ProfileDot } from './profiles/ProfileBadge.tsx';
import { Meter } from './ui/Meter.tsx';
import type { UsageLine } from './session/foldedMeter.ts';
import { costComputersNotes, countdown, limitCosts, limitLabel, nextUsageEntry, spokenLimit, usageMessage, usageSummary, visibleLimits, type UsageEntry } from './usageFormat.ts';
import { usePreferences } from '../state/preferencesStore.ts';
import { useWindowCosts } from './usage/useWindowCosts.ts';
import { openUsage } from '../state/usageViewStore.ts';
import { thisComputerName } from '../lib/platform.ts';
import { quotaSummary, resetDay } from './providers/quotaText.ts';

interface UsageState {
  /** Plan usage per Claude profile (each login has its own limits). No entry: not loaded yet. */
  usage: Map<string, UsageEntry>;
  /** Profiles a band has shown; refreshed when the window comes back into focus (also after a failed fetch). */
  wanted: Set<string>;
  set(profileId: string, result: { usage: UsageSnapshot | null; error?: string | null }): void;
}

export const useUsage = create<UsageState>()((set) => ({
  usage: new Map(),
  wanted: new Set(),
  set: (profileId, result) =>
    set((s) => ({
      usage: new Map(s.usage).set(profileId, nextUsageEntry(s.usage.get(profileId), result)),
      wanted: s.wanted.has(profileId) ? s.wanted : new Set(s.wanted).add(profileId),
    })),
}));

/** Asks the engine for a profile's usage (`refresh`: fetch now rather than from its cache) and stores the answer, or why there is none. */
export function fetchUsage(client: EngineClient, profileId: string, refresh = false): Promise<void> {
  return client.call('usage.get', { refresh, profileId }).then(
    (result) => useUsage.getState().set(profileId, result),
    (error: unknown) => useUsage.getState().set(profileId, { usage: null, error: error instanceof Error ? error.message : String(error) }),
  );
}

/** Follows usage updates, and refreshes the profiles on screen when the window comes back into focus. */
export function useUsageSync(): void {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client) return;
    const off = client.on('usage.changed', ({ profileId, usage }) => useUsage.getState().set(profileId, { usage }));
    const onFocus = () => {
      for (const profileId of useUsage.getState().wanted) void fetchUsage(client, profileId);
    };
    window.addEventListener('focus', onFocus);
    return () => {
      off();
      window.removeEventListener('focus', onFocus);
    };
  }, [client]);
}

/** Loads a profile's usage the first time a band shows it. Undefined until the first answer, and for no profile (null: another provider's, which has no plan usage). */
export function useUsageFor(profileId: string | null): UsageEntry | undefined {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client || profileId === null || useUsage.getState().usage.has(profileId)) return;
    // Fetching starts a short-lived Claude Code process; let the window finish starting first.
    const timer = setTimeout(() => void fetchUsage(client, profileId), performance.now() < 10_000 ? 2_000 : 0);
    return () => clearTimeout(timer);
  }, [client, profileId]);
  return useUsage((s) => (profileId === null ? undefined : s.usage.get(profileId)));
}

/** `useUsageFor` for several Claude profiles at once (Home's usage column): each one's entry, loaded the first time it shows. */
export function useUsageForAll(profileIds: readonly string[]): ReadonlyMap<string, UsageEntry> {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const key = profileIds.join('\0');
  useEffect(() => {
    if (!client) return;
    const missing = profileIds.filter((id) => !useUsage.getState().usage.has(id));
    if (missing.length === 0) return;
    // Fetching starts a short-lived Claude Code process; let the window finish starting first.
    const timer = setTimeout(() => missing.forEach((id) => void fetchUsage(client, id)), performance.now() < 10_000 ? 2_000 : 0);
    return () => clearTimeout(timer);
  }, [client, key]);
  return useUsage((s) => s.usage);
}

/** A usage bar is a button that opens the Usage view: it keeps its look and lights up on hover. */
const BAND_HOVER = 'no-drag cursor-pointer hover:bg-border/45 focus-visible:bg-border/45';

const money = (minorUnits: number, currency: string | null) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 2 }).format(minorUnits / 100);

/** The footer's short names: "5h" for the session window, "Week" for the weekly one (with its scope, such as a model). */
export function footerLabel(limit: UsageLimit): string {
  const label = limitLabel(limit);
  return label.startsWith('7d') ? `Week${label.slice(2)}` : label;
}

/** The footer's windows as short names and percentages, for the ring that stands in for the footer while the terminal is open below. */
export function useUsageLines(profileId?: string | null, enabled = true): UsageLine[] {
  const defaultId = useProfiles((s) => s.defaultId);
  // Another provider's session has no plan usage: nothing is asked (`enabled` false).
  const usage = useUsageFor(enabled ? (profileId ?? defaultId) : null)?.usage;
  return useMemo(() => (usage ? visibleLimits(usage.limits).map((limit) => ({ label: footerLabel(limit), percent: limit.percent })) : []), [usage]);
}

/** A window's tooltip: when it resets, as a time and a countdown. */
const resetTitle = (limit: UsageLimit, now: number) =>
  limit.resetsAt
    ? `Resets ${new Date(limit.resetsAt).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })} (in ${countdown(limit.resetsAt, now)})`
    : undefined;

/**
 * Plan usage, like the claude-stats mod: one pill per window with a ring and a reset countdown.
 * Shows the limits of the given Claude profile (the default one when omitted).
 * `compact` drops the pills for a single line (`6% 5h · 4h44m`), for the new session's route tray.
 * `footer`: small rings (`5h ◔ 9%   Week ◔ 18%`) for the tray under the message box, reset times in the tooltips;
 * the profile is a chip on the same tray.
 */
export function UsageBand({ profileId, compact = false, footer = false }: { profileId?: string | null; compact?: boolean; footer?: boolean }) {
  const defaultId = useProfiles((s) => s.defaultId);
  const id = profileId ?? defaultId;
  const usage = useUsageFor(id)?.usage;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const limits = usage ? visibleLimits(usage.limits) : [];
  const extra = usage?.extraUsage;
  // The estimated API cost of each window, after its bar (Settings › Usage), in the footer and New session's tray.
  const showCost = usePreferences((s) => s.prefs.showCost && s.prefs.showBarCost) && footer;
  const currency = usePreferences((s) => s.prefs.costCurrency);
  const priced = useWindowCosts(id, showCost && limits.length > 0);
  const costs = limitCosts(limits, priced.windows, showCost ? currency : null);
  const costNotes = costComputersNotes(thisComputerName(), priced.counted, priced.uncounted.map((u) => u.reason));
  if (!usage || limits.length === 0) return null;
  // Each pill is a meter, read as one sentence ("5-hour limit: 6% used, resets in 4h3m") instead of "6% 5h".
  const meter = (limit: UsageLimit) => ({
    role: 'meter',
    'aria-label': spokenLimit(limit, now),
    'aria-valuenow': Math.round(Math.min(100, Math.max(0, limit.percent))),
    'aria-valuemin': 0,
    'aria-valuemax': 100,
  });

  if (footer) {
    return (
      <button
        type="button"
        onClick={() => openUsage(id)}
        aria-label={`Plan usage: ${limits.map((l, i) => spokenLimit(l, now, costs[i])).join('. ')}. Open usage`}
        data-tooltip={usageSummary(limits, now, costs, costNotes)}
        className={`flex min-w-0 items-center gap-3 rounded-md px-1 py-0.5 text-meta text-muted ${BAND_HOVER}`}
        data-usage-band
        data-usage-profile={id}
      >
        {limits.map((limit, i) => (
          <span key={`${limit.kind}:${limit.scope ?? ''}`} className="flex items-center gap-1.5 whitespace-nowrap">
            {/* Rings rather than bars: the line also holds the cost and the context window, so it runs out of room fast. */}
            <Meter kind="ring" percent={limit.percent} showValue hideTrackNarrow>
              <span>{footerLabel(limit)}</span>
            </Meter>
            {costs[i] && (
              <span className="tabular-nums text-faint @max-[400px]/meters:hidden" data-usage-cost={limit.kind}>
                {costs[i]}
              </span>
            )}
          </span>
        ))}
        {extra?.enabled && extra.usedCredits !== null && extra.usedCredits > 0 && (
          <span className="whitespace-nowrap @max-[400px]/meters:hidden">
            <span className="text-ok">{money(extra.usedCredits, extra.currency)}</span> extra
          </span>
        )}
      </button>
    );
  }

  if (compact) {
    return (
      <div role="group" aria-label="Plan usage" className="flex shrink-0 items-center divide-x divide-border text-meta" data-usage-band data-usage-profile={id}>
        {limits.map((limit) => (
          <div
            key={`${limit.kind}:${limit.scope ?? ''}`}
            {...meter(limit)}
            className="flex items-center gap-1.5 px-2.5 whitespace-nowrap first:pl-0 last:pr-0"
            data-tooltip={resetTitle(limit, now)}
          >
            <Meter kind="ring" size="md" percent={limit.percent} />
            <span className="font-semibold text-muted tabular-nums">{Math.round(limit.percent)}%</span>
            <span className="text-muted">
              {limitLabel(limit)}
              {limit.resetsAt && ` · ${countdown(limit.resetsAt, now)}`}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role="group" aria-label="Plan usage" className="flex flex-wrap items-center gap-1.5" data-usage-band data-usage-profile={id}>
      <ProfileBadge profileId={id} className="mr-0.5 text-ui" />
      {limits.map((limit) => (
        <div
          key={`${limit.kind}:${limit.scope ?? ''}`}
          {...meter(limit)}
          className="flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-ui"
          data-tooltip={resetTitle(limit, now)}
        >
          <Meter kind="ring" size="md" percent={limit.percent} />
          <span className="font-semibold tabular-nums">{Math.round(limit.percent)}%</span>
          <span className="text-muted">
            {limitLabel(limit)}
            {limit.resetsAt && ` · resets ${countdown(limit.resetsAt, now)}`}
          </span>
        </div>
      ))}
      {extra?.enabled && extra.usedCredits !== null && extra.usedCredits > 0 && (
        <div className="flex h-7 items-center gap-1.5 rounded-full border border-border bg-card px-2.5 text-ui">
          <span className="font-semibold text-ok">{money(extra.usedCredits, extra.currency)}</span>
          <span className="text-muted">extra usage{extra.monthlyLimit !== null && ` of ${money(extra.monthlyLimit, extra.currency)}`}</span>
        </div>
      )}
    </div>
  );
}

/** What Home's usage column knows of a profile: its plan usage (Claude Code's) or premium requests (another provider's). */
export interface HomeProfileUsage {
  profile: ClaudeProfile;
  /** Claude Code's plan usage; undefined until it has loaded, and for another provider's profile. */
  entry?: UsageEntry;
  /** Another provider's premium requests (GitHub Copilot's); null while it hasn't said. */
  quota?: ProviderQuota | null;
}

/** The limits a profile's line and bars show, by their short names ("5h", "Week", "Premium requests"). */
export function homeLimits({ profile, entry, quota }: HomeProfileUsage): { label: string; percent: number }[] {
  if (profile.provider !== 'claude') return quota && quota.entitlement !== null ? [{ label: 'Premium requests', percent: quota.percentUsed }] : [];
  return entry?.usage ? visibleLimits(entry.usage.limits).map((limit) => ({ label: footerLabel(limit), percent: limit.percent })) : [];
}

/**
 * A busy profile on Home (sessions today, or over half a limit): its name and account, what its sessions are doing
 * ("2 working"), and a thin bar per limit in the level's colour with the reset countdown (premium requests for
 * another provider), and any extra usage. The bars open Usage.
 */
export function ProfileUsageCard({ usage, activity, now }: { usage: HomeProfileUsage; activity: string; now: number }) {
  const { profile, entry, quota } = usage;
  const provider = profile.provider !== 'claude' ? profile.provider : null;
  const limits = entry?.usage ? visibleLimits(entry.usage.limits) : [];
  const extra = entry?.usage?.extraUsage;
  return (
    <article className="grid content-start gap-2 rounded-xl bg-text/6 px-3.5 py-3" aria-label={`${profile.name}: usage`} data-home-profile={profile.id}>
      <div className="flex min-w-0 items-center gap-2">
        {/* Always named here (the badge elsewhere hides itself while there is only one profile). */}
        <ProfileDot color={profile.color} size={7} />
        <span className="shrink-0 truncate text-ui font-semibold">{profile.name}</span>
        {profile.account?.email && <span className="min-w-0 truncate text-meta text-faint">{profile.account.email}</span>}
        <span className="flex-1" />
        <span className="shrink-0 text-meta text-muted">{activity}</span>
      </div>
      {provider ? (
        quota ? (
          <button type="button" onClick={() => openUsage(profile.id)} aria-label={`${quotaSummary(quota)}. Open usage`} data-tooltip={quotaSummary(quota)} className={`-mx-1.5 grid gap-2 rounded-md px-1.5 py-1 text-left ${BAND_HOVER}`} data-provider-usage={provider}>
            {quota.entitlement === null ? (
              <span className="text-meta text-muted">{quota.used.toLocaleString()} premium requests used, no limit on this plan</span>
            ) : (
              <Meter percent={quota.percentUsed} size="compact" showValue>
                <span className="text-muted">Premium requests</span>
                <span className="flex-1" />
                {quota.resetsAt && <span className="text-faint">resets {resetDay(quota.resetsAt)}</span>}
              </Meter>
            )}
          </button>
        ) : null
      ) : limits.length === 0 ? (
        <p className="text-meta text-faint" data-tooltip={entry?.error ?? undefined} data-usage-status>
          {usageMessage(entry)}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => openUsage(profile.id)}
          aria-label={`Plan usage: ${limits.map((l) => spokenLimit(l, now)).join('. ')}. Open usage`}
          data-tooltip={usageSummary(limits, now)}
          className={`-mx-1.5 grid gap-2 rounded-md px-1.5 py-1 text-left ${BAND_HOVER}`}
          data-usage-band
          data-usage-profile={profile.id}
        >
          {limits.map((limit) => (
            <Meter key={`${limit.kind}:${limit.scope ?? ''}`} percent={limit.percent} size="compact" showValue>
              <span className="text-muted">{footerLabel(limit)}</span>
              <span className="flex-1" />
              {limit.resetsAt && <span className="text-faint">{countdown(limit.resetsAt, now)}</span>}
            </Meter>
          ))}
        </button>
      )}
      {extra?.enabled && extra.usedCredits !== null && extra.usedCredits > 0 && (
        <p className="text-meta text-muted">
          <span className="font-semibold text-ok">{money(extra.usedCredits, extra.currency)}</span> extra usage{extra.monthlyLimit !== null && ` of ${money(extra.monthlyLimit, extra.currency)}`}
        </p>
      )}
    </article>
  );
}

/**
 * A quiet profile on Home (no sessions today, under half of every limit), as one line in the shared card: its dot, its
 * name and its numbers ("5h 1% · Week 8%", "Premium requests 12%"). The line opens Usage, with the details on hover.
 */
export function QuietProfileLine({ usage, numbers, now }: { usage: HomeProfileUsage; numbers: string; now: number }) {
  const { profile, entry, quota } = usage;
  const provider = profile.provider !== 'claude' ? profile.provider : null;
  const limits = entry?.usage ? visibleLimits(entry.usage.limits) : [];
  const summary = provider ? (quota ? quotaSummary(quota) : null) : limits.length ? usageSummary(limits, now) : null;
  const text = numbers || (provider ? (quota ? `${quota.used.toLocaleString()} premium requests` : '') : usageMessage(entry));
  return (
    <li className="grid min-w-0" data-home-profile={profile.id}>
      <button
        type="button"
        onClick={() => openUsage(profile.id)}
        aria-label={`${profile.name}: ${summary ?? text}. Open usage`}
        data-tooltip={summary ?? entry?.error ?? undefined}
        className={`-mx-1.5 flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 text-left text-ui ${BAND_HOVER}`}
        data-provider-usage={provider ?? undefined}
        data-usage-status={!provider && limits.length === 0 ? '' : undefined}
      >
        <ProfileDot color={profile.color} size={7} />
        <span className="shrink-0 truncate text-muted">{profile.name}</span>
        <span className="min-w-0 truncate text-meta text-faint tabular-nums">{text}</span>
      </button>
    </li>
  );
}
