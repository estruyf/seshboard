import { useMemo } from 'react';
import { useProfiles } from '../../state/profilesStore.ts';
import { useProviderQuotas } from '../../state/providersStore.ts';
import type { SessionRowData } from '../../state/sessionsStore.ts';
import { homeLimits, ProfileUsageCard, QuietProfileLine, useUsageForAll, type HomeProfileUsage } from '../UsageBand.tsx';
import { SectionHeader } from '../ui/SectionHeader.tsx';
import { profileActivity, profileActivityLine, profileIsBusy, quietNumbers } from './homeModel.ts';

/**
 * Home's usage column: every profile, the default first. A busy one (sessions today, or over half a limit) keeps its
 * card with bars; the quiet ones share one card, a line each. "Usage" with one profile, "Profiles" with more.
 */
export function HomeUsage({ rows, now }: { rows: readonly SessionRowData[]; now: number }) {
  const all = useProfiles((s) => s.profiles);
  const profiles = useMemo(() => [...all].filter((p) => p.exists).sort((a, b) => Number(b.isDefault) - Number(a.isDefault)), [all]);
  const claudeIds = useMemo(() => profiles.filter((p) => p.provider === 'claude').map((p) => p.id), [profiles]);
  const providerIds = useMemo(() => profiles.filter((p) => p.provider !== 'claude').map((p) => p.id), [profiles]);
  const entries = useUsageForAll(claudeIds);
  const quotas = useProviderQuotas(providerIds);
  const perProfile = useMemo(() => profileActivity(rows, now), [rows, now]);
  if (profiles.length === 0) return null;

  const usages: HomeProfileUsage[] = profiles.map((profile) => (profile.provider === 'claude' ? { profile, entry: entries.get(profile.id) } : { profile, quota: quotas.get(profile.id) ?? null }));
  const busy = usages.filter((u) => profileIsBusy(perProfile.get(u.profile.id), homeLimits(u).map((l) => l.percent)));
  const quiet = usages.filter((u) => !busy.includes(u));
  return (
    <section aria-labelledby="home-usage" className="grid min-w-0 content-start gap-2.5" data-home-usage data-home-profiles>
      <SectionHeader as="h2" headingId="home-usage">
        {profiles.length > 1 ? 'Profiles' : 'Usage'}
      </SectionHeader>
      {busy.map((usage) => (
        <ProfileUsageCard key={usage.profile.id} usage={usage} activity={profileActivityLine(perProfile.get(usage.profile.id))} now={now} />
      ))}
      {quiet.length > 0 && (
        <ul className="grid gap-0.5 rounded-xl bg-text/6 px-3.5 py-2.5" aria-label="Quiet profiles" data-home-quiet-profiles>
          {quiet.map((usage) => (
            <QuietProfileLine key={usage.profile.id} usage={usage} numbers={quietNumbers(homeLimits(usage))} now={now} />
          ))}
        </ul>
      )}
    </section>
  );
}
