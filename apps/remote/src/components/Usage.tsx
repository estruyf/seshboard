import { useEffect, useState } from 'react';
import type { RemoteProfileUsage, UsageLimit } from '@switchboard/protocol/remote-client';
import { PROFILE_DOT } from '../lib/options.ts';
import { countdown, LEVEL_FILL, LEVEL_TEXT, levelOf, limitName, spokenLimit, usageMessage, visibleLimits, withUsage } from '../lib/usage.ts';
import type { Client } from './Connected.tsx';
import { useNow } from './SessionList.tsx';
import { SectionHeader } from './ui.tsx';

/** The last numbers, for this tab: shown on Home while offline, also after a reload. */
const CACHE = 'switchboard-remote:usage';

function cachedUsage(): RemoteProfileUsage[] | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(CACHE) ?? 'null') as RemoteProfileUsage[] | null;
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Every profile's plan usage: asked for once connected and each time the app comes back on screen (the computer
 * checks again when its numbers are more than a minute old), then kept up to date by `usage.changed`. Null until the
 * first answer.
 */
export function useUsage(client: Client): RemoteProfileUsage[] | null {
  const [list, setList] = useState<RemoteProfileUsage[] | null>(cachedUsage);
  useEffect(() => {
    if (!client) return;
    // A Switchboard from before Remote had usage doesn't know the method: an empty list says so.
    const load = () => void client.call('usage.get', {}).then((result) => setList(result.profiles), () => setList((current) => current ?? []));
    load();
    const off = client.on('usage.changed', ({ profileId, usage }) => setList((current) => current && withUsage(current, profileId, usage)));
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [client]);
  useEffect(() => {
    try {
      if (list) sessionStorage.setItem(CACHE, JSON.stringify(list));
    } catch {
      // Storage is full or off: the numbers just aren't kept.
    }
  }, [list]);
  return list;
}

/**
 * Home's usage: a card per Claude profile with a bar for the 5-hour window and the week, as on the computer's Home.
 * "Profiles" with more than one, else "Usage".
 */
export function UsageSection({ usage, offline = false, className = '' }: { usage: RemoteProfileUsage[] | null; offline?: boolean; className?: string }) {
  const now = useNow();
  return (
    <section aria-labelledby="home-usage" aria-busy={usage === null || undefined} className={`flex flex-col ${className}`} data-remote-usage>
      <SectionHeader id="home-usage" label={usage && usage.length > 1 ? 'Profiles' : 'Usage'} className="px-0" />
      {usage === null || usage.length === 0 ? (
        <p className="pt-1 text-meta text-faint">{usage ? 'Update Switchboard on your computer to see usage here.' : offline ? 'Usage shows once your computer is back.' : 'Loading usage…'}</p>
      ) : (
        <div className={`grid grid-cols-1 gap-3 pt-1 transition-opacity lg:grid-cols-2 ${offline ? 'opacity-60' : ''}`}>
          {usage.map((entry) => (
            <ProfileCard key={entry.profile.id} entry={entry} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}

function ProfileCard({ entry, now }: { entry: RemoteProfileUsage; now: number }) {
  const limits = entry.usage ? visibleLimits(entry.usage.limits) : [];
  return (
    <article aria-label={`${entry.profile.name}: usage`} className="flex min-w-0 flex-col gap-2.5 rounded-xl border border-border bg-card p-3" data-remote-usage-profile={entry.profile.id}>
      <div className="flex min-w-0 items-center gap-2">
        <span aria-hidden className={`size-2 shrink-0 rounded-full ${PROFILE_DOT[entry.profile.color]}`} />
        <h3 className="truncate text-ui font-semibold">{entry.profile.name}</h3>
      </div>
      {limits.length === 0 ? (
        <p className="text-meta text-faint" title={entry.error ?? undefined}>
          {usageMessage(entry)}
        </p>
      ) : (
        limits.map((limit) => <UsageBar key={`${limit.kind}:${limit.scope ?? ''}`} limit={limit} now={now} />)
      )}
    </article>
  );
}

/** One window: its name, when it resets and the % used on a line, the bar under it in the level's colour. */
function UsageBar({ limit, now }: { limit: UsageLimit; now: number }) {
  const percent = Math.round(Math.min(100, Math.max(0, limit.percent)));
  const level = levelOf(limit.percent);
  return (
    <div role="meter" aria-label={spokenLimit(limit, now)} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} className="flex flex-col gap-1.5 text-meta">
      <div aria-hidden className="flex items-baseline gap-2">
        <span className="text-muted">{limitName(limit)}</span>
        <span className="flex-1" />
        {limit.resetsAt && <span className="text-faint">resets in {countdown(limit.resetsAt, now)}</span>}
        <span className={`font-semibold tabular-nums ${LEVEL_TEXT[level]}`}>{percent}%</span>
      </div>
      <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-border">
        {/* A sliver at 0%, so an empty bar still reads as a bar. */}
        <div className={`h-full rounded-full ${LEVEL_FILL[level]}`} style={{ width: `max(${percent}%, 6px)` }} />
      </div>
    </div>
  );
}
