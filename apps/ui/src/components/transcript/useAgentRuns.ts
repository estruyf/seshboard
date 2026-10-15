import { useMemo } from 'react';
import type { DisplayItem } from './displayItems.ts';
import { agentRuns, type AgentRun } from './agentRuns.ts';

/** Agents Claude started in this session, newest first, and how many are still running. */
export function useAgentRuns(items: readonly DisplayItem[], sessionOpen: boolean): { agents: AgentRun[]; running: number } {
  const agents = useMemo(() => agentRuns(items, sessionOpen).reverse(), [items, sessionOpen]);
  return { agents, running: agents.filter((a) => a.running).length };
}
