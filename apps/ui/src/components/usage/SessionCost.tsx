import { useEffect, useState } from 'react';
import { REMOTE_FEATURE_COSTS, type Computer, type Contract, type RpcClient } from '@switchboard/protocol/client';
import { useEngineConnection } from '../../engine/useEngine.ts';
import { useProfiles } from '../../state/profilesStore.ts';
import { callComputer } from '../computers/callComputer.ts';
import { useCostFormat } from './useCost.ts';

/** How often it asks again, to pick up new turns between the engine's notices. */
const POLL_MS = 60_000;

type Cost = { usd: number; partial: boolean } | null;

/** The line itself: "Cost ≈$4.20", with what it counts in its tooltip. Nothing before there is a cost. */
function CostLine({ cost, format }: { cost: Cost; format: (usd: number) => string }) {
  if (!cost) return null;
  const tooltip = `What this session would cost at Anthropic's API prices, since it started: every turn and its agents, each model at its own price.${cost.partial ? ' A model without a known price is left out.' : ''} Your plan is not billed per token.`;
  return (
    <span className="flex h-6 shrink-0 items-center px-1.5 whitespace-nowrap tabular-nums @max-[520px]:hidden" data-tooltip={tooltip} data-session-cost>
      Cost&nbsp;<span className="text-faint">{format(cost.usd)}</span>
    </span>
  );
}

/**
 * One session's estimated API cost since it started, for the line under its message box: "Cost ≈$4.20". Asked
 * again when the engine reads new tokens for the profile. Nothing while Show estimated cost is off, or before any of
 * the session's tokens were read.
 */
export function SessionCost({ sessionId, profileId: given }: { sessionId: string; /** The session's profile; the default one when it isn't known. */ profileId: string | null }) {
  const defaultId = useProfiles((s) => s.defaultId);
  const profileId = given ?? defaultId;
  const format = useCostFormat();
  const connection = useEngineConnection();
  const client = connection.status === 'connected' ? connection.client : null;
  const [cost, setCost] = useState<Cost>(null);
  const enabled = format !== null;
  useEffect(() => {
    setCost(null);
    if (!client || !enabled) return;
    let alive = true;
    const load = () =>
      void client.call('usage.sessionCost', { sessionId, profileId }).then(
        (result) => alive && setCost(result.cost),
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
  }, [client, sessionId, profileId, enabled]);
  return format && <CostLine cost={cost} format={format} />;
}

/**
 * The same for a session on another computer, which answers from its own transcripts (`usage.sessionCost` there, with
 * `REMOTE_FEATURE_COSTS`): asked when the view opens, when a turn ends (`working` goes off) and every minute. Nothing
 * while that computer is offline or on an older Switchboard.
 */
export function RemoteSessionCost({ client, computer, sessionId, working }: { client: RpcClient<Contract>; computer: Computer; sessionId: string; working: boolean }) {
  const format = useCostFormat();
  const [cost, setCost] = useState<Cost>(null);
  const able = format !== null && computer.state === 'connected' && computer.features.includes(REMOTE_FEATURE_COSTS);
  useEffect(() => {
    if (!able) return setCost(null);
    let alive = true;
    const load = () =>
      void callComputer(client, computer.id, 'usage.sessionCost', { sessionId }).then(
        (result) => alive && setCost(result.cost),
        () => {},
      );
    load();
    const timer = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [client, computer.id, sessionId, able, working]);
  return format && able && <CostLine cost={cost} format={format} />;
}
