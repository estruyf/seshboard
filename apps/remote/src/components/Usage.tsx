import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { RemoteProfileUsage, UsageLimit } from '@switchboard/protocol/remote-client';
import { PROFILE_DOT } from '../lib/options.ts';
import { cardRows, compactProfiles, compactText, windowPercent } from '../lib/profiles.ts';
import { countdown, LEVEL_FILL, LEVEL_TEXT, levelOf, limitName, spokenLimit, usageMessage, visibleLimits, withUsage } from '../lib/usage.ts';
import type { Client } from './Connected.tsx';
import { connectionOf } from './connectionOf.ts';
import { useNow } from './SessionList.tsx';
import { SectionHeader } from './ui.tsx';

/** Each computer's last numbers, for this tab: shown while offline, also after a reload. */
const CACHE = 'switchboard-remote:usage';

function cachedUsage(computer: string): RemoteProfileUsage[] | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(`${CACHE}:${computer}`) ?? 'null') as RemoteProfileUsage[] | null;
    return Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

type Usages = ReadonlyMap<string, RemoteProfileUsage[] | null>;

/**
 * Every computer's plan usage, by its id: asked for once it is connected and each time the app comes back on screen
 * (the computer checks again when its numbers are more than a minute old), then kept up to date by `usage.changed`.
 * Null for a computer until its first answer.
 */
