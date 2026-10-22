import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type { UsageLimit, UsageSnapshot } from '@switchboard/protocol/client';
import type { EngineClient } from '../engine/connection.ts';
import { useEngineConnection } from '../engine/useEngine.ts';
import { useProfile, useProfiles } from '../state/profilesStore.ts';
import { ProfileBadge, ProfileDot } from './profiles/ProfileBadge.tsx';
import { Meter } from './ui/Meter.tsx';
import type { UsageLine } from './session/foldedMeter.ts';
import { costComputersNotes, countdown, limitCosts, limitLabel, nextUsageEntry, resetLabel, spokenLimit, usageMessage, usageSummary, visibleLimits, type UsageEntry } from './usageFormat.ts';
import { usePreferences } from '../state/preferencesStore.ts';
import { useWindowCosts } from './usage/useWindowCosts.ts';
import { openUsage } from '../state/usageViewStore.ts';
import { thisComputerName } from '../lib/platform.ts';

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

/** Loads a profile's usage the first time a band shows it. Undefined until the first answer. */
export function useUsageFor(profileId: string): UsageEntry | undefined {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  useEffect(() => {
    if (!client || useUsage.getState().usage.has(profileId)) return;
    // Fetching starts a short-lived Claude Code process; let the window finish starting first.
    const timer = setTimeout(() => void fetchUsage(client, profileId), performance.now() < 10_000 ? 2_000 : 0);
    return () => clearTimeout(timer);
  }, [client, profileId]);
  return useUsage((s) => s.usage.get(profileId));
}

/** A usage bar is a button that opens the Usage view: it keeps its look and lights up on hover. */
const BAND_HOVER = 'no-drag cursor-pointer hover:bg-border/45 focus-visible:bg-border/45';

const money = (minorUnits: number, currency: string | null) =>
  new Intl.NumberFormat(undefined, { style: 'currency', currency: currency ?? 'USD', maximumFractionDigits: 2 }).format(minorUnits / 100);

/** The footer's short names: "5h" for the session window, "Week" for the weekly one (with its scope, such as a model). */
function footerLabel(limit: UsageLimit): string {
  const label = limitLabel(limit);
  return label.startsWith('7d') ? `Week${label.slice(2)}` : label;
}

