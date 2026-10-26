import { useEffect, useMemo, useState } from 'react';
import { accountKey, REMOTE_FEATURE_COSTS, type WindowCost } from '@seshboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useComputers } from '../../state/computersStore.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { callComputer } from '../computers/callComputer.ts';
import { addWindowCosts, computersToAsk, notCounted, type ComputerRef, type Uncounted } from './usageMerge.ts';

/** How often a usage bar asks again, to pick up new turns between the engine's notices. */
const POLL_MS = 60_000;

export interface WindowCosts {
  /** Each running window's cost: this computer's tokens and those of the paired computers in `counted`. */
  windows: WindowCost[];
  /** The other computers whose tokens are in it. */
  counted: ComputerRef[];
  /** Paired computers that aren't, and why. */
  uncounted: Uncounted[];
}

const NONE: WindowCosts = { windows: [], counted: [], uncounted: [] };

/**
 * The estimated API cost of a profile's running plan windows, asked again when the engine reads new tokens for it,
 * when its plan usage changes (a window reset) and every minute. The plan's windows count every computer the account
 * is used on, so the same windows are asked of the paired computers signed in to it (`usage.windowCosts`, with the
 * starts this computer's plan gave) and added up. Empty until the first answer, and while `enabled` is off.
 */
export function useWindowCosts(profileId: string, enabled = true): WindowCosts {
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [local, setLocal] = useState<WindowCost[]>([]);
  const [answers, setAnswers] = useState<ReadonlyMap<string, WindowCost[] | 'no-account' | 'failed'>>(new Map());
  const account = useProfiles((s) => s.profiles.find((p) => p.id === profileId)?.account ?? null);
  const key = useMemo(() => accountKey(account), [account]);
  const paired = useComputers((s) => s.status?.computers);
  const { ask, uncounted } = useMemo(() => computersToAsk(paired ?? [], REMOTE_FEATURE_COSTS), [paired]);
  // The status changes often; only who is asked, and about which windows, matters.
  const askIds = ask.map((c) => c.id).join('\n');
  const windows = local.map((w) => `${w.kind}|${w.scope ?? ''}|${w.from}`).join('\n');

  useEffect(() => {
    setLocal([]);
    if (!client || !enabled) return;
    let alive = true;
    const load = () =>
      void client.call('usage.cost', { profileId }).then(
        (result) => alive && setLocal(result.windows),
        () => {},
      );
    load();
    const offTokens = client.on('usage.tokens', ({ profileIds }) => profileIds.includes(profileId) && load());
    const offUsage = client.on('usage.changed', (event) => event.profileId === profileId && load());
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      offTokens();
      offUsage();
      clearInterval(timer);
    };
  }, [client, profileId, enabled]);

  useEffect(() => {
    setAnswers(new Map());
    if (!client || !enabled || !key || !askIds || !windows) return;
    let alive = true;
    const asked = windows.split('\n').map((line) => {
      const [kind, scope, from] = line.split('|');
      return { kind: kind!, scope: scope || null, from: Number(from) };
    });
    const load = () => {
      for (const id of askIds.split('\n')) {
        callComputer(client, id, 'usage.windowCosts', { account: key, windows: asked }).then(
          (result) => alive && setAnswers((now) => new Map(now).set(id, result.windows ?? 'no-account')),
          () => alive && setAnswers((now) => new Map(now).set(id, 'failed')),
        );
      }
    };
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client, enabled, key, askIds, windows]);

  return useMemo(() => {
    if (!enabled || local.length === 0) return NONE;
    const counted: ComputerRef[] = [];
    const missing = [...uncounted];
    const lists: WindowCost[][] = [];
    for (const computer of ask) {
      const answer = answers.get(computer.id);
      if (!answer) continue;
      if (answer === 'failed' || answer === 'no-account') missing.push(notCounted(computer, answer));
      else {
        counted.push(computer);
        lists.push(answer);
      }
    }
    // Without an account to match, other computers can't be asked: only this one counts, and that is all it says.
    return { windows: addWindowCosts(local, lists), counted, uncounted: key ? missing : [] };
  }, [enabled, local, answers, ask, uncounted, key]);
}
