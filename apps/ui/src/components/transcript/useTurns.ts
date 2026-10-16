import { useEffect, useMemo, useRef, useState } from 'react';
import type { Contract, RpcClient } from '@switchboard/protocol/client';
import { useHosts } from '../../state/hostsStore.ts';
import type { DisplayItem } from './displayItems.ts';
import { updateTurns, type AgentTokens, type Turn, type TurnContext, type TurnsState, type Wait } from './turns.ts';

const NO_WAITS: readonly Wait[] = [];
const AGENT_TOOLS = new Set(['Task', 'Agent']);

/**
 * The conversation's turns, kept up to date as messages land: only the open turn is grouped again (`updateTurns`).
 * Subagents' tokens come from their own transcripts, asked for again when a subagent starts or a turn ends.
 */
export function useTurns(client: RpcClient<Contract> | null, sessionId: string, items: readonly DisplayItem[], working: boolean): Turn[] {
  const waits = useHosts((s) => s.waits.get(sessionId) ?? NO_WAITS);
  const agents = useAgentTokens(client, sessionId, items, working);
  const context = useMemo<TurnContext>(() => ({ waits, agents }), [waits, agents]);
  const state = useRef<TurnsState | null>(null);
  const turns = useMemo(() => {
    state.current = updateTurns(state.current?.items.length && state.current.items[0]?.key === items[0]?.key ? state.current : null, items, context);
    return state.current.turns;
  }, [items, context]);
  return turns;
}

/** The subagent calls in the conversation, as one string that changes when one starts or finishes. */
function agentCalls(items: readonly DisplayItem[]): string {
  const ids: string[] = [];
  for (const item of items) if (item.kind === 'tool' && AGENT_TOOLS.has(item.name)) ids.push(`${item.id}${item.result ? '+' : ''}`);
  return ids.join(',');
}

function useAgentTokens(client: RpcClient<Contract> | null, sessionId: string, items: readonly DisplayItem[], working: boolean): ReadonlyMap<string, AgentTokens> | undefined {
  const calls = useMemo(() => agentCalls(items), [items]);
  const [agents, setAgents] = useState<{ sessionId: string; map: ReadonlyMap<string, AgentTokens> } | null>(null);
  useEffect(() => {
    if (!client || !calls) return;
    let cancelled = false;
    // A short wait, so a burst of subagents finishing is one read.
    const timer = setTimeout(() => {
      client.call('transcript.agentUsage', { sessionId }).then(
        ({ agents }) => !cancelled && setAgents({ sessionId, map: new Map(agents.map((a) => [a.toolUseId, a])) }),
        () => {},
      );
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, sessionId, calls, working]);
  return agents?.sessionId === sessionId ? agents.map : undefined;
}