/** The footer's windows as short names and percentages, for the ring that stands in for the footer while the terminal is open below. */
export function useUsageLines(profileId?: string | null): UsageLine[] {
  const defaultId = useProfiles((s) => s.defaultId);
  const usage = useUsageFor(profileId ?? defaultId)?.usage;
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
 * `footer`: small rings (`5h ◔ 9%   Week ◔ 18%`) for the quiet line under a session's composer, reset times in the tooltips;
 * the profile is shown next to it by the caller.
 * `tray`: the footer with the profile in front and when each window resets (`● Work  5h ▬ 9% · resets 3h 10m`),
 * for New session. Its parent must be an `@container`: the reset times go first when it is narrow, then the bars.
 */
export function UsageBand({ profileId, compact = false, footer = false, tray = false }: { profileId?: string | null; compact?: boolean; footer?: boolean; tray?: boolean }) {
  const defaultId = useProfiles((s) => s.defaultId);
  const id = profileId ?? defaultId;
  const profile = useProfile(id);
  const usage = useUsageFor(id)?.usage;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const limits = usage ? visibleLimits(usage.limits) : [];
  const extra = usage?.extraUsage;
  // The estimated API cost of each window, after its bar (Settings › Usage), in the footer and New session's tray.
  const showCost = usePreferences((s) => s.prefs.showCost && s.prefs.showBarCost) && (footer || tray);
  const currency = usePreferences((s) => s.prefs.costCurrency);
  const priced = useWindowCosts(id, showCost && limits.length > 0);
  const costs = limitCosts(limits, priced.windows, showCost ? currency : null);
  const costNotes = costComputersNotes(thisComputerName(), priced.counted, priced.uncounted.map((u) => u.reason));
  if (tray) {
    // The profile shows at once, also while its usage loads: it is the answer to "which account?".
    return (
      <button
        type="button"
        onClick={() => openUsage(id)}
        aria-label={`Plan usage${profile ? ` of ${profile.name}` : ''}. Open usage`}
        data-tooltip={usageSummary(limits, now, costs, costNotes)}
        className={`flex min-w-0 items-center gap-3 rounded-md px-1.5 py-0.5 -mx-1.5 text-meta text-muted ${BAND_HOVER}`}
        data-usage-band
        data-usage-profile={id}
      >
        {profile && (
          <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap" data-usage-profile-name>
            <ProfileDot color={profile.color} />
            <span className="truncate text-text">{profile.name}</span>
          </span>
        )}
        {limits.map((limit, i) => (
          <span key={`${limit.kind}:${limit.scope ?? ''}`} className="flex items-center gap-1.5 whitespace-nowrap">
            <Meter percent={limit.percent} label={spokenLimit(limit, now, costs[i])} showValue hideTrackNarrow="tight">
              <span>{footerLabel(limit)}</span>
            </Meter>
            {/* The meter's label already says the cost. */}
            {costs[i] && (
              <span aria-hidden className="tabular-nums text-faint @max-[560px]:hidden" data-usage-cost={limit.kind}>
                {costs[i]}
              </span>
            )}
            {/* The meter's label already says when it resets. */}
            {limit.resetsAt && (
              <span aria-hidden className="text-faint @max-[640px]:hidden" data-usage-reset>
                · resets {resetLabel(limit.resetsAt, now)}
              </span>
            )}
          </span>
        ))}
        {extra?.enabled && extra.usedCredits !== null && extra.usedCredits > 0 && (
          <span className="whitespace-nowrap @max-[640px]:hidden">
            <span className="text-ok">{money(extra.usedCredits, extra.currency)}</span> extra
          </span>
        )}
      </button>
    );
  }
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

/**
 * One Claude profile's plan usage as a card, for Home: its name and account, a full-width bar per
 * limit in the level's colour with the reset countdown, and any extra usage. `activity` is a line
 * about its sessions ("2 working · 5 today").
 */
export function ProfileUsageCard({ profileId, activity }: { profileId: string; activity: string }) {
  const profile = useProfiles((s) => s.profiles.find((p) => p.id === profileId));
  const entry = useUsageFor(profileId);
  const usage = entry?.usage ?? null;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const limits = usage ? visibleLimits(usage.limits) : [];
  const extra = usage?.extraUsage;
  return (
    <article className="grid content-start gap-2.5 rounded-xl border border-border bg-card p-3" aria-label={`${profile?.name ?? 'Profile'}: usage`} data-home-profile={profileId}>
      <div className="flex min-w-0 items-center gap-2">
        {/* Always named here (the badge elsewhere hides itself while there is only one profile). */}
        {profile && <ProfileDot color={profile.color} size={8} />}
        <span className="truncate text-ui font-semibold">{profile?.name ?? 'Claude'}</span>
        {profile?.account?.email && <span className="min-w-0 truncate text-meta text-faint">{profile.account.email}</span>}
      </div>
      <p className="text-meta text-muted">{activity}</p>
      {limits.length === 0 ? (
        <p className="text-meta text-faint" data-tooltip={entry?.error ?? undefined} data-usage-status>
          {usageMessage(entry)}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => openUsage(profileId)}
          aria-label={`Plan usage: ${limits.map((l) => spokenLimit(l, now)).join('. ')}. Open usage`}
          data-tooltip={usageSummary(limits, now)}
          className={`-mx-1.5 grid gap-2 rounded-md px-1.5 py-1 text-left ${BAND_HOVER}`}
          data-usage-band
          data-usage-profile={profileId}
        >
          {limits.map((limit) => (
            <Meter key={`${limit.kind}:${limit.scope ?? ''}`} percent={limit.percent} size="md" showValue>
              <span className="text-muted">{footerLabel(limit)}</span>
              <span className="flex-1" />
              {limit.resetsAt && <span className="text-faint">resets in {countdown(limit.resetsAt, now)}</span>}
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
