import type { BackgroundTask } from '@switchboard/protocol/client';
import type { DisplayItem } from './displayItems.ts';
import type { ToolItem } from './ToolDetails.tsx';
import type { AgentTokens } from './turns.ts';

const isAgent = (item: DisplayItem): item is ToolItem => item.kind === 'tool' && !item.subagent && (item.name === 'Agent' || item.name === 'Task');

export interface AgentRun {
  item: ToolItem;
  running: boolean;
  /** Launched in the background (the call returns at once; the agent reports back later). */
  background: boolean;
  /** Claude Code's id for a background agent, from the launch's result: the id its background task has too. */
  agentId: string | null;
  /** The agent type (`general-purpose`, `Explore`…). */
  type: string;
  /** What the agent was asked to do, in a few words. */
  what: string;
  /** The full instruction it was given. */
  prompt: string | null;
  /** The model the call asked for (`sonnet`, `opus`…), null when it left it to the agent type or the session's model. */
  asked: string | null;
  /** What it reported back, once done: the call's result, or a background agent's hand-back. */
  report: string | null;
}

/** An agent's type, short description and full prompt, from the call that started it. */
export function describeAgent(item: ToolItem): Pick<AgentRun, 'type' | 'what' | 'prompt' | 'asked'> {
  const input = (item.input ?? {}) as { description?: unknown; subagent_type?: unknown; prompt?: unknown; model?: unknown };
  const prompt = typeof input.prompt === 'string' && input.prompt.trim() ? input.prompt : null;
  return {
    type: typeof input.subagent_type === 'string' ? input.subagent_type : 'agent',
    what: typeof input.description === 'string' ? input.description : prompt ? prompt.slice(0, 100) : 'Agent',
    prompt,
    asked: typeof input.model === 'string' && input.model.trim() ? input.model : null,
  };
}

/** The model an agent runs on: the one its replies used, else the one the call asked for. Null before it has replied and when the call left it open. */
export function agentModel(run: AgentRun, usage: AgentTokens | undefined): string | null {
  return usage?.model ?? run.asked;
}

/**
 * Every agent in a session and whether it's still working. A foreground agent runs until its
 * call returns; a background one until its report comes back. Nothing runs in a closed session.
 */
export function agentRuns(items: readonly DisplayItem[], sessionOpen: boolean): AgentRun[] {
  // Finished: reported back by agent id (hand-backs) or by the call's id (task notifications).
  const reports = items.filter((i): i is Extract<DisplayItem, { kind: 'agent-report' }> => i.kind === 'agent-report');
  const reported = new Set(reports.flatMap((r) => [r.agentId, ...(r.toolUseId ? [r.toolUseId] : [])]));
  return items.filter(isAgent).map((item) => {
    const launched = !!item.result && /Async agent launched/.test(item.result.text);
    const agentId = launched ? (/agentId: (\w+)/.exec(item.result!.text)?.[1] ?? null) : null;
    const working = item.result === null || (launched && !reported.has(item.id) && !(agentId && reported.has(agentId)));
    const handBack = launched ? reports.find((r) => r.toolUseId === item.id || (agentId !== null && r.agentId === agentId)) : undefined;
    const report = launched ? (handBack?.text ?? null) : (item.result?.text ?? null);
    return { item, background: launched, running: sessionOpen && working, agentId, ...describeAgent(item), report };
  });
}

/** The run a background task (the bottom strip's list) stands for: by Claude Code's id, else by its description. */
export function agentForTask(task: BackgroundTask, runs: readonly AgentRun[]): AgentRun | undefined {
  const own = runs.find((run) => run.agentId !== null && run.agentId === task.taskId);
  if (own) return own;
  const sameWords = runs.filter((run) => run.background && run.running && run.what === task.description);
  return sameWords.length === 1 ? sameWords[0] : undefined;
}

/** The task that keeps a background agent running, which a Stop button ends. Foreground agents have none. */
export function taskForAgent(run: AgentRun, tasks: readonly BackgroundTask[]): BackgroundTask | undefined {
  if (!run.background || !run.running) return undefined;
  return tasks.find((task) => agentForTask(task, [run]) === run);
}

/** Running agents first, each group newest first as given. */
export function splitAgents(runs: readonly AgentRun[]): { active: AgentRun[]; finished: AgentRun[] } {
  return { active: runs.filter((run) => run.running), finished: runs.filter((run) => !run.running) };
}

/** The agent the panel shows: the one picked if it is still there, else the newest running one, else the newest. */
export function shownAgent(runs: readonly AgentRun[], picked: string | null): AgentRun | undefined {
  return runs.find((run) => run.item.id === picked) ?? runs.find((run) => run.running) ?? runs[0];
}