export function useUsages(computers: ReadonlyArray<{ id: string; client: Client }>): Usages {
  const [lists, setLists] = useState<Usages>(() => new Map(computers.map((c) => [c.id, cachedUsage(c.id)])));
  const latest = useRef(computers);
  latest.current = computers;
  // Asked again when a computer is paired, forgotten, or connects again.
  const key = computers.map((c) => `${c.id}#${connectionOf(c.client)}`).join(' ');
  useEffect(() => {
    const change = (id: string, next: (current: RemoteProfileUsage[] | null) => RemoteProfileUsage[] | null) =>
      setLists((current) => {
        const value = next(current.has(id) ? current.get(id)! : cachedUsage(id));
        try {
          if (value) sessionStorage.setItem(`${CACHE}:${id}`, JSON.stringify(value));
        } catch {
          // Storage is full or off: the numbers just aren't kept.
        }
        return new Map(current).set(id, value);
      });
    const loads: Array<() => void> = [];
    const offs: Array<() => void> = [];
    for (const { id, client } of latest.current) {
      if (!client) continue;
      // A Switchboard from before Remote had usage doesn't know the method: an empty list says so.
      const load = () => void client.call('usage.get', {}).then(({ profiles }) => change(id, () => profiles), () => change(id, (current) => current ?? []));
      loads.push(load);
      offs.push(client.on('usage.changed', ({ profileId, usage }) => change(id, (current) => current && withUsage(current, profileId, usage))));
    }
    loads.forEach((load) => load());
    const onVisible = () => {
      if (document.visibilityState === 'visible') loads.forEach((load) => load());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      offs.forEach((off) => off());
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key]);
  return useMemo(() => new Map(computers.map((c) => [c.id, lists.has(c.id) ? lists.get(c.id)! : cachedUsage(c.id)])), [lists, key]);
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

/** Whether the first screen's usage card is unfolded, for this tab. */
const OPEN_KEY = 'switchboard-remote:usage-open';

function wasOpen(): boolean {
  try {
    return sessionStorage.getItem(OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The first screen's usage: "Usage" with the 5-hour and week bars on one row, or with more than one profile a
 * "Profiles" card with a row per profile (the two closest to a limit, and "+N", from three on). A tap unfolds every
 * profile's full card. Nothing until the first numbers come.
 */
export function UsageCard({ usage, offline = false }: { usage: RemoteProfileUsage[] | null; offline?: boolean }) {
  const now = useNow();
  const [open, setOpen] = useState(wasOpen);
  const id = useId();
  if (!usage?.length) return null;
  const toggle = () => {
    setOpen(!open);
    try {
      sessionStorage.setItem(OPEN_KEY, open ? '0' : '1');
    } catch {
      // Storage is off: it stays the way it is until the page closes.
    }
  };
  const many = usage.length > 1;
  const { rows, more } = cardRows(usage);
  return (
    <section aria-label={many ? 'Profiles' : 'Usage'} className={`flex flex-col gap-2 transition-opacity ${offline ? 'opacity-60' : ''}`} data-remote-usage-card>
      <button type="button" onClick={toggle} aria-expanded={open} aria-controls={id} className="flex w-full flex-col gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-border/45 active:bg-selected">
        {many ? (
          <>
            <span className="flex items-center gap-2 text-meta font-semibold tracking-wide text-faint uppercase">
              <span className="flex-1">Profiles</span>
              <span className="w-[5.5rem] normal-case">5h</span>
              <span className="w-[5.5rem] normal-case">Week</span>
              <ChevronDown aria-hidden className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </span>
            {rows.map((entry) => (
              <span key={entry.profile.id} className="flex min-w-0 items-center gap-2 text-ui" data-remote-usage-row={entry.profile.id}>
                <span aria-hidden className={`size-2 shrink-0 rounded-full ${PROFILE_DOT[entry.profile.color]}`} />
                <span className="min-w-0 flex-1 truncate">{entry.profile.name}</span>
                <MiniBar label="5-hour limit" percent={windowPercent(entry, 'session')} />
                <MiniBar label="Weekly limit" percent={windowPercent(entry, 'weekly_all')} />
                <span className="w-3.5" />
              </span>
            ))}
            {more > 0 && <span className="text-meta text-muted">+{more}</span>}
          </>
        ) : (
          <span className="flex min-w-0 items-center gap-2 text-ui" data-remote-usage-row={usage[0]!.profile.id}>
            <span className="flex-1 font-semibold">Usage</span>
            <span className="text-meta text-faint">5h</span>
            <MiniBar label="5-hour limit" percent={windowPercent(usage[0]!, 'session')} />
            <span className="text-meta text-faint">Week</span>
            <MiniBar label="Weekly limit" percent={windowPercent(usage[0]!, 'weekly_all')} />
            <ChevronDown aria-hidden className={`size-3.5 shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        )}
      </button>
      {open && (
        <div id={id} className="grid grid-cols-1 gap-2">
          {usage.map((entry) => (
            <ProfileCard key={entry.profile.id} entry={entry} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}

/** A small bar and its %, in the level's colour; a dash with no number. */
function MiniBar({ label, percent }: { label: string; percent: number | null }) {
  if (percent === null) {
    return (
      <span className="w-[5.5rem] text-meta text-faint" aria-label={`${label}: not reported`}>
        –
      </span>
    );
  }
  const value = Math.round(Math.min(100, Math.max(0, percent)));
  const level = levelOf(percent);
  return (
    <span role="meter" aria-label={`${label}: ${value}% used`} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} className="flex w-[5.5rem] shrink-0 items-center gap-1.5">
      <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
        <span className={`block h-full rounded-full ${LEVEL_FILL[level]}`} style={{ width: `max(${value}%, 4px)` }} />
      </span>
      <span aria-hidden className={`w-8 text-right text-meta font-semibold tabular-nums ${LEVEL_TEXT[level]}`}>
        {value}%
      </span>
    </span>
  );
}

/**
 * The drawer's Home row: each profile's dot, name and the highest of its limits in the level's colour ("● Work 82%
 * ● Personal 18%"), or the closest to a limit and "+2" from three profiles on. Nothing with one profile.
 */
export function ProfileStrip({ usage }: { usage: RemoteProfileUsage[] | null }) {
  const compact = compactProfiles(usage ?? []);
  if (!compact.items.length) return null;
  return (
    <span className="flex min-w-0 items-center gap-3 text-meta" aria-label={compactText(compact)} data-remote-profile-strip>
      {compact.items.map((item) => (
        <span key={item.id} aria-hidden className="flex min-w-0 items-center gap-1">
          <span className={`size-1.5 shrink-0 rounded-full ${PROFILE_DOT[item.color]}`} />
          <span className="truncate text-muted">{item.name}</span>
          {item.percent !== null && <span className={`font-semibold tabular-nums ${LEVEL_TEXT[item.level] || 'text-muted'}`}>{item.percent}%</span>}
        </span>
      ))}
      {compact.more > 0 && (
        <span aria-hidden className="shrink-0 text-faint">
          +{compact.more}
        </span>
      )}
    </span>
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
