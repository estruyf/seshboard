import { useEffect, useMemo, useState } from 'react';
import { accountKey, type PlanHistory, type RemoteUsageBreakdown, type UsageBreakdown, type UsageGroup, type UsagePeriod } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { thisComputerName } from '../../lib/platform.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { useUsageView } from '../../state/usageViewStore.ts';
import { callComputer } from '../computers/callComputer.ts';
import { computersToAsk, engineGroup, mergeBreakdowns, notCounted, type ComputerRef, type MergedBreakdown, type Uncounted, type UsageViewGroup } from './usageMerge.ts';

const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** How often an open view asks again, to pick up new turns between the engine's notices. */
const POLL_MS = 60_000;

/**
 * A profile's token breakdown for a period, asked again whenever the engine reads new tokens for it (often during
 * the first read of the transcripts) and every minute. Null until the first answer.
 */
export function useBreakdown(profileId: string | null, period: UsagePeriod, groupBy: UsageGroup, model: string | null = null): UsageBreakdown | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [data, setData] = useState<UsageBreakdown | null>(null);
  useEffect(() => {
    if (!client || !profileId) return;
    let alive = true;
    const load = () =>
      void client.call('usage.breakdown', { profileId, period, groupBy, model, timeZone: timeZone() }).then(
        (result) => alive && setData(result),
        () => {},
      );
    load();
    const off = client.on('usage.tokens', ({ profileIds }) => profileIds.includes(profileId) && load());
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      off();
      clearInterval(timer);
    };
  }, [client, profileId, period, groupBy, model]);
  // A different question starts empty rather than showing the last answer under new labels.
  useEffect(() => setData(null), [profileId, period, groupBy, model]);
  return data;
}

/** What another computer answered: its breakdown, null when no profile there signs in to the account, or a failure. */
type Answer = { breakdown: RemoteUsageBreakdown | null } | { failed: true };

/**
 * The same account's breakdown on other computers, asked again every minute. `computers` are the ones to ask (ids
 * and names); nothing is asked without an account key.
 */
function useComputerBreakdowns(computers: readonly ComputerRef[], account: string | null, period: UsagePeriod, groupBy: UsageGroup, model: string | null): ReadonlyMap<string, Answer> {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [answers, setAnswers] = useState<ReadonlyMap<string, Answer>>(new Map());
  // The list changes on every status update; only who is asked matters.
  const ids = computers.map((c) => c.id).join('\n');
  useEffect(() => {
    setAnswers(new Map());
    if (!client || !account || !ids) return;
    let alive = true;
    const load = () => {
      for (const id of ids.split('\n')) {
        callComputer(client, id, 'usage.tokens', { account, period, groupBy, model, timeZone: timeZone() }).then(
          (result) => alive && setAnswers((now) => new Map(now).set(id, { breakdown: result.breakdown })),
          () => alive && setAnswers((now) => new Map(now).set(id, { failed: true })),
        );
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client, ids, account, period, groupBy, model]);
  return answers;
}

export interface CountedUsage {
  /** Null until this computer answers. */
  data: MergedBreakdown | null;
  /** The other computers counted in `data`. */
  counted: ComputerRef[];
  /** Paired computers that aren't, and why. */
  uncounted: Uncounted[];
  /** Whether other computers count at all: paired, and All computers chosen. */
  across: boolean;
  /** The profile isn't signed in to a claude.ai account, so other computers can't be matched to it. */
  noAccount: boolean;
}

/**
 * A profile's breakdown as the Usage view shows it: this computer's, plus the tokens of the same claude.ai account on
 * paired computers while All computers is chosen (Computer is a grouping only then).
 */
export function useCountedBreakdown(profileId: string | null, period: UsagePeriod, groupBy: UsageViewGroup, model: string | null = null): CountedUsage {
  const choice = useUsageView((s) => s.computers);
  const paired = useComputers((s) => s.status?.computers);
  const account = useProfiles((s) => s.profiles.find((p) => p.id === profileId)?.account ?? null);
  const key = useMemo(() => accountKey(account), [account]);
  const across = choice === 'all' && !!paired?.length;
  const group: UsageViewGroup = across || groupBy !== 'computer' ? groupBy : 'session';
  const { ask, uncounted } = useMemo(() => computersToAsk(across ? (paired ?? []) : []), [across, paired]);
  const local = useBreakdown(profileId, period, engineGroup(group), model);
  const answers = useComputerBreakdowns(ask, key, period, engineGroup(group), model);
  return useMemo(() => {
    const others: Array<{ computer: ComputerRef; breakdown: RemoteUsageBreakdown }> = [];
    const missing = [...uncounted];
    for (const computer of ask) {
      const answer = answers.get(computer.id);
      if (!answer) continue;
      if ('failed' in answer) missing.push(notCounted(computer, 'failed'));
      else if (!answer.breakdown) missing.push(notCounted(computer, 'no-account'));
      else others.push({ computer, breakdown: answer.breakdown });
    }
    return {
      data: local && (across ? mergeBreakdowns(local, others, group, thisComputerName()) : local),
      counted: others.map((o) => o.computer),
      uncounted: key ? missing : [],
      across,
      noAccount: across && !key,
    };
  }, [local, answers, ask, uncounted, across, group, key]);
}

/** A profile's plan % history for a period, asked again when its usage changes. */
export function usePlanHistory(profileId: string | null, period: UsagePeriod): PlanHistory | null {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [data, setData] = useState<PlanHistory | null>(null);
  useEffect(() => {
    if (!client || !profileId) return;
    let alive = true;
    const load = () =>
      void client.call('usage.history', { profileId, period, timeZone: timeZone() }).then(
        (result) => alive && setData(result),
        () => {},
      );
    load();
    const off = client.on('usage.changed', (event) => event.profileId === profileId && load());
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      off();
      clearInterval(timer);
    };
  }, [client, profileId, period]);
  return data;
}
